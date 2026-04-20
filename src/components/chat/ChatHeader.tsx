import { Settings, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { getPreset } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

export function ChatHeader() {
  const { selectedModel, setSettingsOpen } = useSettingsStore();
  const isStreaming = useChatStore((s) => s.isStreaming);

  const preset = getPreset(selectedModel);
  const displayName = preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-card/30 px-4 backdrop-blur-sm">
        {/* Model indicator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isStreaming ? "bg-primary animate-pulse" : "bg-green-400/70",
                )}
              />
              <span className="font-medium">{displayName}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{isStreaming ? "Generating…" : "Click to change model"}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{selectedModel}</p>
          </TooltipContent>
        </Tooltip>

        {/* Settings shortcut */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Settings</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
