import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as os from "os";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
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
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      if (predicate(res)) return;
    } catch {
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
    `Phase:            ${failure.phase}`,
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
}

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
}

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

// ── Runtime manager state ─────────────────────────────────────────────────────

let _proc: ChildProcess | null = null;
let _port: number | null = null;
let _modelId: string | null = null;
/** Tracks the spawn options the running process was started with so
 *  callers can detect when a setting change requires a restart. */
let _spawnOptions: RuntimeSpawnOptions = {};

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
    } = {
      modelPath: null,
      binaryPath: null,
      stderr: "",
      stdout: "",
      exitCode: null,
      signal: null,
      exited: false,
      currentPhase: "checking-model",
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
    ): RuntimeStartupFailureDetails => ({
      phase,
      message,
      modelId: typeof modelId === "string" && modelId.length > 0 ? modelId : null,
      modelPath: ctx.modelPath,
      modelPathExists: ctx.modelPath ? safeExists(ctx.modelPath) : null,
      binaryPath: ctx.binaryPath,
      binaryPathExists: ctx.binaryPath ? safeExists(ctx.binaryPath) : null,
      exitCode: ctx.exitCode,
      signal: ctx.signal,
      exited: ctx.exited,
      stderrTail: ctx.stderr,
      stdoutTail: ctx.stdout,
    });

    // Wrap the user callback + structured log in one helper so every
    // startup phase is both visible in the UI and recoverable from a
    // post-mortem log.  Failures inside the callback must never crash
    // the start sequence.  When `phase === "failed"` we additionally
    // build structured diagnostics, persist them to disk, and forward
    // them to the callback so the renderer can render an actionable
    // error UI (with Retry / Open Logs / Manage Model actions) instead
    // of a vague "loading…" spinner.
    const reportPhase = (phase: RuntimeStartupPhase, detail?: string) => {
      ctx.currentPhase = phase;
      console.log(
        `[runtimeManager.start] phase=${phase}` +
          (detail ? ` detail=${detail}` : "") +
          ` modelId=${modelId}`,
      );
      let failure: RuntimeStartupFailureDetails | undefined;
      if (phase === "failed") {
        failure = buildFailure(phase, detail ?? "Runtime startup failed.");
        try {
          writeRuntimeFailureLog(failure);
        } catch (err) {
          console.warn(
            "[runtimeManager.start] failed to persist runtime-last-failure.log:",
            err,
          );
        }
      }
      try {
        onPhase?.(phase, detail, failure);
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
      reportPhase("failed", msg);
      throw new Error(msg);
    }

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
        reportPhase("failed", `warm-health check failed: ${msg}`);
        throw err;
      }
    }

    // Different model, different options, or dead process — stop whatever
    // is running.
    await runtimeManager.stop();

    try {
      reportPhase("checking-model", `looking up installed model "${modelId}"`);
      const record = modelRegistry.listInstalled().find((r) => r.id === modelId);
      if (!record) {
        const msg = `Model "${modelId}" is not installed. Run the offline install flow first.`;
        reportPhase("failed", msg);
        throw new Error(msg);
      }

      if (typeof record.modelPath !== "string" || record.modelPath.length === 0) {
        const msg =
          `[runtimeManager.start] model record for "${modelId}" has no modelPath ` +
          `(received ${record.modelPath === undefined ? "undefined" : JSON.stringify(record.modelPath)}). ` +
          `The offline_models row appears corrupt — try repairing or reinstalling the model.`;
        console.error(msg);
        reportPhase("failed", msg);
        throw new Error(msg);
      }
      ctx.modelPath = record.modelPath;

      reportPhase(
        "checking-binary",
        "resolving llama-server binary path",
      );
      let binaryPath: string;
      try {
        binaryPath = resolveRuntimeBinaryPath();
      } catch (err) {
        const msg = `Cannot start offline runtime: ${err instanceof Error ? err.message : String(err)}`;
        reportPhase("failed", msg);
        throw new Error(msg);
      }

      if (typeof binaryPath !== "string" || binaryPath.length === 0) {
        const msg =
          `[runtimeManager.start] resolveRuntimeBinaryPath() returned an empty value ` +
          `(received ${binaryPath === undefined ? "undefined" : JSON.stringify(binaryPath)}). ` +
          `Run the offline install flow to download the llama-server binary.`;
        console.error(msg);
        reportPhase("failed", msg);
        throw new Error(msg);
      }
      ctx.binaryPath = binaryPath;

      reportPhase("preparing-config", "selecting free port and runtime knobs");
      // Pre-flight existence checks — surface "file is gone" errors
      // here, before spawn, so the user sees a clear "model file not
      // found" message instead of a timeout three minutes later when
      // llama-server silently exits because it can't open the GGUF.
      if (!safeExists(ctx.modelPath)) {
        const msg =
          `Model file is missing on disk: ${ctx.modelPath}. ` +
          `Try repairing or reinstalling "${modelId}" from Manage models.`;
        reportPhase("failed", msg);
        throw new Error(msg);
      }
      if (!safeExists(ctx.binaryPath)) {
        const msg =
          `Runtime binary is missing on disk: ${ctx.binaryPath}. ` +
          `Reinstall the offline runtime to recover.`;
        reportPhase("failed", msg);
        throw new Error(msg);
      }

      const port = await getFreePort();

      const ctxSize = options.contextSize ?? 4096;
      const threads = options.threads ?? Math.max(1, Math.floor(os.cpus().length / 2));

      console.log(
        `[runtimeManager] starting llama-server on port ${port} ` +
          `(modelId=${modelId}, modelPath=${ctx.modelPath}, ` +
          `binaryPath=${ctx.binaryPath}, ctx=${ctxSize}, threads=${threads})`,
      );

      const args = [
        "--model", ctx.modelPath,
        "--port", String(port),
        "--host", "127.0.0.1",
        "--ctx-size", String(ctxSize),
        "--n-predict", "-1",
        "--threads", String(threads),
        "--no-display-prompt",
        "--log-disable",
      ];

      reportPhase(
        "launching-process",
        `spawning llama-server on port ${port} (ctx=${ctxSize}, threads=${threads})`,
      );

      let proc: ChildProcess;
      try {
        proc = spawn(ctx.binaryPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });
      } catch (err) {
        const msg = `Failed to spawn llama-server: ${err instanceof Error ? err.message : String(err)}`;
        reportPhase("failed", msg);
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
          console.log(
            `[runtimeManager] process exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
          );
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
        reportPhase("failed", detail);
        try {
          if (proc && !proc.killed && !ctx.exited) proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      reportPhase(
        "warming-up",
        "waiting for model to finish loading into memory",
      );
      try {
        // /health returns 200 once the GGUF is fully loaded; before
        // that it returns 503 with `{"status": "loading model"}`.  This
        // is the real "warming up" signal — the previous one-shot
        // spinner masked it entirely on slow disks.
        await raceReadiness(
          "/health",
          (res) => res.ok,
          120_000,
          "model warm-up",
        );
      } catch (err) {
        const baseMsg = err instanceof Error ? err.message : String(err);
        const detail = ctx.exited
          ? `${baseMsg}. The runtime process stopped while loading the model.`
          : `${baseMsg}${ctx.stderr ? ` — last stderr: ${tailLine(ctx.stderr)}` : ""}`;
        reportPhase("failed", detail);
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
      return;
    }

    const proc = _proc;
    _proc = null;
    _port = null;
    _modelId = null;
    _spawnOptions = {};

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
