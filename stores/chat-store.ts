import { create } from "zustand";

import type { AppSettings } from "@/types";

interface ChatState {
  selectedConversationId: string | null;
  draft: string;
  isStreaming: boolean;
  streamingText: string;
  theme: AppSettings["theme"];
  setSelectedConversationId: (id: string | null) => void;
  setDraft: (value: string) => void;
  setStreaming: (value: boolean) => void;
  setStreamingText: (value: string) => void;
  setTheme: (theme: AppSettings["theme"]) => void;
  resetStreaming: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedConversationId: null,
  draft: "",
  isStreaming: false,
  streamingText: "",
  theme: "dark",
  setSelectedConversationId: (selectedConversationId) =>
    set({ selectedConversationId }),
  setDraft: (draft) => set({ draft }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setStreamingText: (streamingText) => set({ streamingText }),
  setTheme: (theme) => set({ theme }),
  resetStreaming: () => set({ isStreaming: false, streamingText: "" }),
}));
