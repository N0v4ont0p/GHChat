import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { IPC } from "@/types";
import { AUTO_MODEL_ID } from "@/lib/models";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import type { IpcRendererEvent } from "electron";
import type { ChatErrorRecoveryAction, StructuredChatError, ChatFailureKind, Message } from "@/types";

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

/** The local-model ID used for offline chat streaming. */
const OFFLINE_MODEL_ID = "offline-local";

/**
 * Returns true when a chat request should be routed to the local llama.cpp
 * runtime rather than OpenRouter.
 * - "offline" mode: always use local runtime.
 * - "auto" mode: use local runtime only when a model is installed.
 */
function shouldUseOfflineBackend(
  currentMode: string,
  offlineState: string,
): boolean {
  return (
    currentMode === "offline" ||
    (currentMode === "auto" && offlineState === "installed")
  );
}

/** Derive a short conversation title from the first user message */
function deriveTitleFromMessage(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  // Take first sentence or first 50 chars, whichever is shorter
  const sentence = trimmed.split(/[.!?\n]/)[0].trim();
  const candidate = sentence.length > 4 ? sentence : trimmed;
  return candidate.length > 50 ? candidate.slice(0, 50).trimEnd() + "…" : candidate;
}

/** Create a minimal in-memory Message object for incognito sessions */
function makeIncognitoMessage(conversationId: string, role: "user" | "assistant", content: string): Message {
  return {
    id: `incognito-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    conversationId,
    role,
    content,
    createdAt: Date.now(),
  };
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
    setForceScrollToBottom,
    incognitoMode,
    incognitoMessages,
    addIncognitoMessage,
  } = useChatStore();
  const { selectedModel, setSelectedModel, advancedParams } = useSettingsStore();
  const { currentMode, offlineState, offlineRecommendation } = useModeStore();

  // The installed offline model ID — falls back to OFFLINE_MODEL_ID sentinel
  // if no recommendation is available (e.g. after an install with no reco step).
  const offlineModelId = offlineRecommendation?.modelId ?? OFFLINE_MODEL_ID;

  const activeRequestId = useRef<string | null>(null);
  // Mirror of streamingText in a ref so event callbacks see the latest value
  const streamingTextRef = useRef(streamingText);
  streamingTextRef.current = streamingText;
  // Refs for incognito state that IPC callbacks need to access
  const incognitoModeRef = useRef(incognitoMode);
  incognitoModeRef.current = incognitoMode;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const addIncognitoMessageRef = useRef(addIncognitoMessage);
  addIncognitoMessageRef.current = addIncognitoMessage;

  // ── IPC listeners ──────────────────────────────────────────────────────────
  useEffect(() => {
    // ── OpenRouter listeners ────────────────────────────────────────────────
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
        if (requestId !== activeRequestId.current) return;

        const fullText = streamingTextRef.current;
        activeRequestId.current = null;

        if (!fullText.trim()) {
          setStreamState("completed");
          resetStreaming();
          return;
        }

        const convId = conversationIdRef.current;

        if (incognitoModeRef.current) {
          // Incognito: save assistant reply only in-memory, no DB
          if (convId) {
            addIncognitoMessageRef.current(
              makeIncognitoMessage(convId, "assistant", fullText),
            );
          }
          setStreamState("completed");
          resetStreaming();
          return;
        }

        if (!convId) {
          setStreamState("completed");
          resetStreaming();
          return;
        }

        ipc
          .appendMessage({ conversationId: convId, role: "assistant", content: fullText })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["messages", convId] });
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

    // ── Offline (local) chat listeners ──────────────────────────────────────
    const offOfflineToken = window.ghchat.on(
      IPC.OFFLINE_CHAT_TOKEN,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId, token } = payload as TokenPayload;
        if (requestId === activeRequestId.current) {
          appendStreamingToken(token);
        }
      },
    );

    const offOfflineEnd = window.ghchat.on(
      IPC.OFFLINE_CHAT_END,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId } = payload as EndPayload;
        if (requestId !== activeRequestId.current) return;

        const fullText = streamingTextRef.current;
        activeRequestId.current = null;

        if (!fullText.trim()) {
          setStreamState("completed");
          resetStreaming();
          return;
        }

        const convId = conversationIdRef.current;

        if (incognitoModeRef.current) {
          if (convId) {
            addIncognitoMessageRef.current(
              makeIncognitoMessage(convId, "assistant", fullText),
            );
          }
          setStreamState("completed");
          resetStreaming();
          return;
        }

        if (!convId) {
          setStreamState("completed");
          resetStreaming();
          return;
        }

        ipc
          .appendMessage({ conversationId: convId, role: "assistant", content: fullText })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["messages", convId] });
            setStreamState("completed");
            resetStreaming();
          })
          .catch(() => {
            setStreamState("failed");
            resetStreaming();
          });
      },
    );

    const offOfflineError = window.ghchat.on(
      IPC.OFFLINE_CHAT_ERROR,
      (_e: IpcRendererEvent, payload: unknown) => {
        const p = payload as { requestId: string; error: string };
        if (p.requestId !== activeRequestId.current) return;
        activeRequestId.current = null;
        setStreamState("failed");
        resetStreaming();

        const structuredError: StructuredChatError = {
          message: p.error,
          actions: ["retry"],
        };
        setLastStreamError(structuredError);
        toast.error(`Offline model error: ${p.error}`, { duration: 4000 });
      },
    );

    return () => {
      offToken();
      offRouting();
      offEnd();
      offError();
      offOfflineToken();
      offOfflineEnd();
      offOfflineError();
    };
  }, [appendStreamingToken, resetStreaming, setLastStreamError, setRoutingInfo, qc, setStreamState]);

  // ── Internal helper: dispatch a chat stream request ────────────────────────
  const dispatchStream = useCallback(
    async (modelId: string, messages: Array<{ role: string; content: string }>) => {
      setStreamState("validating");

      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeRequestId.current = requestId;
      setStreaming(true);
      setStreamState("routing");
      setLastStreamError(null);
      setRoutingInfo(null);

      if (shouldUseOfflineBackend(currentMode, offlineState)) {
        // ── Offline / Auto-with-offline path: local llama.cpp runtime ──────
        // No API key required; the runtime manager handles the rest.
        setStreamState("streaming");
        ipc.sendOfflineChatStream({
          requestId,
          modelId: offlineModelId,
          messages: messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
        });
        return;
      }

      // ── Online path: route to OpenRouter ────────────────────────────────
      const apiKey = await ipc.getApiKey();
      if (!apiKey) {
        toast.error("No API key set. Open Settings to add your OpenRouter API key.", {
          duration: 5000,
        });
        setStreamState("failed");
        return;
      }
      window.ghchat.send(IPC.OR_CHAT_STREAM, {
        requestId,
        model: modelId,
        messages,
        apiKey,
        webSearch: advancedParams.webSearch,
        reasoningOn: advancedParams.reasoningOn,
        maxTokens: advancedParams.maxTokens,
      });
      setStreamState("streaming");
    },
    [currentMode, offlineState, offlineModelId, setStreaming, setStreamState, setLastStreamError, setRoutingInfo, advancedParams],
  );

  // ── Send a new message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      if (!conversationId || isStreaming || !content.trim()) return;

      try {
        // Only require an API key for online (OpenRouter) mode.
        // Auto mode may also use online as a fallback when offline is not installed.
        if (!shouldUseOfflineBackend(currentMode, offlineState)) {
          const apiKey = await ipc.getApiKey();
          if (!apiKey) {
            toast.error("No API key set. Open Settings to add your OpenRouter API key.", {
              duration: 5000,
              action: { label: "Open Settings", onClick: () => {} },
            });
            setStreamState("failed");
            return;
          }
        }

        // Signal the message list to scroll to bottom immediately
        setForceScrollToBottom(true);

        if (incognitoMode) {
          // Incognito: keep messages in-memory only
          const userMsg = makeIncognitoMessage(conversationId, "user", content);
          addIncognitoMessage(userMsg);
          const allMsgs = [...incognitoMessages, userMsg];
          await dispatchStream(
            selectedModel,
            allMsgs.map((m) => ({ role: m.role, content: m.content })),
          );
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
            }).catch((err: unknown) => {
              console.error("[useChat] auto-rename failed:", err);
            });
          }
        }

        const messages = await ipc.listMessages(conversationId);
        await dispatchStream(selectedModel, messages.map((m) => ({ role: m.role, content: m.content })));
      } catch (err) {
        console.error("[useChat] sendMessage failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to send message. Please try again.");
        setStreamState("failed");
        resetStreaming();
      }
    },
    [conversationId, isStreaming, currentMode, offlineState, selectedModel, dispatchStream, qc, setStreamState,
     setForceScrollToBottom, resetStreaming, incognitoMode, incognitoMessages, addIncognitoMessage],
  );

  // ── Stop the active stream ─────────────────────────────────────────────────
  const stopStream = useCallback(() => {
    const id = activeRequestId.current;
    if (!id) return;
    setStreamState("stopping");
    const usingOffline = shouldUseOfflineBackend(currentMode, offlineState);
    if (usingOffline) {
      ipc.stopOfflineStream(id);
    } else {
      ipc.stopStream(id);
    }
    // The main process sends the appropriate *_CHAT_END after aborting
  }, [currentMode, offlineState, setStreamState]);

  // ── Regenerate the last assistant reply ────────────────────────────────────
  const regenerate = useCallback(async () => {
    if (!conversationId || isStreaming) return;

    try {
      if (incognitoMode) {
        // Incognito regenerate: remove last assistant message and re-stream
        const msgs = incognitoMessages;
        if (msgs.length === 0) return;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.role !== "assistant") return;
        const remaining = msgs.slice(0, -1);
        await dispatchStream(selectedModel, remaining.map((m) => ({ role: m.role, content: m.content })));
        return;
      }

      const messages = await ipc.listMessages(conversationId);
      if (messages.length === 0) return;

      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role !== "assistant") return;

      // Remove the stale assistant message
      await ipc.deleteMessage(lastMsg.id);
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });

      const remaining = messages.slice(0, -1);
      await dispatchStream(selectedModel, remaining.map((m) => ({ role: m.role, content: m.content })));
    } catch (err) {
      console.error("[useChat] regenerate failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to regenerate. Please try again.");
      setStreamState("failed");
      resetStreaming();
    }
  }, [conversationId, isStreaming, selectedModel, dispatchStream, qc, resetStreaming, setStreamState,
      incognitoMode, incognitoMessages]);

  // ── Retry after failure (no message deletion needed — stream never saved) ──
  const retryStream = useCallback(
    async (overrideModel?: string) => {
      if (!conversationId || isStreaming) return;
      const modelToUse = overrideModel ?? selectedModel;
      if (overrideModel && overrideModel !== selectedModel) {
        setSelectedModel(overrideModel);
      }
      try {
        if (incognitoMode) {
          if (incognitoMessages.length === 0) return;
          await dispatchStream(modelToUse, incognitoMessages.map((m) => ({ role: m.role, content: m.content })));
          return;
        }
        const messages = await ipc.listMessages(conversationId);
        if (messages.length === 0) return;
        await dispatchStream(modelToUse, messages.map((m) => ({ role: m.role, content: m.content })));
      } catch (err) {
        console.error("[useChat] retryStream failed:", err);
        toast.error(err instanceof Error ? err.message : "Retry failed. Please try again.");
        setStreamState("failed");
        resetStreaming();
      }
    },
    [conversationId, isStreaming, selectedModel, setSelectedModel, dispatchStream, resetStreaming,
     setStreamState, incognitoMode, incognitoMessages],
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
