import type { IpcMain, IpcMainEvent } from "electron";
import { huggingFaceProvider } from "../providers";
import { IPC } from "./channels";

// Active abort controllers keyed by requestId — used to stop streaming
const activeStreams = new Map<string, AbortController>();

interface StreamRequest {
  requestId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  apiKey: string;
}

export function registerHfHandlers(ipcMain: IpcMain): void {
  // ── List recommended models ──────────────────────────────────────────────
  ipcMain.handle(IPC.HF_MODELS_LIST, () => huggingFaceProvider.getRecommendedModels());

  // ── Validate API key ─────────────────────────────────────────────────────
  ipcMain.handle(IPC.HF_KEY_VALIDATE, async (_e, key: string) =>
    huggingFaceProvider.validateApiKey(key),
  );

  // ── Start streaming chat ─────────────────────────────────────────────────
  ipcMain.on(
    IPC.HF_CHAT_STREAM,
    async (
      event: IpcMainEvent,
      { requestId, model, messages, apiKey }: StreamRequest,
    ) => {
      const controller = new AbortController();
      activeStreams.set(requestId, controller);

      const send = (channel: string, payload: unknown) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel, payload);
        }
      };

      try {
        await huggingFaceProvider.streamChat({
          model,
          messages: messages as Array<{
            role: "user" | "assistant" | "system";
            content: string;
          }>,
          apiKey,
          signal: controller.signal,
          onToken: (token) => {
            send(IPC.HF_CHAT_TOKEN, { requestId, token });
          },
        });

        send(IPC.HF_CHAT_END, { requestId });
      } catch (err) {
        if (controller.signal.aborted) {
          // Renderer already handles stop — send end so UI resets cleanly
          send(IPC.HF_CHAT_END, { requestId });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const userMessage = formatHfError(message);
          send(IPC.HF_CHAT_ERROR, { requestId, error: userMessage });
        }
      } finally {
        activeStreams.delete(requestId);
      }
    },
  );

  // ── Stop streaming ───────────────────────────────────────────────────────
  ipcMain.on(IPC.HF_CHAT_STOP, (_e, { requestId }: { requestId: string }) => {
    activeStreams.get(requestId)?.abort();
    activeStreams.delete(requestId);
  });
}

/** Translate raw HF API errors into user-friendly messages. */
function formatHfError(raw: string): string {
  if (raw.includes("401") || raw.includes("Unauthorized")) {
    return "Invalid API key — open Settings to update it.";
  }
  if (raw.includes("403") || raw.includes("Forbidden")) {
    return "Access denied — your key may not have permission for this model.";
  }
  if (raw.includes("429") || raw.includes("Rate limit")) {
    return "Rate limit reached — wait a moment and try again.";
  }
  if (raw.includes("503") || raw.includes("loading") || raw.includes("currently loading")) {
    return "Model is loading on Hugging Face — try again in 20–30 seconds.";
  }
  if (raw.includes("404") || raw.includes("not found")) {
    return "Model not found — it may have been removed or the name is incorrect.";
  }
  if (
    raw.includes("ECONNREFUSED") ||
    raw.includes("ENOTFOUND") ||
    raw.includes("fetch failed")
  ) {
    return "Network error — check your internet connection and try again.";
  }
  // Return a truncated version of the original if nothing matched
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}
