import type { IpcMain, IpcMainEvent } from "electron";
import { openRouterProvider } from "../providers";
import { IPC } from "./channels";
import { getApiKey } from "../services/keychain";

const activeStreams = new Map<string, AbortController>();

interface StreamRequest {
  requestId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  apiKey: string;
  webSearch?: boolean;
  reasoningOn?: boolean;
  maxTokens?: number | null;
}

function actionsForStatus(
  status: number | undefined,
  fallbackModel: string | undefined,
): string[] {
  if (status === 401) return ["verify-token", "settings"];
  if (status === 402) return ["settings"];
  if (status === 403) return fallbackModel ? ["fallback", "auto", "settings"] : ["auto", "settings"];
  if (status === 404) return fallbackModel ? ["fallback", "auto", "settings"] : ["auto", "settings"];
  if (status === 429) return fallbackModel ? ["retry", "fallback", "auto", "refresh-models"] : ["retry", "auto", "refresh-models"];
  if (status === 503) return fallbackModel ? ["retry", "fallback", "auto", "refresh-models"] : ["retry", "auto", "refresh-models"];
  return ["retry", "auto", "refresh-models", "settings"];
}

export function registerOrHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.OR_MODELS_LIST, async (_e, apiKey?: string) => {
    const key = (apiKey ?? getApiKey()).trim();
    if (!key) return openRouterProvider.getRecommendedModels();
    return openRouterProvider.listModelPresets(key);
  });

  ipcMain.handle(IPC.OR_DIAGNOSTICS_GET, async (_e, apiKey?: string) => {
    const key = (apiKey ?? getApiKey()).trim();
    if (!key) {
      const now = Date.now();
      return {
        apiKeyValid: false,
        apiKeyMessage: "No key set.",
        keyValidation: { status: "failed", message: "No OpenRouter API key configured.", checkedAt: now },
        catalogValidation: { status: "failed", message: "Catalog unavailable until a key is provided.", checkedAt: now },
        modelValidation: { status: "failed", message: "Model verification pending key setup.", checkedAt: now },
        streamingValidation: { status: "failed", message: "Streaming readiness pending key setup.", checkedAt: now },
        checkedAt: now,
        models: openRouterProvider.getRecommendedModels(),
        freeModelCount: 0,
        bestWorkingModels: [],
        noVerifiedModels: true,
        recommendedFallback: "openrouter/free",
      };
    }
    return openRouterProvider.getDiagnostics(key);
  });

  ipcMain.handle(IPC.OR_DIAGNOSTICS_REFRESH, async (_e, apiKey?: string) => {
    const key = (apiKey ?? getApiKey()).trim();
    if (!key) {
      const now = Date.now();
      return {
        apiKeyValid: false,
        apiKeyMessage: "No key set.",
        keyValidation: { status: "failed", message: "No OpenRouter API key configured.", checkedAt: now },
        catalogValidation: { status: "failed", message: "Catalog unavailable until a key is provided.", checkedAt: now },
        modelValidation: { status: "failed", message: "Model verification pending key setup.", checkedAt: now },
        streamingValidation: { status: "failed", message: "Streaming readiness pending key setup.", checkedAt: now },
        checkedAt: now,
        models: openRouterProvider.getRecommendedModels(),
        freeModelCount: 0,
        bestWorkingModels: [],
        noVerifiedModels: true,
        recommendedFallback: "openrouter/free",
      };
    }
    return openRouterProvider.getDiagnostics(key, { forceProbe: true });
  });

  ipcMain.handle(IPC.OR_KEY_VALIDATE, async (_e, key: string) =>
    openRouterProvider.validateApiKey(key),
  );

  ipcMain.on(
    IPC.OR_CHAT_STREAM,
    async (
      event: IpcMainEvent,
      { requestId, model, messages, apiKey, webSearch, reasoningOn, maxTokens }: StreamRequest,
    ) => {
      const controller = new AbortController();
      activeStreams.set(requestId, controller);

      const send = (channel: string, payload: unknown) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel, payload);
        }
      };

      try {
        await openRouterProvider.streamChat({
          model,
          messages: messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
          apiKey,
          signal: controller.signal,
          webSearch,
          reasoningOn,
          maxTokens,
          preferences: { webSearch, reasoningOn },
          onToken: (token) => {
            send(IPC.OR_CHAT_TOKEN, { requestId, token });
          },
          onRoutingDecision: (info) => {
            send(IPC.OR_CHAT_ROUTING, { requestId, ...info });
          },
        });

        send(IPC.OR_CHAT_END, { requestId });
      } catch (err) {
        if (controller.signal.aborted) {
          send(IPC.OR_CHAT_END, { requestId });
        } else {
          const routerErr = err as { message?: string; status?: number; fallbackModel?: string; model?: string; kind?: string };
          const message = routerErr.message ?? String(err);
          const status = routerErr.status;
          const fallbackModel = routerErr.fallbackModel;
          const failedModel = routerErr.model;
          const kind = routerErr.kind;
          const actions = actionsForStatus(status, fallbackModel);
          send(IPC.OR_CHAT_ERROR, { requestId, error: message, status, fallbackModel, failedModel, kind, actions });
        }
      } finally {
        activeStreams.delete(requestId);
      }
    },
  );

  ipcMain.on(IPC.OR_CHAT_STOP, (_e, { requestId }: { requestId: string }) => {
    activeStreams.get(requestId)?.abort();
    activeStreams.delete(requestId);
  });
}
