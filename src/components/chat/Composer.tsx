import { useRef, useEffect, useCallback } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat-store";
import { getPreset } from "@/lib/models";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

const MAX_HEIGHT = 160; // ~6 lines

export function Composer({ onSend, onStop, isStreaming }: Props) {
  const { draft, setDraft } = useChatStore();
  const { selectedModel } = useSettingsStore();
  const ref = useRef<HTMLTextAreaElement>(null);

  const preset = getPreset(selectedModel);
  const modelName = preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

  // Focus on mount
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft("");
    onSend(text);
  }, [draft, isStreaming, setDraft, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="shrink-0 border-t border-border/50 bg-card/20 px-4 py-3">
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border bg-secondary/60 px-3 py-2 transition-colors",
          isStreaming ? "border-primary/20" : "border-border hover:border-border/80",
        )}
      >
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Generating…" : "Message GHchat…"}
          className="min-h-[36px] flex-1 resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
          disabled={isStreaming}
          rows={1}
          style={{ maxHeight: MAX_HEIGHT }}
        />

        {isStreaming ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground hover:bg-red-500/10"
            onClick={onStop}
            title="Stop generating"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSend}
            disabled={!draft.trim()}
            title="Send (Enter)"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
        {modelName}
        {!isStreaming && (
          <span className="ml-2 opacity-60">↵ send · ⇧↵ newline</span>
        )}
      </p>
    </div>
  );
}
