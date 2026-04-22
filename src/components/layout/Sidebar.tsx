import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings, Trash2, Pencil, MessageSquare, Search, X } from "lucide-react";
import logoUrl from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import type { Conversation } from "@/types";

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

function ConversationItem({
  conv,
  isSelected,
  onSelect,
  onRename,
  onDelete,
}: {
  conv: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
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

  return (
    <motion.div
      key={conv.id}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.13 }}
      className={cn(
        "sidebar-active-item group relative mb-0.5 flex items-center rounded-lg px-2.5 py-2 text-sm cursor-pointer select-none",
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
          <span
            className={cn(
              "flex-1 truncate text-xs",
              isSelected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {conv.title}
          </span>
          <div className="absolute right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
  const { data: conversations = [], isLoading } = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const { selectedConversationId, setSelectedConversationId } = useChatStore();
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <TooltipProvider delayDuration={400}>
      <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border/40 bg-card/10">
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-1.5 pl-1">
            <img src={logoUrl} alt="GHchat" className="h-5 w-5 object-contain" />
            <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
              Chats
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New chat</TooltipContent>
          </Tooltip>
        </div>

        {/* Search */}
        {conversations.length > 3 && (
          <div className="relative px-2 pb-2">
            <Search className="absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="h-7 pl-7 pr-7 text-xs bg-secondary/50 border-border/40"
            />
            {searchQuery && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2">
          {isLoading ? (
            <div className="space-y-1 p-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-secondary/30" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/25" />
              <p className="text-xs text-muted-foreground/50 leading-relaxed">
                No conversations yet.
                <br />
                Start a new chat above.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <Search className="h-6 w-6 text-muted-foreground/25" />
              <p className="text-xs text-muted-foreground/50">No results for "{searchQuery}"</p>
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
                    />
                  ))}
                </div>
              ))}
            </AnimatePresence>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/30 p-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

