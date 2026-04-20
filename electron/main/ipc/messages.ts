import type { IpcMain } from "electron";
import { listMessages, appendMessage } from "../services/database";
import { IPC } from "./channels";

export function registerMessageHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.MESSAGES_LIST, (_e, conversationId: string) =>
    listMessages(conversationId),
  );

  ipcMain.handle(
    IPC.MESSAGES_APPEND,
    (
      _e,
      payload: { conversationId: string; role: string; content: string },
    ) => appendMessage(payload),
  );
}
