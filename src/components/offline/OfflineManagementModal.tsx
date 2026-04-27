import { useState, useEffect } from "react";
import {
  Cpu,
  FolderOpen,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  HardDrive,
  MapPin,
  Calendar,
  Package,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useModeStore } from "@/stores/mode-store";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { OfflineInfo } from "@/types";

// ── Byte formatting ───────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${i >= 2 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function fmtDate(epochMs: number | null): string {
  if (epochMs == null) return "Unknown";
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
      <span className="text-xs text-muted-foreground/70 w-24 shrink-0">{label}</span>
      <span className={cn("text-xs text-foreground/90 flex-1 break-all", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}

// ── Health badge ──────────────────────────────────────────────────────────────

function HealthBadge({ isRunning }: { isRunning: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        isRunning
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : "bg-muted/60 text-muted-foreground border border-border/40",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isRunning ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/50",
        )}
      />
      {isRunning ? "Runtime running" : "Runtime idle"}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OfflineManagementModal() {
  const offlineManagementOpen = useModeStore((s) => s.offlineManagementOpen);
  const setOfflineManagementOpen = useModeStore((s) => s.setOfflineManagementOpen);
  const setOfflineState = useModeStore((s) => s.setOfflineState);
  const setMode = useModeStore((s) => s.setMode);
  const setOfflineRecommendation = useModeStore((s) => s.setOfflineRecommendation);

  const [info, setInfo] = useState<OfflineInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Action states
  const [revealing, setRevealing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Load info whenever the modal opens.
  useEffect(() => {
    if (!offlineManagementOpen) {
      setConfirmRemove(false);
      return;
    }
    setLoading(true);
    setError(null);
    ipc
      .getOfflineInfo()
      .then((i) => setInfo(i))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [offlineManagementOpen]);

  const handleReveal = async () => {
    setRevealing(true);
    try {
      await ipc.revealOfflineFolder();
    } catch {
      // Best effort.
    } finally {
      setRevealing(false);
    }
  };

  const handleRepair = () => {
    // Close management modal and restart setup flow from the analyze step.
    setOfflineManagementOpen(false);
    setOfflineRecommendation(null);
    setOfflineState("analyzing-system");
  };

  const handleRemoveConfirmed = async () => {
    setRemoving(true);
    try {
      await ipc.removeOfflineMode();
      // Reset renderer state: leave offline mode and go back to online.
      setOfflineState("not-installed");
      setOfflineRecommendation(null);
      setMode("online");
      setOfflineManagementOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <Dialog open={offlineManagementOpen} onOpenChange={setOfflineManagementOpen}>
      <DialogContent className="max-w-md gap-0 p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <Cpu className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <DialogTitle className="text-sm font-semibold">Offline Mode</DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-400/90 break-words">{error}</p>
            </div>
          )}

          {/* Info panel */}
          {!loading && info && (
            <>
              {/* Status */}
              <div className="flex items-center justify-between">
                <HealthBadge isRunning={info.isRuntimeRunning} />
                <span className="text-[10px] text-muted-foreground/50">
                  Installed {fmtDate(info.installedAt)}
                </span>
              </div>

              {/* Package details card */}
              <div className="rounded-xl border border-border/50 bg-secondary/20 px-4 divide-y divide-border/30">
                <InfoRow
                  icon={Package}
                  label="Model"
                  value={
                    info.modelName +
                    (info.quantization ? ` · ${info.quantization}` : "")
                  }
                />
                <InfoRow
                  icon={HardDrive}
                  label="Disk usage"
                  value={
                    fmtBytes(info.storageBytesUsed) +
                    (info.sizeGb > 0
                      ? ` (model ~${info.sizeGb.toFixed(1)} GB)`
                      : "")
                  }
                />
                <InfoRow
                  icon={MapPin}
                  label="Location"
                  value={info.installPath}
                  mono
                />
                <InfoRow
                  icon={Calendar}
                  label="Installed"
                  value={fmtDate(info.installedAt)}
                />
              </div>

              {/* Status note */}
              {info.isRuntimeRunning && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <p className="text-xs text-emerald-400/90">
                    llama-server is running and ready to accept inference requests.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          {!loading && (
            <div className="space-y-2">
              {/* Reveal folder */}
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-xs h-8"
                onClick={handleReveal}
                disabled={revealing || repairing || removing}
              >
                {revealing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5" />
                )}
                Reveal in Finder / Explorer
              </Button>

              {/* Repair */}
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-xs h-8 text-amber-400 border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-300"
                onClick={handleRepair}
                disabled={revealing || repairing || removing}
              >
                {repairing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Repair / Reinstall
              </Button>

              {/* Remove */}
              {!confirmRemove ? (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 text-xs h-8 text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => setConfirmRemove(true)}
                  disabled={revealing || repairing || removing}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove Offline Mode
                </Button>
              ) : (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400/90 leading-relaxed">
                      This will delete the runtime binary, model files, downloads, and
                      all offline state. Your online chats and API key will not be affected.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() => setConfirmRemove(false)}
                      disabled={removing}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs bg-red-600 hover:bg-red-500 text-white border-0"
                      onClick={handleRemoveConfirmed}
                      disabled={removing}
                    >
                      {removing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Trash2 className="h-3 w-3 mr-1" />
                      )}
                      {removing ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
