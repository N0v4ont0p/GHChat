import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateConversation } from "@/hooks/useConversations";
import { getPreset } from "@/lib/models";
import { useSettingsStore } from "@/stores/settings-store";

export function EmptyState() {
  const createConversation = useCreateConversation();
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const preset = getPreset(selectedModel);
  const modelName = preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <div className="space-y-2 max-w-xs">
        <h2 className="text-xl font-semibold tracking-tight">Start a conversation</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Chat with <span className="text-foreground font-medium">{modelName}</span> and
          hundreds of other open-source AI models via the Hugging Face Inference API.
        </p>
      </div>
      <Button
        onClick={() => createConversation.mutate()}
        disabled={createConversation.isPending}
        className="gap-2"
      >
        <Sparkles className="h-4 w-4" />
        New conversation
      </Button>
      <p className="text-xs text-muted-foreground/60">
        Tip: Press{" "}
        <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
          ↵
        </kbd>{" "}
        to send a message
      </p>
    </div>
  );
}
