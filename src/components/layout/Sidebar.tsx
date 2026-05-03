import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings, Trash2, Pencil, MessageSquare, Search, X, EyeOff, Eye, AlertTriangle, Cpu, Globe, Zap } from "lucide-react";
import logoUrl from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { TechnicalDetails } from "@/components/ui/technical-details";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from "@/hooks/useConversations";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import { useOfflineState } from "@/hooks/useOfflineState";
import { ipc } from "@/lib/ipc";
import { MODE_ACCENT } from "@/lib/mode-accent";
import type { AppMode, Conversation } from "@/types";

/** Error keywords that indicate a native module ABI mismatch requiring a rebuild. */
const NATIVE_MODULE_ERROR_RE = /NODE_MODULE_VERSION|invalid ELF|napi/i;

function groupByDate(convs: Conversation[]): Array<{ label: string; items: Conversation[] }> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Older: [],
  };

  for (const c of convs) {
    const d = new Date(c.updatedAt);
    if (d.toDateString() === today.toDateString()) groups["Today"].push(c);
    else if (d.toDateString() === yesterday.toDateString()) groups["Yesterday"].push(c);
    else if (d >= weekAgo) groups["This week"].push(c);
    else groups["Older"].push(c);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// ── Mode switcher ────────────────────────────────────────────────────────────
//
// Compact Online / Auto / Offline pill row, surfaced at the top of the
// sidebar so the user can always see (and change) the active mode while
// keeping the chat top bar focused on title + model + readiness.

const MODE_CONFIG: Record<AppMode, { label: string; icon: React.ElementType; activeClass: string; tooltip: string }> = {
  online: {
    label: "Online",
    icon: Globe,
    activeClass: MODE_ACCENT.online.badgeSolid,
    tooltip: "Online — uses OpenRouter free models",
  },
  auto: {
    label: "Auto",
    icon: Zap,
    activeClass: MODE_ACCENT.auto.badgeSolid,
    tooltip: "Auto — uses your installed offline model when available, otherwise online",
  },
  offline: {
    label: "Offline",
    icon: Cpu,
    activeClass: MODE_ACCENT.offline.badgeSolid,
    tooltip: "Offline — runs locally on your device, no internet required",
  },
};

function ModeSwitcher() {
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
      className="flex items-center justify-between rounded-full border border-border/40 bg-secondary/40 p-0.5 gap-0"
      role="radiogroup"
      aria-label="Mode"
    >
      {(["online", "auto", "offline"] as AppMode[]).map((m) => {
        const { label, icon: Icon, activeClass, tooltip } = MODE_CONFIG[m];
        const isActive = currentMode === m;
        return (
          <Tooltip key={m}>
            <TooltipTrigger asChild>
              <button
                role="radio"
                aria-checked={isActive}
                onClick={() => void handleModeChange(m)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-all select-none",
                  isActive ? activeClass : "text-muted-foreground/55 hover:text-muted-foreground",
                )}
              >
                <Icon className="h-2.5 w-2.5" />
                {label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Format a unix-ms timestamp as a compact, human-readable label suitable
 * for the sidebar conversation list:
 *   - <1 min      → "now"
 *   - <60 min     → "5m"
 *   - <24 h       → "3h"
 *   - <7 days     → weekday name ("Mon", "Tue", …)
 *   - same year   → "Mar 4"
 *   - older       → "Mar 4, 2024"
 *
 * Kept timezone-naive on purpose — the database stores epoch ms in the
 * user's local clock and the sidebar only needs human-friendly hints.
 */
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  }
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Mode-pill style + icon for the conversation list item. */
const CONV_MODE_BADGE: Record<AppMode, { icon: React.ElementType; className: string; label: string }> = {
  online: {
    icon: Globe,
    className: MODE_ACCENT.online.badge,
    label: MODE_ACCENT.online.label,
  },
  auto: {
    icon: Zap,
    className: MODE_ACCENT.auto.badge,
    label: MODE_ACCENT.auto.label,
  },
  offline: {
    icon: Cpu,
    className: MODE_ACCENT.offline.badge,
    label: MODE_ACCENT.offline.label,
  },
};

function ConversationItem({
  conv,
  isSelected,
  onSelect,
  onDelete,
  installedOfflineModelIds,
}: {
  conv: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  /** Set of installed offline catalog ids — used to flag missing-model conversations. */
  installedOfflineModelIds: Set<string>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(conv.title);
  const renameConversation = useRenameConversation();

  const commitRename = () => {
    if (value.trim()) renameConversation.mutate({ id: conv.id, title: value.trim() });
    setRenaming(false);
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(conv.title);
    setRenaming(true);
  };

  // Derive a display label for the bound model.
  const modelLabel = useMemo(() => {
    if (!conv.modelId) return null;
    if (conv.mode === "offline") return conv.modelId.replace(/-/g, " ");
    // For online IDs like "meta-llama/llama-3.1-8b-instruct:free", show the
    // last path segment without the ":free" tier suffix.
    const base = conv.modelId.split("/").pop() ?? conv.modelId;
    return base.replace(/:.*$/, "");
  }, [conv.mode, conv.modelId]);

  // Is this an offline conversation whose model is no longer installed?
  const isModelMissing =
    conv.mode === "offline" &&
    !!conv.modelId &&
    !installedOfflineModelIds.has(conv.modelId);

  const modeBadge = CONV_MODE_BADGE[conv.mode] ?? CONV_MODE_BADGE.online;
  const ModeIcon = modeBadge.icon;
  const timeLabel = formatRelativeTime(conv.updatedAt);
  const fullTimeTitle = new Date(conv.updatedAt).toLocaleString();

  return (
    <motion.div
      key={conv.id}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.13 }}
      className={cn(
        "sidebar-active-item group relative mb-0.5 flex items-start rounded-lg px-2.5 py-2 text-sm cursor-pointer select-none",
        "hover:bg-secondary/50 transition-colors duration-100",
        isSelected && "bg-secondary/70 text-foreground",
      )}
      onClick={() => { if (!renaming) onSelect(); }}
    >
      {renaming ? (
        <Input
          className="h-6 text-xs px-1 py-0 border-primary/40 bg-secondary/60"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <div className="min-w-0 flex-1 pr-12">
            {/* Title row: warning icon (if missing model) + title + timestamp */}
            <div className="flex items-center gap-1.5">
              {isModelMissing && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0">
                      <AlertTriangle className="h-3 w-3 text-amber-400/80" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    Offline model not installed — open this conversation to recover
                  </TooltipContent>
                </Tooltip>
              )}
              <span
                className={cn(
                  "truncate text-xs leading-tight flex-1",
                  isSelected ? "text-foreground" : "text-muted-foreground",
                  isModelMissing && "text-amber-300/80",
                )}
              >
                {conv.title}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="shrink-0 text-[9px] tabular-nums text-muted-foreground/45 leading-tight"
                    aria-label={`Updated ${fullTimeTitle}`}
                  >
                    {timeLabel}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">Updated {fullTimeTitle}</TooltipContent>
              </Tooltip>
            </div>

            {/* Metadata row: mode badge (always) + model badge (when bound).
                Both stay compact so a long model name truncates rather than
                wrapping the row. */}
            <div className="mt-1 flex items-center gap-1 leading-tight min-w-0">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-0 text-[9px] font-medium uppercase tracking-wide",
                  modeBadge.className,
                )}
              >
                <ModeIcon className="h-2 w-2" />
                {modeBadge.label}
              </span>
              {modelLabel && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "min-w-0 truncate rounded border border-border/40 bg-secondary/40 px-1 py-0 text-[9px] text-muted-foreground/70",
                        isModelMissing && "border-amber-500/30 bg-amber-500/10 text-amber-300/80",
                      )}
                    >
                      {modelLabel}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[260px]">
                    <span className="font-mono text-[11px]">{conv.modelId}</span>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded p-1 hover:bg-secondary transition-colors"
                  onClick={handleRenameClick}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Rename</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded p-1 hover:bg-red-500/15 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onDelete(e); }}
                >
                  <Trash2 className="h-3 w-3 text-red-400/70" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </>
      )}
    </motion.div>
  );
}

