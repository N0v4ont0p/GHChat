import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  Copy,
  FileText,
  FolderOpen,
  HeartPulse,
  Loader2,
  RefreshCw,
  RotateCw,
  Stethoscope,
  XCircle,
  Zap,
  ZapOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type {
  OfflineRuntimeDiagnostics,
  OfflineRuntimeStateKind,
} from "@/types";

/**
 * Map a runtime state kind to a short user-facing label + tone.  Kept
 * private to this module so the diagnostics panel is self-contained.
 */
const STATE_LABELS: Record<
  OfflineRuntimeStateKind,
  { label: string; tone: "ok" | "busy" | "warn" | "fail" | "idle" }
> = {
  unconfigured: { label: "Offline mode not installed", tone: "idle" },
  "model-missing": { label: "No offline model installed", tone: "warn" },
  validating: { label: "Validating…", tone: "busy" },
  launching: { label: "Launching…", tone: "busy" },
  "waiting-for-ready": { label: "Waiting for server…", tone: "busy" },
  "warming-up": { label: "Loading model…", tone: "busy" },
  ready: { label: "Ready", tone: "ok" },
  stopping: { label: "Stopping…", tone: "busy" },
  stopped: { label: "Stopped", tone: "idle" },
  failed: { label: "Failed", tone: "fail" },
};

function toneClasses(tone: "ok" | "busy" | "warn" | "fail" | "idle"): string {
  switch (tone) {
    case "ok":
      return "text-emerald-400";
    case "busy":
      return "text-amber-400";
    case "warn":
      return "text-amber-400";
    case "fail":
      return "text-red-400";
    case "idle":
    default:
      return "text-muted-foreground/60";
  }
}

