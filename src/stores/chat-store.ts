import { create } from "zustand";
import { DEFAULT_MODEL } from "@/lib/models";
import type { StructuredChatError, ChatRoutingInfo } from "@/types";

interface ChatState {
  selectedConversationId: string | null;
  draft: string;
  isStreaming: boolean;
  streamingText: string;
  streamingTokenCount: number;
  /** Structured error from the most recent failed stream, cleared on next send */
  lastStreamError: StructuredChatError | null;
  /** Routing decision info from the most recent (or current) stream */
  routingInfo: ChatRoutingInfo | null;
  setSelectedConversationId: (id: string | null) => void;
  setDraft: (v: string) => void;
  setStreaming: (v: boolean) => void;
  appendStreamingToken: (token: string) => void;
  resetStreaming: () => void;
  setLastStreamError: (err: StructuredChatError | null) => void;
  setRoutingInfo: (info: ChatRoutingInfo | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedConversationId: null,
  draft: "",
  isStreaming: false,
  streamingText: "",
  streamingTokenCount: 0,
  lastStreamError: null,
  routingInfo: null,
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
  setLastStreamError: (lastStreamError) => set({ lastStreamError }),
  setRoutingInfo: (routingInfo) => set({ routingInfo }),
}));
