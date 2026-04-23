import { useEffect, useRef } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useConversations } from "@/hooks/useConversations";
import { useChatStore } from "@/stores/chat-store";
import { ipc } from "@/lib/ipc";

export function AppShell() {
  const { data: conversations } = useConversations();
  const { selectedConversationId, setSelectedConversationId } = useChatStore();
  const autoSelectedRef = useRef(false);

  // Auto-select the most recent conversation when conversations load
  // and none is currently selected (e.g. on launch without a persisted lastConversationId)
  useEffect(() => {
    if (!autoSelectedRef.current && !selectedConversationId && conversations && conversations.length > 0) {
      autoSelectedRef.current = true;
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId, setSelectedConversationId]);

  // Persist the active conversation so it can be restored on next launch
  useEffect(() => {
    if (selectedConversationId) {
      void ipc.updateSettings({ lastConversationId: selectedConversationId });
    }
  }, [selectedConversationId]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 overflow-hidden">
          <ChatWindow />
        </main>
      </div>
      <SettingsModal />
    </div>
  );
}