function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}m ${seconds}s`;
}

function formatPathExists(
  path: string | null,
  exists: boolean | null,
): string {
  if (!path) return "—";
  if (exists === null) return path;
  return `${path} (${exists ? "exists" : "missing"})`;
}

function formatHealth(
  hc: OfflineRuntimeDiagnostics["lastHealthCheck"],
): string {
  if (!hc) return "—";
  const ts = formatTimestamp(hc.at);
  const code = hc.httpStatus !== undefined ? ` HTTP ${hc.httpStatus}` : "";
  const detail = hc.detail ? ` — ${hc.detail}` : "";
  return `${hc.status}${code} (at ${ts})${detail}`;
}

/**
 * Compose the plain-text diagnostics report copied to the clipboard
 * by the "Copy diagnostics" action.  Stable, single-block format so
 * users can paste it directly into bug reports.
 */
function formatReport(d: OfflineRuntimeDiagnostics): string {
  const lines: string[] = [
    "# Offline Runtime Diagnostics",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Status",
    `Kind: ${d.runtimeState.kind}`,
    `Process running: ${d.isRuntimeRunning ? "yes" : "no"}`,
    `Port: ${d.port ?? "—"}`,
    `Active model: ${d.modelId ?? "—"}`,
    "",
    "## Paths",
    `Offline root: ${d.offlineRootPath}`,
    `Model path: ${formatPathExists(d.modelPath, d.modelPathExists)}`,
    `Binary path: ${formatPathExists(d.binaryPath, d.binaryPathExists)}`,
    `Runtime log: ${d.runtimeLogPath} (${d.runtimeLogExists ? "exists" : "missing"})`,
    "",
    "## Last attempt",
    `Started at: ${formatTimestamp(d.lastStartedAt)}`,
    `Ready at: ${formatTimestamp(d.lastReadyAt)}`,
    `Startup duration: ${formatDuration(d.lastStartupDurationMs)}`,
    "",
    "## Last process exit",
    `Exited at: ${formatTimestamp(d.lastExitAt)}`,
    `Exit code: ${d.lastExitCode ?? "—"}`,
    `Signal: ${d.lastExitSignal ?? "—"}`,
    "",
    "## Last health check",
    formatHealth(d.lastHealthCheck),
    "",
    "## Last error",
    d.lastErrorMessage ?? "—",
    "",
    "## stderr (tail)",
    d.stderrTail || "—",
    "",
    "## stdout (tail)",
    d.stdoutTail || "—",
  ];
  return lines.join("\n");
}

export function RuntimeDiagnosticsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [diag, setDiag] = useState<OfflineRuntimeDiagnostics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<
    null | "retry" | "force-stop" | "copy"
  >(null);
  const [copied, setCopied] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    try {
      const next = await ipc.getOfflineRuntimeDiagnostics();
      setDiag(next);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load diagnostics",
      );
    }
  }, []);

  // Initial load + auto-refresh on every state-machine push so the
  // panel never goes stale while users are watching it.  We rely on
  // OFFLINE_RUNTIME_STATE alone — the state machine is the canonical
  // surface and every meaningful runtime transition routes through it.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    const offState = ipc.onOfflineRuntimeState(() => {
      void refresh();
    });
    return () => {
      offState?.();
    };
  }, [open, refresh]);

  const stateInfo = useMemo(() => {
    if (!diag) return null;
    return STATE_LABELS[diag.runtimeState.kind];
  }, [diag]);

  const canRetry = !!diag && diag.runtimeState.kind !== "unconfigured";
  const canForceStop = !!diag && diag.isRuntimeRunning;

  const handleCopy = async () => {
    if (!diag) return;
    setBusyAction("copy");
    try {
      await navigator.clipboard.writeText(formatReport(diag));
      setCopied(true);
      toast.success("Diagnostics copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not copy diagnostics",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenOfflineFolder = async () => {
    try {
      await ipc.revealOfflineFolder();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open offline folder",
      );
    }
  };

  const handleOpenLogs = async () => {
    try {
      await ipc.revealOfflineRuntimeLog();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open runtime log",
      );
    }
  };

  const handleRetry = async () => {
    setBusyAction("retry");
    try {
      const res = await ipc.restartOfflineRuntime();
      if (!res.ok) {
        toast.error(res.error ?? "Restart failed");
      } else {
        toast.success("Runtime restart initiated");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setBusyAction(null);
      void refresh();
    }
  };

  const handleForceStop = async () => {
    setBusyAction("force-stop");
    try {
      await ipc.forceStopOfflineRuntime();
      toast.success("Runtime force-stopped");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Force stop failed");
    } finally {
      setBusyAction(null);
      void refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <Stethoscope className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <DialogTitle className="text-sm font-semibold">
              Runtime Diagnostics
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto text-[12px]">
          {loading && !diag ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : diag && stateInfo ? (
            <>
              {/* Status header */}
              <div
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3.5 py-2.5",
                  stateInfo.tone === "ok" &&
                    "border-emerald-500/30 bg-emerald-500/5",
                  stateInfo.tone === "fail" &&
                    "border-red-500/30 bg-red-500/5",
                  stateInfo.tone === "busy" &&
                    "border-amber-500/30 bg-amber-500/5",
                  stateInfo.tone === "warn" &&
                    "border-amber-500/30 bg-amber-500/5",
                  stateInfo.tone === "idle" &&
                    "border-border/40 bg-secondary/20",
                )}
              >
                <div className="flex items-center gap-2">
                  {stateInfo.tone === "ok" ? (
                    <Zap
                      className={cn("h-3.5 w-3.5 shrink-0", toneClasses(stateInfo.tone))}
                    />
                  ) : stateInfo.tone === "fail" ? (
                    <XCircle
                      className={cn("h-3.5 w-3.5 shrink-0", toneClasses(stateInfo.tone))}
                    />
                  ) : stateInfo.tone === "busy" ? (
                    <Loader2
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 animate-spin",
                        toneClasses(stateInfo.tone),
                      )}
                    />
                  ) : (
                    <Activity
                      className={cn("h-3.5 w-3.5 shrink-0", toneClasses(stateInfo.tone))}
                    />
                  )}
                  <div>
                    <div className="text-[12px] font-medium">
                      Runtime:{" "}
                      <span className={toneClasses(stateInfo.tone)}>
                        {stateInfo.label}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground/60">
                      Active model:{" "}
                      <span className="font-mono">{diag.modelId ?? "—"}</span>
                      {diag.port !== null ? ` · port ${diag.port}` : ""}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => void refresh()}
                  aria-label="Refresh diagnostics"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopy()}
                  disabled={busyAction !== null}
                  title="Copy a plain-text diagnostics report to the clipboard"
                >
                  {copied ? (
                    <Check className="mr-1 h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="mr-1 h-3.5 w-3.5" />
                  )}
                  Copy diagnostics
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleOpenOfflineFolder()}
                >
                  <FolderOpen className="mr-1 h-3.5 w-3.5" />
                  Open offline folder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleOpenLogs()}
                  title={
                    diag.runtimeLogExists
                      ? "Reveal runtime-last-failure.log"
                      : "Open the offline folder (no log file yet)"
                  }
                >
                  <FileText className="mr-1 h-3.5 w-3.5" />
                  Open logs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRetry()}
                  disabled={!canRetry || busyAction !== null}
                  title="Stop the runtime and start it again for the active model"
                >
                  {busyAction === "retry" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="mr-1 h-3.5 w-3.5" />
                  )}
                  Retry runtime
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleForceStop()}
                  disabled={!canForceStop || busyAction !== null}
                  className="text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                  title="Force-kill the runtime process (SIGKILL)"
                >
                  {busyAction === "force-stop" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ZapOff className="mr-1 h-3.5 w-3.5" />
                  )}
                  Force stop
                </Button>
              </div>

              {/* Paths */}
              <DiagnosticsSection title="Paths">
                <DiagnosticsRow
                  label="Offline root"
                  value={diag.offlineRootPath}
                />
                <DiagnosticsRow
                  label="Model path"
                  value={formatPathExists(diag.modelPath, diag.modelPathExists)}
                  warn={diag.modelPath !== null && diag.modelPathExists === false}
                />
                <DiagnosticsRow
                  label="Binary path"
                  value={formatPathExists(diag.binaryPath, diag.binaryPathExists)}
                  warn={
                    diag.binaryPath !== null && diag.binaryPathExists === false
                  }
                />
                <DiagnosticsRow
                  label="Runtime log"
                  value={`${diag.runtimeLogPath} (${diag.runtimeLogExists ? "exists" : "missing"})`}
                />
              </DiagnosticsSection>

              {/* Last attempt */}
              <DiagnosticsSection title="Last attempt">
                <DiagnosticsRow
                  label="Started at"
                  value={formatTimestamp(diag.lastStartedAt)}
                />
                <DiagnosticsRow
                  label="Ready at"
                  value={formatTimestamp(diag.lastReadyAt)}
                />
                <DiagnosticsRow
                  label="Startup duration"
                  value={formatDuration(diag.lastStartupDurationMs)}
                />
              </DiagnosticsSection>

              {/* Last process exit */}
              <DiagnosticsSection title="Last process exit">
                <DiagnosticsRow
                  label="Exited at"
                  value={formatTimestamp(diag.lastExitAt)}
                />
                <DiagnosticsRow
                  label="Exit code"
                  value={diag.lastExitCode === null ? "—" : String(diag.lastExitCode)}
                  warn={
                    diag.lastExitCode !== null && diag.lastExitCode !== 0
                  }
                />
                <DiagnosticsRow
                  label="Signal"
                  value={diag.lastExitSignal ?? "—"}
                  warn={
                    diag.lastExitSignal !== null &&
                    diag.lastExitSignal !== "SIGTERM"
                  }
                />
              </DiagnosticsSection>

              {/* Last health check */}
              <DiagnosticsSection
                title="Last health check"
                icon={<HeartPulse className="h-3 w-3 text-muted-foreground/60" />}
              >
                <DiagnosticsRow
                  label="Result"
                  value={formatHealth(diag.lastHealthCheck)}
                  warn={
                    diag.lastHealthCheck !== null && !diag.lastHealthCheck.ok
                  }
                />
              </DiagnosticsSection>

              {/* Last error */}
              {diag.lastErrorMessage && (
                <DiagnosticsSection title="Last error">
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-red-500/30 bg-red-500/5 p-2 font-mono text-[11px] text-red-200">
                    {diag.lastErrorMessage}
                  </pre>
                </DiagnosticsSection>
              )}

              {/* stderr / stdout */}
              <DiagnosticsSection title="stderr (tail)">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-secondary/30 p-2 font-mono text-[11px] text-muted-foreground">
                  {diag.stderrTail || "—"}
                </pre>
              </DiagnosticsSection>
              <DiagnosticsSection title="stdout (tail)">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-secondary/30 p-2 font-mono text-[11px] text-muted-foreground">
                  {diag.stdoutTail || "—"}
                </pre>
              </DiagnosticsSection>
            </>
          ) : (
            <div className="text-muted-foreground">
              No diagnostics available.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiagnosticsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DiagnosticsRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/30 bg-secondary/10 px-2.5 py-1.5">
      <span className="min-w-[7.5rem] shrink-0 text-[11px] font-medium text-muted-foreground/80">
        {label}
      </span>
      <span
        className={cn(
          "flex-1 break-all font-mono text-[11px]",
          warn ? "text-amber-300" : "text-foreground/85",
        )}
      >
        {value}
      </span>
    </div>
  );
}
