import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import { MODE_ACCENT } from "@/lib/mode-accent";
import { cn } from "@/lib/utils";

export function StreamingIndicator() {
  const { routingInfo, streamState, activeStreamKind } = useChatStore();
  const activeOfflineModelLabel = useModeStore((s) => s.activeOfflineModelLabel);
  const currentMode = useModeStore((s) => s.currentMode);
  // Offline-specific lifecycle phases must only render their labels when
  // the *in-flight stream* is actually using the offline backend — never
  // when the user has switched to Online mid-stream, and never as a
  // leftover after a failed stream.  `activeStreamKind` is the source of
  // truth for "what backend is the active request using right now?";
  // gating the offline labels on it makes mode contamination impossible.
  const isOfflineStream = activeStreamKind === "offline";
  // For the accent dot we prefer the in-flight backend (so an Auto-mode
  // user who chose offline sees the emerald dot, and switching modes
  // mid-stream doesn't change colour for the running request).  Falls
  // back to the user's current mode when no stream is active yet.
  const accentMode =
    activeStreamKind === "offline"
      ? "offline"
      : activeStreamKind === "online"
        ? "online"
        : currentMode;
  // Map every lifecycle state to a friendly label.  Offline-specific phases
  // (runtime-starting / loading-model / processing-prompt / generating) make
  // slow on-device boot legible — without them, "streaming" lingers for many
  // seconds while llama.cpp spawns and loads the model file from disk.
  // The default fallback differs by mode so offline streams are never
  // pinned to a misleading "Streaming response…" label.  In practice the
  // offline path always seeds a specific phase in dispatchStream, so this
  // branch is only reached if a phase event is dropped or arrives out of
  // order on slow hardware — keeping a calm, honest label avoids the
  // "stuck on Streaming response…" complaint that motivated this fix.
  const fallbackLabel = isOfflineStream ? "Working on your reply…" : "Streaming response…";
  const offlinePhaseLabel =
    streamState === "runtime-starting"
      ? "Starting offline runtime…"
      : streamState === "loading-model"
        ? `Loading ${activeOfflineModelLabel ?? "model"}…`
        : streamState === "processing-prompt"
          ? "Processing your prompt…"
          : streamState === "generating"
            ? "Generating response…"
            : null;
  const label =
    streamState === "validating"
      ? "Validating connection…"
      : streamState === "routing"
        ? "Routing to best free model…"
        : streamState === "fallback-switching"
          ? "Switching to fallback model…"
          : streamState === "stopping"
            ? "Stopping…"
            : isOfflineStream && offlinePhaseLabel
              ? offlinePhaseLabel
              : fallbackLabel;

  // Per-mode accent for the leading pulse dot — keeps the indicator
  // visually anchored to the active request's backend (online=blue,
  // offline=emerald, auto=amber when no backend has been chosen yet)
  // without dominating the row.
  const accentDot = MODE_ACCENT[accentMode]?.dot ?? MODE_ACCENT.online.dot;

  return (
    <div className="flex items-center gap-2 px-6 py-4">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full motion-safe:animate-glow-pulse",
          accentDot,
        )}
        aria-hidden="true"
      />
      <div className="flex items-end gap-[3px] h-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="inline-block w-[3px] rounded-full bg-primary/70 motion-safe:animate-wave origin-bottom"
            style={{ animationDelay: `${i * 0.11}s` }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground/60 motion-safe:animate-pulse-subtle">
          {label}
        </span>
        {routingInfo && (
          <span className="text-[10px] text-muted-foreground/40 leading-tight">
            {routingInfo.modelName}
            {/* Show the routing reason only in Auto mode — for manual model selection
                the reason ("Selected by you") is redundant information */}
            {routingInfo.reason && routingInfo.isAuto
              ? ` · ${routingInfo.reason}`
              : ""}
            {routingInfo.isFallback && (
              <span className="ml-1 text-amber-400/60">(fallback)</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
