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

export function MessageList({ messages, onRegenerate }: Props) {
  const { isStreaming, streamingText } = useChatStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const getViewport = useCallback(() => {
    return scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLDivElement | null;
  }, []);

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
    const viewport = getViewport();
    if (!viewport) return;
    updateBottomState();
    const onScroll = () => updateBottomState();
    viewport.addEventListener("scroll", onScroll);
    return () => viewport.removeEventListener("scroll", onScroll);
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

  return (
    <div className="relative flex-1">
      <ScrollArea ref={scrollAreaRef} className="h-full">
        <div className="flex flex-col px-2 pb-6 pt-4">
          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLastAssistant={!isStreaming && idx === lastAssistantIndex}
              onRegenerate={onRegenerate}
            />
          ))}

          {isStreaming && streamingText && (
            <MessageBubble
              message={{
                id: "__streaming__",
                conversationId: "",
                role: "assistant",
                content: streamingText,
                createdAt: Date.now(),
              }}
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
            className="pointer-events-auto h-8 rounded-full bg-card/95 shadow-md backdrop-blur-sm"
            variant="outline"
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              setShowJumpToLatest(false);
            }}
          >
            <ArrowDown className="mr-1 h-3.5 w-3.5" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
