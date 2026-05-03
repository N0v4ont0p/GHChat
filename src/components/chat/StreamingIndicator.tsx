import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import { ipc } from "@/lib/ipc";
import { MODE_ACCENT } from "@/lib/mode-accent";
import {
  STARTUP_ELAPSED_REVEAL_MS,
  formatStartupDuration,
  formatTypicalRange,
  slowStartupThresholdMs,
} from "@/lib/offline-startup-format";
import { SlowStartupHint } from "@/components/offline/SlowStartupHint";
import { cn } from "@/lib/utils";
import type { OfflineRuntimeStartupStats, StreamLifecycleState } from "@/types";

/**
 * Lifecycle states that represent the offline runtime *starting up*
 * (before the model is actually generating).  When the in-flight
 * stream is in one of these states, we surface the elapsed timer +
 * expected range so a slow boot reads as "still working" rather than
 * "stuck".  Centralised so the indicator and any future surface
 * (e.g. a header status pill) cannot disagree.
 */
const OFFLINE_STARTUP_STATES: ReadonlySet<StreamLifecycleState> = new Set([
  "runtime-starting",
  "checking-model",
  "checking-binary",
  "preparing-config",
  "launching-process",
  "waiting-for-server",
  "warming-up",
  "loading-model",
]);

export function StreamingIndicator() {
  const { routingInfo, streamState, activeStreamKind } = useChatStore();
  const activeOfflineModelLabel = useModeStore((s) => s.activeOfflineModelLabel);
  const currentMode = useModeStore((s) => s.currentMode);
  const isOfflineStream = activeStreamKind === "offline";
  const isStartupPhase = isOfflineStream && OFFLINE_STARTUP_STATES.has(streamState);
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
      : streamState === "checking-model"
        ? "Checking installed model…"
        : streamState === "checking-binary"
          ? "Checking runtime binary…"
          : streamState === "preparing-config"
            ? "Preparing runtime config…"
            : streamState === "launching-process"
              ? "Launching runtime process…"
              : streamState === "waiting-for-server"
                ? "Waiting for server readiness…"
                : streamState === "warming-up"
                  ? `Warming up ${activeOfflineModelLabel ?? "model"}…`
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

  // ── Offline startup elapsed timer + stats ──────────────────────────
  // Anchor the elapsed clock the moment we *enter* an offline startup
  // state, and reset it as soon as we leave.  Doing it locally is
  // sufficient because each startup phase begins with a state change,
  // and the indicator is always mounted while a stream is in flight.
  const startupAnchorRef = useRef<number | null>(null);
  if (isStartupPhase && startupAnchorRef.current === null) {
    startupAnchorRef.current = Date.now();
  }
  if (!isStartupPhase && startupAnchorRef.current !== null) {
    startupAnchorRef.current = null;
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isStartupPhase) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStartupPhase]);
  const startupElapsedMs = startupAnchorRef.current
    ? Math.max(0, now - startupAnchorRef.current)
    : 0;

  // Pull the active model's startup history.  Refetched lazily on
  // each transition into a startup phase so the "typical" range
  // reflects the most recent runs.  Cheap IPC call; no-op when not
  // offline.  Falls back to null if IPC fails — UI then just hides
  // the suffix without breaking.
  const [startupStats, setStartupStats] = useState<OfflineRuntimeStartupStats | null>(null);
  useEffect(() => {
    if (!isStartupPhase) {
      setStartupStats(null);
      return;
    }
    let cancelled = false;
    void ipc
      .getOfflineInfo()
      .then((info) => {
        if (!cancelled) setStartupStats(info.startupStats ?? null);
      })
      .catch(() => {
        /* tolerate IPC failure — the suffix simply collapses to elapsed-only */
      });
    return () => {
      cancelled = true;
    };
  }, [isStartupPhase]);
  // Hint: when a startup exceeds max(history*1.5, 30s), surface the
  // "taking longer than usual" disclosure with possible causes.  The
  // floor matters most on first launch when no history exists yet.
  const slowThresholdMs = slowStartupThresholdMs(startupStats);
  const isSlowStartup = isStartupPhase && startupElapsedMs >= slowThresholdMs;

  // Build the optional "elapsed · typically X" suffix surfaced beside
  // the phase label.  Only rendered after STARTUP_ELAPSED_REVEAL_MS
  // so a fast warm start doesn't flash a "0s" badge.
  const elapsedSuffix =
    isStartupPhase && startupElapsedMs >= STARTUP_ELAPSED_REVEAL_MS
      ? formatStartupDuration(startupElapsedMs)
      : null;
  const typicalLabel = isStartupPhase ? formatTypicalRange(startupStats) : null;

  return (
    <div className="flex flex-col gap-1.5 px-6 py-4">
      <div className="flex items-center gap-2">
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
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs text-muted-foreground/60 motion-safe:animate-pulse-subtle">
            {label}
            {elapsedSuffix && (
              <span className="ml-1.5 font-mono tabular-nums text-[10.5px] text-muted-foreground/50">
                {elapsedSuffix}
                {typicalLabel ? ` · typically ${typicalLabel}` : ""}
              </span>
            )}
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
      {isSlowStartup && <SlowStartupHint className="ml-5" />}
    </div>
  );
}
