import { useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const [showTime, setShowTime] = useState(false);
  const isUser = message.role === "user";
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn("flex w-full px-4 py-2", isUser ? "justify-end" : "justify-start")}
      onMouseEnter={() => setShowTime(true)}
      onMouseLeave={() => setShowTime(false)}
    >
      <div
        className={cn(
          "message-content relative max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-secondary text-foreground rounded-bl-sm",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <pre className="my-2 overflow-auto rounded-md bg-black/40 p-3 font-mono text-xs">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                ) : (
                  <code
                    className="rounded bg-black/30 px-1 py-0.5 font-mono text-xs"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
              },
              ul({ children }) {
                return <ul className="mb-2 list-disc pl-4">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="mb-2 list-decimal pl-4">{children}</ol>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}

        {showTime && (
          <span
            className={cn(
              "absolute -bottom-5 text-[10px] text-muted-foreground whitespace-nowrap",
              isUser ? "right-1" : "left-1",
            )}
          >
            {time}
          </span>
        )}
      </div>
    </motion.div>
  );
}
