"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/types";

interface SidebarProps {
  conversations: ChatConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({
  conversations,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((entry) =>
      entry.title.toLowerCase().includes(normalized),
    );
  }, [conversations, query]);

  return (
    <aside className="glass-panel flex w-full max-w-76 flex-col border-r border-slate-800/70 p-4">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 shadow-[0_0_40px_rgba(99,102,241,0.45)]">
          <WandSparkles size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">GHchat</h1>
          <p className="text-xs text-slate-400">Local-first AI on macOS</p>
        </div>
      </div>

      <Button variant="primary" className="mb-4 w-full" onClick={onCreate}>
        <MessageSquarePlus className="mr-2" size={16} />
        New chat
      </Button>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-500" size={16} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          className="pl-9"
          placeholder="Search chats"
        />
      </div>

      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto pr-1">
        <AnimatePresence>
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-dashed border-slate-700/70 p-4 text-sm text-slate-400"
            >
              No chats yet. Start one to build your local history.
            </motion.div>
          ) : (
            filtered.map((item) => (
              <motion.button
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "group w-full rounded-xl border px-3 py-2 text-left transition",
                  item.id === selectedId
                    ? "border-blue-400/40 bg-blue-500/15"
                    : "border-slate-800 bg-slate-900/70 hover:border-slate-700",
                )}
              >
                <div className="line-clamp-2 text-sm font-medium text-slate-100">
                  {item.title}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{new Date(item.updatedAt).toLocaleString()}</span>
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-slate-700"
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextTitle = window.prompt("Rename conversation", item.title);
                        if (nextTitle) {
                          onRename(item.id, nextTitle);
                        }
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-rose-500/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (window.confirm("Delete this conversation?")) {
                          onDelete(item.id);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </motion.button>
            ))
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
