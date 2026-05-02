import { useEffect, useRef } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar, SidebarErrorBoundary } from "./Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { OfflineSetupFlow } from "@/components/offline/OfflineSetupFlow";
import { OfflineManagementModal } from "@/components/offline/OfflineManagementModal";
import { useConversations } from "@/hooks/useConversations";
import { useOfflineState } from "@/hooks/useOfflineState";
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
  const activeOfflineModelId = useModeStore((s) => s.activeOfflineModelId);

  // Single source of truth for offline state — internally mirrors
  // `offlineState` and `activeOfflineModel` into useModeStore so legacy
  // subscribers (TitleBar, ChatHeader, EmptyState, Sidebar) keep working
  // without each component fetching the data itself.  Also subscribes to
  // OFFLINE_ACTIVE_MODEL_CHANGED so install / remove / set-active push
  // events refresh the cache without polling.
  useOfflineState();

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
    <div className="app-ambient flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <SidebarErrorBoundary>
          <Sidebar />
        </SidebarErrorBoundary>
        <main className="flex flex-1 overflow-hidden">
          {needsOfflineSetup ? <OfflineSetupFlow /> : <ChatWindow />}
        </main>
      </div>
      <SettingsModal />
      <OfflineManagementModal />
    </div>
  );
}
