import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { IPC } from "@/types";
import { AUTO_MODEL_ID } from "@/lib/models";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { IpcRendererEvent } from "electron";
import type { ChatErrorRecoveryAction, StructuredChatError, ChatFailureKind } from "@/types";

interface TokenPayload {
  requestId: string;
  token: string;
}

interface EndPayload {
  requestId: string;
}

interface ErrorPayload {
  requestId: string;
  error: string;
  status?: number;
  fallbackModel?: string;
  fallbackModelName?: string;
  failedModel?: string;
  kind?: ChatFailureKind;
  actions?: ChatErrorRecoveryAction[];
}

interface RoutingPayload {
  requestId: string;
  model: string;
  modelName: string;
  reason: string;
  isAuto: boolean;
  isFallback: boolean;
}

/** Derive a short conversation title from the first user message */
function deriveTitleFromMessage(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  // Take first sentence or first 50 chars, whichever is shorter
  const sentence = trimmed.split(/[.!?\n]/)[0].trim();
  const candidate = sentence.length > 4 ? sentence : trimmed;
  return candidate.length > 50 ? candidate.slice(0, 50).trimEnd() + "…" : candidate;
}

export function useChat(conversationId: string | null) {
  const qc = useQueryClient();
  const {
    isStreaming,
    streamingText,
    setStreaming,
    setStreamState,
    appendStreamingToken,
    resetStreaming,
    setLastStreamError,
    setRoutingInfo,
  } = useChatStore();
  const { selectedModel, setSelectedModel } = useSettingsStore();

  const activeRequestId = useRef<string | null>(null);
  // Mirror of streamingText in a ref so event callbacks see the latest value
  const streamingTextRef = useRef(streamingText);
  streamingTextRef.current = streamingText;

  // ── IPC listeners ──────────────────────────────────────────────────────────
  useEffect(() => {
    const offToken = window.ghchat.on(
      IPC.OR_CHAT_TOKEN,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId, token } = payload as TokenPayload;
        if (requestId === activeRequestId.current) {
          appendStreamingToken(token);
        }
      },
    );

    const offRouting = window.ghchat.on(
      IPC.OR_CHAT_ROUTING,
      (_e: IpcRendererEvent, payload: unknown) => {
        const p = payload as RoutingPayload;
        if (p.requestId === activeRequestId.current) {
          setStreamState(p.isFallback ? "fallback-switching" : "streaming");
          setRoutingInfo({
            model: p.model,
            modelName: p.modelName,
            reason: p.reason,
            isAuto: p.isAuto,
            isFallback: p.isFallback,
          });
        }
      },
    );

    const offEnd = window.ghchat.on(
      IPC.OR_CHAT_END,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId } = payload as EndPayload;
        if (requestId !== activeRequestId.current || !conversationId) return;

        const fullText = streamingTextRef.current;
        activeRequestId.current = null;

        if (!fullText.trim()) {
          setStreamState("completed");
          resetStreaming();
          return;
        }

        ipc
          .appendMessage({ conversationId, role: "assistant", content: fullText })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["messages", conversationId] });
            setStreamState("completed");
            resetStreaming();
          })
          .catch(() => {
            setStreamState("failed");
            resetStreaming();
          });
      },
    );

    const offError = window.ghchat.on(
      IPC.OR_CHAT_ERROR,
      (_e: IpcRendererEvent, payload: unknown) => {
        const p = payload as ErrorPayload;
        if (p.requestId !== activeRequestId.current) return;
        activeRequestId.current = null;
        setStreamState("failed");
        resetStreaming();

        const structuredError: StructuredChatError = {
          message: p.error,
          kind: p.kind,
          status: p.status,
          failedModel: p.failedModel,
          fallbackModel: p.fallbackModel,
          fallbackModelName: p.fallbackModelName,
          actions: p.actions ?? ["retry", "auto", "refresh-models", "settings"],
        };
        setLastStreamError(structuredError);
        // Also show a brief toast for accessibility / notification
        toast.error(p.error, { duration: 4000 });
      },
    );

    return () => {
      offToken();
      offRouting();
      offEnd();
      offError();
    };
  }, [conversationId, appendStreamingToken, resetStreaming, setLastStreamError, setRoutingInfo, qc, setStreamState]);

  // ── Internal helper: dispatch a chat stream request ────────────────────────
  const dispatchStream = useCallback(
    async (modelId: string, messages: Array<{ role: string; content: string }>) => {
      setStreamState("validating");
      const apiKey = await ipc.getApiKey();
      if (!apiKey) {
        toast.error("No API key set. Open Settings to add your OpenRouter API key.", {
          duration: 5000,
        });
        setStreamState("failed");
        return;
      }
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeRequestId.current = requestId;
      setStreaming(true);
      setStreamState("routing");
      setLastStreamError(null);
      setRoutingInfo(null);
      window.ghchat.send(IPC.OR_CHAT_STREAM, { requestId, model: modelId, messages, apiKey });
      setStreamState("streaming");
    },
    [setStreaming, setStreamState, setLastStreamError, setRoutingInfo],
  );

  // ── Send a new message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      if (!conversationId || isStreaming || !content.trim()) return;

      const apiKey = await ipc.getApiKey();
      if (!apiKey) {
        toast.error("No API key set. Open Settings to add your OpenRouter API key.", {
          duration: 5000,
          action: { label: "Open Settings", onClick: () => {} },
        });
        setStreamState("failed");
        return;
      }

      await ipc.appendMessage({ conversationId, role: "user", content });
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });

      // Auto-name the conversation from the first user message
      const existingMessages = await ipc.listMessages(conversationId);
      const userMessages = existingMessages.filter((m) => m.role === "user");
      if (userMessages.length === 1) {
        // This is the first user message — derive a title
        const newTitle = deriveTitleFromMessage(content);
        if (newTitle) {
          ipc.renameConversation(conversationId, newTitle).then(() => {
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }).catch(() => {});
        }
      }

      const messages = await ipc.listMessages(conversationId);
      await dispatchStream(selectedModel, messages.map((m) => ({ role: m.role, content: m.content })));
    },
    [conversationId, isStreaming, selectedModel, dispatchStream, qc, setStreamState],
  );

  // ── Stop the active stream ─────────────────────────────────────────────────
  const stopStream = useCallback(() => {
    const id = activeRequestId.current;
    if (!id) return;
    setStreamState("stopping");
    ipc.stopStream(id);
    // The main process sends OR_CHAT_END after aborting, which cleans up state
  }, [setStreamState]);

  // ── Regenerate the last assistant reply ────────────────────────────────────
  const regenerate = useCallback(async () => {
    if (!conversationId || isStreaming) return;

    const messages = await ipc.listMessages(conversationId);
    if (messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;

    // Remove the stale assistant message
    await ipc.deleteMessage(lastMsg.id);
    qc.invalidateQueries({ queryKey: ["messages", conversationId] });

    const remaining = messages.slice(0, -1);
    await dispatchStream(selectedModel, remaining.map((m) => ({ role: m.role, content: m.content })));
  }, [conversationId, isStreaming, selectedModel, dispatchStream, qc]);

  // ── Retry after failure (no message deletion needed — stream never saved) ──
  const retryStream = useCallback(
    async (overrideModel?: string) => {
      if (!conversationId || isStreaming) return;
      const messages = await ipc.listMessages(conversationId);
      if (messages.length === 0) return;
      const modelToUse = overrideModel ?? selectedModel;
      if (overrideModel && overrideModel !== selectedModel) {
        setSelectedModel(overrideModel);
      }
      await dispatchStream(modelToUse, messages.map((m) => ({ role: m.role, content: m.content })));
    },
    [conversationId, isStreaming, selectedModel, setSelectedModel, dispatchStream],
  );

  // ── Switch to Auto mode and retry ─────────────────────────────────────────
  const switchToAutoMode = useCallback(async () => {
    setSelectedModel(AUTO_MODEL_ID);
    await retryStream(AUTO_MODEL_ID);
  }, [setSelectedModel, retryStream]);

  const refreshModelAvailability = useCallback(async () => {
    await ipc.refreshDiagnostics();
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["models"] }),
      qc.invalidateQueries({ queryKey: ["models", "__stored__"] }),
    ]);
    toast.success("Model availability refreshed");
  }, [qc]);

  return {
    sendMessage,
    stopStream,
    regenerate,
    retryStream,
    switchToAutoMode,
    refreshModelAvailability,
    isStreaming,
    streamingText,
  };
}
