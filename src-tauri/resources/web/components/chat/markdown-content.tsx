"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";

function CodeBlock({
  className,
  children,
  ...props
}: React.ComponentProps<"code">) {
  const code = String(children).replace(/\n$/, "");
  const isInline = !className;
  const [copied, setCopied] = useState(false);

  if (isInline) {
    return (
      <code className="rounded bg-slate-800/80 px-1.5 py-0.5 text-xs" {...props}>
        {children}
      </code>
    );
  }

  const language = className?.replace("language-", "") || "code";

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950/90">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2 text-xs text-slate-400">
        <span>{language}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-slate-300"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);

  return (
    <div className="prose prose-invert prose-pre:m-0 prose-headings:mb-2 prose-headings:mt-4 prose-p:my-3 prose-li:my-1 max-w-none">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          code: CodeBlock,
          a: (props) => (
            <a
              {...props}
              className="text-blue-300 underline decoration-blue-500/40 underline-offset-4 hover:text-blue-200"
              target="_blank"
              rel="noreferrer"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
