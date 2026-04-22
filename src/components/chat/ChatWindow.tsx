import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useMessages } from "@/hooks/useMessages";
import { useChat } from "@/hooks/useChat";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ChatHeader } from "./ChatHeader";

export function ChatWindow() {
  const { selectedConversationId } = useChatStore();
  const { setSettingsOpen } = useSettingsStore();
  const { data: messages = [] } = useMessages(selectedConversationId);
  const { sendMessage, stopStream, regenerate, retryStream, switchToAutoMode, isStreaming } =
    useChat(selectedConversationId);

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
      <MessageList
        messages={messages}
        onRegenerate={regenerate}
        onRetry={() => void retryStream()}
        onSwitchFallback={(modelId) => void retryStream(modelId)}
        onUseAuto={() => void switchToAutoMode()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Composer onSend={sendMessage} onStop={stopStream} isStreaming={isStreaming} />
    </div>
  );
}
