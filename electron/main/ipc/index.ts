import { ipcMain } from "electron";
import { registerConversationHandlers } from "./conversations";
import { registerMessageHandlers } from "./messages";
import { registerSettingsHandlers } from "./settings";
import { registerOrHandlers } from "./or";
import { registerOfflineHandlers } from "./offline";

export function registerAllIpcHandlers(): void {
  registerConversationHandlers(ipcMain);
  registerMessageHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  registerOrHandlers(ipcMain);
  registerOfflineHandlers(ipcMain);
}
