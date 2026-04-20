import { create } from "zustand";

interface ChatState {
  selectedConversationId: string | null;
  draft: string;
  isStreaming: boolean;
  streamingText: string;
  setSelectedConversationId: (id: string | null) => void;
  setDraft: (v: string) => void;
  setStreaming: (v: boolean) => void;
  appendStreamingToken: (token: string) => void;
  resetStreaming: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedConversationId: null,
  draft: "",
  isStreaming: false,
  streamingText: "",
  setSelectedConversationId: (selectedConversationId) =>
    set({ selectedConversationId }),
  setDraft: (draft) => set({ draft }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  appendStreamingToken: (token) =>
    set((s) => ({ streamingText: s.streamingText + token })),
  resetStreaming: () => set({ isStreaming: false, streamingText: "" }),
}));
