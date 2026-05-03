import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as os from "os";
import { modelRegistry } from "./model-registry";
import { resolveRuntimeBinaryPath } from "./runtime-catalog";
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
    // Wrap the user callback + structured log in one helper so every
    // startup phase is both visible in the UI and recoverable from a
    // post-mortem log.  Failures inside the callback must never crash
    // the start sequence.
    const reportPhase = (phase: RuntimeStartupPhase, detail?: string) => {
      console.log(
        `[runtimeManager.start] phase=${phase}` +
          (detail ? ` detail=${detail}` : "") +
          ` modelId=${modelId}`,
      );
      try {
        onPhase?.(phase, detail);
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

      reportPhase("preparing-config", "selecting free port and runtime knobs");
      const port = await getFreePort();

      const ctxSize = options.contextSize ?? 4096;
      const threads = options.threads ?? Math.max(1, Math.floor(os.cpus().length / 2));

      console.log(
        `[runtimeManager] starting llama-server on port ${port} ` +
          `(modelId=${modelId}, modelPath=${record.modelPath}, ` +
          `binaryPath=${binaryPath}, ctx=${ctxSize}, threads=${threads})`,
      );

      const args = [
        "--model", record.modelPath,
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
        proc = spawn(binaryPath, args, {
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

      // Capture the most recent stderr line so a startup failure can
      // surface it (e.g. "failed to load model" / "out of memory") rather
      // than only the generic readiness-timeout.  Bounded so a chatty
      // model log can't grow this buffer without limit.
      const MAX_STDERR_TAIL_BYTES = 500;
      let lastStderr = "";
      _proc.on("error", (err) => {
        console.error("[runtimeManager] process error:", err);
        _proc = null;
        _port = null;
        _modelId = null;
        _spawnOptions = {};
      });

      _proc.on("exit", (code, signal) => {
        console.log(
          `[runtimeManager] process exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
        );
        _proc = null;
        _port = null;
        _modelId = null;
        _spawnOptions = {};
      });

      // Log stderr so failures are visible in the Electron log.  Keep
      // the trailing window so we can attach it to a "failed" phase
      // detail if the readiness wait times out.
      _proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trimEnd();
        if (text.length > 0) {
          lastStderr =
            text.length > MAX_STDERR_TAIL_BYTES
              ? text.slice(-MAX_STDERR_TAIL_BYTES)
              : text;
          console.log(`[llama-server] ${text}`);
        }
      });

      // Wait for the HTTP server to start accepting connections.  Any
      // HTTP response (including 503 "loading model") proves the
      // process is alive — we then transition to "warming-up" while
      // llama.cpp finishes mmap-loading the GGUF into memory.
      reportPhase(
        "waiting-for-server",
        `polling http://127.0.0.1:${port}/health for TCP readiness`,
      );
      try {
        await pollUntil(port, "/health", () => true, 60_000);
      } catch (err) {
        const detail =
          (err instanceof Error ? err.message : String(err)) +
          (lastStderr ? ` — last stderr: ${lastStderr}` : "");
        reportPhase("failed", detail);
        // Best-effort: kill the process we spawned so we don't leave a
        // half-alive llama-server holding the port.
        try {
          if (proc && !proc.killed) proc.kill("SIGKILL");
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
        await pollUntilReady(port, "/health", 120_000);
      } catch (err) {
        const detail =
          (err instanceof Error ? err.message : String(err)) +
          (lastStderr ? ` — last stderr: ${lastStderr}` : "");
        reportPhase("failed", detail);
        try {
          if (proc && !proc.killed) proc.kill("SIGKILL");
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
