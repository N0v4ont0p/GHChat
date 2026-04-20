import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { SettingsModal } from "@/components/settings/SettingsModal";

export function AppShell() {
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
