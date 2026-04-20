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
  const { data: conversations = [] } = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const { selectedConversationId, setSelectedConversationId } = useChatStore();
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (conv: Conversation) => {
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
    <TooltipProvider delayDuration={500}>
      <aside className="flex h-full w-64 flex-col border-r border-border bg-card">
        {/* New chat button */}
        <div className="p-3">
          <Button
            className="w-full justify-start gap-2"
            onClick={() => createConversation.mutate()}
            disabled={createConversation.isPending}
          >
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2">
          <AnimatePresence initial={false}>
            {conversations.map((conv) => (
              <motion.div
                key={conv.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "group relative mb-1 flex items-center rounded-md px-2 py-2 text-sm cursor-pointer hover:bg-secondary",
                  selectedConversationId === conv.id && "bg-secondary",
                )}
                onClick={() => setSelectedConversationId(conv.id)}
              >
                <MessageSquare className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {renamingId === conv.id ? (
                  <Input
                    className="h-6 text-xs px-1 py-0"
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
                  <span className="flex-1 truncate text-foreground/90">{conv.title}</span>
                )}

                {/* Action buttons */}
                {renamingId !== conv.id && (
                  <div className="absolute right-1 hidden gap-0.5 group-hover:flex">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="rounded p-1 hover:bg-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(conv);
                          }}
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Rename</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="rounded p-1 hover:bg-red-600/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation.mutate(conv.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-red-400" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </ScrollArea>

        {/* Bottom: Settings */}
        <div className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
