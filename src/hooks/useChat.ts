import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { IPC } from "@/types";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { IpcRendererEvent } from "electron";

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
}

export function useChat(conversationId: string | null) {
  const qc = useQueryClient();
  const { isStreaming, streamingText, setStreaming, appendStreamingToken, resetStreaming } =
    useChatStore();
  const { selectedModel } = useSettingsStore();

  const activeRequestId = useRef<string | null>(null);
  // Mirror of streamingText in a ref so event callbacks see the latest value
  const streamingTextRef = useRef(streamingText);
  streamingTextRef.current = streamingText;

  // ── IPC listeners ──────────────────────────────────────────────────────────
  useEffect(() => {
    const offToken = window.ghchat.on(
      IPC.HF_CHAT_TOKEN,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId, token } = payload as TokenPayload;
        if (requestId === activeRequestId.current) {
          appendStreamingToken(token);
        }
      },
    );

    const offEnd = window.ghchat.on(
      IPC.HF_CHAT_END,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId } = payload as EndPayload;
        if (requestId !== activeRequestId.current || !conversationId) return;

        const fullText = streamingTextRef.current;
        activeRequestId.current = null;

        if (!fullText.trim()) {
          resetStreaming();
          return;
        }

        ipc
          .appendMessage({ conversationId, role: "assistant", content: fullText })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["messages", conversationId] });
            resetStreaming();
          })
          .catch(() => resetStreaming());
      },
    );

    const offError = window.ghchat.on(
      IPC.HF_CHAT_ERROR,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId, error } = payload as ErrorPayload;
        if (requestId !== activeRequestId.current) return;
        activeRequestId.current = null;
        resetStreaming();
        toast.error(error, { duration: 6000 });
      },
    );

    return () => {
      offToken();
      offEnd();
      offError();
    };
  }, [conversationId, appendStreamingToken, resetStreaming, qc]);

  // ── Send a new message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      if (!conversationId || isStreaming || !content.trim()) return;

      const apiKey = await ipc.getApiKey();
      if (!apiKey) {
        toast.error("No API key set. Open Settings to add your Hugging Face API key.", {
          duration: 5000,
          action: { label: "Open Settings", onClick: () => {} },
        });
        return;
      }

      await ipc.appendMessage({ conversationId, role: "user", content });
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });

      const messages = await ipc.listMessages(conversationId);
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeRequestId.current = requestId;
      setStreaming(true);

      window.ghchat.send(IPC.HF_CHAT_STREAM, {
        requestId,
        model: selectedModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        apiKey,
      });
    },
    [conversationId, isStreaming, selectedModel, setStreaming, qc],
  );

  // ── Stop the active stream ─────────────────────────────────────────────────
  const stopStream = useCallback(() => {
    const id = activeRequestId.current;
    if (!id) return;
    ipc.stopStream(id);
    // The main process sends HF_CHAT_END after aborting, which cleans up state
  }, []);

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

    const apiKey = await ipc.getApiKey();
    if (!apiKey) {
      toast.error("No API key set. Open Settings to add your Hugging Face API key.");
      return;
    }

    const remaining = messages.slice(0, -1);
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeRequestId.current = requestId;
    setStreaming(true);

    window.ghchat.send(IPC.HF_CHAT_STREAM, {
      requestId,
      model: selectedModel,
      messages: remaining.map((m) => ({ role: m.role, content: m.content })),
      apiKey,
    });
  }, [conversationId, isStreaming, selectedModel, setStreaming, qc]);

  return { sendMessage, stopStream, regenerate, isStreaming, streamingText };
}
