import type { IpcMain, IpcMainEvent } from "electron";
import { huggingFaceProvider } from "../providers";
import { IPC } from "./channels";
import { getApiKey } from "../services/keychain";

// Active abort controllers keyed by requestId — used to stop streaming
const activeStreams = new Map<string, AbortController>();

interface StreamRequest {
  requestId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  apiKey: string;
}

/**
 * Map recovery actions appropriate for the given HTTP status so the renderer
 * can render targeted one-click recovery buttons.
 */
function actionsForStatus(
  status: number | undefined,
  fallbackModel: string | undefined,
): string[] {
  if (status === 401) return ["verify-token", "settings"];
  if (status === 402) return ["refresh-models", "auto", "settings"];
  if (status === 403) return fallbackModel ? ["fallback", "auto", "settings"] : ["auto", "settings"];
  if (status === 404) return fallbackModel ? ["fallback", "auto", "settings"] : ["auto", "settings"];
  if (status === 429) return fallbackModel ? ["retry", "fallback", "auto", "refresh-models"] : ["retry", "auto", "refresh-models"];
  if (status === 503) return fallbackModel ? ["retry", "fallback", "auto", "refresh-models"] : ["retry", "auto", "refresh-models"];
  return ["retry", "auto", "refresh-models", "settings"];
}

export function registerHfHandlers(ipcMain: IpcMain): void {
  // ── List recommended models ──────────────────────────────────────────────
  ipcMain.handle(IPC.HF_MODELS_LIST, async (_e, apiKey?: string) => {
    const key = (apiKey ?? getApiKey()).trim();
    if (!key) return huggingFaceProvider.getRecommendedModels();
    return huggingFaceProvider.listModelPresets(key);
  });

  ipcMain.handle(IPC.HF_DIAGNOSTICS_GET, async (_e, apiKey?: string) => {
    const key = (apiKey ?? getApiKey()).trim();
    if (!key) {
      const now = Date.now();
      return {
        tokenValid: false,
        tokenMessage: "No key set.",
        tokenValidation: { status: "failed", message: "No Hugging Face token configured.", checkedAt: now },
        inferenceValidation: { status: "failed", message: "Inference unavailable until a token is provided.", checkedAt: now },
        modelValidation: { status: "failed", message: "Model verification pending token setup.", checkedAt: now },
        streamingValidation: { status: "failed", message: "Streaming readiness pending token setup.", checkedAt: now },
        checkedAt: now,
        models: huggingFaceProvider.getRecommendedModels(),
        bestWorkingModels: [],
        noVerifiedModels: true,
        recommendedFallback: "Qwen/Qwen2.5-1.5B-Instruct",
      };
    }
    return huggingFaceProvider.getDiagnostics(key);
  });

  ipcMain.handle(IPC.HF_DIAGNOSTICS_REFRESH, async (_e, apiKey?: string) => {
    const key = (apiKey ?? getApiKey()).trim();
    if (!key) {
      const now = Date.now();
      return {
        tokenValid: false,
        tokenMessage: "No key set.",
        tokenValidation: { status: "failed", message: "No Hugging Face token configured.", checkedAt: now },
        inferenceValidation: { status: "failed", message: "Inference unavailable until a token is provided.", checkedAt: now },
        modelValidation: { status: "failed", message: "Model verification pending token setup.", checkedAt: now },
        streamingValidation: { status: "failed", message: "Streaming readiness pending token setup.", checkedAt: now },
        checkedAt: now,
        models: huggingFaceProvider.getRecommendedModels(),
        bestWorkingModels: [],
        noVerifiedModels: true,
        recommendedFallback: "Qwen/Qwen2.5-1.5B-Instruct",
      };
    }
    return huggingFaceProvider.getDiagnostics(key, { forceProbe: true });
  });

  // ── Validate API key ─────────────────────────────────────────────────────
  ipcMain.handle(IPC.HF_KEY_VALIDATE, async (_e, key: string) => huggingFaceProvider.validateApiKey(key));

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
          onRoutingDecision: (info) => {
            // Tell the renderer exactly which model is being used and why,
            // so the streaming indicator and post-response caption are accurate.
            send(IPC.HF_CHAT_ROUTING, { requestId, ...info });
          },
        });

        send(IPC.HF_CHAT_END, { requestId });
      } catch (err) {
        if (controller.signal.aborted) {
          // Renderer already handles stop — send end so UI resets cleanly
          send(IPC.HF_CHAT_END, { requestId });
        } else {
          // The provider already maps errors to human-friendly messages; send
          // the structured payload so the renderer can render recovery actions.
          const routerErr = err as { message?: string; status?: number; fallbackModel?: string; model?: string; kind?: string };
          const message = routerErr.message ?? String(err);
          const status = routerErr.status;
          const fallbackModel = routerErr.fallbackModel;
          const failedModel = routerErr.model;
          const kind = routerErr.kind;
          const actions = actionsForStatus(status, fallbackModel);
          send(IPC.HF_CHAT_ERROR, { requestId, error: message, status, fallbackModel, failedModel, kind, actions });
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
