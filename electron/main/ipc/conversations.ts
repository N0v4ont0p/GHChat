import type { IpcMain } from "electron";
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
} from "../services/database";
import { IPC } from "./channels";

export function registerConversationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.CONVERSATIONS_LIST, () => listConversations());

  ipcMain.handle(IPC.CONVERSATIONS_CREATE, (_e, title?: string) =>
    createConversation(title),
  );

  ipcMain.handle(IPC.CONVERSATIONS_RENAME, (_e, id: string, title: string) =>
    renameConversation(id, title),
  );

  ipcMain.handle(IPC.CONVERSATIONS_DELETE, (_e, id: string) =>
    deleteConversation(id),
  );
}
