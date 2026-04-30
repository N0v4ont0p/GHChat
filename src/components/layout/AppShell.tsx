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
  const setActiveOfflineModel = useModeStore((s) => s.setActiveOfflineModel);
  const activeOfflineModelId = useModeStore((s) => s.activeOfflineModelId);

  // Sync offline readiness + active model from the main process on mount.
  // Re-runs whenever the offline setup state transitions so a fresh
  // install (or model switch) is reflected without a full app reload.
  useEffect(() => {
    ipc.getOfflineStatus()
      .then((r) => setOfflineState(r.state))
      .catch(() => {
        console.debug("[AppShell] offline status unavailable, using default");
      });
    // Sync the currently active offline model so chat requests use it.
    ipc.getActiveOfflineModel()
      .then((info) => setActiveOfflineModel(info))
      .catch(() => {
        console.debug("[AppShell] active offline model unavailable");
      });
  }, [setOfflineState, setActiveOfflineModel, offlineState]);

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
  // Only "offline" mode explicitly requests offline — when not installed it
  // routes through the setup flow.  "auto" mode falls back to online silently
  // when offline is not ready, so it never forces the setup flow.
  //
  // We also force the setup flow when state==="installed" but no usable
  // active model is present — this happens if every installed model was
  // removed externally, or if the DB ended up in an inconsistent state
  // that the startup repair couldn't recover.  Without this, the chat
  // window would render and the user's first message would fail with a
  // confusing "model not installed" error.
  const needsOfflineSetup =
    currentMode === "offline" &&
    (offlineState !== "installed" || !activeOfflineModelId);

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
