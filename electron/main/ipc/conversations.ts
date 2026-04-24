import type { IpcMain } from "electron";
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
} from "../services/database";
import { IPC } from "./channels";

export function registerConversationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.CONVERSATIONS_LIST, () => {
    try {
      return listConversations();
    } catch (err) {
      console.error("[ipc:conversations:list] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CONVERSATIONS_CREATE, (_e, title?: string) => {
    try {
      return createConversation(title);
    } catch (err) {
      console.error("[ipc:conversations:create] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CONVERSATIONS_RENAME, (_e, id: string, title: string) => {
    try {
      return renameConversation(id, title);
    } catch (err) {
      console.error("[ipc:conversations:rename] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CONVERSATIONS_DELETE, (_e, id: string) => {
    try {
      return deleteConversation(id);
    } catch (err) {
      console.error("[ipc:conversations:delete] failed:", err);
      throw err;
    }
  });
}
