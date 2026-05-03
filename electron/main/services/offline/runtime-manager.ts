import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as os from "os";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  statSync,
  accessSync,
  constants as fsConstants,
} from "fs";
import { extname, join } from "path";
import { modelRegistry } from "./model-registry";
import { resolveRuntimeBinaryPath } from "./runtime-catalog";
import { storageService } from "./storage";
import { touchOfflineModelLastUsed } from "../database";

// ── Port utilities ────────────────────────────────────────────────────────────

/** Find a free TCP port by letting the OS pick one. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Could not determine free port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Poll GET http://127.0.0.1:{port}/{path} until `predicate` returns true
 * for the response, or the timeout elapses.  Used to distinguish the
 * "TCP server accepting connections" milestone (any HTTP response, even
 * 503) from the "model loaded" milestone (200 OK).  llama.cpp's
 * `/health` endpoint returns 503 with `{"status": "loading model"}`
 * while the GGUF is being mmap'd into RAM, then flips to 200 once the
 * model is ready — exactly the signal we need to render an honest
 * "warming up model" step instead of one big spinner.
 */
async function pollUntil(
  port: number,
  path: string,
  predicate: (res: Response) => boolean,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // The diagnostics snapshot captures the *most recent* /health poll
  // result so the Runtime Diagnostics panel can show "server up, model
  // still loading" vs "server unreachable" vs "fully ready".  Only
  // writes when the path is /health to avoid polluting the snapshot
  // with unrelated probes.
  const recordHealth = (res: HealthCheckResult) => {
    if (path === "/health") _diagnostics.lastHealthCheck = res;
  };
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      recordHealth({
        ok: res.ok,
        status: res.ok ? "ready" : res.status === 503 ? "loading" : "unknown",
        at: Date.now(),
        httpStatus: res.status,
      });
      if (predicate(res)) return;
    } catch (err) {
      recordHealth({
        ok: false,
        status: "unreachable",
        at: Date.now(),
        detail: err instanceof Error ? err.message : String(err),
      });
      // Server not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `llama-server at port ${port}${path} did not satisfy readiness within ${timeoutMs / 1000}s`,
  );
}

/** Poll GET http://127.0.0.1:{port}/{path} until it returns 200 or timeout. */
async function pollUntilReady(
  port: number,
  path: string,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  return pollUntil(port, path, (res) => res.ok, timeoutMs, intervalMs);
}

// ── Diagnostics helpers ───────────────────────────────────────────────────────

/** `existsSync` that swallows EACCES/EPERM/etc. and returns false. */
function safeExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Return the file size in bytes, or `null` if `path` does not exist /
 * cannot be stat'd.  Used by pre-launch validation to catch zero-byte
 * "installed" GGUFs (e.g. interrupted downloads that were renamed into
 * place by a buggy install path) before they reach `llama-server`,
 * which otherwise mmaps the empty file and exits with a cryptic
 * "tensor not found" error 30 s later.
 */
function safeFileSize(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

/**
 * Return `true` if the current process can `execve` `path`.  On POSIX
 * this requires the owner/group/other execute bit to be set; on
 * Windows the concept doesn't exist (every regular file is executable
 * if its extension says so), so we treat existence as sufficient.
 *
 * `child_process.spawn` will surface EACCES eventually, but only after
 * a setup round-trip — pre-checking here lets us emit a clear
 * "binary is not executable" recovery banner instead of a generic
 * spawn-error.
 */
function isExecutable(path: string): boolean {
  if (process.platform === "win32") {
    return safeExists(path);
  }
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lower-cased file extensions accepted by the bundled llama.cpp
 * runtime.  `.gguf` is the only on-disk format the install pipeline
 * produces today, but the check is centralised so adding e.g. `.bin`
 * support later only touches one constant.
 */
const SUPPORTED_MODEL_EXTENSIONS: ReadonlySet<string> = new Set([".gguf"]);

/**
 * Result of {@link validateLaunchPreconditions}.  When `ok` is true
 * the caller may proceed to `spawn`; the resolved paths are returned
 * so the caller never has to re-derive them.  When `ok` is false the
 * caller MUST abort the launch and surface the failure exactly as
 * given — `kind`, `phase`, `message`, and `recoveryActions` are all
 * picked to drive the renderer's failure banner verbatim.
 */
type LaunchPreconditionResult =
  | {
      ok: true;
      modelPath: string;
      modelSizeBytes: number;
      binaryPath: string;
    }
  | {
      ok: false;
      phase: RuntimeStartupPhase;
      kind: RuntimeStartupFailureDetails["kind"];
      message: string;
      recoveryActions: RuntimeRecoveryAction[];
      modelPath: string | null;
      binaryPath: string | null;
    };

/**
 * Run *every* pre-launch invariant required by the offline runtime in
 * a single pass and return either the resolved `{modelPath, binaryPath}`
 * tuple or a structured failure that maps 1:1 to recovery affordances.
 *
 * Why a single helper:
 *   - Each check used to be inlined in `start()`, which made it easy
 *     to add a new field without remembering to also surface a
 *     recovery action for it.  Centralising the rules guarantees the
 *     UI banner and the backend agree on what counts as "broken".
 *   - The helper runs entirely synchronously and *before* `spawn()`,
 *     so a corrupt-but-marked-installed model is caught with a clear
 *     fix path instead of a 60-second readiness timeout followed by
 *     an opaque "process exited" message.
 *
 * Validation order is chosen so the most useful diagnostic wins:
 *   1. Model record present in registry          → recovery: choose-other
 *   2. Model record carries a non-empty path     → recovery: repair / reinstall / remove
 *   3. Model file exists on disk                 → recovery: repair / reinstall / remove / reveal-folder / choose-other
 *   4. Model file is non-zero bytes              → recovery: repair / reinstall / remove / reveal-folder / choose-other
 *   5. Model file extension is supported         → recovery: remove / choose-other / reveal-folder
 *   6. Runtime binary path resolves              → recovery: reinstall-runtime
 *   7. Runtime binary exists on disk             → recovery: reinstall-runtime
 *   8. Runtime binary has the execute bit        → recovery: reinstall-runtime
 *
 * Compatibility check (#8.5 — currently a degenerate one-format world):
 *   - `.gguf` ↔ llama.cpp.  When more runtimes/formats land, extend
 *     SUPPORTED_MODEL_EXTENSIONS plus a per-runtime allow-list and
 *     return a `config-error` with `choose-other` recovery on
 *     mismatch.
 */
function validateLaunchPreconditions(modelId: string): LaunchPreconditionResult {
  // 1. Registry lookup.
  const record = modelRegistry.listInstalled().find((r) => r.id === modelId);
  if (!record) {
    return {
      ok: false,
      phase: "checking-model",
      kind: "config-error",
      message:
        `Model "${modelId}" is not installed. Pick another installed model, ` +
        `or reinstall this one from Manage models.`,
      recoveryActions: ["choose-other", "reinstall"],
      modelPath: null,
      binaryPath: null,
    };
  }

  // 2. Model path defined and non-empty.
  if (typeof record.modelPath !== "string" || record.modelPath.length === 0) {
    return {
      ok: false,
      phase: "checking-model",
      kind: "config-error",
      message:
        `The offline_models entry for "${modelId}" has no file path. ` +
        `The registry row appears corrupt — repair, reinstall, or remove ` +
        `the model from Manage models.`,
      recoveryActions: ["repair", "reinstall", "remove", "choose-other"],
      modelPath: null,
      binaryPath: null,
    };
  }
  const modelPath = record.modelPath;

  // 3. Model file exists on disk.
  if (!safeExists(modelPath)) {
    return {
      ok: false,
      phase: "checking-model",
      kind: "missing-file",
      message:
        `Model file is missing on disk: ${modelPath}. ` +
        `Repair or reinstall "${modelId}", or pick another installed model.`,
      recoveryActions: ["repair", "reinstall", "remove", "choose-other", "reveal-folder"],
      modelPath,
      binaryPath: null,
    };
  }

  // 4. Model file is non-zero bytes.
  const modelSizeBytes = safeFileSize(modelPath);
  if (modelSizeBytes === null) {
    return {
      ok: false,
      phase: "checking-model",
      kind: "missing-file",
      message:
        `Cannot read model file at ${modelPath}. The file may have been ` +
        `removed, locked by another process, or its containing folder is ` +
        `unreadable. Try repairing or reinstalling "${modelId}".`,
      recoveryActions: ["repair", "reinstall", "remove", "choose-other", "reveal-folder"],
      modelPath,
      binaryPath: null,
    };
  }
  if (modelSizeBytes === 0) {
    return {
      ok: false,
      phase: "checking-model",
      kind: "missing-file",
      message:
        `Model file at ${modelPath} is empty (0 bytes). The download was ` +
        `likely interrupted. Repair or reinstall "${modelId}" to recover.`,
      recoveryActions: ["repair", "reinstall", "remove", "choose-other", "reveal-folder"],
      modelPath,
      binaryPath: null,
    };
  }

  // 5. Model file extension/format is supported (== compatible with
  //    the only runtime we currently ship: llama.cpp).
  const ext = extname(modelPath).toLowerCase();
  if (!SUPPORTED_MODEL_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      phase: "checking-model",
      kind: "config-error",
      message:
        `Model file ${modelPath} has unsupported format "${ext || "(none)"}". ` +
        `The bundled offline runtime only loads ${[...SUPPORTED_MODEL_EXTENSIONS].join(", ")} ` +
        `files. Remove this entry and install a compatible model.`,
      recoveryActions: ["remove", "choose-other", "reveal-folder"],
      modelPath,
      binaryPath: null,
    };
  }

  // 6. Runtime binary path resolves.
  let binaryPath: string;
  try {
    binaryPath = resolveRuntimeBinaryPath();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      phase: "checking-binary",
      kind: "config-error",
      message:
        `Cannot resolve offline runtime binary: ${cause}. ` +
        `Reinstall the offline runtime from Manage offline models to recover.`,
      recoveryActions: ["reinstall-runtime"],
      modelPath,
      binaryPath: null,
    };
  }
  if (typeof binaryPath !== "string" || binaryPath.length === 0) {
    return {
      ok: false,
      phase: "checking-binary",
      kind: "config-error",
      message:
        `Offline runtime binary path is empty. ` +
        `Reinstall the offline runtime from Manage offline models to recover.`,
      recoveryActions: ["reinstall-runtime"],
      modelPath,
      binaryPath: null,
    };
  }

  // 7. Runtime binary exists on disk.
  if (!safeExists(binaryPath)) {
    return {
      ok: false,
      phase: "checking-binary",
      kind: "missing-file",
      message:
        `Runtime binary is missing on disk: ${binaryPath}. ` +
        `Reinstall the offline runtime to recover.`,
      recoveryActions: ["reinstall-runtime"],
      modelPath,
      binaryPath,
    };
  }

  // 8. Runtime binary is executable (POSIX only — see isExecutable()).
  if (!isExecutable(binaryPath)) {
    return {
      ok: false,
      phase: "checking-binary",
      kind: "config-error",
      message:
        `Runtime binary at ${binaryPath} is not executable. ` +
        `Reinstall the offline runtime to restore the execute bit.`,
      recoveryActions: ["reinstall-runtime"],
      modelPath,
      binaryPath,
    };
  }

  return { ok: true, modelPath, modelSizeBytes, binaryPath };
}

