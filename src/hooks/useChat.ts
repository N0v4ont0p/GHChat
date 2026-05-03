import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { IPC } from "@/types";
import { AUTO_MODEL_ID } from "@/lib/models";
import { resolveActiveModel, resolveConversationModel } from "@/lib/active-model";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import type { IpcRendererEvent } from "electron";
import type { ChatErrorRecoveryAction, Conversation, StructuredChatError, ChatFailureKind, Message } from "@/types";

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

/**
 * How long after a user-initiated stop the renderer keeps the requestId
 * in its `cancelledRequestIds` set so any late token events arriving
 * from the runtime are still suppressed.  Slightly longer than the IPC
 * cancel-watchdog (1500 ms default) so the watchdog has time to either
 * drain or force-restart before we forget about the request.
 */
const CANCELLED_REQUEST_CLEANUP_DELAY_MS = 5_000;

/**
 * Maximum time the renderer will wait for *any* progress signal
 * (token, lifecycle phase, end, or error) on an in-flight offline
 * stream before assuming the local llama.cpp runtime has hung.
 *
 * Loading a 26B-class model from a slow disk can legitimately take
 * a minute or more, so the budget is generous; the goal is only to
 * prevent a permanently stuck "Generating…" indicator if the runtime
 * silently dies.  When the watchdog fires, the renderer cancels the
 * stream and surfaces a structured error so the user can retry.
 */
const OFFLINE_STREAM_IDLE_TIMEOUT_MS = 180_000;

/**
 * Recovery actions surfaced for any offline-runtime-flavored chat
 * failure (sync send throw, async OFFLINE_CHAT_ERROR, watchdog timeout).
 * Consolidated here so every offline failure path offers the same set of
 * one-click recoveries — Retry, Restart Runtime, Force Stop Runtime,
 * Manage Model, Open Diagnostics — instead of just "Try again".
 */
