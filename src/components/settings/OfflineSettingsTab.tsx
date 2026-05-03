import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2,
  FolderOpen,
  FileText,
  Settings2,
  Zap,
  Scale,
  Sparkles,
  RotateCcw,
  AlertTriangle,
  HardDrive,
  Cpu,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Square,
  ZapOff,
  Layers,
  Plus,
  Trash2,
  Eraser,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/lib/ipc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TechnicalDetails } from "@/components/ui/technical-details";
import { useModeStore } from "@/stores/mode-store";
import { useSettingsStore } from "@/stores/settings-store";
import type {
  OfflineSettings,
  OfflineHardwareProfileSnapshot,
  OfflineModelSummary,
  OfflineInfo,
  OfflinePerformancePreset,
  OfflineRuntimeStartupPhase,
  OfflineRuntimePhaseEvent,
  OfflineRuntimeFailureDetails,
  OfflineRuntimeState,
  OfflineRuntimeStateKind,
} from "@/types";

/** Display "12.3 GB" or "456 MB" for byte counts. */
function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u <= 1 ? 0 : 1)} ${units[u]}`;
}

/**
 * Heuristic threshold used by hardware-fit warnings: when an active
 * model's on-disk size exceeds this fraction of the host's total RAM,
 * we surface an amber diagnostic warning the user that streaming may
 * be slow and recommending a smaller variant.
 */
const HEAVY_MODEL_RAM_RATIO = 0.6;

/** How often to re-poll the runtime running/stopped status while the tab is open. */
const RUNTIME_STATUS_POLL_INTERVAL_MS = 2000;

const PRESET_META: Record<
  OfflinePerformancePreset,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  speed: {
    label: "Speed",
    description: "Smaller context, capped output, more threads. Best for quick replies on lower-end machines.",
    icon: Zap,
  },
  balanced: {
    label: "Balanced",
    description: "Good defaults for most laptops. 4K context, 1024 token cap.",
    icon: Scale,
  },
  quality: {
    label: "Quality",
    description: "8K context, longer outputs, lower temperature. Slower on memory-constrained machines.",
    icon: Sparkles,
  },
  custom: {
    label: "Custom",
    description: "Manually tuned — your own values are in effect.",
    icon: Cpu,
  },
};

/**
 * Offline-specific settings pane.  Renders runtime tuning knobs that
 * only apply to local inference; online/OpenRouter settings stay in
 * their own tabs so the two backends can evolve independently.
 */
export function OfflineSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<OfflineSettings | null>(null);
  const [hwProfile, setHwProfile] = useState<OfflineHardwareProfileSnapshot | null>(null);
  const [installedModels, setInstalledModels] = useState<OfflineModelSummary[]>([]);
  const [info, setInfo] = useState<OfflineInfo | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [removingOffline, setRemovingOffline] = useState(false);
  /**
   * Latest runtime startup progress event broadcast by the main
   * process.  Drives the inline step-by-step status under the
   * Runtime row so a slow `llama-server` boot is never hidden behind
   * a single spinner.  Reset to null on a fresh Restart click.
   */
  const [runtimePhase, setRuntimePhase] = useState<OfflineRuntimePhaseEvent | null>(
    null,
  );
  /**
   * Snapshot of the offline runtime state machine (single source of
   * truth: `unconfigured | model-missing | validating | launching |
   * waiting-for-ready | warming-up | ready | stopping | stopped |
   * failed`).  Drives the Running/Stopped pill, the busy gating on
   * Restart/Stop/Force-stop buttons, and the failure banner — all
   * three previously cobbled together `info?.isRuntimeRunning` and
   * the last phase event, which made transient/failed states display
   * inconsistently.
   *
   * Initialised to `stopped` so first-paint never sees `undefined`
   * (no silent fallback to idle), then immediately overwritten by
   * the first `OFFLINE_RUNTIME_STATE` push or `getOfflineInfo()`
   * read.
   */
  const [runtimeState, setRuntimeState] = useState<OfflineRuntimeState>(() => ({
    kind: "stopped",
    enteredAt: Date.now(),
  }));
  /**
   * Last non-terminal phase observed (i.e. not `ready`/`failed`).  Used
   * to attribute a `failed` event to the step that was actually in
   * progress when llama.cpp blew up — without it, the trail would only
   * know "something failed" but not which step.
   */
  const [lastInProgressPhase, setLastInProgressPhase] = useState<
    OfflineRuntimeStartupPhase | null
  >(null);

  const setOfflineManagementOpen = useModeStore((s) => s.setOfflineManagementOpen);
  const setOfflineState = useModeStore((s) => s.setOfflineState);
  const setOfflineRecommendation = useModeStore((s) => s.setOfflineRecommendation);
  const setMode = useModeStore((s) => s.setMode);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);

  // Effective busy: either we have an in-flight local IPC call, or the
  // runtime state machine reports a transition in progress (which can
  // happen when another window — e.g. a chat-driven start — drives the
  // runtime).  Both sources gate the same Restart/Stop buttons so the
  // user can't issue conflicting operations.
  const runtimeStateBusy = RUNTIME_BUSY_KINDS.has(runtimeState.kind);
  const runtimeBusyEffective = runtimeBusy || runtimeStateBusy;

  const refreshInfo = useCallback(async () => {
    try {
      const next = await ipc.getOfflineInfo();
      setInfo(next);
    } catch {
      /* ignore — info is best-effort and may transiently fail */
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const next = await ipc.listInstalledOfflineModels();
      setInstalledModels(next);
    } catch {
      /* ignore */
    }
  }, []);

  // Load everything in parallel on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      ipc.getOfflineSettings(),
      ipc.getOfflineHardwareProfile(),
      ipc.listInstalledOfflineModels().catch(() => []),
      ipc.getOfflineInfo().catch(() => null),
    ])
      .then(([s, hw, models, i]) => {
        if (cancelled) return;
        setSettings(s);
        setHwProfile(hw);
        setInstalledModels(models);
        setInfo(i);
        if (i?.runtimeState) {
          setRuntimeState(i.runtimeState);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll runtime status every 2s so the Running/Stopped pill stays accurate
  // without any manual refresh after Stop / Restart.
  useEffect(() => {
    const id = setInterval(refreshInfo, RUNTIME_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshInfo]);

  // Subscribe to runtime startup phase broadcasts so the Restart action
  // shows step-by-step progress (checking model → launching process →
  // warming up → ready / failed) instead of just a generic spinner.
  // The same broadcast fires for chat-driven starts; we accept those too
  // so opening Settings during a slow first message also reflects what
  // the runtime is doing.
  useEffect(() => {
    const off = ipc.onOfflineRuntimePhase((event) => {
      setRuntimePhase(event);
      if (event.phase !== "ready" && event.phase !== "failed") {
        setLastInProgressPhase(event.phase);
      }
      // A terminal `ready` phase implies the runtime is now serving;
      // refresh the Running/Stopped pill immediately so the user
      // doesn't have to wait for the next 2 s poll tick.
      if (event.phase === "ready" || event.phase === "failed") {
        refreshInfo();
      }
    });
    return () => off();
  }, [refreshInfo]);

  // Subscribe to the runtime state machine.  Single source of truth
  // for the Running/Stopped pill, the busy gating, and the failure
  // banner — replaces the old habit of stitching `info.isRuntimeRunning`
  // together with the last `OFFLINE_RUNTIME_PHASE` event.
  useEffect(() => {
    const off = ipc.onOfflineRuntimeState((state) => {
      setRuntimeState(state);
    });
    return () => off();
  }, []);

  /**
   * Trigger a runtime restart from any caller (Restart button, Retry
   * button on the failure banner).  Centralised so the two surfaces
   * stay in lockstep — same guard logic, same progress reset, same
   * toast handling.
   */
  const triggerRestart = useCallback(async () => {
    if (installedModels.length === 0 || !activeModel) {
      console.warn(
        `[OfflineSettingsTab] Restart runtime aborted: ` +
          `installedCount=${installedModels.length}, ` +
          `activeModelId=${activeModel?.id ?? "<none>"}`,
      );
      toast.error(
        installedModels.length === 0
          ? "No offline models installed. Install one to start the runtime."
          : "No active offline model selected. Pick one in Offline Models.",
      );
      setOfflineManagementOpen(true);
      return;
    }
    setRuntimeBusy(true);
    setRuntimePhase(null);
    setLastInProgressPhase(null);
    try {
      console.log(
        `[OfflineSettingsTab] Restart runtime clicked ` +
          `(activeModelId=${activeModel.id}, ` +
          `installedCount=${installedModels.length}, ` +
          `currentlyRunning=${info?.isRuntimeRunning ?? "unknown"})`,
      );
      const res = await ipc.restartOfflineRuntime();
      if (res.ok) {
        toast.success("Runtime restarted");
      } else {
        toast.error(res.error ?? "Restart failed");
      }
      await refreshInfo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OfflineSettingsTab] restartOfflineRuntime threw:", err);
      toast.error(`Restart failed: ${msg}`);
    } finally {
      setRuntimeBusy(false);
    }
  }, [
    activeModel,
    installedModels.length,
    info?.isRuntimeRunning,
    refreshInfo,
    setOfflineManagementOpen,
  ]);

  const update = useCallback(async (partial: Partial<OfflineSettings>) => {
    try {
      const next = await ipc.updateOfflineSettings(partial);
      setSettings(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save offline setting");
    }
  }, []);

  const handlePreset = useCallback(
    async (preset: OfflinePerformancePreset) => {
      setSavingPreset(true);
      try {
        await update({ performancePreset: preset });
        toast.success(`Performance preset set to ${PRESET_META[preset].label}`);
      } finally {
        setSavingPreset(false);
      }
    },
    [update],
  );

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      const next = await ipc.resetOfflineSettings();
      setSettings(next);
      toast.success("Offline settings reset to defaults");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  }, []);

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeModel = installedModels.find((m) => m.isActive);
  const heaviestThatFits = hwProfile
    ? installedModels.find((m) => m.isActive && m.sizeOnDiskBytes / 1024 ** 3 > hwProfile.totalRamGb * HEAVY_MODEL_RAM_RATIO)
    : null;

  return (
    <div className="space-y-5">
      {/* Hardware tier banner */}
      {hwProfile && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs">
            <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">Detected hardware</span>
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              hwProfile.tier === "ultra" && "bg-purple-500/20 text-purple-300",
              hwProfile.tier === "high" && "bg-emerald-500/20 text-emerald-300",
              hwProfile.tier === "mid" && "bg-amber-500/20 text-amber-300",
              hwProfile.tier === "low" && "bg-red-500/20 text-red-300",
            )}>
              {hwProfile.tier} tier
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
            {hwProfile.totalRamGb.toFixed(0)} GB RAM · {hwProfile.cpuCores} CPU cores
            {hwProfile.isAppleSilicon && " · Apple Silicon (Metal)"}
            {" · "}
            {hwProfile.freeDiskGb.toFixed(0)} GB free disk
          </p>
          {heaviestThatFits && (
            <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>
                The active model <strong>{heaviestThatFits.name}</strong> ({fmtBytes(heaviestThatFits.sizeOnDiskBytes)}) is
                large for this machine and may stream slowly. Try a smaller variant for faster responses.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Active model */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-foreground">Active offline model</label>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setSettingsOpen(false);
                setOfflineManagementOpen(true);
              }}
            >
              <Layers className="mr-1 h-3 w-3" /> Manage models
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setSettingsOpen(false);
                setOfflineManagementOpen(true);
              }}
            >
              <Plus className="mr-1 h-3 w-3" /> Install model
            </Button>
          </div>
        </div>
        {installedModels.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No offline models installed yet. Use "Install model" above to add one.
          </p>
        ) : (
          <Select
            value={activeModel?.id ?? ""}
            onValueChange={async (id) => {
              try {
                await ipc.setActiveOfflineModel(id);
                await refreshModels();
                toast.success("Active model updated");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to switch active model");
              }
            }}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select an active model" />
            </SelectTrigger>
            <SelectContent>
              {installedModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name} ({fmtBytes(m.sizeOnDiskBytes)})
                  {m.health !== "ok" && " — needs repair"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Runtime status — driven by the runtime state machine. */}
      <div className="space-y-2 rounded-md border border-border/50 bg-muted/10 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                runtimeState.kind === "ready"
                  ? "bg-emerald-400 animate-pulse"
                  : runtimeState.kind === "failed"
                    ? "bg-red-500"
                    : RUNTIME_BUSY_KINDS.has(runtimeState.kind)
                      ? "bg-amber-400 animate-pulse"
                      : "bg-muted-foreground/40",
              )}
            />
            <span>Runtime</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                runtimeState.kind === "ready"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : runtimeState.kind === "failed"
                    ? "bg-red-500/20 text-red-300"
                    : RUNTIME_BUSY_KINDS.has(runtimeState.kind)
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-muted text-muted-foreground",
              )}
            >
              {RUNTIME_STATE_LABEL[runtimeState.kind]}
            </span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {RUNTIME_STATE_DESCRIPTION[runtimeState.kind]}
        </p>
        {runtimeState.kind === "failed" && (
          <RuntimeFailureBanner
            failure={runtimeState.failure ?? runtimePhase?.failure ?? null}
            detail={
              runtimeState.progressLabel ?? runtimePhase?.detail ?? null
            }
            onRetry={triggerRestart}
            onManageModel={() => {
              setOfflineManagementOpen(true);
            }}
            disabled={runtimeBusyEffective}
          />
        )}
        {(runtimeBusyEffective ||
          (runtimePhase &&
            runtimePhase.phase !== "ready" &&
            runtimeState.kind !== "ready" &&
            runtimeState.kind !== "stopped")) && (
          <RuntimePhaseTrail
            phase={runtimePhase}
            busy={runtimeBusyEffective}
            lastInProgressPhase={lastInProgressPhase}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={runtimeBusyEffective || installedModels.length === 0 || !activeModel}
            title={
              installedModels.length === 0
                ? "Install an offline model first to start the runtime"
                : !activeModel
                  ? "No active offline model — pick one in Offline Models"
                  : undefined
            }
            onClick={async () => {
              await triggerRestart();
            }}
          >
            {runtimeBusyEffective ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            Restart runtime
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={runtimeBusyEffective || runtimeState.kind !== "ready"}
            onClick={async () => {
              setRuntimeBusy(true);
              try {
                await ipc.stopOfflineRuntime();
                toast.success("Runtime stopped");
                await refreshInfo();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Stop failed");
              } finally {
                setRuntimeBusy(false);
              }
            }}
          >
            <Square className="mr-1 h-3.5 w-3.5" />
            Stop
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              runtimeBusyEffective ||
              (runtimeState.kind !== "ready" && !info?.isRuntimeRunning)
            }
            className="border-red-500/30 text-red-400/80 hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/10"
            onClick={async () => {
              setRuntimeBusy(true);
              try {
                await ipc.forceStopOfflineRuntime();
                toast.success("Runtime force-stopped");
                await refreshInfo();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Force-stop failed");
              } finally {
                setRuntimeBusy(false);
              }
            }}
          >
            <ZapOff className="mr-1 h-3.5 w-3.5" />
            Force stop
          </Button>
        </div>
      </div>

      {/* Default model */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground">
          Default model on launch
        </label>
        <Select
          value={settings.defaultModelId ?? "__none__"}
          onValueChange={(v) => update({ defaultModelId: v === "__none__" ? null : v })}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Use the recommendation engine" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Use the recommendation engine</SelectItem>
            {installedModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Picks which installed model becomes active the first time you switch to offline mode.
        </p>
      </div>

      {/* Performance preset */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground">Performance preset</label>
        <div className="grid grid-cols-3 gap-2">
          {(["speed", "balanced", "quality"] as const).map((p) => {
            const meta = PRESET_META[p];
            const Icon = meta.icon;
            const active = settings.performancePreset === p;
            return (
              <button
                key={p}
                disabled={savingPreset}
                onClick={() => handlePreset(p)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/50 bg-muted/10 hover:bg-muted/30",
                  savingPreset && "opacity-50",
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </div>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  {meta.description}
                </p>
              </button>
            );
          })}
        </div>
        {settings.performancePreset === "custom" && (
          <p className="flex items-center gap-1 text-[10px] text-amber-300">
            <Cpu className="h-3 w-3" /> Custom values are in effect — pick a preset above to revert to its defaults.
          </p>
        )}
      </div>

      {/* Streaming toggle */}
      <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/10 px-3 py-2">
        <div>
          <p className="text-xs font-medium">Stream tokens as they're generated</p>
          <p className="text-[10px] text-muted-foreground">
            Disable to wait for the full response before showing it.
          </p>
        </div>
        <button
          onClick={() => update({ streamingEnabled: !settings.streamingEnabled })}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            settings.streamingEnabled ? "bg-primary" : "bg-muted",
          )}
          aria-pressed={settings.streamingEnabled}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
              settings.streamingEnabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? "▾" : "▸"} Advanced runtime knobs
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-md border border-border/50 bg-muted/10 p-3">
          {/* Context size */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium">Context window (tokens)</label>
              <span className="text-[10px] text-muted-foreground">
                {settings.contextSize ?? "preset default"}
              </span>
            </div>
            <Input
              type="number"
              min={512}
              max={32768}
              step={512}
              value={settings.contextSize ?? ""}
              placeholder="preset default"
              onChange={(e) =>
                update({ contextSize: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Larger values support longer conversations but use more RAM. Changes take effect on the next message.
            </p>
          </div>

          {/* Max tokens */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium">Max tokens per reply</label>
              <span className="text-[10px] text-muted-foreground">
                {settings.maxTokens === -1
                  ? "unlimited"
                  : settings.maxTokens ?? "preset default"}
              </span>
            </div>
            <Input
              type="number"
              min={-1}
              max={8192}
              step={64}
              value={settings.maxTokens ?? ""}
              placeholder="preset default"
              onChange={(e) =>
                update({ maxTokens: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Caps generation length so a runaway model can't stream forever. Use -1 for unlimited.
            </p>
          </div>

          {/* Temperature */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium">Temperature</label>
              <span className="text-[10px] text-muted-foreground">
                {settings.temperature ?? "preset default"}
              </span>
            </div>
            <Input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature ?? ""}
              placeholder="preset default"
              onChange={(e) =>
                update({ temperature: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 text-xs"
            />
          </div>

          {/* Top-p */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium">Top-p</label>
              <span className="text-[10px] text-muted-foreground">
                {settings.topP ?? "preset default"}
              </span>
            </div>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={settings.topP ?? ""}
              placeholder="preset default"
              onChange={(e) =>
                update({ topP: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 text-xs"
            />
          </div>

          {/* Threads */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium">Worker threads</label>
              <span className="text-[10px] text-muted-foreground">
                {settings.threads ?? "auto"}
              </span>
            </div>
            <Input
              type="number"
              min={1}
              max={hwProfile?.cpuCores ?? 32}
              step={1}
              value={settings.threads ?? ""}
              placeholder="auto"
              onChange={(e) =>
                update({ threads: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 text-xs"
            />
          </div>

          {/* Cancel timeout */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium">Stop / cancel timeout (ms)</label>
              <span className="text-[10px] text-muted-foreground">
                {settings.cancelTimeoutMs ?? "default (1500 ms)"}
              </span>
            </div>
            <Input
              type="number"
              min={0}
              max={10000}
              step={250}
              value={settings.cancelTimeoutMs ?? ""}
              placeholder="default (1500 ms)"
              onChange={(e) =>
                update({ cancelTimeoutMs: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              How long to wait after Stop before force-restarting the runtime. 0 disables the watchdog.
            </p>
          </div>
        </div>
      )}

      {/* Storage */}
      <div className="space-y-2 rounded-md border border-border/50 bg-muted/10 p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
          Model storage
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded border border-border/40 bg-muted/20 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Used</p>
            <p className="font-medium">{info ? fmtBytes(info.storageBytesUsed) : "—"}</p>
          </div>
          <div className="rounded border border-border/40 bg-muted/20 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Free disk</p>
            <p className="font-medium">
              {hwProfile ? `${hwProfile.freeDiskGb.toFixed(0)} GB` : "—"}
            </p>
          </div>
        </div>
        {info?.installPath ? (
          <p className="break-all text-[10px] text-muted-foreground font-mono">
            {info.installPath}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">No storage location yet.</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={!info?.installPath}
            onClick={async () => {
              try {
                await ipc.revealOfflineFolder();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to open folder");
              }
            }}
          >
            <FolderOpen className="mr-1 h-3.5 w-3.5" /> Open folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={clearingCache}
            onClick={async () => {
              setClearingCache(true);
              try {
                const res = await ipc.clearOfflineCache();
                if (res.ok) {
                  toast.success(
                    res.freedBytes > 0
                      ? `Freed ${fmtBytes(res.freedBytes)} of cache`
                      : "Cache was already empty",
                  );
                  await refreshInfo();
                } else {
                  toast.error(res.error ?? "Failed to clear cache");
                }
              } finally {
                setClearingCache(false);
              }
            }}
          >
            {clearingCache ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eraser className="mr-1 h-3.5 w-3.5" />
            )}
            Clear temp / download cache
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Wipes failed downloads and runtime extract scratch space. Installed models stay put.
        </p>
      </div>

      {/* Installed models summary */}
      {installedModels.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Installed models ({installedModels.length})</p>
          <div className="space-y-1">
            {installedModels.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded border border-border/40 bg-muted/10 px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  {m.health === "ok" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <XCircle className="h-3 w-3 text-red-400" />
                  )}
                  <span>{m.name}</span>
                  {m.isActive && (
                    <span className="rounded bg-primary/20 px-1 text-[9px] uppercase text-primary">
                      Active
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground">{fmtBytes(m.sizeOnDiskBytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger zone — remove offline mode */}
      <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
        <p className="text-xs font-medium text-red-400/80">Danger zone</p>
        <p className="text-[10px] text-muted-foreground">
          Removes the runtime, every installed model, all caches, and every offline DB record.
          Online conversations and your API key are not affected.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={removingOffline}
          className="border-red-500/30 text-red-400/80 hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/10"
          onClick={async () => {
            const ok = window.confirm(
              "Remove offline mode entirely? This deletes the runtime and every installed model. " +
                "You'll need to re-install if you want to use offline mode again.",
            );
            if (!ok) return;
            setRemovingOffline(true);
            try {
              const next = await ipc.removeOfflineMode();
              setOfflineState(next.state);
              setOfflineRecommendation(null);
              setMode("online");
              setSettingsOpen(false);
              toast.success("Offline mode removed");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to remove offline mode");
            } finally {
              setRemovingOffline(false);
            }
          }}
        >
          {removingOffline ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="mr-1 h-3.5 w-3.5" />
          )}
          Remove offline mode
        </Button>
      </div>

      {/* Reset */}
      <div className="flex justify-end pt-2">
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={resetting}>
          {resetting ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
          )}
          Reset offline settings to defaults
        </Button>
      </div>
    </div>
  );
}

// ── Runtime state-machine display ─────────────────────────────────────────────

/**
 * UI-facing copy for each `OfflineRuntimeStateKind`.  Drives the
 * Running/Stopped pill, the dot colour, and the description line
 * under the Runtime row so the entire surface stays in lockstep.
 *
 * `ready` is the only "alive and serving" kind; everything else
 * (`validating` … `warming-up`) is in-flight, `stopping` is mid-shutdown,
 * `stopped` is idle, `failed` is broken.
 */
const RUNTIME_STATE_LABEL: Record<OfflineRuntimeStateKind, string> = {
  unconfigured: "Not installed",
  "model-missing": "No model",
  validating: "Validating…",
  launching: "Launching…",
  "waiting-for-ready": "Waiting for server…",
  "warming-up": "Loading model…",
  ready: "Running",
  stopping: "Stopping…",
  stopped: "Stopped",
  failed: "Failed",
};

/** Description shown under the Runtime label for each state. */
const RUNTIME_STATE_DESCRIPTION: Record<OfflineRuntimeStateKind, string> = {
  unconfigured: "Offline mode is not installed yet.",
  "model-missing":
    "No offline models installed. Install one to start the runtime.",
  validating: "Checking installed model and runtime binary…",
  launching: "Spawning the local runtime process…",
  "waiting-for-ready": "Waiting for the local server to come up…",
  "warming-up": "Loading the model into memory…",
  ready: "The local runtime is loaded and ready to stream.",
  stopping: "Shutting down the local runtime…",
  stopped:
    "The runtime starts automatically the next time you send an offline message.",
  failed:
    "The local runtime failed to start. See details below to recover.",
};

/** Kinds that block Restart/Stop/Force-stop while a transition is in flight. */
const RUNTIME_BUSY_KINDS = new Set<OfflineRuntimeStateKind>([
  "validating",
  "launching",
  "waiting-for-ready",
  "warming-up",
  "stopping",
]);

// ── Runtime startup phase trail ───────────────────────────────────────────────

/**
 * Ordered list of fine-grained startup phases shown in the inline
 * trail under the Runtime row.  Mirrors the steps emitted by
 * `runtimeManager.start()` in the main process.  Kept ordered so we
 * can render previous steps as ✓ and the current step as a spinner.
 */
const RUNTIME_PHASE_ORDER: OfflineRuntimeStartupPhase[] = [
  "checking-model",
  "checking-binary",
  "preparing-config",
  "launching-process",
  "waiting-for-server",
  "warming-up",
  "ready",
];

const RUNTIME_PHASE_LABELS: Record<OfflineRuntimeStartupPhase, string> = {
  "checking-model": "Checking installed model",
  "checking-binary": "Checking runtime binary",
  "preparing-config": "Preparing runtime config",
  "launching-process": "Launching runtime process",
  "waiting-for-server": "Waiting for server readiness",
  "warming-up": "Warming up model",
  ready: "Ready",
  failed: "Failed",
};

/**
 * Step-by-step status trail for the offline runtime startup sequence.
 * Renders each phase from `RUNTIME_PHASE_ORDER` with an icon: completed
 * steps as a check, the current step with a spinner, future steps
 * dimmed.  When the latest broadcast carries `failed`, the failing step
 * is rendered in red along with the underlying error detail so the
 * user can see *which* step broke instead of a generic "startup
 * failed" message.
 */
function RuntimePhaseTrail({
  phase,
  busy,
  lastInProgressPhase,
}: {
  phase: OfflineRuntimePhaseEvent | null;
  busy: boolean;
  lastInProgressPhase: OfflineRuntimeStartupPhase | null;
}) {
  const current = phase?.phase ?? null;
  const failed = current === "failed";
  // Live "elapsed Xs" badge on the active phase row.  Tick a 1Hz timer
  // while a non-terminal phase is active so the user has visible
  // feedback that startup is still progressing — a slow load no longer
  // looks identical to a frozen one.  The timer is anchored on the
  // backend-supplied `phaseStartedAt` (preferred — survives renderer
  // remounts) and falls back to the moment we received the event.
  const phaseStartedAt = phase?.phaseStartedAt ?? null;
  const localFallbackRef = useRef<number | null>(null);
  if (phase && !phaseStartedAt && localFallbackRef.current === null) {
    localFallbackRef.current = Date.now();
  }
  if (!phase) localFallbackRef.current = null;
  const anchor = phaseStartedAt ?? localFallbackRef.current;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (failed || !current || current === "ready" || !anchor) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [failed, current, anchor]);
  const elapsedMs = anchor ? Math.max(0, now - anchor) : 0;

  // Index of the most-recent non-terminal phase we've seen.  When the
  // event is `failed` we treat the previously-in-progress phase as the
  // failing step so the trail attributes the error to a specific row.
  const activeIndex = (() => {
    if (current === "ready") return RUNTIME_PHASE_ORDER.indexOf("ready");
    if (failed) {
      // Prefer the last non-terminal phase we observed; fall back to
      // the very first step so the trail isn't blank when no progress
      // arrived before the failure (e.g. argument validation).
      const idx = lastInProgressPhase
        ? RUNTIME_PHASE_ORDER.indexOf(lastInProgressPhase)
        : 0;
      return idx >= 0 ? idx : 0;
    }
    if (current) return RUNTIME_PHASE_ORDER.indexOf(current);
    return -1;
  })();

  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2.5 text-[11px]">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium text-foreground">
          {failed
            ? "Runtime startup failed"
            : current === "ready"
              ? "Runtime ready"
              : busy
                ? "Starting offline runtime…"
                : "Runtime startup status"}
        </span>
        {phase?.modelId && (
          <span className="text-muted-foreground">{phase.modelId}</span>
        )}
      </div>
      <ol className="space-y-0.5">
        {RUNTIME_PHASE_ORDER.map((step, i) => {
          const isCurrent = !failed && i === activeIndex && current !== "ready";
          const isDone =
            (current === "ready" && step !== "ready") || i < activeIndex;
          const isFailedHere = failed && i === activeIndex;
          const stepStateClass = isFailedHere
            ? "text-red-400"
            : isCurrent
              ? "text-foreground"
              : isDone
                ? "text-emerald-300"
                : "text-muted-foreground/60";
          return (
            <li
              key={step}
              className={cn("flex items-center gap-2", stepStateClass)}
            >
              <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
                {isCurrent ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isDone ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : isFailedHere ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-current" />
                )}
              </span>
              <span className="flex-1">{RUNTIME_PHASE_LABELS[step]}</span>
              {isCurrent && elapsedMs >= 1000 && (
                <span className="ml-auto font-mono tabular-nums text-[10px] text-muted-foreground">
                  {formatElapsed(elapsedMs)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {/*
        Failure detail is rendered by the dedicated RuntimeFailureBanner
        above this trail (with structured technical details + Retry /
        Open Logs / Manage Model actions).  Keeping the trail itself
        free of the error string avoids duplicating the message in two
        adjacent UI surfaces.
      */}
    </div>
  );
}

// ── Runtime failure banner ────────────────────────────────────────────────────

/**
 * Actionable failure UI shown when `runtimeManager.start()` reports a
 * `failed` phase.  Surfaces:
 *   – the user-facing message
 *   – Retry, Open Logs, and Manage Model action buttons
 *   – a "Show technical details" disclosure (model id / paths /
 *     existence flags / exit code / signal / stderr / stdout tails)
 *
 * Renders even when `failure` is null (legacy main-process build) so a
 * downgrade never leaves the user with a half-broken banner.
 */
function RuntimeFailureBanner({
  failure,
  detail,
  onRetry,
  onManageModel,
  disabled,
}: {
  failure: OfflineRuntimeFailureDetails | null;
  detail: string | null;
  onRetry: () => void | Promise<void>;
  onManageModel: () => void;
  disabled: boolean;
}) {
  const [forceStopping, setForceStopping] = useState(false);
  // Pick a headline that matches the actual failure mode so the user
  // immediately understands "timed out" vs "process crashed" vs
  // "missing file" instead of staring at a generic "failed to start".
  const headline = (() => {
    if (!failure) return "Offline runtime failed to start";
    switch (failure.kind) {
      case "timeout":
        return "Runtime did not become ready in time";
      case "exited":
        return "Runtime process stopped before becoming ready";
      case "missing-file":
        return "Required offline file is missing";
      case "spawn-error":
        return "Failed to launch the runtime process";
      case "config-error":
        return "Offline runtime is misconfigured";
      default:
        return "Offline runtime failed to start";
    }
  })();
  const message = failure?.message ?? detail ?? "Runtime startup failed.";
  const lastStepLabel = failure?.lastInProgressPhase
    ? RUNTIME_PHASE_LABELS[failure.lastInProgressPhase]
    : null;
  const elapsedLabel =
    failure?.phaseElapsedMs && failure.phaseElapsedMs > 0
      ? formatElapsed(failure.phaseElapsedMs)
      : null;
  const technical = failure ? renderTechnicalDetails(failure) : null;

  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[12px]">
      <div className="flex items-start gap-2">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="flex-1 space-y-2">
          <p className="font-medium text-red-200">{headline}</p>
          <p className="text-red-300/90">{message}</p>
          {lastStepLabel && (
            <p className="text-red-300/70">
              Last step:{" "}
              <span className="font-medium text-red-200">{lastStepLabel}</span>
              {elapsedLabel ? ` (after ${elapsedLabel})` : null}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || forceStopping}
              onClick={() => {
                void onRetry();
              }}
            >
              {disabled ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              Retry
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || forceStopping}
              // SIGKILL the runtime so a wedged llama-server can't keep
              // the next start from acquiring its port.  Even when the
              // process has already exited, this is a no-op rather than
              // an error — useful for users who want a "fully reset"
              // button alongside Retry.
              onClick={async () => {
                setForceStopping(true);
                try {
                  await ipc.forceStopOfflineRuntime();
                  toast.success("Runtime force-stopped");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Force stop failed",
                  );
                } finally {
                  setForceStopping(false);
                }
              }}
            >
              {forceStopping ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ZapOff className="mr-1 h-3.5 w-3.5" />
              )}
              Force Stop Runtime
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await ipc.revealOfflineRuntimeLog();
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Could not open the runtime log",
                  );
                }
              }}
            >
              <FileText className="mr-1 h-3.5 w-3.5" />
              Open Logs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onManageModel}
            >
              <Settings2 className="mr-1 h-3.5 w-3.5" />
              Manage Model
            </Button>
            {failure?.recoveryActions?.includes("reveal-folder") &&
              failure.modelId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await ipc.revealOfflineModelFolder(failure.modelId!);
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Could not reveal the model folder",
                      );
                    }
                  }}
                >
                  <FolderOpen className="mr-1 h-3.5 w-3.5" />
                  Reveal Model Folder
                </Button>
              )}
          </div>
          {technical && (
            <TechnicalDetails tone="danger">{technical}</TechnicalDetails>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Format a millisecond duration as a compact "Xs" / "X.Ys" / "Xm Ys"
 * label.  Used by both the live elapsed badge in the phase trail and
 * the "stuck for …" line in the failure banner — kept in one place so
 * the two surfaces never disagree.
 */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return totalSeconds < 10
      ? `${totalSeconds.toFixed(1)}s`
      : `${Math.round(totalSeconds)}s`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds - m * 60);
  return `${m}m ${s}s`;
}

/**
 * Render the structured failure record as a fixed-width key/value
 * block.  Falsy values are kept as `<unknown>` / `<n/a>` placeholders
 * so the user sees explicitly *what we don't know* instead of a
 * misleadingly empty field.
 */
function renderTechnicalDetails(f: OfflineRuntimeFailureDetails) {
  const fmt = (label: string, value: string) => `${label.padEnd(18)} ${value}`;
  const exists = (b: boolean | null) =>
    b === null ? "<unknown>" : b ? "yes" : "no";
  const lines = [
    fmt("Kind:", f.kind),
    fmt("Phase:", f.phase),
    fmt("Last step:", f.lastInProgressPhase ?? "<n/a>"),
    fmt(
      "Phase elapsed:",
      f.phaseElapsedMs === null ? "<n/a>" : `${f.phaseElapsedMs} ms`,
    ),
    fmt("Model ID:", f.modelId ?? "<unknown>"),
    fmt("Model path:", f.modelPath ?? "<unknown>"),
    fmt("Model exists:", exists(f.modelPathExists)),
    fmt("Binary path:", f.binaryPath ?? "<unknown>"),
    fmt("Binary exists:", exists(f.binaryPathExists)),
    fmt("Process exited:", String(f.exited)),
    fmt("Exit code:", f.exitCode === null ? "<n/a>" : String(f.exitCode)),
    fmt("Signal:", f.signal ?? "<n/a>"),
    "",
    "── stderr tail ───────────────",
    f.stderrTail || "<empty>",
    "",
    "── stdout tail ───────────────",
    f.stdoutTail || "<empty>",
  ];
  return (
    <pre
      role="log"
      aria-label="Offline runtime startup technical details"
      className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed"
    >
      {lines.join("\n")}
    </pre>
  );
}
