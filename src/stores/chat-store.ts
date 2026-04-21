import { create } from "zustand";

interface ChatState {
  selectedConversationId: string | null;
  draft: string;
  isStreaming: boolean;
  streamingText: string;
  streamingTokenCount: number;
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
  streamingTokenCount: 0,
  setSelectedConversationId: (selectedConversationId) =>
    set({ selectedConversationId }),
  setDraft: (draft) => set({ draft }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  appendStreamingToken: (token) =>
    set((s) => ({
      streamingText: s.streamingText + token,
      streamingTokenCount: s.streamingTokenCount + 1,
    })),
  resetStreaming: () =>
    set({ isStreaming: false, streamingText: "", streamingTokenCount: 0 }),
}));
