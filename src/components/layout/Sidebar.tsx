import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings, Trash2, Pencil, MessageSquare } from "lucide-react";
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

export function Sidebar() {
  const { data: conversations = [], isLoading } = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const { selectedConversationId, setSelectedConversationId } = useChatStore();
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const commitRename = (id: string) => {
    if (renameValue.trim()) {
      renameConversation.mutate({ id, title: renameValue.trim() });
    }
    setRenamingId(null);
  };

  return (
    <TooltipProvider delayDuration={400}>
      <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border/50 bg-card/20">
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider pl-1">
            Chats
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New chat</TooltipContent>
          </Tooltip>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2">
          {isLoading ? (
            <div className="space-y-1 p-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-secondary/40" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                No conversations yet.
                <br />
                Start a new chat above.
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {conversations.map((conv) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8, height: 0 }}
                  transition={{ duration: 0.14 }}
                  className={cn(
                    "group relative mb-0.5 flex items-center rounded-lg px-2 py-1.5 text-sm cursor-pointer select-none",
                    "hover:bg-secondary/60 transition-colors",
                    selectedConversationId === conv.id &&
                      "bg-secondary/80 text-foreground",
                  )}
                  onClick={() => {
                    if (renamingId !== conv.id) setSelectedConversationId(conv.id);
                  }}
                >
                  {renamingId === conv.id ? (
                    <Input
                      className="h-6 text-xs px-1 py-0 border-primary/50"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(conv.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span
                        className={cn(
                          "flex-1 truncate text-xs",
                          selectedConversationId === conv.id
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {conv.title}
                      </span>

                      <div className="absolute right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="rounded p-1 hover:bg-accent transition-colors"
                              onClick={(e) => startRename(conv, e)}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteConversation.mutate(conv.id);
                              }}
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
              ))}
            </AnimatePresence>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/30 p-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
