import type { IpcMain } from "electron";
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  isDatabaseReady,
  getDbInitError,
} from "../services/database";
import { IPC } from "./channels";

/**
 * Throw a descriptive error when the DB has not been successfully initialised.
 * This surfaces the real failure reason (e.g. missing better-sqlite3 binary)
 * rather than the generic "Database not initialized" from getDb().
 */
function requireDb(): void {
  if (!isDatabaseReady()) {
    const why = getDbInitError() ?? "initialization failed — run: pnpm run rebuild:native";
    throw new Error(`Database not available: ${why}`);
  }
}

export function registerConversationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.CONVERSATIONS_LIST, () => {
    try {
      requireDb();
      return listConversations();
    } catch (err) {
      console.error("[ipc:conversations:list] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CONVERSATIONS_CREATE, (_e, title?: string) => {
    try {
      requireDb();
      return createConversation(title);
    } catch (err) {
      console.error("[ipc:conversations:create] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CONVERSATIONS_RENAME, (_e, id: string, title: string) => {
    try {
      requireDb();
      return renameConversation(id, title);
    } catch (err) {
      console.error("[ipc:conversations:rename] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CONVERSATIONS_DELETE, (_e, id: string) => {
    try {
      requireDb();
      return deleteConversation(id);
    } catch (err) {
      console.error("[ipc:conversations:delete] failed:", err);
      throw err;
    }
  });
}
