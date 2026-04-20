"use client";

import { Loader2, SendHorizontal, Square } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  disabled,
  isStreaming,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
  }, [value]);

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-900/80 p-3 backdrop-blur">
      <Textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        placeholder="Message GHchat…"
        className="max-h-60 min-h-12 border-transparent bg-transparent p-2 text-base focus-visible:ring-0"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!disabled) {
              onSubmit();
            }
          }
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Enter to send • Shift+Enter for newline</p>
        {isStreaming ? (
          <Button variant="danger" size="sm" onClick={onStop}>
            <Square size={14} className="mr-1" />
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onSubmit} disabled={disabled}>
            {disabled ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <SendHorizontal size={14} className="mr-1" />
            )}
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
