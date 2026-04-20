import { useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";

interface Props {
  onSend: (content: string) => void;
}

export function Composer({ onSend }: Props) {
  const { draft, setDraft, isStreaming } = useChatStore();
  const { selectedModel } = useSettingsStore();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 120)}px`;
    }
  }, [draft]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft("");
    onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Enter" && e.metaKey) || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const modelName = selectedModel.split("/").pop() ?? selectedModel;

  return (
    <div className="border-t border-border bg-card/50 p-4">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-secondary p-2">
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message GHchat... (Enter to send)"
          className="min-h-[36px] flex-1 resize-none border-0 bg-transparent p-1 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={isStreaming}
          rows={1}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleSend}
          disabled={!draft.trim() || isStreaming}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
        {modelName} · Enter to send
      </p>
    </div>
  );
}
