"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { apiFetch } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import type { AppSettings, BackendStatus, ChatConversation, ChatMessage, ModelInfo } from "@/types";

interface StatusResponse {
  status: BackendStatus;
  host: string;
  details: {
    cliDetected: boolean;
    existingPaths: string[];
    healthMessage?: string;
  };
}

export function ChatApp() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeModel, setActiveModel] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const queryClient = useQueryClient();
  const {
    selectedConversationId,
    setSelectedConversationId,
    draft,
    setDraft,
    isStreaming,
    setStreaming,
    streamingText,
    setStreamingText,
    resetStreaming,
    setTheme,
  } = useChatStore();

  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: () => apiFetch<StatusResponse>("/api/status"),
    refetchInterval: 20_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<AppSettings>("/api/settings"),
  });

  const modelsQuery = useQuery({
    queryKey: ["models", settingsQuery.data?.backendHost],
    enabled: Boolean(settingsQuery.data?.backendHost),
    queryFn: () => apiFetch<{ models: ModelInfo[] }>("/api/models"),
  });

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiFetch<{ conversations: ChatConversation[] }>("/api/conversations"),
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", selectedConversationId],
    enabled: Boolean(selectedConversationId),
    queryFn: () =>
      apiFetch<{ messages: ChatMessage[] }>(
        `/api/conversations/${selectedConversationId}/messages`,
      ),
  });

  const settingsMutation = useMutation({
    mutationFn: (payload: AppSettings) =>
      apiFetch<AppSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess(data) {
      queryClient.setQueryData(["settings"], data);
      setTheme(data.theme);
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations ?? [],
    [conversationsQuery.data?.conversations],
  );
  const messages = useMemo(
    () => messagesQuery.data?.messages ?? [],
    [messagesQuery.data?.messages],
  );
  const models = useMemo(
    () => modelsQuery.data?.models ?? [],
    [modelsQuery.data?.models],
  );

  const currentConversation = useMemo(
    () => conversations.find((entry) => entry.id === selectedConversationId),
    [conversations, selectedConversationId],
  );

  const latestAssistant = [...messages].reverse().find((msg) => msg.role === "assistant");
  const latestUser = [...messages].reverse().find((msg) => msg.role === "user");

  const createConversation = async () => {
    const response = await apiFetch<{ conversation: ChatConversation }>(
      "/api/conversations",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    setSelectedConversationId(response.conversation.id);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const renameConversation = async (id: string, title: string) => {
    await apiFetch(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const removeConversation = async (id: string) => {
    await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (selectedConversationId === id) {
      setSelectedConversationId(null);
    }
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    resetStreaming();
  };

  const runStream = async (content: string, regenerate = false) => {
    const model = activeModel || settingsQuery.data?.defaultModel;

    if (!model) {
      toast.error("Select a model first");
      return;
    }

    setStreaming(true);
    setStreamingText("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          message: content,
          model,
          regenerate,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to stream response");
      }

      const conversationIdHeader = response.headers.get("X-Conversation-Id");
      if (!selectedConversationId && conversationIdHeader) {
        setSelectedConversationId(conversationIdHeader);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let output = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        setStreamingText(output);
      }

      setDraft("");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["messages"] }),
      ]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info("Generation stopped");
      } else {
        toast.error(error instanceof Error ? error.message : "Generation failed");
      }
    } finally {
      resetStreaming();
    }
  };

  const status = statusQuery.data?.status ?? "not_detected";
  const title = currentConversation?.title ?? "New conversation";

  if (settingsQuery.isLoading || conversationsQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen gap-4 p-4">
      <Sidebar
        conversations={conversations}
        selectedId={selectedConversationId}
        onSelect={setSelectedConversationId}
        onCreate={() => {
          void createConversation();
        }}
        onRename={(id, nextTitle) => {
          void renameConversation(id, nextTitle);
        }}
        onDelete={(id) => {
          void removeConversation(id);
        }}
      />

      <main className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-950/60 p-4 shadow-[0_35px_100px_rgba(0,0,0,0.5)]">
        <TopBar
          title={title}
          status={status}
          models={models}
          selectedModel={activeModel || settingsQuery.data?.defaultModel || ""}
          onModelChange={setActiveModel}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <section className="scrollbar-thin flex-1 space-y-4 overflow-y-auto pr-2">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700/70 bg-slate-900/30 p-8 text-center">
              <Sparkles className="mb-3 text-blue-300" />
              <h3 className="text-xl font-semibold">Welcome to GHchat</h3>
              <p className="mt-2 max-w-md text-sm text-slate-400">
                Connect to Ollama, pick a model, and start a beautiful local-first
                chat. Your history stays on your machine.
              </p>
              {models.length === 0 ? (
                <p className="mt-4 text-xs text-amber-300">
                  No local models detected yet. Run <code>ollama pull gemma3:4b</code>
                  and refresh.
                </p>
              ) : null}
            </div>
          ) : (
            <AnimatePresence>
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isLastAssistant={latestAssistant?.id === message.id}
                  isLastUser={latestUser?.id === message.id}
                  onRegenerate={() => {
                    if (latestUser?.content) {
                      void runStream(latestUser.content, true);
                    }
                  }}
                  onEditResend={(content) => setDraft(content)}
                />
              ))}
              {isStreaming ? (
                <motion.div
                  key="streaming"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3"
                >
                  <p className="mb-2 text-xs uppercase tracking-wide text-blue-200">
                    Assistant is thinking…
                  </p>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                    {streamingText || "…"}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          )}
        </section>

        <div className="mt-4">
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const content = draft.trim();
              if (!content) return;
              void runStream(content);
            }}
            onStop={stopStreaming}
            disabled={status !== "online" || models.length === 0 || isStreaming}
            isStreaming={isStreaming}
          />
        </div>
      </main>

      {settingsOpen && settingsQuery.data ? (
        <SettingsSheet
          settings={settingsQuery.data}
          status={status}
          onClose={() => setSettingsOpen(false)}
          onAutoDetect={async () => {
            await queryClient.invalidateQueries({ queryKey: ["status"] });
          }}
          onSave={async (next) => {
            await settingsMutation.mutateAsync(next);
          }}
        />
      ) : null}
    </div>
  );
}
