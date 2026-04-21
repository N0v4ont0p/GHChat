import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import { StreamingIndicator } from "./StreamingIndicator";
import { useChatStore } from "@/stores/chat-store";
import type { Message } from "@/types";

interface Props {
  messages: Message[];
  onRegenerate: () => void;
}

const SCROLL_BOTTOM_THRESHOLD = 32;

/** Format a timestamp into a human-readable date label */
function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 h-px bg-border/30" />
      <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  );
}

export function MessageList({ messages, onRegenerate }: Props) {
  const { isStreaming, streamingText } = useChatStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const getViewport = useCallback(() => viewportRef.current, []);

  const updateBottomState = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    const distanceToBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceToBottom < SCROLL_BOTTOM_THRESHOLD;
    setIsAtBottom(nearBottom);
    if (nearBottom) setShowJumpToLatest(false);
  }, [getViewport]);

  useEffect(() => {
    const viewport =
      (scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLDivElement | null) ?? null;
    if (!viewport) return;
    viewportRef.current = viewport;
    updateBottomState();
    const onScroll = () => updateBottomState();
    viewport.addEventListener("scroll", onScroll);
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      viewportRef.current = null;
    };
  }, [getViewport, updateBottomState]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isAtBottom) {
      if (messages.length > 0) setShowJumpToLatest(true);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isAtBottom]);

  useEffect(() => {
    if (!isStreaming) return;
    if (isAtBottom) {
      // Streaming emits tokens at high frequency; "auto" avoids repeated smooth-scroll animations.
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
        scrollRafRef.current = null;
      });
    } else if (streamingText) {
      setShowJumpToLatest(true);
    }
  }, [streamingText, isStreaming, isAtBottom]);

  const lastAssistantIndex = messages.reduce(
    (acc, m, i) => (m.role === "assistant" ? i : acc),
    -1,
  );

  // Build list with date dividers
  const items: Array<{ type: "divider"; label: string } | { type: "message"; msg: Message; idx: number }> = [];
  let lastLabel = "";
  messages.forEach((msg, idx) => {
    const label = formatDateLabel(msg.createdAt);
    if (label !== lastLabel) {
      items.push({ type: "divider", label });
      lastLabel = label;
    }
    items.push({ type: "message", msg, idx });
  });

  return (
    <div className="relative flex-1 overflow-hidden">
      <ScrollArea ref={scrollAreaRef} className="h-full">
        <div className="flex flex-col pb-6 pt-2">
          {items.map((item) =>
            item.type === "divider" ? (
              <DateDivider key={`divider-${item.label}`} label={item.label} />
            ) : (
              <MessageBubble
                key={item.msg.id}
                message={item.msg}
                index={item.idx}
                isLastAssistant={!isStreaming && item.idx === lastAssistantIndex}
                onRegenerate={onRegenerate}
              />
            ),
          )}

          {isStreaming && streamingText && (
            <MessageBubble
              message={{
                id: "__streaming__",
                conversationId: "",
                role: "assistant",
                content: streamingText,
                createdAt: Date.now(),
              }}
              index={messages.length}
              isStreaming
            />
          )}

          {isStreaming && !streamingText && <StreamingIndicator />}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {showJumpToLatest && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <Button
            size="sm"
            className="pointer-events-auto h-8 gap-1.5 rounded-full bg-card/95 shadow-lg backdrop-blur-sm ring-1 ring-border/50 text-xs"
            variant="outline"
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              setShowJumpToLatest(false);
            }}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

