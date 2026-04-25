import type { IpcMain } from "electron";
import {
  listMessages,
  appendMessage,
  deleteMessage,
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
    const why = getDbInitError() ?? "initialization failed (see app logs for details)";
    throw new Error(`Database not available: ${why}`);
  }
}

export function registerMessageHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.MESSAGES_LIST, (_e, conversationId: string) => {
    try {
      requireDb();
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
        requireDb();
        return appendMessage(payload);
      } catch (err) {
        console.error("[ipc:messages:append] failed:", err);
        throw err;
      }
    },
  );

  ipcMain.handle(IPC.MESSAGES_DELETE, (_e, id: string) => {
    try {
      requireDb();
      return deleteMessage(id);
    } catch (err) {
      console.error("[ipc:messages:delete] failed:", err);
      throw err;
    }
  });
}
