import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { StreamingIndicator } from "./StreamingIndicator";
import { useChatStore } from "@/stores/chat-store";
import type { Message } from "@/types";

interface Props {
  messages: Message[];
  onRegenerate: () => void;
}

export function MessageList({ messages, onRegenerate }: Props) {
  const { isStreaming, streamingText } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  const lastAssistantIndex = messages.reduce(
    (acc, m, i) => (m.role === "assistant" ? i : acc),
    -1,
  );

  return (
    <ScrollArea className="flex-1">
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
  );
}
