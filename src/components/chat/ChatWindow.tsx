import { useChatStore } from "@/stores/chat-store";
import { useMessages } from "@/hooks/useMessages";
import { useChat } from "@/hooks/useChat";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

export function ChatWindow() {
  const { selectedConversationId } = useChatStore();
  const { data: messages = [] } = useMessages(selectedConversationId);
  const { sendMessage } = useChat(selectedConversationId);

  if (!selectedConversationId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <MessageList messages={messages} />
      <Composer onSend={sendMessage} />
    </div>
  );
}
