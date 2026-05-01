import { Settings, AlertTriangle, ShieldAlert, Clock, EyeOff, Eye, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { getPreset, CATEGORY_META, AUTO_MODEL_ID } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import { useModels } from "@/hooks/useModels";
import type { ModelVerificationStatus, ModelPreset } from "@/types";
const CATEGORY_COLORS: Record<string, string> = {
  auto: "bg-cyan-500/15 text-cyan-400",
  general: "bg-blue-500/15 text-blue-400",
  coding: "bg-emerald-500/15 text-emerald-400",
  fast: "bg-amber-500/15 text-amber-400",
  reasoning: "bg-violet-500/15 text-violet-400",
  longContext: "bg-fuchsia-500/15 text-fuchsia-400",
  creative: "bg-pink-500/15 text-pink-400",
  all: "bg-slate-500/15 text-slate-400",
};

/** Dot color + icon + tooltip for each verification status */
function HealthIndicator({ status, modelId }: { status: ModelVerificationStatus; modelId: string }) {
  const isAuto = modelId === AUTO_MODEL_ID;

  if (isAuto) {
    // Auto mode is always "healthy" from the user's perspective
    return (
      <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-cyan-400/80" />
    );
  }

  switch (status) {
    case "verified":
      return <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-green-400/80" />;
    case "gated":
      return <ShieldAlert className="h-3 w-3 flex-shrink-0 text-amber-400/80" />;
    case "rate-limited":
      return <Clock className="h-3 w-3 flex-shrink-0 text-amber-400/80" />;
    case "billing-blocked":
      return <AlertTriangle className="h-3 w-3 flex-shrink-0 text-red-400/80" />;
    case "unavailable":
      return <AlertTriangle className="h-3 w-3 flex-shrink-0 text-red-400/70" />;
    default:
      return <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-muted-foreground/40" />;
  }
}

function healthTooltip(status: ModelVerificationStatus, modelId: string): string {
  if (modelId === AUTO_MODEL_ID) return "Auto mode — routes to the best free model via OpenRouter";
  switch (status) {
    case "verified": return "Model verified and working";
    case "gated": return "Requires model access approval";
    case "rate-limited": return "Rate limited recently — may retry automatically";
    case "billing-blocked": return "API key valid, but billing currently blocks inference";
    case "unavailable": return "Model currently unavailable — Auto mode will reroute";
    default: return "Model not yet probed for your account";
  }
}

function CapabilityBadges({ preset }: { preset: ModelPreset | undefined }) {
  if (!preset?.capabilities) return null;
  const cap = preset.capabilities;
  const badges: Array<{ label: string; icon: string }> = [];
  if (cap.coding) badges.push({ label: "coding", icon: "🧑‍💻" });
  if (cap.reasoning) badges.push({ label: "reasoning", icon: "🧠" });
  if (cap.creative) badges.push({ label: "creative", icon: "✨" });
  if (cap.fast) badges.push({ label: "fast", icon: "⚡" });
  if (cap.longContext) badges.push({ label: "long ctx", icon: "📚" });
  if (cap.webSearch) badges.push({ label: "search", icon: "🔍" });
  if (badges.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {badges.slice(0, 2).map((b) => (
        <span
          key={b.label}
          className="rounded px-1 py-0.5 text-[9px] font-medium bg-muted/60 text-muted-foreground/70"
        >
          {b.icon} {b.label}
        </span>
      ))}
    </span>
  );
}

export function ChatHeader() {
  const { selectedModel, setSettingsOpen } = useSettingsStore();
  const { isStreaming, streamingTokenCount, incognitoMode, setIncognitoMode } = useChatStore();
  const { data: models = [] } = useModels();
  const { currentMode, activeOfflineModelLabel, setOfflineManagementOpen } = useModeStore();

  const isOffline = currentMode === "offline";

  // In offline mode show the *active installed* model only.  The
  // analyze-step recommendation is intentionally NOT used as a fallback
  // — it points at a model the user may have never installed (e.g.
  // Gemma 4 E4B as the recommendation while the user actually installed
  // a lightweight test variant), which would mislead the user about
  // what their next message will hit.  When no active label is known
  // we render a neutral affordance that opens the management modal so
  // the user can pick or install one.
  const offlineModelLabel = activeOfflineModelLabel ?? "Choose an offline model";
  const hasActiveOffline = activeOfflineModelLabel !== null;

  const preset = getPreset(models, selectedModel);
  const displayName = isOffline ? offlineModelLabel : (preset?.name ?? selectedModel.split("/").pop() ?? selectedModel);
  const vendor = isOffline ? "Local" : preset?.vendor;
  const category = isOffline ? "general" : (preset?.category ?? "general");
  const verifiedStatus = preset?.verifiedStatus ?? "unknown";
  const healthTags = preset?.healthTags ?? [];
  const categoryMeta = CATEGORY_META[category] ?? CATEGORY_META.general;
  const categoryColorClass = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn(
          "flex h-12 shrink-0 items-center justify-between border-b px-4 backdrop-blur-sm transition-colors",
          incognitoMode
            ? "border-amber-500/30 bg-amber-950/20"
            : "border-border/40 bg-card/20",
        )}
      >
        {/* Model indicator */}
        <div className="flex items-center gap-2">
          {incognitoMode && (
            <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              <EyeOff className="h-2.5 w-2.5" />
              Incognito
            </span>
          )}
          {isOffline && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setOfflineManagementOpen(true)}
                  className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                >
                  <Cpu className="h-2.5 w-2.5" />
                  Offline
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Manage Offline Mode</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (isOffline) {
                    // Always allow opening the management modal in
                    // offline mode — both to switch active model and
                    // to install one when no active model exists yet.
                    setOfflineManagementOpen(true);
                  } else {
                    setSettingsOpen(true);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all",
                  "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  isOffline && !hasActiveOffline && "border border-dashed border-amber-500/40 text-amber-300 hover:text-amber-200",
                )}
              >
                {isStreaming ? (
                  <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary animate-glow-pulse" />
                ) : isOffline ? (
                  <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-emerald-400/80" />
                ) : (
                  <HealthIndicator status={verifiedStatus} modelId={selectedModel} />
                )}
                <span className="font-medium">{displayName}</span>
                {vendor && !isStreaming && (
                  <span className="text-[10px] text-muted-foreground/50 font-normal">
                    {vendor}
                  </span>
                )}
                {!isOffline && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight", categoryColorClass)}>
                    {categoryMeta.emoji} {categoryMeta.label}
                  </span>
                )}
                {!isStreaming && !isOffline && <CapabilityBadges preset={preset} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="space-y-0.5 max-w-[240px]">
              {isOffline ? (
                <>
                  <p>Local inference — no internet required</p>
                  <p className="text-[11px] text-muted-foreground">
                    Running on-device via llama.cpp
                  </p>
                </>
              ) : (
                <>
                  <p>{isStreaming ? "Generating…" : "Click to change model"}</p>
                  {!isStreaming && (
                    <>
                      <p className="text-[11px] text-muted-foreground">{healthTooltip(verifiedStatus, selectedModel)}</p>
                      {vendor && (
                        <p className="text-[11px] text-muted-foreground">Provider: {vendor}</p>
                      )}
                      {preset?.contextWindow && (
                        <p className="text-[11px] text-muted-foreground">Context: {preset.contextWindow}</p>
                      )}
                      {healthTags.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {healthTags.join(" · ")}
                        </p>
                      )}
                    </>
                  )}
                  <p className="font-mono text-[11px] text-muted-foreground">{selectedModel}</p>
                </>
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          {/* Live token counter */}
          {isStreaming && streamingTokenCount > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60 animate-fade-in">
              {streamingTokenCount} tok
            </span>
          )}

          {/* Incognito toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 transition-colors",
                  incognitoMode
                    ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setIncognitoMode(!incognitoMode)}
              >
                {incognitoMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {incognitoMode ? "Incognito on — click to disable" : "Enable incognito mode"}
            </TooltipContent>
          </Tooltip>

          {/* Settings shortcut */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
