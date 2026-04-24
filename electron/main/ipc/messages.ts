import type { IpcMain } from "electron";
import { listMessages, appendMessage, deleteMessage } from "../services/database";
import { IPC } from "./channels";

export function registerMessageHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.MESSAGES_LIST, (_e, conversationId: string) => {
    try {
      return listMessages(conversationId);
    } catch (err) {
      console.error("[ipc:messages:list] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(
    IPC.MESSAGES_APPEND,
    (
      _e,
      payload: { conversationId: string; role: string; content: string },
    ) => {
      try {
        return appendMessage(payload);
      } catch (err) {
        console.error("[ipc:messages:append] failed:", err);
        throw err;
      }
    },
  );

  ipcMain.handle(IPC.MESSAGES_DELETE, (_e, id: string) => {
    try {
      return deleteMessage(id);
    } catch (err) {
      console.error("[ipc:messages:delete] failed:", err);
      throw err;
    }
  });
}
