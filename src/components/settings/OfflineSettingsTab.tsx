import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  FolderOpen,
  Zap,
  Scale,
  Sparkles,
  RotateCcw,
  AlertTriangle,
  HardDrive,
  Cpu,
  CheckCircle2,
  XCircle,
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
import type {
  OfflineSettings,
  OfflineHardwareProfileSnapshot,
  OfflineModelSummary,
  OfflinePerformancePreset,
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
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Load everything in parallel on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      ipc.getOfflineSettings(),
      ipc.getOfflineHardwareProfile(),
      ipc.listInstalledOfflineModels().catch(() => []),
      ipc.getOfflineInfo().then((i) => i?.offlineRoot ?? null).catch(() => null),
    ])
      .then(([s, hw, models, root]) => {
        if (cancelled) return;
        setSettings(s);
        setHwProfile(hw);
        setInstalledModels(models);
        setStoragePath(root);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    ? installedModels.find((m) => m.isActive && m.sizeBytes / 1024 ** 3 > hwProfile.totalRamGb * 0.6)
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
                The active model <strong>{heaviestThatFits.name}</strong> ({fmtBytes(heaviestThatFits.sizeBytes)}) is
                large for this machine and may stream slowly. Try a smaller variant for faster responses.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Active model */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground">Active offline model</label>
        {installedModels.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No offline models installed yet. Install one from the Offline Models manager.
          </p>
        ) : (
          <Select
            value={activeModel?.id ?? ""}
            onValueChange={async (id) => {
              try {
                await ipc.setActiveOfflineModel(id);
                const next = await ipc.listInstalledOfflineModels();
                setInstalledModels(next);
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
                  {m.name} ({fmtBytes(m.sizeBytes)})
                  {m.health !== "ok" && " — needs repair"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
        {storagePath ? (
          <p className="break-all text-[10px] text-muted-foreground font-mono">
            {storagePath}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">No storage location yet.</p>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!storagePath}
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
                <span className="text-muted-foreground">{fmtBytes(m.sizeBytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
