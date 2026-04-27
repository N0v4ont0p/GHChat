import { Globe, Cpu, Zap } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { AppMode } from "@/types";

const MODE_CONFIG: Record<AppMode, { label: string; icon: React.ElementType; activeClass: string }> = {
  online: { label: "Online", icon: Globe, activeClass: "bg-blue-500/20 text-blue-400" },
  auto: { label: "Auto", icon: Zap, activeClass: "bg-cyan-500/20 text-cyan-400" },
  offline: { label: "Offline", icon: Cpu, activeClass: "bg-emerald-500/20 text-emerald-400" },
};

export function TitleBar() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const { currentMode, setMode, setOfflineState } = useModeStore();

  const handleModeChange = async (mode: AppMode) => {
    if (mode === currentMode) return;
    await ipc.setMode(mode);
    setMode(mode);
    // Sync offline state from the main process so AppShell routing is
    // immediately correct (e.g. clicking Offline with no install shows setup).
    const readiness = await ipc.getOfflineStatus();
    setOfflineState(readiness.state);
  };

  return (
    <div
      className="relative flex h-11 w-full shrink-0 items-center justify-center bg-transparent"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* App label (left, stays draggable) */}
      <div className="absolute left-3 flex items-center gap-2 select-none">
        {isStreaming && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-glow-pulse" />
        )}
        <span className="text-xs font-medium text-muted-foreground/55 tracking-[0.08em]">
          GHchat
        </span>
      </div>

      {/* Mode switcher (center, non-draggable) */}
      <div
        className="flex items-center rounded-full border border-border/40 bg-secondary/40 p-0.5 gap-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {(["online", "auto", "offline"] as AppMode[]).map((m) => {
          const { label, icon: Icon, activeClass } = MODE_CONFIG[m];
          const isActive = currentMode === m;
          return (
            <button
              key={m}
              onClick={() => void handleModeChange(m)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all select-none",
                isActive ? activeClass : "text-muted-foreground/50 hover:text-muted-foreground",
              )}
            >
              <Icon className="h-2.5 w-2.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Hairline bottom border */}
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
    </div>
  );
}
