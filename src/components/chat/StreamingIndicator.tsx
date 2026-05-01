import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";

export function StreamingIndicator() {
  const { routingInfo, streamState } = useChatStore();
  const activeOfflineModelLabel = useModeStore((s) => s.activeOfflineModelLabel);
  // Map every lifecycle state to a friendly label.  Offline-specific phases
  // (runtime-starting / loading-model / processing-prompt / generating) make
  // slow on-device boot legible — without them, "streaming" lingers for many
  // seconds while llama.cpp spawns and loads the model file from disk.
  const label =
    streamState === "validating"
      ? "Validating connection…"
      : streamState === "routing"
        ? "Routing to best free model…"
        : streamState === "fallback-switching"
          ? "Switching to fallback model…"
          : streamState === "stopping"
            ? "Stopping…"
            : streamState === "runtime-starting"
              ? "Starting offline runtime…"
              : streamState === "loading-model"
                ? `Loading ${activeOfflineModelLabel ?? "model"}…`
                : streamState === "processing-prompt"
                  ? "Processing your prompt…"
                  : streamState === "generating"
                    ? "Generating response…"
                    : "Streaming response…";

  return (
    <div className="flex items-center gap-2 px-6 py-4">
      <div className="flex items-end gap-[3px] h-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="inline-block w-[3px] rounded-full bg-primary/70 animate-wave origin-bottom"
            style={{ animationDelay: `${i * 0.11}s` }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground/60 animate-pulse-subtle">
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
