import { useChatStore } from "@/stores/chat-store";

export function TitleBar() {
  const isStreaming = useChatStore((s) => s.isStreaming);

  return (
    <div
      className="relative flex h-11 w-full shrink-0 items-center justify-center bg-transparent"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 select-none">
        {isStreaming && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-glow-pulse" />
        )}
        <span className="text-xs font-medium text-muted-foreground/55 tracking-[0.08em]">
          GHchat
        </span>
      </div>
      {/* Hairline bottom border that acts as a subtle section divider */}
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
    </div>
  );
}
