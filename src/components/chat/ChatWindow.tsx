import { useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import { useMessages } from "@/hooks/useMessages";
import { useChat } from "@/hooks/useChat";
import { useConversationModelHealth } from "@/hooks/useConversationModelHealth";
import { ipc } from "@/lib/ipc";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ChatHeader } from "./ChatHeader";
import { MissingModelRecovery } from "./MissingModelRecovery";
import { RuntimeDiagnosticsModal } from "@/components/offline/RuntimeDiagnosticsModal";

export function ChatWindow() {
  const { selectedConversationId } = useChatStore();
  const { setSettingsOpen } = useSettingsStore();
  const setOfflineManagementOpen = useModeStore((s) => s.setOfflineManagementOpen);
  const { data: messages = [] } = useMessages(selectedConversationId);
  const { sendMessage, stopStream, regenerate, editLastUserMessage, retryStream, switchToAutoMode, refreshModelAvailability, isStreaming } =
    useChat(selectedConversationId);
  const health = useConversationModelHealth(selectedConversationId);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  if (!selectedConversationId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <EmptyState />
      </div>
    );
  }

  const composerDisabled = health.kind === "missing-offline-model";

  // ── Offline runtime recovery handlers ────────────────────────────────
  // Surfaced from the inline ChatErrorPanel when an offline stream
  // failed.  Each handler does the bare minimum to recover and (where
  // applicable) re-issues the failed send so the user doesn't have to
  // type the prompt again.
  const handleRestartRuntime = async () => {
    try {
      const res = await ipc.restartOfflineRuntime();
      if (!res.ok) {
        toast.error(res.error ?? "Restart failed");
        return;
      }
      toast.success("Runtime restart initiated");
      // Re-issue the previously failed send.  retryStream is a no-op if
      // there's nothing to retry, so this is always safe.
      void retryStream();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    }
  };

  const handleForceStopRuntime = async () => {
    try {
      await ipc.forceStopOfflineRuntime();
      toast.success("Runtime force-stopped");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Force stop failed");
    }
  };

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
        onRestartRuntime={() => void handleRestartRuntime()}
        onForceStopRuntime={() => void handleForceStopRuntime()}
        onManageOfflineModel={() => setOfflineManagementOpen(true)}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
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
      <RuntimeDiagnosticsModal
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
      />
    </div>
  );
}