export function Sidebar() {
  const { data: conversations = [], isLoading, isError } = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const { selectedConversationId, setSelectedConversationId, incognitoMode, setIncognitoMode } = useChatStore();
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const dbAvailable = useSettingsStore((s) => s.dbAvailable);
  const dbInitError = useSettingsStore((s) => s.dbInitError);
  const { currentMode, offlineState, setOfflineManagementOpen } = useModeStore();
  const [searchQuery, setSearchQuery] = useState("");

  // Offline state used to flag conversations whose model is no longer installed.
  const { data: offlineSnap } = useOfflineState();
  const installedOfflineModelIds = useMemo<Set<string>>(
    () => new Set((offlineSnap?.installedModels ?? []).map((m) => m.id)),
    [offlineSnap],
  );

  // Show the Offline Manager shortcut whenever there is anything to manage:
  // either the user is currently in offline mode (so they can pick / install
  // a model) OR they already have at least one installed offline model
  // available — even from online mode they may want to manage their cache.
  const hasInstalledOfflineModels = (offlineSnap?.installedModels?.length ?? 0) > 0;
  const showOfflineManager =
    currentMode === "offline" ||
    (currentMode === "auto" && offlineState === "installed") ||
    hasInstalledOfflineModels;

  const newChatDisabled = createConversation.isPending || !dbAvailable;
  const newChatTooltip = !dbAvailable
    ? "Database unavailable — restart the app or run: pnpm run rebuild:native"
    : "Start a new chat";

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <TooltipProvider delayDuration={400}>
      <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border/50 bg-[hsl(var(--surface-1))]/85 backdrop-blur-md">
        {/* Brand header */}
        <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5 select-none">
          <img src={logoUrl} alt="GHchat" className="h-5 w-5 object-contain" />
          <span className="text-[11px] font-semibold text-muted-foreground/65 uppercase tracking-[0.18em]">
            Chats
          </span>
        </div>

        {/* New Chat — primary, full-width action */}
        <div className="px-3 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => createConversation.mutate()}
                disabled={newChatDisabled}
                className="h-8 w-full justify-start gap-2 text-xs font-medium active:scale-[0.99] transition-transform"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{newChatTooltip}</TooltipContent>
          </Tooltip>
        </div>

        {/* Mode switcher */}
        <div className="px-3 pb-2">
          <ModeSwitcher />
        </div>

        {/* Search — always visible so the user can filter without
            waiting for a conversation threshold */}
        <div className="relative px-3 pb-2">
          <Search className="absolute left-5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations…"
            className="h-7 pl-7 pr-7 text-xs bg-secondary/50 border-border/40"
          />
          {searchQuery && (
            <button
              className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2">
          {isLoading ? (
            <div className="space-y-1.5 p-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1 px-1.5 py-1.5">
                  <Skeleton className="h-3 w-[80%]" />
                  <Skeleton className="h-2 w-[40%] opacity-70" />
                </div>
              ))}
            </div>
          ) : isError || !dbAvailable ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
              <AlertTriangle className="h-7 w-7 text-amber-400/60" />
              <p className="text-xs text-amber-400/80 leading-relaxed font-medium">
                Database unavailable
              </p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                We couldn't open your local conversation database, so your chat
                history can't be loaded right now. Your messages are safe — they
                just need the database to come back online.
                {dbInitError && NATIVE_MODULE_ERROR_RE.test(dbInitError) && (
                  <>
                    {" "}This usually means a native module needs to be rebuilt
                    for your current Electron version.
                  </>
                )}
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 rounded-lg text-xs"
                  onClick={() => window.location.reload()}
                >
                  Reload app
                </Button>
                {dbInitError && NATIVE_MODULE_ERROR_RE.test(dbInitError) && (
                  <code className="rounded bg-secondary/60 px-1.5 py-1 font-mono text-[10px] text-muted-foreground/80">
                    pnpm run rebuild:native
                  </code>
                )}
              </div>
              {dbInitError && (
                <div className="mt-2 w-full">
                  <TechnicalDetails
                    details={dbInitError}
                    tone="warning"
                    label="error details"
                  />
                </div>
              )}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-3 py-10 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/25" />
              <div className="space-y-1">
                <p className="text-xs text-foreground/80 font-medium">
                  No conversations yet
                </p>
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                  Start your first chat to see it appear here.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 rounded-lg text-xs"
                onClick={() => createConversation.mutate()}
                disabled={newChatDisabled}
              >
                <Plus className="h-3 w-3" />
                Start a new chat
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <Search className="h-6 w-6 text-muted-foreground/25" />
              <p className="text-xs text-muted-foreground/60">
                No conversations match{" "}
                <span className="text-foreground/80">"{searchQuery}"</span>
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 rounded-lg text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
                Clear search
              </Button>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {groups.map(({ label, items }) => (
                <div key={label} className="mb-1">
                  <p className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/40">
                    {label}
                  </p>
                  {items.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conv={conv}
                      isSelected={selectedConversationId === conv.id}
                      onSelect={() => setSelectedConversationId(conv.id)}
                      onDelete={(e) => { e.stopPropagation(); deleteConversation.mutate(conv.id); }}
                      installedOfflineModelIds={installedOfflineModelIds}
                    />
                  ))}
                </div>
              ))}
            </AnimatePresence>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/30 p-2 space-y-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIncognitoMode(!incognitoMode)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors",
                  incognitoMode
                    ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/15"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                {incognitoMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {incognitoMode ? "Incognito on" : "Incognito"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {incognitoMode ? "Disable incognito mode" : "Enable incognito — messages won't be saved"}
            </TooltipContent>
          </Tooltip>
          {showOfflineManager && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setOfflineManagementOpen(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-emerald-400/80 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
                >
                  <Cpu className="h-3.5 w-3.5" />
                  Offline Manager
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Manage installed offline models</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open settings</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}

// ── Error boundary wrapper ───────────────────────────────────────────────────

import { Component, type ReactNode, type ErrorInfo } from "react";

interface SidebarErrorBoundaryState {
  error: Error | null;
}

/**
 * Wraps the Sidebar so that any uncaught render error inside it renders a
 * degraded (but visible) fallback instead of crashing the whole application.
 * Without this, a JavaScript error inside a conversation item or offline hook
 * would propagate to the root and blank the entire UI.
 */
export class SidebarErrorBoundary extends Component<
  { children: ReactNode },
  SidebarErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Sidebar] uncaught render error:", error, info);
  }

  override render() {
    if (this.state.error) {
      const err = this.state.error;
      const technical =
        err.stack && err.stack.length > 0
          ? err.stack
          : `${err.name ?? "Error"}: ${err.message}`;
      return (
        <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border/50 bg-[hsl(var(--surface-1))]/85 backdrop-blur-md items-center justify-center gap-3 px-4 py-8 text-center">
          <AlertTriangle className="h-7 w-7 text-amber-400/60" />
          <p className="text-xs text-amber-400/80 font-medium">
            The sidebar hit an unexpected problem
          </p>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Your chats and data are safe — only this panel failed to render.
            Try again, or reload the app if the issue continues.
          </p>
          <div className="flex items-center gap-1.5">
            <button
              className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
          <div className="w-full">
            <TechnicalDetails details={technical} tone="warning" label="error details" />
          </div>
        </aside>
      );
    }
    return this.props.children;
  }
}

