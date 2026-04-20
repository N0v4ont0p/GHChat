import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { StreamingIndicator } from "./StreamingIndicator";
import { useChatStore } from "@/stores/chat-store";
import type { Message } from "@/types";

interface Props {
  messages: Message[];
}

export function MessageList({ messages }: Props) {
  const { isStreaming, streamingText } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col pb-4 pt-2">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
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
          />
        )}

        {isStreaming && !streamingText && <StreamingIndicator />}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
