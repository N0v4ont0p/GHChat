import { useChatStore } from "@/stores/chat-store";
import { useMessages } from "@/hooks/useMessages";
import { useChat } from "@/hooks/useChat";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ChatHeader } from "./ChatHeader";

export function ChatWindow() {
  const { selectedConversationId } = useChatStore();
  const { data: messages = [] } = useMessages(selectedConversationId);
  const { sendMessage, stopStream, regenerate, isStreaming } = useChat(selectedConversationId);

  if (!selectedConversationId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <ChatHeader />
      <MessageList messages={messages} onRegenerate={regenerate} />
      <Composer onSend={sendMessage} onStop={stopStream} isStreaming={isStreaming} />
    </div>
  );
}
