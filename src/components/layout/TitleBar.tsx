import { useChatStore } from "@/stores/chat-store";

/**
 * Slim, draggable window title bar.
 *
 * The mode switcher (Online / Auto / Offline) lives in the sidebar now —
 * see `Sidebar.tsx` — so the title bar only carries the app label, a
 * streaming pulse, and the OS drag region.  Keeping it minimal also
 * gives the chat top bar full width for title + mode + model + readiness.
 */
export function TitleBar() {
  const isStreaming = useChatStore((s) => s.isStreaming);

  return (
    <div
      className="relative flex h-9 w-full shrink-0 items-center justify-center bg-transparent"
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

      {/* Hairline bottom border */}
      <div className="hairline-x absolute bottom-0 inset-x-0 h-px" />
    </div>
  );
}