const OFFLINE_RUNTIME_RECOVERY_ACTIONS: ChatErrorRecoveryAction[] = [
  "retry",
  "restart-runtime",
  "force-stop-runtime",
  "manage-offline-model",
  "open-diagnostics",
];

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
    setActiveStreamKind,
    appendStreamingToken,
    resetStreaming,
    setLastStreamError,
    setRoutingInfo,
    setForceScrollToBottom,
    incognitoMode,
    incognitoMessages,
    addIncognitoMessage,
    setIncognitoMessages,
    setOfflineStopPendingAt,
  } = useChatStore();
  const { selectedModel, setSelectedModel, advancedParams } = useSettingsStore();
  const { currentMode, offlineState, activeOfflineModelId, activeOfflineModelLabel, setOfflineManagementOpen, setMode } = useModeStore();

  /**
   * The current conversation row pulled from the React-Query cache.
   * Used by `dispatchStream` to honour the conversation's stamped
   * mode/model binding (so flipping the global switcher cannot
   * retroactively rewrite an existing chat).
   *
   * Returns null for the incognito session (no row exists) or before
   * the conversations cache has loaded — in those cases the resolver
   * falls back to the live globals.
   */
  const getConversationFromCache = useCallback((): Conversation | null => {
    if (!conversationId) return null;
    const list = qc.getQueryData<Conversation[]>(["conversations"]);
    return list?.find((c) => c.id === conversationId) ?? null;
  }, [conversationId, qc]);

  // Resolved offline model id is now produced by resolveActiveModel /
  // resolveConversationModel inside dispatchStream — see src/lib/active-model.ts.
  // Keeping a thin alias so the existing stop-stream branch (which only
  // needs to know whether the *next* send would be offline) still has a
  // straight boolean to read.

  const activeRequestId = useRef<string | null>(null);
  /**
   * Set of requestIds the user has cancelled.  Used to drop any
   * in-flight token events that race with the stop call.  The main
   * process applies the same suppression on its side, but a race
   * window still exists between when stopStream() runs and when the
   * cancel reaches the main process.
   */
  const cancelledRequestIds = useRef<Set<string>>(new Set());
  /**
   * Watchdog timer for the active offline stream.  Reset on every
   * token / phase event from the local runtime, cleared on END /
   * ERROR / user-stop.  When it fires the stream is considered hung
   * and the renderer transitions to `failed` so the indicator never
   * gets pinned forever on a generic label.
   */
  const offlineWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // ── Offline stream watchdog helpers ────────────────────────────────────────
  // Kept as refs / inline closures (not callbacks) so the IPC effect below
  // can read them without re-subscribing every render.  `clearOfflineWatchdog`
  // is also called on unmount via the effect cleanup.
  const clearOfflineWatchdog = useCallback(() => {
    if (offlineWatchdog.current) {
      clearTimeout(offlineWatchdog.current);
      offlineWatchdog.current = null;
    }
  }, []);
  const kickOfflineWatchdog = useCallback(
    (requestId: string) => {
      clearOfflineWatchdog();
      offlineWatchdog.current = setTimeout(() => {
        // Abort only if this request is still the active one — late
        // events (e.g. after a previous request) must never trip a
        // newer in-flight stream.
        if (activeRequestId.current !== requestId) return;
        cancelledRequestIds.current.add(requestId);
        try {
          ipc.stopOfflineStream(requestId);
        } catch (err) {
          console.error("[useChat] stop after watchdog timeout failed:", err);
        }
        activeRequestId.current = null;
        setStreamState("failed");
        resetStreaming();
        const message =
          "The offline runtime stopped responding. It may still be loading the model — try again, or restart the runtime from Offline Models.";
        setLastStreamError({ message, actions: OFFLINE_RUNTIME_RECOVERY_ACTIONS });
        toast.error(message, { duration: 6000 });
        setTimeout(
          () => cancelledRequestIds.current.delete(requestId),
          CANCELLED_REQUEST_CLEANUP_DELAY_MS,
        );
      }, OFFLINE_STREAM_IDLE_TIMEOUT_MS);
    },
    [clearOfflineWatchdog, setStreamState, resetStreaming, setLastStreamError],
  );

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
        if (cancelledRequestIds.current.has(requestId)) return;
        if (requestId === activeRequestId.current) {
          kickOfflineWatchdog(requestId);
          appendStreamingToken(token);
        }
      },
    );

    const offOfflineEnd = window.ghchat.on(
      IPC.OFFLINE_CHAT_END,
      (_e: IpcRendererEvent, payload: unknown) => {
        const { requestId } = payload as EndPayload;
        // If the user already stopped this stream, the renderer-side
        // stopStream() has already persisted the partial reply and
        // reset state.  Don't re-process the END event.
        if (cancelledRequestIds.current.has(requestId)) return;
        if (requestId !== activeRequestId.current) return;
        clearOfflineWatchdog();

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
        clearOfflineWatchdog();
        activeRequestId.current = null;
        setStreamState("failed");
        resetStreaming();

        const structuredError: StructuredChatError = {
          message: p.error,
          actions: OFFLINE_RUNTIME_RECOVERY_ACTIONS,
        };
        setLastStreamError(structuredError);
        toast.error(`Offline model error: ${p.error}`, { duration: 4000 });
      },
    );

    // Coarse offline lifecycle phases — emitted by the main process so the
    // UI can show "starting runtime" / "loading model" / "processing prompt"
    // / "generating" instead of a generic "streaming" label that hides slow
    // on-device boot.  Late events for cancelled or stale requests are
    // dropped so the indicator doesn't flicker after the user stops.
    const offOfflinePhase = window.ghchat.on(
      IPC.OFFLINE_CHAT_PHASE,
      (_e: IpcRendererEvent, payload: unknown) => {
        const p = payload as {
          requestId: string;
          phase:
            | "runtime-starting"
            | "loading-model"
            | "processing-prompt"
            | "generating"
            | "checking-model"
            | "checking-binary"
            | "preparing-config"
            | "launching-process"
            | "waiting-for-server"
            | "warming-up";
        };
        if (cancelledRequestIds.current.has(p.requestId)) return;
        if (p.requestId !== activeRequestId.current) return;
        kickOfflineWatchdog(p.requestId);
        setStreamState(p.phase);
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
      offOfflinePhase();
      clearOfflineWatchdog();
    };
  }, [appendStreamingToken, resetStreaming, setLastStreamError, setRoutingInfo, qc, setStreamState, kickOfflineWatchdog, clearOfflineWatchdog]);

  // ── Internal helper: dispatch a chat stream request ────────────────────────
  const dispatchStream = useCallback(
    async (modelId: string, messages: Array<{ role: string; content: string }>) => {
      setStreamState("validating");

      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeRequestId.current = requestId;
      setStreaming(true);
      // Each dispatch starts with no committed backend.  The offline /
      // online branches below set this to the right value before any
      // mode-specific UI (e.g. the offline phase labels) can read it,
      // and every terminal path clears it via `resetStreaming` so a
      // failed stream cannot leak its provider into the next one.
      setActiveStreamKind(null);
      setStreamState("routing");
      setLastStreamError(null);
      setRoutingInfo(null);

      // Resolve the target model through the central resolver.  When a
      // conversation is bound (modelId stamped) the resolver honours the
      // binding; otherwise it falls back to live globals.  The resolver
      // is the only place that knows the per-mode rules — every UI
      // surface and the dispatcher all read from the same function so
      // they can never disagree.
      const conversation = getConversationFromCache();
      const globals = {
        currentMode,
        offlineState,
        activeOfflineModelId,
        selectedOnlineModel: modelId,
      };
      const resolved = conversation
        ? resolveConversationModel(conversation, globals)
        : resolveActiveModel(globals);

      if (resolved.kind === "needs-setup") {
        // Offline mode requested but nothing is installed yet — route
        // the user to the setup flow rather than attempting to send.
        // Switching mode also fires the AppShell `needsOfflineSetup`
        // branch, which renders OfflineSetupFlow in place of the chat
        // window without losing the user's selected conversation.
        setMode("offline");
        const msg =
          "Offline mode is selected but no offline model is installed. Set one up to continue.";
        setLastStreamError({ message: msg, actions: ["retry"] });
        toast.error(msg, { duration: 5000 });
        setStreamState("failed");
        activeRequestId.current = null;
        setStreaming(false);
        return;
      }

      if (resolved.kind === "no-offline-model-installed") {
        // Degenerate state: state==='installed' but no usable model id.
        // Open the management modal so the user can install or pick one.
        setOfflineManagementOpen(true);
        const msg =
          "No offline model is currently active. Pick or install one in Offline Models to continue.";
        setLastStreamError({ message: msg, actions: ["retry"] });
        toast.error(msg, { duration: 5000 });
        setStreamState("failed");
        activeRequestId.current = null;
        setStreaming(false);
        return;
      }

      if (resolved.kind === "offline") {
        // ── Offline path: local llama.cpp runtime ──────────────────────
        // Record the in-flight backend BEFORE we touch lifecycle state so
        // a synchronous failure below cannot leave a "runtime-starting"
        // streamState attributed to no backend (which would let
        // StreamingIndicator render "Starting offline runtime…" while
        // the user is in Online mode).
        setActiveStreamKind("offline");
        // Pre-populate routingInfo for offline so the streaming indicator
        // can show the model the runtime will actually load AND, in Auto
        // mode, why offline was chosen.  The online path receives this
        // via OR_CHAT_ROUTING; offline has no equivalent main-process
        // event so we synthesize it here from the resolver result.
        setRoutingInfo({
          model: resolved.modelId,
          modelName: activeOfflineModelLabel ?? resolved.modelId,
          reason:
            currentMode === "auto"
              ? "Auto chose offline (model installed locally)"
              : "Selected by you",
          isAuto: currentMode === "auto",
          isFallback: false,
        });
        // Seed an offline-specific lifecycle phase up front so the
        // streaming indicator never flashes the generic "Streaming
        // response…" label while we wait for the first OFFLINE_CHAT_PHASE
        // event from the main process.  The phase will be refined to
        // "loading-model" / "processing-prompt" / "generating" as those
        // events arrive.  Also start the watchdog so a hung runtime
        // can never pin the UI in this state forever.
        setStreamState("runtime-starting");
        kickOfflineWatchdog(requestId);
        try {
          ipc.sendOfflineChatStream({
            requestId,
            modelId: resolved.modelId,
            messages: messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
          });
        } catch (err) {
          // Synchronous failure (e.g. preload bridge missing, IPC arg
          // validation rejected the payload, channel constant missing).
          // Without this guard the throw would leave `streamState` stuck
          // on "runtime-starting", the watchdog ticking, and the request
          // id pinned — which is exactly the "Online mode shows Starting
          // offline runtime" + "Offline becomes unusable" symptom this
          // change exists to fix.
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[useChat] dispatchStream offline send threw synchronously ` +
              `(requestId=${requestId}, modelId=${resolved.modelId}): ${message}`,
          );
          clearOfflineWatchdog();
          activeRequestId.current = null;
          setStreamState("failed");
          resetStreaming();
          setRoutingInfo(null);
          setLastStreamError({
            message: `Couldn't start the offline runtime: ${message}`,
            actions: OFFLINE_RUNTIME_RECOVERY_ACTIONS,
          });
          toast.error(`Offline runtime failed to start: ${message}`, { duration: 6000 });
        }
        return;
      }

      // ── Online path: route to OpenRouter ────────────────────────────────
      const apiKey = await ipc.getApiKey();
      if (!apiKey) {
        toast.error("No API key set. Open Settings to add your OpenRouter API key.", {
          duration: 5000,
        });
        setStreamState("failed");
        resetStreaming();
        return;
      }
      // Lock the in-flight backend so any cross-mode UI (notably the
      // streaming indicator) reads the right provider while the request
      // is alive — independent of any subsequent global mode flip.
      setActiveStreamKind("online");
      try {
        window.ghchat.send(IPC.OR_CHAT_STREAM, {
          requestId,
          model: resolved.modelId,
          messages,
          apiKey,
          webSearch: advancedParams.webSearch,
          reasoningOn: advancedParams.reasoningOn,
          maxTokens: advancedParams.maxTokens,
        });
        setStreamState("streaming");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[useChat] dispatchStream online send threw synchronously ` +
            `(requestId=${requestId}, model=${resolved.modelId}): ${message}`,
        );
        activeRequestId.current = null;
        setStreamState("failed");
        resetStreaming();
        setLastStreamError({
          message: `Couldn't start the online stream: ${message}`,
          actions: ["retry", "settings"],
        });
        toast.error(`Online stream failed to start: ${message}`, { duration: 6000 });
      }
    },
    [currentMode, offlineState, activeOfflineModelId, activeOfflineModelLabel, getConversationFromCache, setStreaming,
     setStreamState, setActiveStreamKind, setLastStreamError, setRoutingInfo, advancedParams, setMode, setOfflineManagementOpen,
     kickOfflineWatchdog, clearOfflineWatchdog, resetStreaming],
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

          // Stamp the resolved mode/model onto the conversation row so
          // future sends keep talking to the same model regardless of
          // what the global switcher does.  Conversations stay "unbound"
          // (model_id IS NULL) until this point so the user can flip
          // mode in the empty state without surprising results.
          const conversation = getConversationFromCache();
          if (conversation && !conversation.modelId) {
            const resolvedForBinding = resolveActiveModel({
              currentMode,
              offlineState,
              activeOfflineModelId,
              selectedOnlineModel: selectedModel,
            });
            if (
              resolvedForBinding.kind === "online" ||
              resolvedForBinding.kind === "offline"
            ) {
              const modeForBinding =
                resolvedForBinding.kind === "online" ? "online" : "offline";
              ipc
                .updateConversationModel(conversationId, {
                  mode: modeForBinding,
                  modelId: resolvedForBinding.modelId,
                })
                .then(() => {
                  qc.invalidateQueries({ queryKey: ["conversations"] });
                })
                .catch((err: unknown) => {
                  console.error("[useChat] conversation stamp failed:", err);
                });
            }
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
    [conversationId, isStreaming, currentMode, offlineState, activeOfflineModelId, selectedModel, dispatchStream, qc, setStreamState,
     setForceScrollToBottom, resetStreaming, incognitoMode, incognitoMessages, addIncognitoMessage, getConversationFromCache],
  );

  // ── Stop the active stream ─────────────────────────────────────────────────
  // For online streams we just signal the main process and wait for OR_CHAT_END
  // (server-side cancellation is fast).  For offline streams we have to
  // assume the runtime may take a beat to unwind on slow hardware, so we
  // *immediately* drop any further tokens and reset UI state — the main
  // process also sends OFFLINE_CHAT_END right away to keep state in sync.
  const stopStream = useCallback(() => {
    const id = activeRequestId.current;
    if (!id) return;
    setStreamState("stopping");
    const usingOffline = shouldUseOfflineBackend(currentMode, offlineState);
    if (usingOffline) {
      // Clear the watchdog right away — the user-initiated stop is the
      // terminal signal here, not a runtime-hang timeout.
      clearOfflineWatchdog();
      // Mark the request as cancelled so any in-flight token events that
      // race with the stop are dropped on the renderer side too.
      cancelledRequestIds.current.add(id);
      ipc.stopOfflineStream(id);

      // Record the stop timestamp so the Composer can decide whether to
      // surface a "Force stop runtime" affordance — the runtime may keep
      // unwinding for another beat after we optimistically reset the UI
      // below, and the user shouldn't be left wondering whether the next
      // chat will be slow to start.
      setOfflineStopPendingAt(Date.now());

      // Persist whatever was already streamed and reset UI state right
      // now.  Without this, a slow runtime could keep the user staring
      // at "Stopping…" for several seconds while llama.cpp unwinds.
      const fullText = streamingTextRef.current;
      activeRequestId.current = null;

      const finalize = () => {
        setStreamState("completed");
        resetStreaming();
        // Brief terminal feedback so the user knows the stop actually
        // landed — without this there's no visible difference between
        // "stopped early" and "finished naturally".
        toast("Stopped", { duration: 1500 });
        // Drop the entry after a few seconds — long enough that any
        // late tokens from the runtime are still suppressed.
        setTimeout(() => cancelledRequestIds.current.delete(id), CANCELLED_REQUEST_CLEANUP_DELAY_MS);
      };

      if (!fullText.trim()) {
        finalize();
        return;
      }
      const convId = conversationIdRef.current;
      if (incognitoModeRef.current) {
        if (convId) {
          addIncognitoMessageRef.current(
            makeIncognitoMessage(convId, "assistant", fullText),
          );
        }
        finalize();
        return;
      }
      if (!convId) {
        finalize();
        return;
      }
      ipc
        .appendMessage({ conversationId: convId, role: "assistant", content: fullText })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["messages", convId] });
          finalize();
        })
        .catch(() => {
          setStreamState("failed");
          resetStreaming();
          setTimeout(() => cancelledRequestIds.current.delete(id), CANCELLED_REQUEST_CLEANUP_DELAY_MS);
        });
    } else {
      ipc.stopStream(id);
      // The main process sends OR_CHAT_END after aborting — wait for it
      // to drive the UI transition (online cancellation is fast).
    }
  }, [currentMode, offlineState, setStreamState, qc, resetStreaming, clearOfflineWatchdog, setOfflineStopPendingAt]);

  // ── Edit the last user message and re-stream ───────────────────────────────
  // Removes the last user message + any assistant reply that follows it,
  // appends the edited content as a fresh user turn, and re-streams.  Mirrors
  // the regenerate flow so the conversation rolls cleanly back one round.
  const editLastUserMessage = useCallback(
    async (newContent: string) => {
      const trimmed = newContent.trim();
      if (!conversationId || isStreaming || !trimmed) return;

      try {
        if (incognitoMode) {
          const msgs = incognitoMessages;
          const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
          if (lastUserIdx < 0) return;
          const remaining = msgs.slice(0, lastUserIdx);
          const edited = makeIncognitoMessage(conversationId, "user", trimmed);
          setIncognitoMessages([...remaining, edited]);
          setForceScrollToBottom(true);
          await dispatchStream(
            selectedModel,
            [...remaining, edited].map((m) => ({ role: m.role, content: m.content })),
          );
          return;
        }

        const messages = await ipc.listMessages(conversationId);
        const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
        if (lastUserIdx < 0) return;

        // Drop the last user message and anything after it (usually one
        // assistant reply, possibly nothing if the previous turn errored).
        for (let i = messages.length - 1; i >= lastUserIdx; i -= 1) {
          await ipc.deleteMessage(messages[i].id);
        }
        await ipc.appendMessage({ conversationId, role: "user", content: trimmed });
        qc.invalidateQueries({ queryKey: ["messages", conversationId] });

        setForceScrollToBottom(true);
        const refreshed = await ipc.listMessages(conversationId);
        await dispatchStream(
          selectedModel,
          refreshed.map((m) => ({ role: m.role, content: m.content })),
        );
      } catch (err) {
        console.error("[useChat] editLastUserMessage failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to edit message. Please try again.");
        setStreamState("failed");
        resetStreaming();
      }
    },
    [conversationId, isStreaming, selectedModel, dispatchStream, qc, resetStreaming, setStreamState,
     setForceScrollToBottom, setIncognitoMessages, incognitoMode, incognitoMessages],
  );

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
    editLastUserMessage,
    retryStream,
    switchToAutoMode,
    refreshModelAvailability,
    isStreaming,
    streamingText,
  };
}
