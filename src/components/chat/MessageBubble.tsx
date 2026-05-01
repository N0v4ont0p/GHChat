import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, RefreshCw, User, Bot, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/types";

interface Props {
  message: Message;
  isLastAssistant?: boolean;
  /** True for the most recent user turn (eligible for inline edit). */
  isLastUser?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
  index?: number;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);

  return (
    <button
      onClick={copy}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-all duration-150",
        "text-muted-foreground hover:text-foreground hover:bg-white/8 active:scale-95",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/** Extract language label from highlight.js className like "language-typescript" */
function extractLanguage(className?: string): string {
  if (!className) return "";
  const m = className.match(/language-(\w+)/);
  return m ? m[1] : "";
}

export function MessageBubble({ message, isLastAssistant, isLastUser, isStreaming, onRegenerate, onEdit, index = 0 }: Props) {
  const isUser = message.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset draft if the underlying message content changes while we're not editing.
  useEffect(() => {
    if (!isEditing) setDraft(message.content);
  }, [message.content, isEditing]);

  // Auto-grow + focus textarea when entering edit mode.
  useEffect(() => {
    if (!isEditing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
  }, [isEditing]);

  const beginEdit = useCallback(() => {
    setDraft(message.content);
    setIsEditing(true);
  }, [message.content]);
  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraft(message.content);
  }, [message.content]);
  const submitEdit = useCallback(() => {
    const next = draft.trim();
    if (!next || next === message.content.trim()) {
      cancelEdit();
      return;
    }
    setIsEditing(false);
    onEdit?.(next);
  }, [draft, message.content, cancelEdit, onEdit]);

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const wordCount = message.content.trim().split(/\s+/).filter(Boolean).length;
  const canEdit = isUser && isLastUser && !isStreaming && !!onEdit;

  return (
    <TooltipProvider delayDuration={400}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.22,
          ease: [0.16, 1, 0.3, 1],
          delay: Math.min(index * 0.02, 0.1),
        }}
        className={cn(
          "group/msg flex w-full px-4 py-2.5 sm:px-6",
          isUser ? "justify-end" : "justify-start",
        )}
      >
        {/* Avatar — only for assistant */}
        {!isUser && (
          <div className="mr-3 mt-1 flex-shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 ring-1 ring-primary/15">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
          </div>
        )}

        <div className={cn("flex flex-col gap-1.5", isUser ? "items-end max-w-[78%]" : "flex-1 min-w-0 max-w-[85%]")}>
          {isEditing ? (
            <div className="w-full max-w-[640px] rounded-2xl rounded-br-md bg-primary/95 p-2 ring-1 ring-primary/40">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  const ta = e.currentTarget;
                  ta.style.height = "auto";
                  ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-sm leading-relaxed text-primary-foreground outline-none placeholder:text-primary-foreground/50"
                rows={1}
                aria-label="Edit message"
              />
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <span className="text-[10px] text-primary-foreground/60">
                  Enter to save · Shift+Enter for newline · Esc to cancel
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-primary-foreground/80 transition-colors hover:bg-primary-foreground/10"
                  >
                    <X className="h-3 w-3" />
                    Cancel
                  </button>
                  <button
                    onClick={submitEdit}
                    disabled={!draft.trim() || draft.trim() === message.content.trim()}
                    className="flex items-center gap-1 rounded-md bg-primary-foreground/95 px-2.5 py-1 text-[11px] font-medium text-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check className="h-3 w-3" />
                    Save &amp; resend
                  </button>
                </div>
              </div>
            </div>
          ) : (
          <div
            className={cn(
              "message-content relative text-[14.5px] leading-relaxed",
              isUser
                ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-sm"
                : "rounded-2xl rounded-bl-md bg-card/55 px-4 py-3 text-foreground ring-1 ring-border/25",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  pre({ children, ...props }) {
                    // Extract language + raw code text from the child code element
                    const codeEl = children as React.ReactElement<{ className?: string; children?: unknown }>;
                    const lang = extractLanguage(codeEl?.props?.className);
                    const codeText = String(codeEl?.props?.children ?? "").replace(/\n$/, "");

                    return (
                      <div className="group/code relative my-3 overflow-hidden rounded-xl border border-border/40 bg-zinc-950">
                        {/* Header bar */}
                        <div className="flex items-center justify-between border-b border-border/30 bg-zinc-900/80 px-3 py-1.5">
                          <span className="font-mono text-[10px] font-medium text-muted-foreground/70">
                            {lang || "code"}
                          </span>
                          <CopyButton text={codeText} />
                        </div>
                        <pre
                          className="overflow-x-auto p-4 text-[12px] leading-relaxed"
                          {...props}
                        >
                          {children}
                        </pre>
                      </div>
                    );
                  },
                  code({ className, children, ...props }) {
                    const isBlock = String(className ?? "").includes("language-");
                    if (isBlock) {
                      return (
                        <code className={cn(className, "font-mono text-[12px]")} {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className="rounded-md bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[0.81em] text-zinc-200 ring-1 ring-zinc-700/50"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="mb-2.5 list-disc space-y-1 pl-5">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="mb-2.5 list-decimal space-y-1 pl-5">{children}</ol>;
                  },
                  li({ children }) {
                    return <li className="leading-relaxed">{children}</li>;
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote className="my-2.5 rounded-r-lg border-l-2 border-primary/50 bg-primary/5 py-1.5 pl-3 pr-2 text-muted-foreground italic">
                        {children}
                      </blockquote>
                    );
                  },
                  h1({ children }) {
                    return <h1 className="mb-2.5 mt-4 text-base font-bold first:mt-0">{children}</h1>;
                  },
                  h2({ children }) {
                    return <h2 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h2>;
                  },
                  h3({ children }) {
                    return <h3 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>;
                  },
                  a({ href, children }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary transition-colors"
                      >
                        {children}
                      </a>
                    );
                  },
                  hr() {
                    return <hr className="my-3 border-border/40" />;
                  },
                  table({ children }) {
                    return (
                      <div className="my-3 overflow-x-auto rounded-lg ring-1 ring-border/40">
                        <table className="w-full text-xs">{children}</table>
                      </div>
                    );
                  },
                  thead({ children }) {
                    return <thead className="bg-secondary/50">{children}</thead>;
                  },
                  th({ children }) {
                    return (
                      <th className="border-b border-border/40 px-3 py-2 text-left font-semibold text-muted-foreground">
                        {children}
                      </th>
                    );
                  },
                  td({ children }) {
                    return <td className="border-b border-border/20 px-3 py-2 last:border-b-0">{children}</td>;
                  },
                }}
              >
                {/* Blinking cursor appended during streaming */}
                {message.content}
              </ReactMarkdown>
            )}
            {/* Streaming cursor */}
            {isStreaming && (
              <span className="inline-block h-3.5 w-0.5 translate-y-0.5 rounded-sm bg-primary animate-cursor-blink ml-0.5" />
            )}
          </div>
          )}

          {/* Per-message action bar — appears on hover via CSS group-hover */}
          <AnimatePresence>
            {!isStreaming && !isEditing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className={cn(
                  "flex items-center gap-0.5 opacity-0 transition-opacity duration-150",
                  "group-hover/msg:opacity-100 focus-within:opacity-100",
                  isUser ? "flex-row-reverse" : "flex-row",
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <CopyButton text={message.content} className="opacity-70 hover:opacity-100" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Copy message</TooltipContent>
                </Tooltip>

                {canEdit && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={beginEdit}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-70 transition-all hover:opacity-100 hover:text-foreground hover:bg-white/5 active:scale-95"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Edit and resend</TooltipContent>
                  </Tooltip>
                )}

                {isLastAssistant && onRegenerate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onRegenerate}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-70 transition-all hover:opacity-100 hover:text-foreground hover:bg-white/5 active:scale-95"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Regenerate
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Regenerate response</TooltipContent>
                  </Tooltip>
                )}

                <span className="px-1 py-0.5 text-[10px] text-muted-foreground/40 tabular-nums">
                  {time}
                  {!isUser && wordCount > 0 && (
                    <span className="ml-1.5 opacity-60">{wordCount}w</span>
                  )}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Avatar — only for user */}
        {isUser && (
          <div className="ml-3 mt-1 flex-shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/18 ring-1 ring-primary/25">
              <User className="h-3.5 w-3.5 text-primary" />
            </div>
          </div>
        )}
      </motion.div>
    </TooltipProvider>
  );
}

