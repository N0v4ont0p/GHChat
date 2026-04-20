"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PencilLine, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

import { MarkdownContent } from "./markdown-content";

interface MessageBubbleProps {
  message: ChatMessage;
  isLastAssistant?: boolean;
  isLastUser?: boolean;
  onRegenerate?: () => void;
  onEditResend?: (content: string) => void;
}

export function MessageBubble({
  message,
  isLastAssistant,
  isLastUser,
  onRegenerate,
  onEditResend,
}: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("flex w-full", isAssistant ? "justify-start" : "justify-end")}
    >
      <div
        className={cn(
          "group w-full max-w-3xl rounded-2xl border px-4 py-3 shadow-sm",
          isAssistant
            ? "border-slate-700/70 bg-slate-900/70"
            : "border-blue-500/30 bg-blue-500/20",
        )}
      >
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
          {isAssistant ? "Assistant" : "You"}
        </div>
        <MarkdownContent content={message.content} />
        <AnimatePresence>
          {(isLastAssistant || isLastUser) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex gap-2"
            >
              {isLastAssistant && onRegenerate ? (
                <Button size="sm" variant="ghost" onClick={onRegenerate}>
                  <RefreshCcw size={14} className="mr-1" />
                  Regenerate
                </Button>
              ) : null}
              {isLastUser && onEditResend ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onEditResend(message.content)}
                >
                  <PencilLine size={14} className="mr-1" />
                  Edit & resend
                </Button>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
