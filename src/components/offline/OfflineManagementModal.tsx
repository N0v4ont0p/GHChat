import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu,
  FolderOpen,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  HardDrive,
  Plus,
  X,
  Check,
  Clock,
  Download,
  Activity,
  Layers,
  ArrowLeft,
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
import type {
  OfflineCatalogEntrySummary,
  OfflineInstallProgress,
  OfflineModelHealth,
  OfflineModelSummary,
} from "@/types";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${i >= 2 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function fmtDate(epochMs: number | null): string {
  if (epochMs == null) return "Never";
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtRelative(epochMs: number | null): string {
  if (epochMs == null) return "Never used";
  const diffMs = Date.now() - epochMs;
  if (diffMs < 60_000) return "Just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return fmtDate(epochMs);
}

function familyLabel(family: OfflineModelSummary["family"]): string {
  switch (family) {
    case "gemma-4":
      return "Gemma 4";
    case "gemma-3":
      return "Gemma 3";
    default:
      return "Unknown";
  }
}

// ── Health pill ───────────────────────────────────────────────────────────────

function HealthPill({ health, reason }: { health: OfflineModelHealth; reason?: string }) {
  const cfg: Record<OfflineModelHealth, { label: string; cls: string }> = {
    ok: {
      label: "Ready",
      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    missing: {
      label: "Missing",
      cls: "bg-red-500/10 text-red-400 border-red-500/20",
    },
    incomplete: {
      label: "Incomplete",
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    unknown: {
      label: "Unknown",
      cls: "bg-muted/40 text-muted-foreground border-border/40",
    },
  };
  const c = cfg[health];
  return (
    <span
      title={reason}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        c.cls,
      )}
    >
      {c.label}
    </span>
  );
}

// ── One installed-model row ───────────────────────────────────────────────────

interface InstalledRowProps {
  model: OfflineModelSummary;
  busy: boolean;
  onActivate: (id: string) => void;
  onReveal: (id: string) => void;
  onRemove: (id: string) => void;
}

function InstalledRow({ model, busy, onActivate, onReveal, onRemove }: InstalledRowProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border bg-secondary/20 px-3.5 py-3 space-y-2",
        model.isActive
          ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
          : "border-border/40",
      )}
    >
      {/* Heading row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground/95 truncate">
              {model.name}
            </span>
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {model.variantLabel}
            </span>
            {model.isActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Active
              </span>
            )}
            <HealthPill health={model.health} reason={model.healthReason} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <Layers className="h-2.5 w-2.5" />
              {familyLabel(model.family)}
            </span>
            <span className="inline-flex items-center gap-1">
              <HardDrive className="h-2.5 w-2.5" />
              {model.sizeOnDiskBytes > 0
                ? fmtBytes(model.sizeOnDiskBytes)
                : `~${model.declaredSizeGb.toFixed(1)} GB`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {fmtRelative(model.lastUsedAt)}
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-muted-foreground/50 break-all">
            {model.modelDir}
          </div>
          {model.healthReason && model.health !== "ok" && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-400/90">
              <AlertTriangle className="h-2.5 w-2.5 mt-px shrink-0" />
              <span>{model.healthReason}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions row */}
      {!confirmRemove ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={() => onActivate(model.id)}
            disabled={busy || model.isActive || model.health === "missing"}
            title={
              model.health === "missing"
                ? "Cannot activate a missing model — remove and reinstall it"
                : model.isActive
                  ? "Already active"
                  : "Use this model for offline chat"
            }
          >
            <Check className="h-3 w-3" />
            {model.isActive ? "Active" : "Set active"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={() => onReveal(model.id)}
            disabled={busy}
            title="Show this model file in your file manager"
          >
            <FolderOpen className="h-3 w-3" />
            Reveal
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300 ml-auto"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 space-y-2">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-400/90 leading-relaxed">
              Delete <span className="font-semibold">{model.name}</span>?
              {model.isActive && " The runtime will stop and another installed model will become active."}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-6 text-[11px]"
              onClick={() => setConfirmRemove(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 h-6 text-[11px] bg-red-600 hover:bg-red-500 text-white border-0"
              onClick={() => {
                onRemove(model.id);
                setConfirmRemove(false);
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One installable-catalog-entry row ─────────────────────────────────────────

interface CatalogRowProps {
  entry: OfflineCatalogEntrySummary;
  busy: boolean;
  onInstall: (id: string) => void;
}

function CatalogRow({ entry, busy, onInstall }: CatalogRowProps) {
  const cantInstall = entry.installed || busy;
  return (
    <div className="rounded-xl border border-border/40 bg-secondary/10 px-3.5 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground/95">{entry.name}</span>
          <span className="text-[10px] text-muted-foreground/70 font-mono">
            {entry.variantLabel}
          </span>
          {entry.isFallback && (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium">
              Fallback
            </span>
          )}
          {entry.installed && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium">
              Installed
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground/70">
          <span className="inline-flex items-center gap-1">
            <Download className="h-2.5 w-2.5" />~{entry.sizeGb.toFixed(1)} GB
          </span>
          <span className="inline-flex items-center gap-1">
            <Cpu className="h-2.5 w-2.5" />{entry.ramRequiredGb} GB RAM
          </span>
          <span className="inline-flex items-center gap-1">
            <HardDrive className="h-2.5 w-2.5" />{entry.diskRequiredGb} GB disk
          </span>
        </div>
        {!entry.fitsHardware && entry.fitReason && (
          <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-400/90">
            <AlertTriangle className="h-2.5 w-2.5 mt-px shrink-0" />
            <span>{entry.fitReason}</span>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[11px] gap-1.5 shrink-0"
        onClick={() => onInstall(entry.id)}
        disabled={cantInstall}
      >
        <Download className="h-3 w-3" />
        {entry.installed ? "Installed" : "Install"}
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type View = "list" | "add";

export function OfflineManagementModal() {
  const offlineManagementOpen = useModeStore((s) => s.offlineManagementOpen);
  const setOfflineManagementOpen = useModeStore((s) => s.setOfflineManagementOpen);
  const setOfflineState = useModeStore((s) => s.setOfflineState);
  const setMode = useModeStore((s) => s.setMode);
  const setOfflineRecommendation = useModeStore((s) => s.setOfflineRecommendation);
  const setActiveOfflineModelId = useModeStore((s) => s.setActiveOfflineModelId);

  const [view, setView] = useState<View>("list");
  const [installed, setInstalled] = useState<OfflineModelSummary[] | null>(null);
  const [available, setAvailable] = useState<OfflineCatalogEntrySummary[] | null>(null);
  const [storageBytes, setStorageBytes] = useState<number>(0);
  const [installPath, setInstallPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<OfflineInstallProgress | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, catalog, info, activeId] = await Promise.all([
        ipc.listInstalledOfflineModels(),
        ipc.listAvailableOfflineModels(),
        ipc.getOfflineInfo(),
        ipc.getActiveOfflineModel(),
      ]);
      setInstalled(list);
      setAvailable(catalog);
      setStorageBytes(info.storageBytesUsed);
      setInstallPath(info.installPath);
      setActiveOfflineModelId(activeId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [setActiveOfflineModelId]);

  useEffect(() => {
    if (!offlineManagementOpen) {
      setView("list");
      setInstallProgress(null);
      setBusyId(null);
      return;
    }
    void reload();
  }, [offlineManagementOpen, reload]);

  // ── Install progress subscription ─────────────────────────────────────────
  useEffect(() => {
    if (!offlineManagementOpen) return;
    const off = ipc.onInstallProgress((p) => setInstallProgress(p));
    return () => off();
  }, [offlineManagementOpen]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleActivate = async (id: string) => {
    setBusyId(id);
    try {
      const newId = await ipc.setActiveOfflineModel(id);
      setActiveOfflineModelId(newId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReveal = async (id: string) => {
    try {
      await ipc.revealOfflineModelFolder(id);
    } catch {
      // Best effort.
    }
  };

  const handleRevealRoot = async () => {
    try {
      await ipc.revealOfflineFolder();
    } catch {
      // Best effort.
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await ipc.removeOfflineModel(id);
      if (!res.ok) {
        setError(res.error ?? "Remove failed");
      } else {
        await reload();
        // If the user removed the last model, drop offline mode entirely.
        const remaining = await ipc.listInstalledOfflineModels();
        if (remaining.length === 0) {
          setOfflineState("not-installed");
          setOfflineRecommendation(null);
          setMode("online");
          setOfflineManagementOpen(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleInstallAdditional = async (id: string) => {
    setBusyId(id);
    setInstallProgress({ phase: "preflight", step: "Starting…", pct: 0 });
    try {
      const res = await ipc.installAdditionalOfflineModel(id);
      if (!res.ok) {
        setError(res.error ?? "Install failed");
      } else {
        await reload();
        setView("list");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
      setInstallProgress(null);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const installedCount = installed?.length ?? 0;
  const installableCount = useMemo(
    () => (available ?? []).filter((c) => !c.installed).length,
    [available],
  );
  const isInstalling = busyId !== null && installProgress !== null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={offlineManagementOpen} onOpenChange={setOfflineManagementOpen}>
      <DialogContent className="max-w-xl gap-0 p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {view === "add" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setView("list")}
                  disabled={isInstalling}
                  aria-label="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              )}
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                <Cpu className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <DialogTitle className="text-sm font-semibold">
                {view === "list" ? "Offline Models" : "Install Offline Model"}
              </DialogTitle>
            </div>
            {view === "list" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5"
                onClick={() => setView("add")}
                disabled={loading || installableCount === 0}
              >
                <Plus className="h-3 w-3" />
                Add model
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Loading state */}
          {loading && !installed && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-red-400/90 break-words">{error}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 -mt-0.5"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Install-in-progress banner */}
          {isInstalling && installProgress && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">
                  Installing… {installProgress.pct}%
                </span>
              </div>
              <p className="text-[11px] text-emerald-400/80">{installProgress.step}</p>
              <div className="h-1.5 rounded-full bg-emerald-500/10 overflow-hidden">
                <div
                  className="h-full bg-emerald-500/60 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, installProgress.pct))}%` }}
                />
              </div>
            </div>
          )}

          {/* ── List view ────────────────────────────────────────────────── */}
          {view === "list" && installed && (
            <>
              {/* Storage summary */}
              <div className="flex items-center justify-between rounded-xl border border-border/40 bg-secondary/20 px-3.5 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground/80">
                      <span className="font-medium text-foreground/90">
                        {installedCount} installed
                      </span>
                      {" · "}
                      {fmtBytes(storageBytes)} on disk
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground/50 truncate">
                      {installPath}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5 shrink-0"
                  onClick={handleRevealRoot}
                >
                  <FolderOpen className="h-3 w-3" />
                  Open folder
                </Button>
              </div>

              {/* Model list */}
              {installedCount === 0 ? (
                <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center space-y-3">
                  <div className="text-xs text-muted-foreground/70">
                    No offline models installed.
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => setView("add")}
                    disabled={installableCount === 0}
                  >
                    <Plus className="h-3 w-3" />
                    Install your first model
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {installed.map((m) => (
                    <InstalledRow
                      key={m.id}
                      model={m}
                      busy={busyId !== null}
                      onActivate={handleActivate}
                      onReveal={handleReveal}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Add view ─────────────────────────────────────────────────── */}
          {view === "add" && available && (
            <>
              <p className="text-[11px] text-muted-foreground/80">
                Install an additional offline model. Models stay on disk under your
                offline folder and can be activated, removed, or revealed at any time.
              </p>
              {available.length === 0 ? (
                <div className="text-xs text-muted-foreground/70 py-4 text-center">
                  No catalog entries available.
                </div>
              ) : (
                <div className="space-y-2">
                  {available.map((entry) => (
                    <CatalogRow
                      key={entry.id}
                      entry={entry}
                      busy={busyId !== null}
                      onInstall={handleInstallAdditional}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
