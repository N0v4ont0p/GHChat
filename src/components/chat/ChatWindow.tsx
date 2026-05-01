import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useMessages } from "@/hooks/useMessages";
import { useChat } from "@/hooks/useChat";
import { useConversationModelHealth } from "@/hooks/useConversationModelHealth";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ChatHeader } from "./ChatHeader";
import { MissingModelRecovery } from "./MissingModelRecovery";

export function ChatWindow() {
  const { selectedConversationId } = useChatStore();
  const { setSettingsOpen } = useSettingsStore();
  const { data: messages = [] } = useMessages(selectedConversationId);
  const { sendMessage, stopStream, regenerate, editLastUserMessage, retryStream, switchToAutoMode, refreshModelAvailability, isStreaming } =
    useChat(selectedConversationId);
  const health = useConversationModelHealth(selectedConversationId);

  if (!selectedConversationId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <EmptyState />
      </div>
    );
  }

  const composerDisabled = health.kind === "missing-offline-model";

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <ChatHeader />
      <MessageList
        messages={messages}
        onRegenerate={regenerate}
        onEditUserMessage={(content) => void editLastUserMessage(content)}
        onRetry={() => void retryStream()}
        onSwitchFallback={(modelId) => void retryStream(modelId)}
        onUseAuto={() => void switchToAutoMode()}
        onRefreshModels={() => void refreshModelAvailability()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {health.kind === "missing-offline-model" && (
        <MissingModelRecovery
          conversationId={selectedConversationId}
          missingId={health.missingId}
          missingLabel={health.missingLabel}
        />
      )}
      <Composer
        onSend={sendMessage}
        onStop={stopStream}
        isStreaming={isStreaming}
        disabled={composerDisabled}
        disabledPlaceholder={
          composerDisabled
            ? "Resolve the missing offline model above to continue."
            : undefined
        }
      />
    </div>
  );
}
