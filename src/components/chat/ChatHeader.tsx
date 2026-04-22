import { Settings, AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { getPreset, CATEGORY_META, AUTO_MODEL_ID } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useModels } from "@/hooks/useModels";
import type { ModelVerificationStatus } from "@/types";

const CATEGORY_COLORS: Record<string, string> = {
  auto: "bg-cyan-500/15 text-cyan-400",
  general: "bg-blue-500/15 text-blue-400",
  coding: "bg-emerald-500/15 text-emerald-400",
  fast: "bg-amber-500/15 text-amber-400",
  reasoning: "bg-violet-500/15 text-violet-400",
  longContext: "bg-fuchsia-500/15 text-fuchsia-400",
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
    case "unavailable":
      return <AlertTriangle className="h-3 w-3 flex-shrink-0 text-red-400/70" />;
    default:
      return <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-muted-foreground/40" />;
  }
}

function healthTooltip(status: ModelVerificationStatus, modelId: string): string {
  if (modelId === AUTO_MODEL_ID) return "Auto mode — routes to the best verified model";
  switch (status) {
    case "verified": return "Model verified and working for your account";
    case "gated": return "Requires model access approval on Hugging Face";
    case "rate-limited": return "Rate limited recently — may retry automatically";
    case "unavailable": return "Model currently unavailable — Auto mode will reroute";
    default: return "Model not yet probed for your account";
  }
}

export function ChatHeader() {
  const { selectedModel, setSettingsOpen } = useSettingsStore();
  const { isStreaming, streamingTokenCount } = useChatStore();
  const { data: models = [] } = useModels();

  const preset = getPreset(models, selectedModel);
  const displayName = preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;
  const category = preset?.category ?? "general";
  const verifiedStatus = preset?.verifiedStatus ?? "unknown";
  const categoryMeta = CATEGORY_META[category];
  const categoryColorClass = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 bg-card/20 px-4 backdrop-blur-sm">
        {/* Model indicator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all",
                "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              {isStreaming ? (
                <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary animate-glow-pulse" />
              ) : (
                <HealthIndicator status={verifiedStatus} modelId={selectedModel} />
              )}
              <span className="font-medium">{displayName}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight", categoryColorClass)}>
                {categoryMeta.emoji} {categoryMeta.label}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="space-y-0.5 max-w-[220px]">
            <p>{isStreaming ? "Generating…" : "Click to change model"}</p>
            {!isStreaming && (
              <p className="text-[11px] text-muted-foreground">{healthTooltip(verifiedStatus, selectedModel)}</p>
            )}
            <p className="font-mono text-[11px] text-muted-foreground">{selectedModel}</p>
          </TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2">
          {/* Live token counter */}
          {isStreaming && streamingTokenCount > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60 animate-fade-in">
              {streamingTokenCount} tok
            </span>
          )}

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
