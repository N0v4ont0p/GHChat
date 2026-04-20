import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateConversation } from "@/hooks/useConversations";

export function EmptyState() {
  const createConversation = useCreateConversation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
        <MessageSquare className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Start a conversation</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Chat with powerful open-source AI models via the Hugging Face Inference API.
        </p>
      </div>
      <Button onClick={() => createConversation.mutate()} className="gap-2">
        <MessageSquare className="h-4 w-4" />
        New chat
      </Button>
      <p className="text-xs text-muted-foreground">
        Tip: Add your Hugging Face API key in Settings to get started.
      </p>
    </div>
  );
}
