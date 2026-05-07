import { motion } from "framer-motion";
import {
  AlertTriangle,
  RefreshCw,
  Zap,
  Settings,
  KeyRound,
  ArrowRight,
  RotateCw,
  ZapOff,
  Cpu,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/technical-details";
import { cn } from "@/lib/utils";
import type { StructuredChatError } from "@/types";

interface ChatErrorPanelProps {
  error: StructuredChatError;
  /** Retry with the same model/settings */
  onRetry: () => void;
  /** Switch to the recommended fallback model and retry */
  onSwitchFallback: (modelId: string) => void;
  /** Switch to Auto mode and retry */
  onUseAuto: () => void;
  /** Re-run model probing for current token */
  onRefreshModels: () => void;
  /** Open the Settings modal */
  onOpenSettings: () => void;
  /** Restart the offline llama.cpp runtime, then retry the failed send */
  onRestartRuntime: () => void;
  /** Force-kill the offline runtime process (SIGKILL) */
  onForceStopRuntime: () => void;
  /** Open the Offline Models management modal */
  onManageOfflineModel: () => void;
  /** Open the Runtime Diagnostics modal */
  onOpenDiagnostics: () => void;
}

/** Human-readable context for each known HTTP error status */
function contextForStatus(status: number | undefined): string {
  if (status === 401) return "Your OpenRouter API key appears to be invalid or revoked.";
  if (status === 402) return "Your key is valid, but inference is currently blocked by credits or billing.";
  if (status === 403)
    return "Access to this model was denied. It may require special approval or be region-restricted.";
  if (status === 404)
    return "The model wasn't found on OpenRouter. It may have been removed or is no longer available for free.";
  if (status === 429)
    return "You've hit a rate limit on this model. Waiting a moment usually resolves this.";
  if (status === 503)
    return "The model is temporarily overloaded or still loading. It should be available shortly.";
  return "Something went wrong while connecting to the model.";
}

export function ChatErrorPanel({
  error,
  onRetry,
  onSwitchFallback,
  onUseAuto,
  onRefreshModels,
  onOpenSettings,
  onRestartRuntime,
  onForceStopRuntime,
  onManageOfflineModel,
  onOpenDiagnostics,
}: ChatErrorPanelProps) {
  const context = contextForStatus(error.status);

  // Build a compact technical block with whatever optional fields the
  // structured error included.  Hidden behind a disclosure so the
  // friendly summary stays the dominant message.
  const technicalLines: string[] = [];
  if (error.kind) technicalLines.push(`kind: ${error.kind}`);
  if (typeof error.status === "number") technicalLines.push(`status: ${error.status}`);
  if (error.failedModel) technicalLines.push(`failedModel: ${error.failedModel}`);
  if (error.fallbackModel) technicalLines.push(`fallbackModel: ${error.fallbackModel}`);
  technicalLines.push(`message: ${error.message}`);
  const technical = technicalLines.join("\n");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="mx-4 mb-4 sm:mx-6 rounded-xl border border-red-500/15 bg-red-500/[0.04] p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-red-500/12 ring-1 ring-red-500/20">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug">{error.message}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{context}</p>
        </div>
      </div>

      {/* Recovery actions */}
      <div className="flex flex-wrap gap-2 pl-10">
        {error.actions.includes("retry") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 rounded-lg border-border/60 text-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors"
            onClick={onRetry}
          >
            <RefreshCw className="h-3 w-3" />
            Try again
          </Button>
        )}

        {error.actions.includes("fallback") && error.fallbackModel && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 rounded-lg border-amber-500/30 text-xs text-amber-400 hover:border-amber-500/60 hover:bg-amber-500/5 transition-colors"
            onClick={() => onSwitchFallback(error.fallbackModel!)}
          >
            <ArrowRight className="h-3 w-3" />
            {error.fallbackModelName
              ? `Switch to ${error.fallbackModelName}`
              : "Switch to fallback model"}
          </Button>
        )}

        {error.actions.includes("auto") && (
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-7 gap-1.5 rounded-lg text-xs transition-colors",
              "border-cyan-500/30 text-cyan-400 hover:border-cyan-500/60 hover:bg-cyan-500/5",
            )}
            onClick={onUseAuto}
          >
            <Zap className="h-3 w-3" />
            Use Auto mode
          </Button>
        )}

        {error.actions.includes("refresh-models") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 rounded-lg border-border/60 text-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors"
            onClick={onRefreshModels}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh model availability
          </Button>
        )}

        {error.actions.includes("settings") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onOpenSettings}
          >
            <Settings className="h-3 w-3" />
            Settings
          </Button>
        )}

        {error.actions.includes("verify-token") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onOpenSettings}
          >
            <KeyRound className="h-3 w-3" />
            Update API key
          </Button>
        )}

        {/* Offline-runtime-flavored recovery actions.  Emerald accent so
            users associate them with offline mode (matches MODE_ACCENT). */}
        {error.actions.includes("restart-runtime") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 rounded-lg border-emerald-500/30 text-xs text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/5 transition-colors"
            onClick={onRestartRuntime}
          >
            <RotateCw className="h-3 w-3" />
            Restart runtime
          </Button>
        )}

        {error.actions.includes("force-stop-runtime") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 rounded-lg border-red-500/30 text-xs text-red-400 hover:border-red-500/60 hover:bg-red-500/5 transition-colors"
            onClick={onForceStopRuntime}
          >
            <ZapOff className="h-3 w-3" />
            Force stop
          </Button>
        )}

        {error.actions.includes("manage-offline-model") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onManageOfflineModel}
          >
            <Cpu className="h-3 w-3" />
            Manage model
          </Button>
        )}

        {error.actions.includes("open-diagnostics") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onOpenDiagnostics}
          >
            <Stethoscope className="h-3 w-3" />
            Diagnostics
          </Button>
        )}
      </div>

      {/* Raw technical info hidden behind a disclosure */}
      <div className="pl-10">
        <TechnicalDetails details={technical} tone="danger" />
      </div>
    </motion.div>
  );
}
