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

/** Poll GET http://127.0.0.1:{port}/{path} until it returns 200 or timeout. */
async function pollUntilReady(
  port: number,
  path: string,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      if (res.ok) return;
    } catch {
      // Server not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `llama-server at port ${port} did not become healthy within ${timeoutMs / 1000}s`,
  );
}

// ── Chat message type ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ── Runtime manager state ─────────────────────────────────────────────────────

let _proc: ChildProcess | null = null;
let _port: number | null = null;
let _modelId: string | null = null;

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
   * If a server is already running for the same model, returns immediately.
   * If a server is running for a different model, it is stopped first.
   */
  async start(modelId: string): Promise<void> {
    if (_proc && !_proc.killed && _modelId === modelId) {
      // Already running the right model — verify health and return.
      if (_port !== null) {
        await pollUntilReady(_port, "/health", 5_000);
      }
      return;
    }

    // Different model or dead process — stop whatever is running.
    await runtimeManager.stop();

    const record = modelRegistry.listInstalled().find((r) => r.id === modelId);
    if (!record) {
      throw new Error(
        `Model "${modelId}" is not installed. Run the offline install flow first.`,
      );
    }

    let binaryPath: string;
    try {
      binaryPath = resolveRuntimeBinaryPath();
    } catch (err) {
      throw new Error(
        `Cannot start offline runtime: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const port = await getFreePort();

    console.log(
      `[runtimeManager] starting llama-server on port ${port} ` +
        `with model ${record.modelPath}`,
    );

    const args = [
      "--model", record.modelPath,
      "--port", String(port),
      "--host", "127.0.0.1",
      "--ctx-size", "4096",
      "--n-predict", "-1",
      "--threads", String(Math.max(1, Math.floor(os.cpus().length / 2))),
      "--no-display-prompt",
      "--log-disable",
    ];

    _proc = spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    _port = port;
    _modelId = modelId;

    _proc.on("error", (err) => {
      console.error("[runtimeManager] process error:", err);
      _proc = null;
      _port = null;
      _modelId = null;
    });

    _proc.on("exit", (code, signal) => {
      console.log(
        `[runtimeManager] process exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
      );
      _proc = null;
      _port = null;
      _modelId = null;
    });

    // Log stderr so failures are visible in the Electron log.
    _proc.stderr?.on("data", (data: Buffer) => {
      console.log(`[llama-server] ${data.toString().trimEnd()}`);
    });

    // Wait for the server to accept connections.
    await pollUntilReady(port, "/health", 60_000);

    console.log(`[runtimeManager] server ready on port ${port}`);
  },

  /** Stop the running inference server. Safe to call when already stopped. */
  async stop(): Promise<void> {
    if (!_proc || _proc.killed) {
      _proc = null;
      _port = null;
      _modelId = null;
      return;
    }

    const proc = _proc;
    _proc = null;
    _port = null;
    _modelId = null;

    await new Promise<void>((resolve) => {
      const onExit = () => resolve();
      proc.once("exit", onExit);
      proc.once("error", onExit);

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
  ): Promise<void> {
    // Ensure the server is running (lazy start).
    await runtimeManager.start(modelId);

    // Mark this model as used now so the management UI can render
    // a meaningful "last used" timestamp for each installed model.
    touchOfflineModelLastUsed(modelId);

    if (_port === null) {
      throw new Error("[runtimeManager] server port not available after start");
    }

    const url = `http://127.0.0.1:${_port}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        stream: true,
        temperature: 0.7,
        top_p: 0.9,
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

    // Parse the SSE (Server-Sent Events) stream.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
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
      reader.releaseLock();
    }
  },
};