/**
 * Append `chunk` to a bounded tail buffer used to capture llama-server
 * stdout/stderr.  Newer bytes always win — when the combined size
 * exceeds `maxBytes`, the leading bytes are discarded.  Newlines in the
 * chunk are preserved so the rendered tail stays readable.
 */
function appendTail(prev: string, chunk: string, maxBytes: number): string {
  const next = prev + chunk;
  if (next.length <= maxBytes) return next;
  return next.slice(next.length - maxBytes);
}

/** Return the last non-empty line of `text`, suitable for inline error display. */
function tailLine(text: string): string {
  const trimmed = text.replace(/\s+$/u, "");
  const idx = trimmed.lastIndexOf("\n");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Absolute path to the on-disk "last runtime startup failure" log,
 * persisted to the offline root so a user can hand it to support.
 * The path is stable across runs so "Open Logs" always reveals the
 * latest failure (or shows the user an empty file when no failure
 * has happened yet).
 */
export function getRuntimeFailureLogPath(): string {
  return join(storageService.getOfflineRoot(), "runtime-last-failure.log");
}

/**
 * Persist a structured failure record to the offline root so the
 * renderer's "Open Logs" action can reveal something concrete in the
 * file manager.  Best-effort: write errors are logged but never
 * propagated, and the file always overwrites the previous run so we
 * don't leak unbounded history.
 */
function writeRuntimeFailureLog(failure: RuntimeStartupFailureDetails): void {
  const path = getRuntimeFailureLogPath();
  try {
    mkdirSync(storageService.getOfflineRoot(), { recursive: true });
  } catch {
    /* ignore — write below will surface the real error */
  }
  const lines = [
    `# GHChat offline runtime startup failure`,
    `Timestamp:        ${new Date().toISOString()}`,
    `Kind:             ${failure.kind}`,
    `Phase:            ${failure.phase}`,
    `Last step:        ${failure.lastInProgressPhase ?? "<n/a>"}`,
    `Phase elapsed:    ${
      failure.phaseElapsedMs === null ? "<n/a>" : `${failure.phaseElapsedMs} ms`
    }`,
    `Message:          ${failure.message}`,
    `Model ID:         ${failure.modelId ?? "<unknown>"}`,
    `Model path:       ${failure.modelPath ?? "<unknown>"}` +
      (failure.modelPathExists === null
        ? ""
        : ` (exists=${failure.modelPathExists})`),
    `Binary path:      ${failure.binaryPath ?? "<unknown>"}` +
      (failure.binaryPathExists === null
        ? ""
        : ` (exists=${failure.binaryPathExists})`),
    `Process exited:   ${failure.exited}`,
    `Exit code:        ${failure.exitCode ?? "<n/a>"}`,
    `Signal:           ${failure.signal ?? "<n/a>"}`,
    "",
    "── stderr tail ─────────────────────────────",
    failure.stderrTail || "<empty>",
    "",
    "── stdout tail ─────────────────────────────",
    failure.stdoutTail || "<empty>",
    "",
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
}

// ── Chat message type ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Per-spawn options for the llama.cpp server.  When omitted, sane
 * defaults are used.  Changes here only take effect on the next
 * `start()` after the runtime has been stopped.
 */
export interface RuntimeSpawnOptions {
  /** Context window size; default 4096. */
  contextSize?: number;
  /** Worker thread count; default = floor(cpus/2). */
  threads?: number;
  /**
   * How long (ms) to wait for the model to finish loading and the
   * `/health` endpoint to flip to 200 OK during the `warming-up` phase
   * before declaring the start a timeout failure.  Defaults to
   * {@link DEFAULT_READINESS_TIMEOUT_MS}.  Smaller models on a fast
   * SSD load in seconds; large 20+ GB GGUFs on spinning disks can
   * take 2-3 minutes — this knob lets the user lift the cap if the
   * default trips on their hardware.
   */
  readinessTimeoutMs?: number;
}

/**
 * Default warm-up readiness timeout (ms).  Bumped from the legacy
 * 120 s value so 7-13B models on spinning disks stop tripping the
 * spurious "did not satisfy readiness" failure.
 */
export const DEFAULT_READINESS_TIMEOUT_MS = 180_000;

/**
 * Fine-grained startup phase reported by `runtimeManager.start()`.
 * Mirrored by the renderer-facing `OfflineRuntimeStartupPhase` in
 * src/types/index.ts; kept duplicated here so the main-process module
 * has no compile-time dependency on the renderer types barrel.
 */
export type RuntimeStartupPhase =
  | "checking-model"
  | "checking-binary"
  | "preparing-config"
  | "launching-process"
  | "waiting-for-server"
  | "warming-up"
  | "ready"
  | "failed";

/**
 * Structured diagnostics attached to a `failed` startup phase so the
 * renderer can render an actionable error UI (and so a user reporting
 * "offline silently died" can copy-paste the values into a bug report).
 *
 * Every field is optional because the failure may happen before the
 * value is known — e.g. a missing model record means we never resolve
 * a model path; a missing binary means we never reach spawn.  All
 * fields are best-effort, must never contain secrets, and must be
 * safe to display to the user verbatim.
 */
export interface RuntimeStartupFailureDetails {
  /** Phase in which the failure occurred. */
  phase: RuntimeStartupPhase;
  /**
   * The last *non-terminal* phase observed before failure.  When
   * `phase === "failed"`, the failing step is whichever phase was in
   * progress at that moment — recorded here so the renderer never has
   * to guess.  May equal `phase` for very early failures (e.g. argument
   * validation throws before the first phase).
   */
  lastInProgressPhase: RuntimeStartupPhase | null;
  /**
   * Coarse failure category.  Drives the user-facing copy:
   *   - `timeout`        readiness poll exceeded its budget
   *   - `exited`         process died before becoming ready
   *   - `spawn-error`    `child_process.spawn` itself threw
   *   - `missing-file`   model GGUF or runtime binary not on disk
   *   - `config-error`   missing/invalid model record / binary path
   *   - `unknown`        catch-all for anything else
   */
  kind:
    | "timeout"
    | "exited"
    | "spawn-error"
    | "missing-file"
    | "config-error"
    | "unknown";
  /** Short, user-facing failure message (same string as `detail`). */
  message: string;
  /** Active model id, when known. */
  modelId: string | null;
  /** Resolved on-disk model path, when known. */
  modelPath: string | null;
  /** Whether `modelPath` exists on disk at the moment of failure. */
  modelPathExists: boolean | null;
  /** Resolved llama-server binary path, when known. */
  binaryPath: string | null;
  /** Whether `binaryPath` exists on disk at the moment of failure. */
  binaryPathExists: boolean | null;
  /**
   * How long (ms) the failing phase had been running when it failed.
   * Surfaces "stuck for 180 s" without the renderer needing its own
   * timer.  Null when the phase had not yet been entered (e.g. early
   * validation failure before any phase was reported).
   */
  phaseElapsedMs: number | null;
  /**
   * Process exit code, when the runtime exited before becoming ready.
   * Null when the runtime had not exited at the time of failure
   * (e.g. readiness poll timeout while the process was still alive).
   */
  exitCode: number | null;
  /** Process termination signal (e.g. "SIGKILL"), when known. */
  signal: string | null;
  /**
   * Whether the runtime process had exited at the time of failure.
   * Distinguishes "process crashed before ready" from "process is
   * alive but slow" — both surface as a readiness failure but only
   * the former is silent-exit.
   */
  exited: boolean;
  /** Bounded tail of llama-server stderr (may be empty). */
  stderrTail: string;
  /** Bounded tail of llama-server stdout (may be empty). */
  stdoutTail: string;
  /**
   * Recovery actions the renderer should expose to the user for this
   * specific failure.  Computed by pre-launch validation so the banner
   * can render only the buttons that make sense — e.g. a missing model
   * file gets {repair, reinstall, remove, choose-other, reveal-folder}
   * but not "reinstall runtime", while a missing binary gets
   * {reinstall-runtime} only.  Defaults to an empty array for failures
   * raised after a successful spawn (where the model + binary are known
   * to be on disk and the right fix is "view logs" / "retry").
   */
  recoveryActions: RuntimeRecoveryAction[];
}

/**
 * The set of UI affordances the renderer may render in response to a
 * runtime startup failure.  Kept as a small string-literal union so it
 * crosses the IPC boundary as plain JSON and can be exhaustively
 * rendered (each value maps to one button or link in
 * `RuntimeFailureBanner`).
 */
export type RuntimeRecoveryAction =
  | "repair"
  | "reinstall"
  | "remove"
  | "choose-other"
  | "reveal-folder"
  | "reinstall-runtime";

/**
 * Callback invoked at every stage of a runtime start so callers can
 * surface step-by-step progress in the UI and the Electron log.
 *
 * `detail` carries an actionable message — for `failed` it is the
 * underlying error text; for other phases it may include the resolved
 * path / port / etc. for diagnostic logging.  Implementations must
 * never throw — the runtime treats this as a fire-and-forget signal.
 */
export type RuntimeStartupPhaseCallback = (
  phase: RuntimeStartupPhase,
  detail?: string,
  /**
   * Structured failure diagnostics — only populated when `phase` is
   * `failed`.  Mutually compatible with the legacy `detail` string
   * (callers that ignore this argument keep working).
   */
  failure?: RuntimeStartupFailureDetails,
  /**
   * Wall-clock timestamp (ms since epoch) when this phase was entered.
   * The renderer ticks against `Date.now() - phaseStartedAt` to show a
   * live "elapsed Xs" badge so a slow boot still feels responsive.
   */
  phaseStartedAt?: number,
) => void;

/**
 * Per-request generation options forwarded to the chat completion call.
 */
export interface RuntimeGenerationOptions {
  temperature?: number;
  topP?: number;
  /** Token cap; -1 = no limit (default).  Capping prevents runaway streams. */
  maxTokens?: number;
}

// ── Runtime diagnostics retention ─────────────────────────────────────────────

/**
 * Bounded snapshot of every diagnostic field the Runtime Diagnostics
 * panel surfaces.  Lives at module scope (not inside `start()`) so the
 * data persists across the start/ready/exit lifecycle and is queryable
 * any time via `getDiagnostics()` — even while the runtime is `stopped`
 * or `failed`.
 *
 * Mirrored as `OfflineRuntimeDiagnostics` in src/types/index.ts (less
 * the composite `runtimeState` / path fields which the IPC overlay
 * fills in).
 */
interface DiagnosticsSnapshot {
  modelId: string | null;
  modelPath: string | null;
  binaryPath: string | null;
  lastStartedAt: number | null;
  lastReadyAt: number | null;
  lastStartupDurationMs: number | null;
  lastExitAt: number | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  stderrTail: string;
  stdoutTail: string;
  lastHealthCheck: HealthCheckResult | null;
  lastErrorMessage: string | null;
}

/** Result of the most recent `/health` poll, retained for diagnostics. */
export interface HealthCheckResult {
  ok: boolean;
  status: "ready" | "loading" | "unreachable" | "unknown";
  at: number;
  httpStatus?: number;
  detail?: string;
}

let _diagnostics: DiagnosticsSnapshot = {
  modelId: null,
  modelPath: null,
  binaryPath: null,
  lastStartedAt: null,
  lastReadyAt: null,
  lastStartupDurationMs: null,
  lastExitAt: null,
  lastExitCode: null,
  lastExitSignal: null,
  stderrTail: "",
  stdoutTail: "",
  lastHealthCheck: null,
  lastErrorMessage: null,
};

/** Patch helper — only overrides supplied fields, preserving the rest. */
function updateDiagnostics(patch: Partial<DiagnosticsSnapshot>): void {
  _diagnostics = { ..._diagnostics, ...patch };
}

/**
 * Reset the per-attempt diagnostic fields when a fresh `start()` begins.
 * Keeps the *last* known model/binary/exit telemetry intact (so the
 * Diagnostics panel can still show "previous run exited with code X"
 * during the new start), but clears the just-started attempt's stderr,
 * stdout, health check, and error so the user doesn't see stale data
 * attributed to the new attempt.
 */
function resetDiagnosticsForAttempt(modelId: string): void {
  _diagnostics = {
    ..._diagnostics,
    modelId,
    lastStartedAt: Date.now(),
    lastReadyAt: null,
    lastStartupDurationMs: null,
    stderrTail: "",
    stdoutTail: "",
    lastHealthCheck: null,
    lastErrorMessage: null,
  };
}

// ── Runtime manager state ─────────────────────────────────────────────────────

let _proc: ChildProcess | null = null;
let _port: number | null = null;
let _modelId: string | null = null;
/** Tracks the spawn options the running process was started with so
 *  callers can detect when a setting change requires a restart. */
let _spawnOptions: RuntimeSpawnOptions = {};

// ── Runtime state machine ─────────────────────────────────────────────────────

/**
 * Discrete states of the offline runtime as observed by the renderer.
 * Mirrored by `OfflineRuntimeStateKind` in src/types/index.ts; kept
 * duplicated here so the main-process module has no compile-time
 * dependency on the renderer types barrel.
 *
 * `unconfigured` and `model-missing` are *composite* states — they
 * depend on the offline setup-state and the installed-model list and
 * are layered on by the IPC overlay (see `electron/main/ipc/offline.ts`).
 * The runtime manager itself only emits process-level kinds.
 */
export type RuntimeStateKind =
  | "unconfigured"
  | "model-missing"
  | "validating"
  | "launching"
  | "waiting-for-ready"
  | "warming-up"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

/**
 * Snapshot of the offline runtime state machine.  Mirrored by
 * `OfflineRuntimeState` in src/types/index.ts.
 */
export interface RuntimeState {
  kind: RuntimeStateKind;
  /** Wall-clock ms when this `kind` was entered (stable across step refinements). */
  enteredAt: number;
  /** Optional fine-grained step within the current `kind`. */
  step?: string;
  /** Optional user-facing label describing the current step. */
  progressLabel?: string;
  /** Model id the runtime is operating on, when known. */
  modelId?: string | null;
  /** Recovery actions the renderer should expose for the current state. */
  recoveryActions?: RuntimeRecoveryAction[];
  /** Structured diagnostics — only populated when `kind === "failed"`. */
  failure?: RuntimeStartupFailureDetails;
}

/** Listener notified on every observable state transition. */
export type RuntimeStateListener = (state: RuntimeState) => void;

let _state: RuntimeState = {
  kind: "stopped",
  enteredAt: Date.now(),
};
const _listeners = new Set<RuntimeStateListener>();

/**
 * Apply a state update.  Stamps `enteredAt: Date.now()` only when the
 * `kind` actually changes (so step refinements within a kind keep the
 * original anchor), notifies subscribers, and no-ops on byte-identical
 * snapshots so spurious re-broadcasts don't churn the renderer.
 *
 * Listeners are invoked synchronously and inside a try/catch — a
 * misbehaving listener can never derail the runtime lifecycle.
 */
function setState(next: Partial<RuntimeState> & { kind: RuntimeStateKind }): void {
  const prev = _state;
  const kindChanged = prev.kind !== next.kind;
  // Carry forward modelId / failure / recoveryActions only when a step
  // refinement within the same kind doesn't override them.  On a kind
  // change, fields not specified in `next` are dropped — a fresh kind
  // means a fresh snapshot.
  const merged: RuntimeState = kindChanged
    ? {
        kind: next.kind,
        enteredAt: Date.now(),
        step: next.step,
        progressLabel: next.progressLabel,
        modelId: next.modelId ?? null,
        recoveryActions: next.recoveryActions,
        failure: next.failure,
      }
    : {
        ...prev,
        ...next,
        // enteredAt anchored on the kind transition, NOT on each refinement.
        enteredAt: prev.enteredAt,
      };

  // No-op on byte-identical snapshots.
  if (
    prev.kind === merged.kind &&
    prev.enteredAt === merged.enteredAt &&
    prev.step === merged.step &&
    prev.progressLabel === merged.progressLabel &&
    (prev.modelId ?? null) === (merged.modelId ?? null) &&
    JSON.stringify(prev.recoveryActions ?? []) ===
      JSON.stringify(merged.recoveryActions ?? []) &&
    JSON.stringify(prev.failure ?? null) === JSON.stringify(merged.failure ?? null)
  ) {
    return;
  }

  _state = merged;
  console.log(
    `[runtimeManager.state] ${prev.kind} → ${merged.kind}` +
      (merged.step ? ` (${merged.step})` : "") +
      (merged.modelId ? ` modelId=${merged.modelId}` : ""),
  );
  for (const listener of _listeners) {
    try {
      listener(merged);
    } catch (err) {
      console.warn("[runtimeManager.state] listener threw:", err);
    }
  }
}

/** Map a startup phase to the corresponding state-machine kind. */
function phaseToStateKind(
  phase: RuntimeStartupPhase,
): Exclude<RuntimeStateKind, "unconfigured" | "model-missing" | "stopping" | "stopped"> {
  switch (phase) {
    case "checking-model":
    case "checking-binary":
    case "preparing-config":
      return "validating";
    case "launching-process":
      return "launching";
    case "waiting-for-server":
      return "waiting-for-ready";
    case "warming-up":
      return "warming-up";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
  }
}

// ── Runtime manager ───────────────────────────────────────────────────────────

/**
 * Runtime manager — owns the lifecycle of the local llama.cpp server
 * process and provides a streaming chat interface to the rest of the
 * main process.
 *
 * The server is started lazily the first time a chat request arrives in
 * offline mode (or explicitly via `start()`).  It stays running until
 * `stop()` is called or the Electron app exits.
 *
 * Communication with the server is over localhost HTTP using the
 * OpenAI-compatible `/v1/chat/completions` endpoint (with `stream: true`).
 * This means no native modules are required — only the built-in `fetch`
 * API and the `child_process` module.
 */
export const runtimeManager = {
  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Start the llama.cpp server for the given installed model.
   * If a server is already running for the same model AND the same spawn
   * options, returns immediately.  If the model id or spawn options have
   * changed, the existing process is stopped and a new one is started.
   *
   * `onPhase` (when provided) is invoked at each step of the startup
   * sequence so the caller can surface step-by-step progress.  Phases
   * are also written to the Electron log (`[runtimeManager.start] phase: …`)
   * regardless of whether a callback is supplied so a user reporting
   * "offline got stuck" can include their log file and we can see
   * exactly which step hung.
   */
  async start(
    modelId: string,
    options: RuntimeSpawnOptions = {},
    onPhase?: RuntimeStartupPhaseCallback,
  ): Promise<void> {
    // Track everything the renderer might need to surface in a failure
    // banner.  These are scoped to a single start() call so a
    // subsequent restart never inherits stale diagnostics.
    const MAX_TAIL_BYTES = 1000;
    const ctx: {
      modelPath: string | null;
      binaryPath: string | null;
      stderr: string;
      stdout: string;
      exitCode: number | null;
      signal: string | null;
      exited: boolean;
      currentPhase: RuntimeStartupPhase;
      /** Wall-clock ms when `currentPhase` was entered. */
      phaseStartedAt: number;
      /** Last *non-terminal* phase entered (i.e. excludes "ready"/"failed"). */
      lastInProgressPhase: RuntimeStartupPhase | null;
    } = {
      modelPath: null,
      binaryPath: null,
      stderr: "",
      stdout: "",
      exitCode: null,
      signal: null,
      exited: false,
      currentPhase: "checking-model",
      phaseStartedAt: Date.now(),
      lastInProgressPhase: null,
    };

    /**
     * Compose the structured failure record used by the UI's "Show
     * technical details" disclosure and the on-disk runtime-failure log.
     * Always reflects the most recent state of `ctx` so it is safe to
     * call from any failure branch — including the early-validation
     * branches that have no spawned process.
     */
    const buildFailure = (
      phase: RuntimeStartupPhase,
      message: string,
      kind: RuntimeStartupFailureDetails["kind"],
      recoveryActions: RuntimeRecoveryAction[] = [],
    ): RuntimeStartupFailureDetails => ({
      phase,
      lastInProgressPhase: ctx.lastInProgressPhase,
      kind,
      message,
      modelId: typeof modelId === "string" && modelId.length > 0 ? modelId : null,
      modelPath: ctx.modelPath,
      modelPathExists: ctx.modelPath ? safeExists(ctx.modelPath) : null,
      binaryPath: ctx.binaryPath,
      binaryPathExists: ctx.binaryPath ? safeExists(ctx.binaryPath) : null,
      phaseElapsedMs: Date.now() - ctx.phaseStartedAt,
      exitCode: ctx.exitCode,
      signal: ctx.signal,
      exited: ctx.exited,
      stderrTail: ctx.stderr,
      stdoutTail: ctx.stdout,
      recoveryActions,
    });

    // Wrap the user callback + structured log in one helper so every
    // startup phase is both visible in the UI and recoverable from a
    // post-mortem log.  Failures inside the callback must never crash
    // the start sequence.  When `phase === "failed"` we additionally
    // build structured diagnostics, persist them to disk, and forward
    // them to the callback so the renderer can render an actionable
    // error UI (with Retry / Open Logs / Manage Model actions) instead
    // of a vague "loading…" spinner.
    const reportPhase = (
      phase: RuntimeStartupPhase,
      detail?: string,
      kind: RuntimeStartupFailureDetails["kind"] = "unknown",
      recoveryActions: RuntimeRecoveryAction[] = [],
    ) => {
      const now = Date.now();
      if (phase !== "failed" && phase !== "ready") {
        ctx.lastInProgressPhase = phase;
      }
      ctx.currentPhase = phase;
      // IMPORTANT: only advance `phaseStartedAt` for *non-terminal*
      // phase transitions.  `failed` and `ready` are outcomes of the
      // previous step, not new steps — overwriting the anchor here
      // would make `phaseElapsedMs` inside buildFailure(...) collapse
      // to ~0 and mask the real "stuck for 180 s" signal.
      if (phase !== "failed" && phase !== "ready") {
        ctx.phaseStartedAt = now;
      }
      console.log(
        `[runtimeManager.start] phase=${phase}` +
          (detail ? ` detail=${detail}` : "") +
          ` modelId=${modelId}`,
      );
      // Persist resolved paths into module-scope diagnostics as soon
      // as they're known so the Diagnostics panel can show them even
      // mid-validation (when the panel is opened during a stuck
      // start).  We pull from `ctx` because that's where the spawn
      // pipeline writes them — module-scope just mirrors the latest.
      updateDiagnostics({
        modelPath: ctx.modelPath ?? _diagnostics.modelPath,
        binaryPath: ctx.binaryPath ?? _diagnostics.binaryPath,
        stderrTail: ctx.stderr || _diagnostics.stderrTail,
        stdoutTail: ctx.stdout || _diagnostics.stdoutTail,
      });
      let failure: RuntimeStartupFailureDetails | undefined;
      if (phase === "failed") {
        failure = buildFailure(
          phase,
          detail ?? "Runtime startup failed.",
          kind,
          recoveryActions,
        );
        try {
          writeRuntimeFailureLog(failure);
        } catch (err) {
          console.warn(
            "[runtimeManager.start] failed to persist runtime-last-failure.log:",
            err,
          );
        }
        // Pin the failure message + final exit telemetry into the
        // diagnostics snapshot so the panel surfaces the same root
        // cause the failure banner shows, even after the user
        // dismisses the banner.
        updateDiagnostics({
          lastErrorMessage: failure.message,
          lastExitCode: failure.exitCode ?? _diagnostics.lastExitCode,
          lastExitSignal: failure.signal ?? _diagnostics.lastExitSignal,
        });
      } else if (phase === "ready") {
        const readyAt = Date.now();
        const startedAt = _diagnostics.lastStartedAt;
        updateDiagnostics({
          lastReadyAt: readyAt,
          lastStartupDurationMs:
            startedAt !== null ? readyAt - startedAt : null,
          lastErrorMessage: null,
        });
      }
      // Mirror this phase into the state machine so a single snapshot
      // (`runtimeManager.getState()`) reflects the current condition.
      // Failed → stash failure + recoveryActions; otherwise the kind
      // overwrites any stale `failed`/`stopped` snapshot, which is
      // exactly the "retry resets stale state" requirement.
      const stateKind = phaseToStateKind(phase);
      if (stateKind === "failed") {
        setState({
          kind: "failed",
          modelId: typeof modelId === "string" && modelId.length > 0 ? modelId : null,
          step: ctx.lastInProgressPhase ?? undefined,
          progressLabel: detail,
          recoveryActions,
          failure,
        });
      } else {
        setState({
          kind: stateKind,
          modelId,
          step: phase,
          progressLabel: detail,
        });
      }
      try {
        onPhase?.(phase, detail, failure, now);
      } catch (err) {
        console.warn("[runtimeManager.start] onPhase callback threw:", err);
      }
    };

    // ── Argument validation ─────────────────────────────────────────────
    // Surface clear, actionable errors *before* anything reaches
    // `child_process.spawn`.  Without this, an undefined/empty modelId
    // or an undefined modelPath in the resolved record would crash deep
    // inside Node's spawn validation (or, when invoked across the
    // Electron IPC bridge with an undefined channel, surface as the
    // cryptic native binding error
    //   "Error processing argument at index 1, conversion failure from undefined").
    if (typeof modelId !== "string" || modelId.length === 0) {
      const msg =
        `[runtimeManager.start] missing required argument "modelId" ` +
        `(received ${modelId === undefined ? "undefined" : JSON.stringify(modelId)}). ` +
        `Caller must resolve the active offline model id before calling start().`;
      console.error(msg);
      reportPhase("failed", msg, "config-error", ["choose-other"]);
      throw new Error(msg);
    }

    // Anchor diagnostics for this attempt — `lastStartedAt` becomes the
    // "Last attempt" timestamp surfaced in the Diagnostics panel, and
    // resetting per-attempt stderr/stdout/health/error keeps the panel
    // from attributing the previous run's failure to this one.  We
    // intentionally retain `lastExitCode/Signal/At` so the diagnostics
    // panel can still show "previous run exited with code X" while the
    // new attempt is in flight.
    resetDiagnosticsForAttempt(modelId);

    const sameOptions =
      _spawnOptions.contextSize === options.contextSize &&
      _spawnOptions.threads === options.threads;
    if (_proc && !_proc.killed && _modelId === modelId && sameOptions) {
      // Already running the right model with the right options — verify
      // health and return.  Surface a single "ready" phase so the
      // renderer's progress UI doesn't sit blank for a warm restart.
      try {
        if (_port !== null) {
          await pollUntilReady(_port, "/health", 5_000);
        }
        reportPhase("ready", "warm: runtime already serving this model");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reportPhase("failed", `warm-health check failed: ${msg}`, "timeout");
        throw err;
      }
    }

    // Different model, different options, or dead process — stop whatever
    // is running.
    await runtimeManager.stop();

    try {
      reportPhase("checking-model", `validating installed model "${modelId}"`);
      // Run every pre-launch invariant in one place — see
      // validateLaunchPreconditions() for the full list.  Failures
      // here surface a structured `recoveryActions` array so the
      // banner can render only the buttons that make sense for the
      // specific fault (repair / reinstall / remove / pick another /
      // reveal model folder / reinstall runtime).
      const pre = validateLaunchPreconditions(modelId);
      if (!pre.ok) {
        // Record whatever paths we already resolved so buildFailure
        // surfaces them in the structured failure record (e.g. a
        // missing-binary error still includes the resolved binary
        // path so "Show technical details" is useful).
        ctx.modelPath = pre.modelPath;
        ctx.binaryPath = pre.binaryPath;
        // `pre.phase` is the *step* that failed (checking-model or
        // checking-binary).  Anchor `lastInProgressPhase` there so the
        // banner shows "Last step: Checking model" instead of the
        // initial validating-installed-model log entry.
        ctx.lastInProgressPhase = pre.phase;
        reportPhase("failed", pre.message, pre.kind, pre.recoveryActions);
        throw new Error(pre.message);
      }
      ctx.modelPath = pre.modelPath;
      ctx.binaryPath = pre.binaryPath;

      reportPhase(
        "checking-binary",
        `runtime binary OK at ${pre.binaryPath} (model ${(pre.modelSizeBytes / 1024 / 1024).toFixed(1)} MB)`,
      );

      reportPhase("preparing-config", "selecting free port and runtime knobs");

      const port = await getFreePort();

      const ctxSize = options.contextSize ?? 4096;
      const threads = options.threads ?? Math.max(1, Math.floor(os.cpus().length / 2));

      console.log(
        `[runtimeManager] starting llama-server on port ${port} ` +
          `(modelId=${modelId}, modelPath=${ctx.modelPath}, ` +
          `binaryPath=${ctx.binaryPath}, ctx=${ctxSize}, threads=${threads})`,
      );

      const args = [
        "--model", pre.modelPath,
        "--port", String(port),
        "--host", "127.0.0.1",
        "--ctx-size", String(ctxSize),
        "--n-predict", "-1",
        "--threads", String(threads),
        "--no-display-prompt",
        "--log-disable",
      ];

      // Defence in depth: every arg above is derived from validated
      // inputs, but a future refactor that lets `undefined` slip into
      // this array would crash deep inside Node's spawn validation
      // with a confusing "the argv argument must be of type string"
      // message.  Catch it here with the same recovery surface as a
      // missing-model failure so the user gets actionable copy.
      const badArgIdx = args.findIndex(
        (a) => typeof a !== "string" || a.length === 0,
      );
      if (badArgIdx >= 0) {
        const msg =
          `Internal error: runtime arg #${badArgIdx} is empty or undefined ` +
          `(args=${JSON.stringify(args)}). Refusing to spawn llama-server.`;
        console.error(`[runtimeManager.start] ${msg}`);
        reportPhase("failed", msg, "config-error", ["choose-other"]);
        throw new Error(msg);
      }

      reportPhase(
        "launching-process",
        `spawning llama-server on port ${port} (ctx=${ctxSize}, threads=${threads})`,
      );

      let proc: ChildProcess;
      try {
        proc = spawn(pre.binaryPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });
      } catch (err) {
        const msg = `Failed to spawn llama-server: ${err instanceof Error ? err.message : String(err)}`;
        reportPhase("failed", msg, "spawn-error");
        throw new Error(msg);
      }

      _proc = proc;
      _port = port;
      _modelId = modelId;
      _spawnOptions = { contextSize: ctxSize, threads };

      // ── Output capture + early-exit detection ───────────────────────
      // The previous implementation only kept stderr and treated a
      // process exit during the readiness wait as a generic timeout.
      // That was the root cause of "runtime silently stops" — when
      // llama-server died on a bad GGUF or OOM, the user sat for 60+
      // seconds before seeing a vague timeout message that omitted
      // the exit code, signal, and stdout context entirely.
      //
      // Now: stdout and stderr are both tailed (bounded), exit code
      // and signal are captured the instant the process dies, and a
      // dedicated `exitPromise` lets the readiness poll abort the
      // moment the process exits — surfacing the real reason in
      // milliseconds instead of minutes.
      let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
      const exitPromise = new Promise<void>((resolve) => {
        onExit = (code, signal) => {
          ctx.exited = true;
          ctx.exitCode = code;
          ctx.signal = signal ?? null;
          // Capture into the persistent diagnostics snapshot so the
          // Runtime Diagnostics panel can show the exit code/signal
          // even after the runtime has been fully torn down (e.g.
          // user opens the panel after a crash and clicks "stopped").
          updateDiagnostics({
            lastExitAt: Date.now(),
            lastExitCode: code,
            lastExitSignal: signal ?? null,
            stderrTail: ctx.stderr,
            stdoutTail: ctx.stdout,
          });
          console.log(
            `[runtimeManager] process exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
          );
          // If the runtime had already reached `ready` (i.e. an
          // unexpected mid-stream death rather than a startup
          // failure), surface this as `failed` so the renderer never
          // silently falls back to `idle`.  Startup-time exits are
          // already converted to `failed` by the readiness race
          // (raceReadiness throws → reportPhase("failed", …)), so the
          // `setState` here is a no-op in that path.  Stop()-driven
          // exits transition `stopping → stopped` from stop() itself
          // and we leave that snapshot alone here.
          if (_state.kind === "ready") {
            const failure: RuntimeStartupFailureDetails = {
              phase: "ready",
              lastInProgressPhase: "warming-up",
              kind: "exited",
              message:
                `Offline runtime exited unexpectedly` +
                ` (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
              modelId: _modelId,
              modelPath: ctx.modelPath,
              modelPathExists: ctx.modelPath ? safeExists(ctx.modelPath) : null,
              binaryPath: ctx.binaryPath,
              binaryPathExists: ctx.binaryPath ? safeExists(ctx.binaryPath) : null,
              phaseElapsedMs: null,
              exitCode: code,
              signal: signal ?? null,
              exited: true,
              stderrTail: ctx.stderr,
              stdoutTail: ctx.stdout,
              recoveryActions: [],
            };
            setState({
              kind: "failed",
              modelId: _modelId,
              progressLabel: failure.message,
              recoveryActions: [],
              failure,
            });
          }
          _proc = null;
          _port = null;
          _modelId = null;
          _spawnOptions = {};
          resolve();
        };
        proc.once("exit", onExit);
      });

      proc.on("error", (err) => {
        console.error("[runtimeManager] process error:", err);
        ctx.stderr = appendTail(
          ctx.stderr,
          `[process error] ${err.message}`,
          MAX_TAIL_BYTES,
        );
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        ctx.stderr = appendTail(ctx.stderr, text, MAX_TAIL_BYTES);
        const trimmed = text.trimEnd();
        if (trimmed.length > 0) console.log(`[llama-server] ${trimmed}`);
      });

      proc.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        ctx.stdout = appendTail(ctx.stdout, text, MAX_TAIL_BYTES);
        const trimmed = text.trimEnd();
        if (trimmed.length > 0) console.log(`[llama-server:out] ${trimmed}`);
      });

      /**
       * Run a readiness poll concurrently with the process exit
       * promise.  Whichever resolves first wins:
       *   - poll succeeds → readiness milestone reached
       *   - process exits → throw an "exited before ready" error
       *     carrying the captured code/signal/stderr/stdout
       *   - poll times out → throw the timeout message
       */
      const raceReadiness = async (
        path: string,
        predicate: (res: Response) => boolean,
        timeoutMs: number,
        what: string,
      ): Promise<void> => {
        const pollPromise = pollUntil(port, path, predicate, timeoutMs).then(
          () => "ready" as const,
        );
        const exitSentinel = exitPromise.then(() => "exited" as const);
        const winner = await Promise.race([pollPromise, exitSentinel]);
        if (winner === "exited") {
          throw new Error(
            `Runtime process exited before ${what}` +
              ` (code=${ctx.exitCode ?? "null"}, signal=${ctx.signal ?? "null"})`,
          );
        }
        // pollPromise won — let any rejection (timeout) propagate.
        await pollPromise;
      };

      // Wait for the HTTP server to start accepting connections.  Any
      // HTTP response (including 503 "loading model") proves the
      // process is alive — we then transition to "warming-up" while
      // llama.cpp finishes mmap-loading the GGUF into memory.
      reportPhase(
        "waiting-for-server",
        `polling http://127.0.0.1:${port}/health for TCP readiness`,
      );
      try {
        await raceReadiness("/health", () => true, 60_000, "TCP readiness");
      } catch (err) {
        const baseMsg = err instanceof Error ? err.message : String(err);
        const detail = ctx.exited
          ? `${baseMsg}. The runtime process stopped before the HTTP server came up.`
          : `${baseMsg}${ctx.stderr ? ` — last stderr: ${tailLine(ctx.stderr)}` : ""}`;
        reportPhase("failed", detail, ctx.exited ? "exited" : "timeout");
        try {
          if (proc && !proc.killed && !ctx.exited) proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      // Warm-up timeout is the dominant cost on slow disks / large
      // models — make it configurable via RuntimeSpawnOptions so users
      // hitting the default cap can lift it without code changes.
      const readinessTimeoutMs =
        options.readinessTimeoutMs && options.readinessTimeoutMs > 0
          ? options.readinessTimeoutMs
          : DEFAULT_READINESS_TIMEOUT_MS;
      reportPhase(
        "warming-up",
        `waiting for model to finish loading into memory ` +
          `(timeout=${Math.round(readinessTimeoutMs / 1000)}s)`,
      );
      try {
        // /health returns 200 once the GGUF is fully loaded; before
        // that it returns 503 with `{"status": "loading model"}`.  This
        // is the real "warming up" signal — the previous one-shot
        // spinner masked it entirely on slow disks.
        await raceReadiness(
          "/health",
          (res) => res.ok,
          readinessTimeoutMs,
          "model warm-up",
        );
      } catch (err) {
        const baseMsg = err instanceof Error ? err.message : String(err);
        const detail = ctx.exited
          ? `${baseMsg}. The runtime process stopped while loading the model.`
          : `${baseMsg}${ctx.stderr ? ` — last stderr: ${tailLine(ctx.stderr)}` : ""}`;
        reportPhase("failed", detail, ctx.exited ? "exited" : "timeout");
        try {
          if (proc && !proc.killed && !ctx.exited) proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      reportPhase("ready", `serving on port ${port}`);
      console.log(`[runtimeManager] server ready on port ${port}`);
    } catch (err) {
      // Any unhandled error from the start sequence — make sure we
      // flag it as a "failed" phase exactly once for the renderer.
      // The individual catch blocks above already report their own
      // detail so re-emitting here would be noisy; rely on the inner
      // reports and just rethrow.
      throw err;
    }
  },

  /**
   * Stop the running inference server. Safe to call when already stopped.
   *
   * Uses SIGTERM first for a graceful shutdown, then escalates to SIGKILL
   * after a short grace period.  When `force` is true, SIGKILL is sent
   * immediately — used by the cancel-watchdog when a hung generation
   * needs to be aborted right now.
   */
  async stop(opts: { force?: boolean } = {}): Promise<void> {
    if (!_proc || _proc.killed) {
      _proc = null;
      _port = null;
      _modelId = null;
      _spawnOptions = {};
      // Already stopped — make sure the state machine reflects that.
      // Don't downgrade a `failed` snapshot to `stopped` (the failure
      // diagnostics are still relevant until the user retries), but
      // any other lingering kind (`ready`, `warming-up`, etc.) should
      // collapse to `stopped` so the UI doesn't claim the runtime is
      // alive.
      if (_state.kind !== "stopped" && _state.kind !== "failed") {
        setState({ kind: "stopped" });
      }
      return;
    }

    const proc = _proc;
    const stoppingModelId = _modelId;
    _proc = null;
    _port = null;
    _modelId = null;
    _spawnOptions = {};

    setState({
      kind: "stopping",
      modelId: stoppingModelId,
      step: opts.force ? "force-kill" : "graceful-shutdown",
    });

    try {
      await new Promise<void>((resolve) => {
        const onExit = () => resolve();
        proc.once("exit", onExit);
        proc.once("error", onExit);

        if (opts.force) {
          proc.kill("SIGKILL");
          return;
        }

        // Give the process 3 s to shut down gracefully, then force-kill.
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 3_000);
      });
      setState({ kind: "stopped" });
    } catch (err) {
      // SIGKILL itself failed (extremely rare — typically EPERM).
      // Surface this as `failed` so the user gets actionable diagnostics
      // instead of a silent stuck-stopping state.
      const message = err instanceof Error ? err.message : String(err);
      const failure: RuntimeStartupFailureDetails = {
        phase: "ready",
        lastInProgressPhase: null,
        kind: "unknown",
        message: `Failed to stop runtime: ${message}`,
        modelId: stoppingModelId,
        modelPath: null,
        modelPathExists: null,
        binaryPath: null,
        binaryPathExists: null,
        phaseElapsedMs: null,
        exitCode: null,
        signal: null,
        exited: false,
        stderrTail: "",
        stdoutTail: "",
        recoveryActions: [],
      };
      setState({
        kind: "failed",
        modelId: stoppingModelId,
        progressLabel: failure.message,
        failure,
      });
      throw err;
    }
  },

  /** Returns true when the server process is currently active. */
  isRunning(): boolean {
    return _proc !== null && !_proc.killed;
  },

  /** Returns the port the server is listening on, or null if not running. */
  getPort(): number | null {
    return _port;
  },

  /** Returns the model id currently loaded in the runtime, or null. */
  getCurrentModelId(): string | null {
    return _modelId;
  },

  /**
   * Returns a snapshot of the runtime state machine.  Safe to call
   * any time — when no runtime has ever been started this returns the
   * initial `{kind: "stopped"}` state.
   */
  getState(): RuntimeState {
    return _state;
  },

  /**
   * Returns a structured snapshot of every diagnostic field surfaced
   * by the Runtime Diagnostics panel (paths, last attempt times,
   * exit code/signal, stderr/stdout tail, last health check, last
   * error).  Composes the module-level `_diagnostics` snapshot with
   * live process data (port, isRunning) so a single read covers the
   * full picture.  Safe to call any time; never starts the runtime.
   */
  getDiagnostics(): DiagnosticsSnapshot & {
    isRunning: boolean;
    port: number | null;
    currentModelId: string | null;
  } {
    return {
      ..._diagnostics,
      isRunning: _proc !== null && !_proc.killed,
      port: _port,
      currentModelId: _modelId,
    };
  },

  /**
   * Subscribe to state-machine transitions.  The listener is invoked
   * once per `setState` call that actually changes the snapshot.
   * Returns an unsubscribe function — callers MUST call it on shutdown
   * to avoid leaking listeners.
   */
  subscribe(listener: RuntimeStateListener): () => void {
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  },

  // ── Inference ───────────────────────────────────────────────────────────────

  /**
   * Stream a chat completion from the local llama.cpp server.
   *
   * Calls `onToken` for every incremental piece of content.  Resolves when
   * the stream is complete, and rejects when a network or model error occurs.
   *
   * The caller should ensure the server is running (call `start()` first
   * or rely on the IPC handler to start it lazily).
   *
   * `signal` can be used to cancel the stream — a cancelled stream resolves
   * without error so callers can distinguish user-initiated stops from failures.
   */
  async streamChat(
    modelId: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal,
    options: {
      spawn?: RuntimeSpawnOptions;
      generation?: RuntimeGenerationOptions;
      /**
       * Optional callback fired immediately after the HTTP request body
       * has been written and the response stream is ready, but before
       * the first token is received.  Used by the IPC layer to surface
       * a "processing prompt" lifecycle phase so the user can see real
       * progress on slow on-device generation.
       */
      onPromptSent?: () => void;
      /**
       * Optional progress callback forwarded to `start()` so chat
       * dispatch surfaces step-by-step runtime startup status the same
       * way an explicit Restart from Settings does.  Only invoked when
       * the runtime actually has to spawn / load — warm requests skip
       * straight to the existing prompt-sent / first-token signals.
       */
      onRuntimePhase?: RuntimeStartupPhaseCallback;
    } = {},
  ): Promise<void> {
    // Ensure the server is running with the requested spawn options
    // (this may stop and restart the runtime when the user changed
    // context size or thread count between requests).
    await runtimeManager.start(modelId, options.spawn ?? {}, options.onRuntimePhase);

    // Mark this model as used now so the management UI can render
    // a meaningful "last used" timestamp for each installed model.
    touchOfflineModelLastUsed(modelId);

    if (_port === null) {
      throw new Error("[runtimeManager] server port not available after start");
    }

    const url = `http://127.0.0.1:${_port}/v1/chat/completions`;

    const gen = options.generation ?? {};
    // Cap generation by default so a runaway model can't stream forever.
    // The IPC layer feeds this from offline_settings; here we keep a
    // sane fallback so direct callers are still safe.
    const maxTokens = gen.maxTokens ?? 1024;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        stream: true,
        temperature: gen.temperature ?? 0.7,
        top_p: gen.topP ?? 0.9,
        // -1 means "no cap" for llama.cpp.  Any positive value is honored
        // so the server stops generating after N tokens — critical for
        // killing runaway generations on low-end hardware.
        max_tokens: maxTokens,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new Error(
        `llama-server returned HTTP ${response.status}: ${body}`,
      );
    }

    if (!response.body) {
      throw new Error("llama-server response has no body");
    }

    // Fire the prompt-sent hook now that the request body is in flight
    // and the runtime has begun ingesting tokens.  This is the cue the
    // IPC layer uses to advance the lifecycle from "loading model" /
    // "starting runtime" to "processing prompt".
    try {
      options.onPromptSent?.();
    } catch (err) {
      console.warn("[runtimeManager] onPromptSent callback threw:", err);
    }

    // Parse the SSE (Server-Sent Events) stream.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        // Eagerly bail when the caller has aborted — the underlying
        // fetch read may already have buffered chunks, so we don't
        // need to wait for those to drain.
        if (signal?.aborted) return;

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (signal?.aborted) return;

          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          if (!data) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const delta =
            (parsed as { choices?: Array<{ delta?: { content?: string } }> })
              ?.choices?.[0]?.delta?.content;

          if (typeof delta === "string" && delta.length > 0) {
            onToken(delta);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        // User-initiated cancel — resolve cleanly.
        return;
      }
      throw err;
    } finally {
      // Best-effort cancel of the reader so the underlying socket is
      // released immediately.  Without this, the read() future can hang
      // around for the duration of the next token batch on slow models.
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  },
};
