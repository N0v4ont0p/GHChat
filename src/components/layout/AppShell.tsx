import { useEffect, useRef } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { OfflineSetupFlow } from "@/components/offline/OfflineSetupFlow";
import { OfflineManagementModal } from "@/components/offline/OfflineManagementModal";
import { useConversations } from "@/hooks/useConversations";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import { ipc } from "@/lib/ipc";

export function AppShell() {
  const { data: conversations } = useConversations();
  const { selectedConversationId, setSelectedConversationId } = useChatStore();
  const incognitoMode = useChatStore((s) => s.incognitoMode);
  const dbAvailable = useSettingsStore((s) => s.dbAvailable);
  const autoSelectedRef = useRef(false);

  const currentMode = useModeStore((s) => s.currentMode);
  const offlineState = useModeStore((s) => s.offlineState);
  const setOfflineState = useModeStore((s) => s.setOfflineState);

  // Sync offline readiness from the main process on mount.
  useEffect(() => {
    ipc.getOfflineStatus()
      .then((r) => setOfflineState(r.state))
      .catch(() => {
        console.debug("[AppShell] offline status unavailable, using default");
      });
  }, [setOfflineState]);

  // Auto-select the most recent conversation when conversations load
  // and none is currently selected (e.g. on launch without a persisted lastConversationId)
  useEffect(() => {
    if (!autoSelectedRef.current && !selectedConversationId && conversations && conversations.length > 0) {
      autoSelectedRef.current = true;
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId, setSelectedConversationId]);

  // Persist the active conversation so it can be restored on next launch.
  // Skipped when DB is unavailable (update would throw) or in incognito mode
  // (to avoid leaking session activity into the DB).
  useEffect(() => {
    if (selectedConversationId && !incognitoMode && dbAvailable) {
      void ipc.updateSettings({ lastConversationId: selectedConversationId });
    }
  }, [selectedConversationId, incognitoMode, dbAvailable]);

  // Determine whether offline setup is required.
  // Offline mode routes to the setup flow until a model is installed.
  const needsOfflineSetup =
    (currentMode === "offline" || currentMode === "auto") &&
    offlineState !== "installed";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 overflow-hidden">
          {needsOfflineSetup ? <OfflineSetupFlow /> : <ChatWindow />}
        </main>
      </div>
      <SettingsModal />
      <OfflineManagementModal />
    </div>
  );
}
