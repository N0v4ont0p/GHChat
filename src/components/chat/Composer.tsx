import { useRef, useEffect, useCallback, useState } from "react";
import { Send, Square, Globe, Brain, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat-store";
import { getPreset } from "@/lib/models";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import { useModels } from "@/hooks/useModels";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  onSend: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  /**
   * When true, the composer is fully disabled and shows a hint placeholder.
   * Used by the missing-model recovery surface in ChatWindow to prevent
   * sends while the conversation's bound model is unavailable.
   */
  disabled?: boolean;
  /** Optional placeholder override used when `disabled` is true. */
  disabledPlaceholder?: string;
}

const MAX_HEIGHT = 180; // ~7 lines
const CHAR_WARN_THRESHOLD = 1800;
const CHAR_MAX = 4000;
const DEFAULT_MAX_TOKENS = 2048;

export function Composer({ onSend, onStop, isStreaming, disabled = false, disabledPlaceholder }: Props) {
  const { draft, setDraft, incognitoMode, streamState } = useChatStore();
  const { selectedModel, advancedParams, setAdvancedParams } = useSettingsStore();
  const { currentMode, activeOfflineModelLabel, offlineState } = useModeStore();
  const { data: models = [] } = useModels();
  const ref = useRef<HTMLTextAreaElement>(null);
  const hadFocusBeforeStreamRef = useRef(false);
  const [showMaxTokens, setShowMaxTokens] = useState(false);
  // After the user clicks Stop, we wait this long for the graceful unwind
  // before exposing a "Force stop runtime" affordance.  Set just below the
  // IPC-side cancel watchdog (offline_settings.cancel_timeout_ms, default
  // 1500 ms — see electron/main/ipc/offline.ts) so the button appears for
  // the user a moment before the watchdog itself would have force-killed
  // the runtime.  Hardcoded rather than read from settings because the
  // composer doesn't have a reactive subscription to offline_settings.
  const FORCE_STOP_REVEAL_MS = 1200;
  const [forceStopAvailable, setForceStopAvailable] = useState(false);

  const preset = getPreset(models, selectedModel);
  const modelName = preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;
  const vendor = preset?.vendor;
  const cap = preset?.capabilities;
  const hasWebSearch = Boolean(cap?.webSearch);
  const hasReasoning = Boolean(cap?.reasoningMode ?? cap?.reasoning ?? cap?.specialReasoning);

  // True when the next message will be routed to the offline runtime.
  // Mirrors the routing rule in shouldUseOfflineBackend() in useChat.ts.
  const willUseOffline =
    currentMode === "offline" ||
    (currentMode === "auto" && offlineState === "installed");

  // Reveal the force-stop button only after a graceful stop has lingered
  // long enough that the user might reasonably wonder if the app is stuck.
  useEffect(() => {
    if (streamState !== "stopping" || !willUseOffline) {
      setForceStopAvailable(false);
      return;
    }
    const t = setTimeout(() => setForceStopAvailable(true), FORCE_STOP_REVEAL_MS);
    return () => clearTimeout(t);
  }, [streamState, willUseOffline]);

  const handleForceStop = useCallback(async () => {
    try {
      await ipc.forceStopOfflineRuntime();
      toast.success("Offline runtime force-stopped.");
    } catch (err) {
      console.error("[Composer] force-stop runtime failed:", err);
      toast.error("Failed to force-stop the offline runtime.");
    }
  }, []);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

  // Focus on mount
  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    if (isStreaming) {
      hadFocusBeforeStreamRef.current = document.activeElement === ref.current;
      return;
    }
    if (hadFocusBeforeStreamRef.current) {
      requestAnimationFrame(() => ref.current?.focus());
      hadFocusBeforeStreamRef.current = false;
    }
  }, [isStreaming]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming || disabled) return;
    setDraft("");
    onSend(text);
    requestAnimationFrame(() => ref.current?.focus());
  }, [draft, isStreaming, disabled, setDraft, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isStreaming && !disabled) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, isStreaming, disabled],
  );

  const charCount = draft.length;
  const overWarn = charCount >= CHAR_WARN_THRESHOLD;
  const overMax = charCount >= CHAR_MAX;
  const canSend = draft.trim().length > 0 && !isStreaming && !overMax && !disabled;

  // Mode-aware placeholder so the user always knows which backend will
  // handle the next message.  In auto mode the live backend is whichever
  // offline+installed/online combination is currently in effect.
  const offlineLabel = activeOfflineModelLabel ?? "offline model";
  const onlineModelHint = vendor ? `${modelName} · ${vendor}` : modelName;
  const composerModelHint = willUseOffline
    ? currentMode === "auto"
      ? `Auto → ${offlineLabel} (offline)`
      : `${offlineLabel} (offline)`
    : currentMode === "auto"
      ? `Auto → ${onlineModelHint} (online)`
      : onlineModelHint;
  const isOfflineUnready =
    currentMode === "offline" && activeOfflineModelLabel === null;
  const baseModePlaceholder = willUseOffline
    ? isOfflineUnready
      ? "Choose an offline model to start chatting…"
      : currentMode === "auto"
        ? `Auto routing · message ${offlineLabel} (offline)…`
        : `Message ${offlineLabel} (offline)…`
    : currentMode === "auto"
      ? `Auto routing · message ${onlineModelHint} (online)…`
      : `Message ${onlineModelHint}…`;
  const placeholder = disabled
    ? (disabledPlaceholder ?? "Resolve the issue above to continue chatting…")
    : incognitoMode
    ? (isStreaming ? "Draft next message…" : "Incognito chat — messages not saved…")
    : (isStreaming ? "Draft next message…" : baseModePlaceholder);

  return (
    <div className="shrink-0 border-t border-border/30 bg-card/10 px-4 py-3">
      {/* Capability params bar — always shown, controls gated by model capabilities */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {/* Web Search toggle — only when model supports it */}
          {hasWebSearch && (
            <button
              onClick={() => setAdvancedParams({ webSearch: !advancedParams.webSearch })}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                advancedParams.webSearch
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-400"
                  : "border-border/40 bg-secondary text-muted-foreground hover:text-foreground",
              )}
              title="Toggle web search"
            >
              <Globe className="h-2.5 w-2.5" />
              Web
            </button>
          )}

          {/* Reasoning toggle — only when model supports it */}
          {hasReasoning && (
            <button
              onClick={() => setAdvancedParams({ reasoningOn: !advancedParams.reasoningOn })}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                advancedParams.reasoningOn
                  ? "border-violet-500/40 bg-violet-500/15 text-violet-400"
                  : "border-border/40 bg-secondary text-muted-foreground hover:text-foreground",
              )}
              title="Toggle extended reasoning"
            >
              <Brain className="h-2.5 w-2.5" />
              Reason
            </button>
          )}

          {/* Max tokens — always available, collapsible */}
          <button
            onClick={() => setShowMaxTokens(!showMaxTokens)}
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors border-border/40 bg-secondary text-muted-foreground hover:text-foreground"
            title="Adjust max tokens"
          >
            {advancedParams.maxTokens ? `${advancedParams.maxTokens} tok` : "Tokens"}
            {showMaxTokens ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
          </button>

          {showMaxTokens && (
            <div className="w-full flex items-center gap-2 mt-0.5">
              <span className="text-[10px] tabular-nums text-muted-foreground/60 w-10 text-right">
                {(advancedParams.maxTokens ?? DEFAULT_MAX_TOKENS).toLocaleString()}
              </span>
              <input
                type="range"
                min={256}
                max={16384}
                step={256}
                value={advancedParams.maxTokens ?? DEFAULT_MAX_TOKENS}
                onChange={(e) => setAdvancedParams({ maxTokens: Number(e.target.value) })}
                className="flex-1 h-1 accent-primary cursor-pointer"
              />
              <button
                onClick={() => setAdvancedParams({ maxTokens: null })}
                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground shrink-0"
                title="Reset to default"
              >
                reset
              </button>
            </div>
          )}
        </div>

      <div
        className={cn(
          "focus-glow flex items-end gap-2 rounded-xl border bg-secondary/50 px-3 py-2.5 transition-all duration-200",
          isStreaming
            ? "border-primary/25 bg-secondary/40"
            : incognitoMode
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border/60 hover:border-border/90",
        )}
      >
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-[36px] flex-1 resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/40 disabled:cursor-not-allowed"
          rows={1}
          style={{ maxHeight: MAX_HEIGHT }}
        />

        {isStreaming ? (
          <div className="flex items-center gap-1">
            {/* Force-stop runtime: revealed only after a graceful stop has
                been pending too long.  Hard-kills llama-server so the user
                isn't left staring at "Stopping…" on a slow on-device model. */}
            {forceStopAvailable && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 px-2 text-[10px] font-medium text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 border border-amber-500/30"
                onClick={() => void handleForceStop()}
                onMouseDown={(e) => e.preventDefault()}
                title="Force-kill the offline runtime if it isn't unwinding"
              >
                <Zap className="h-3 w-3" />
                Force stop
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-95"
              onClick={onStop}
              onMouseDown={(e) => e.preventDefault()}
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 transition-all active:scale-95",
              canSend ? "shadow-sm shadow-primary/20" : "opacity-40",
            )}
            onClick={handleSend}
            onMouseDown={(e) => e.preventDefault()}
            disabled={!canSend}
            title="Send (Enter)"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1">
        <p className="text-[10px] text-muted-foreground/50">
          {composerModelHint}
          {!isStreaming && (
            <span className="ml-2 opacity-60">↵ send · ⇧↵ newline</span>
          )}
        </p>

        {charCount > 0 && (
          <span
            className={cn(
              "text-[10px] tabular-nums transition-colors",
              overMax
                ? "text-red-400"
                : overWarn
                  ? "text-amber-400/80"
                  : "text-muted-foreground/40",
            )}
          >
            {charCount.toLocaleString()}{overMax ? ` / ${CHAR_MAX.toLocaleString()} max` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
