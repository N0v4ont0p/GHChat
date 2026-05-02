import { Settings, AlertTriangle, ShieldAlert, Clock, EyeOff, Eye, Cpu, CircleDot, CircleSlash, Globe, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { getPreset, CATEGORY_META, AUTO_MODEL_ID } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import { useModels } from "@/hooks/useModels";
import { useConversations } from "@/hooks/useConversations";
import { useOfflineState } from "@/hooks/useOfflineState";
import { MODE_ACCENT } from "@/lib/mode-accent";
import type { AppMode, ModelVerificationStatus, ModelPreset } from "@/types";
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
      <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", MODE_ACCENT.auto.dot)} />
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

// ── Mode badge ───────────────────────────────────────────────────────────────
//
// Always rendered in the chat top bar so the user can see — at a glance —
// which backend the next message will hit.  Mirrors the sidebar mode
// switcher's color scheme for visual continuity.

const MODE_BADGE_CONFIG: Record<AppMode, { label: string; icon: React.ElementType; className: string }> = {
  online: {
    label: MODE_ACCENT.online.label,
    icon: Globe,
    className: MODE_ACCENT.online.badge,
  },
  auto: {
    label: MODE_ACCENT.auto.label,
    icon: Zap,
    className: MODE_ACCENT.auto.badge,
  },
  offline: {
    label: MODE_ACCENT.offline.label,
    icon: Cpu,
    className: MODE_ACCENT.offline.badge,
  },
};

function ModeBadge({ mode, onClick }: { mode: AppMode; onClick?: () => void }) {
  const { label, icon: Icon, className } = MODE_BADGE_CONFIG[mode];
  const tooltip =
    mode === "offline"
      ? "Offline mode — running locally on your device"
      : mode === "auto"
        ? "Auto mode — uses installed offline model when available, otherwise online"
        : "Online mode — using OpenRouter free models";
  const interactive = !!onClick;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {interactive ? (
          <button
            onClick={onClick}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:brightness-110",
              className,
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            {label}
          </button>
        ) : (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              className,
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            {label}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function ChatHeader() {
  const { selectedModel, setSettingsOpen } = useSettingsStore();
  const { isStreaming, streamingTokenCount, incognitoMode, setIncognitoMode, selectedConversationId } = useChatStore();
  const { data: models = [] } = useModels();
  const { data: conversations = [] } = useConversations();
  const { currentMode, activeOfflineModelLabel, setOfflineManagementOpen } = useModeStore();
  // Offline-state snapshot for the runtime/readiness pill.  Reads are
  // cheap (cached + push-invalidated) so it's safe to subscribe even
  // when offline mode isn't active — the pill is only rendered in
  // offline mode anyway.
  const { data: offlineSnapshot } = useOfflineState();

  const isOffline = currentMode === "offline";
  // True when Auto mode is currently routing to the offline runtime —
  // mirrors the rule in shouldUseOfflineBackend()/Composer.willUseOffline.
  const isAutoOnLocal =
    currentMode === "auto" && Boolean(offlineSnapshot?.activeModel);
  // Whether the *active backend* the next message will hit is an offline
  // model, regardless of the high-level mode.  Drives the top-bar model
  // selector + capability badges so the user isn't misled in Auto mode.
  const showingLocal = isOffline || isAutoOnLocal;

  // Title for the active conversation — shown as the leftmost element so
  // the user always knows which thread they're in.  Falls back gracefully
  // when no conversation is selected (which the empty state already
  // handles upstream, but render-safe just in case).
  const activeConversation = conversations.find((c) => c.id === selectedConversationId);
  const conversationTitle = activeConversation?.title?.trim() || "New chat";

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
  const displayName = showingLocal ? offlineModelLabel : (preset?.name ?? selectedModel.split("/").pop() ?? selectedModel);
  const vendor = showingLocal ? "Local" : preset?.vendor;
  const category = showingLocal ? "general" : (preset?.category ?? "general");
  const verifiedStatus = preset?.verifiedStatus ?? "unknown";
  const healthTags = preset?.healthTags ?? [];
  const categoryMeta = CATEGORY_META[category] ?? CATEGORY_META.general;
  const categoryColorClass = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;

  // Online / Auto readiness pill — derived from the active model's
  // verification status so the user always sees whether the next message
  // is likely to succeed.  Auto mode advertises "Auto routing" because
  // OpenRouter picks the actual target model at request time.
  const readiness = ((): {
    label: string;
    tooltip: string;
    Icon: React.ElementType;
    className: string;
  } => {
    if (currentMode === "auto") {
      // In auto mode an offline-installed model takes precedence; show
      // that as the active backend so the user isn't surprised.
      if (offlineSnapshot?.activeModel) {
        return {
          label: "Local ready",
          tooltip: "Auto mode: an installed offline model is available — the next message will run on-device.",
          Icon: CircleDot,
          className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        };
      }
      return {
        label: "Auto routing",
        tooltip: "Auto mode: routes to the best free model via OpenRouter.",
        Icon: CircleDot,
        className: cn("border", MODE_ACCENT.auto.badge),
      };
    }
    // Online mode — reflect verification status.
    switch (verifiedStatus) {
      case "verified":
        return {
          label: "Ready",
          tooltip: "Model verified and ready for the next message.",
          Icon: CircleDot,
          className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        };
      case "gated":
        return {
          label: "Access required",
          tooltip: "This model requires access approval from the provider.",
          Icon: ShieldAlert,
          className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        };
      case "rate-limited":
        return {
          label: "Rate limited",
          tooltip: "Recent requests were rate-limited. The next attempt may auto-retry.",
          Icon: Clock,
          className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        };
      case "billing-blocked":
        return {
          label: "Billing blocked",
          tooltip: "API key valid, but billing currently blocks inference.",
          Icon: AlertTriangle,
          className: "border-red-500/30 bg-red-500/10 text-red-300",
        };
      case "unavailable":
        return {
          label: "Unavailable",
          tooltip: "Model currently unavailable — switch to Auto to reroute.",
          Icon: AlertTriangle,
          className: "border-red-500/30 bg-red-500/10 text-red-300",
        };
      default:
        return {
          label: "Connecting",
          tooltip: "Model not yet probed for your account.",
          Icon: CircleSlash,
          className: "border-border/40 bg-secondary/40 text-muted-foreground/70",
        };
    }
  })();

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn(
          "flex h-12 shrink-0 items-center justify-between border-b px-5 backdrop-blur-md transition-colors gap-3",
          incognitoMode
            ? "border-amber-500/30 bg-amber-950/20"
            : "border-border/50 bg-[hsl(var(--surface-2))]/60",
        )}
      >
        {/* Conversation title (always visible) — single line, truncated so
            long titles don't push the model selector off-screen. */}
        <div className="min-w-0 flex-1 flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <h1
                className="truncate text-sm font-semibold text-foreground/90 select-text"
                title={conversationTitle}
              >
                {conversationTitle}
              </h1>
            </TooltipTrigger>
            <TooltipContent side="bottom">{conversationTitle}</TooltipContent>
          </Tooltip>
        </div>

        {/* Mode badge + readiness indicator + active model selector */}
        <div className="flex items-center gap-2 shrink-0">
          {incognitoMode && (
            <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              <EyeOff className="h-2.5 w-2.5" />
              Incognito
            </span>
          )}

          {/* Mode badge — always visible.  Clickable in offline mode so
              the user can jump straight into management; in online/auto
              modes it stays informational since the mode switcher lives
              in the sidebar. */}
          <ModeBadge
            mode={currentMode}
            onClick={isOffline ? () => setOfflineManagementOpen(true) : undefined}
          />

          {/* Readiness / status pill — always rendered so the user can
              see at a glance whether the next message is ready to go.
              Offline:  reflects the real llama.cpp subprocess state.
              Online / Auto:  reflects model verification (verified /
              gated / unavailable / unknown).  Streaming overrides both
              with a "Generating…" state. */}
          {isStreaming ? (
            <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-glow-pulse" />
              Generating…
            </span>
          ) : isOffline ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setOfflineManagementOpen(true)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    offlineSnapshot?.runtimeRunning
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                      : "border-border/40 bg-secondary/40 text-muted-foreground/70 hover:text-foreground",
                  )}
                >
                  {offlineSnapshot?.runtimeRunning ? (
                    <CircleDot className="h-2.5 w-2.5" />
                  ) : (
                    <CircleSlash className="h-2.5 w-2.5" />
                  )}
                  {offlineSnapshot?.runtimeRunning ? "Runtime running" : "Runtime idle"}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                {offlineSnapshot?.runtimeRunning
                  ? "llama.cpp is running. The first message after idle starts it; it stays warm between messages."
                  : "llama.cpp is not running. The next message will start it — slow models may take a few seconds to boot."}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    readiness.className,
                  )}
                >
                  <readiness.Icon className="h-2.5 w-2.5" />
                  {readiness.label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                {readiness.tooltip}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (showingLocal) {
                    // Always allow opening the management modal when the
                    // active backend is local (offline mode, or auto mode
                    // currently routing to an installed offline model) —
                    // both to switch active model and to install one when
                    // no active model exists yet.
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
                ) : showingLocal ? (
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
                {!showingLocal && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight", categoryColorClass)}>
                    {categoryMeta.emoji} {categoryMeta.label}
                  </span>
                )}
                {!isStreaming && !showingLocal && <CapabilityBadges preset={preset} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="space-y-0.5 max-w-[240px]">
              {showingLocal ? (
                <>
                  <p>
                    {isAutoOnLocal
                      ? "Auto mode — routing to local model"
                      : "Local inference — no internet required"}
                  </p>
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
