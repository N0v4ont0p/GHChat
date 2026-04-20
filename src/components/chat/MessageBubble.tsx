import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/types";

interface Props {
  message: Message;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
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
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        "text-muted-foreground hover:text-foreground hover:bg-white/5",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function MessageBubble({ message, isLastAssistant, isStreaming, onRegenerate }: Props) {
  const [showActions, setShowActions] = useState(false);
  const isUser = message.role === "user";

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <TooltipProvider delayDuration={400}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className={cn("group flex w-full px-4 py-1.5", isUser ? "justify-end" : "justify-start")}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div className={cn("flex max-w-[78%] flex-col gap-1", isUser && "items-end")}>
          <div
            className={cn(
              "message-content relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-secondary/80 text-foreground rounded-bl-sm",
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
                    const codeText =
                      typeof children === "object" &&
                      children !== null &&
                      "props" in (children as object)
                        ? String(
                            (children as { props?: { children?: unknown } }).props?.children ?? "",
                          )
                        : "";

                    return (
                      <div className="group/code relative my-2">
                        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/code:opacity-100">
                          <CopyButton text={codeText} />
                        </div>
                        <pre
                          className="overflow-x-auto rounded-lg bg-zinc-950/80 p-4 text-xs leading-relaxed"
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
                        <code className={cn(className, "font-mono text-xs")} {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.82em]"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-2 last:mb-0">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="mb-2 list-disc space-y-0.5 pl-5">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="mb-2 list-decimal space-y-0.5 pl-5">{children}</ol>;
                  },
                  li({ children }) {
                    return <li className="leading-relaxed">{children}</li>;
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground italic">
                        {children}
                      </blockquote>
                    );
                  },
                  h1({ children }) {
                    return <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>;
                  },
                  h2({ children }) {
                    return <h2 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h2>;
                  },
                  h3({ children }) {
                    return <h3 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h3>;
                  },
                  a({ href, children }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {children}
                      </a>
                    );
                  },
                  hr() {
                    return <hr className="my-3 border-border/50" />;
                  },
                  table({ children }) {
                    return (
                      <div className="my-2 overflow-x-auto">
                        <table className="w-full text-xs">{children}</table>
                      </div>
                    );
                  },
                  th({ children }) {
                    return (
                      <th className="border border-border/50 px-2 py-1 text-left font-semibold">
                        {children}
                      </th>
                    );
                  },
                  td({ children }) {
                    return <td className="border border-border/50 px-2 py-1">{children}</td>;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </div>

          {/* Per-message action bar */}
          {showActions && !isStreaming && (
            <div
              className={cn(
                "flex items-center gap-0.5 transition-opacity",
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
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-60 transition-all hover:opacity-100 hover:text-foreground hover:bg-white/5"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Regenerate
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Regenerate this response</TooltipContent>
                </Tooltip>
              )}

              <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground/50">{time}</span>
            </div>
          )}
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
