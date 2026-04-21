import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, RefreshCw, User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/types";

interface Props {
  message: Message;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
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

export function MessageBubble({ message, isLastAssistant, isStreaming, onRegenerate, index = 0 }: Props) {
  const [showActions, setShowActions] = useState(false);
  const isUser = message.role === "user";

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const wordCount = message.content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <TooltipProvider delayDuration={400}>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: 0.22,
          ease: [0.16, 1, 0.3, 1],
          delay: Math.min(index * 0.02, 0.1),
        }}
        className={cn("group flex w-full px-4 py-2", isUser ? "justify-end" : "justify-start")}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {/* Avatar — only for assistant */}
        {!isUser && (
          <div className="mr-2.5 mt-1 flex-shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20">
              <Bot className="h-3 w-3 text-primary" />
            </div>
          </div>
        )}

        <div className={cn("flex flex-col gap-1", isUser ? "items-end max-w-[78%]" : "flex-1 min-w-0 max-w-[85%]")}>
          <div
            className={cn(
              "message-content relative text-sm leading-relaxed",
              isUser
                ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground"
                : "rounded-2xl rounded-bl-md bg-card/60 px-4 py-3 text-foreground ring-1 ring-border/30",
              isStreaming && "animate-pulse-subtle",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
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

          {/* Per-message action bar */}
          {showActions && !isStreaming && (
            <motion.div
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className={cn(
                "flex items-center gap-1 transition-opacity",
                isUser ? "flex-row-reverse" : "flex-row",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <CopyButton text={message.content} className="opacity-60 hover:opacity-100" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Copy message</TooltipContent>
              </Tooltip>

              {isLastAssistant && onRegenerate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onRegenerate}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-60 transition-all hover:opacity-100 hover:text-foreground hover:bg-white/5 active:scale-95"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Regenerate
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Regenerate response</TooltipContent>
                </Tooltip>
              )}

              <span className="px-1 py-0.5 text-[10px] text-muted-foreground/40">
                {time}
                {!isUser && wordCount > 0 && (
                  <span className="ml-1.5 opacity-60">{wordCount}w</span>
                )}
              </span>
            </motion.div>
          )}
        </div>

        {/* Avatar — only for user */}
        {isUser && (
          <div className="ml-2.5 mt-1 flex-shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 ring-1 ring-primary/30">
              <User className="h-3 w-3 text-primary" />
            </div>
          </div>
        )}
      </motion.div>
    </TooltipProvider>
  );
}

