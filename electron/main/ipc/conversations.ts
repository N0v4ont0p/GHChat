import type { IpcMain } from "electron";
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  updateConversationModel,
  isDatabaseReady,
  getDbInitError,
} from "../services/database";
import type { AppMode } from "../../../src/types";
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

  ipcMain.handle(
    IPC.CONVERSATIONS_CREATE,
    (
      _e,
      payload?:
        | string
        | { title?: string; mode?: AppMode; modelId?: string | null },
    ) => {
      try {
        requireDb();
        // Backwards-compatible signature: an old caller may still pass a
        // bare string title.  New callers pass a structured object so the
        // conversation can be created already bound to a specific
        // mode/model (used after the resolver decides what a fresh chat
        // should run on).
        if (typeof payload === "string" || payload === undefined) {
          return createConversation(payload);
        }
        return createConversation(payload.title, {
          mode: payload.mode,
          modelId: payload.modelId,
        });
      } catch (err) {
        console.error("[ipc:conversations:create] failed:", err);
        throw err;
      }
    },
  );

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

  ipcMain.handle(
    IPC.CONVERSATIONS_UPDATE_MODEL,
    (
      _e,
      id: string,
      partial: { mode?: AppMode; modelId?: string | null },
    ) => {
      try {
        requireDb();
        updateConversationModel(id, partial);
      } catch (err) {
        console.error("[ipc:conversations:update-model] failed:", err);
        throw err;
      }
    },
  );
}
