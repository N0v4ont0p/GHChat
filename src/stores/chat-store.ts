import { create } from "zustand";
import { DEFAULT_MODEL } from "@/lib/models";
import type { StructuredChatError, ChatRoutingInfo, StreamLifecycleState, Message } from "@/types";

interface ChatState {
  selectedConversationId: string | null;
  draft: string;
  isStreaming: boolean;
  streamState: StreamLifecycleState;
  streamingText: string;
  streamingTokenCount: number;
  /** Structured error from the most recent failed stream, cleared on next send */
  lastStreamError: StructuredChatError | null;
  /** Routing decision info from the most recent (or current) stream */
  routingInfo: ChatRoutingInfo | null;
  /** When true, the message list should scroll to bottom on next render */
  forceScrollToBottom: boolean;
  /** Whether incognito mode is active — no DB persistence */
  incognitoMode: boolean;
  /** In-memory messages for the current incognito session */
  incognitoMessages: Message[];
  /**
   * Timestamp (ms) at which the user clicked Stop on an offline stream.
   * Tracked separately from `streamState` because the offline stop flow
   * optimistically transitions streamState to "completed" almost
   * immediately (so the streaming bubble can finalize), even though the
   * llama.cpp runtime may still be unwinding for another second or two.
   * Composer uses this to decide when to surface a "Force stop runtime"
   * affordance after a graceful Stop. `null` when no stop is pending.
   */
  offlineStopPendingAt: number | null;
  setSelectedConversationId: (id: string | null) => void;
  setDraft: (v: string) => void;
  setStreaming: (v: boolean) => void;
  setStreamState: (state: StreamLifecycleState) => void;
  appendStreamingToken: (token: string) => void;
  resetStreaming: () => void;
  setLastStreamError: (err: StructuredChatError | null) => void;
  setRoutingInfo: (info: ChatRoutingInfo | null) => void;
  setForceScrollToBottom: (v: boolean) => void;
  setIncognitoMode: (v: boolean) => void;
  addIncognitoMessage: (msg: Message) => void;
  setIncognitoMessages: (msgs: Message[]) => void;
  clearIncognitoMessages: () => void;
  /** Set/clear the offline-stop-pending timestamp. */
  setOfflineStopPendingAt: (ts: number | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedConversationId: null,
  draft: "",
  isStreaming: false,
  streamState: "idle",
  streamingText: "",
  streamingTokenCount: 0,
  lastStreamError: null,
  routingInfo: null,
  forceScrollToBottom: false,
  incognitoMode: false,
  incognitoMessages: [],
  offlineStopPendingAt: null,
  setSelectedConversationId: (selectedConversationId) =>
    set({ selectedConversationId }),
  setDraft: (draft) => set({ draft }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setStreamState: (streamState) => set({ streamState }),
  appendStreamingToken: (token) =>
    set((s) => ({
      streamingText: s.streamingText + token,
      streamingTokenCount: s.streamingTokenCount + 1,
    })),
  resetStreaming: () =>
    set({ isStreaming: false, streamingText: "", streamingTokenCount: 0 }),
  setLastStreamError: (lastStreamError) => set({ lastStreamError }),
  setRoutingInfo: (routingInfo) => set({ routingInfo }),
  setForceScrollToBottom: (forceScrollToBottom) => set({ forceScrollToBottom }),
  setIncognitoMode: (incognitoMode) =>
    set({ incognitoMode, incognitoMessages: [] }),
  addIncognitoMessage: (msg) =>
    set((s) => ({ incognitoMessages: [...s.incognitoMessages, msg] })),
  setIncognitoMessages: (incognitoMessages) => set({ incognitoMessages }),
  clearIncognitoMessages: () => set({ incognitoMessages: [] }),
  setOfflineStopPendingAt: (offlineStopPendingAt) => set({ offlineStopPendingAt }),
}));
