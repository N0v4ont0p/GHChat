import type { IpcMain } from "electron";
import { getSettings, updateSettings, clearAllData, isDatabaseReady, getDbInitError } from "../services/database";
import { getApiKey, setApiKey, deleteApiKey } from "../services/keychain";
import { IPC } from "./channels";
import type { AppSettings } from "../../../src/types";

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.DB_STATUS, () => ({
    ready: isDatabaseReady(),
    error: getDbInitError(),
  }));

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    try {
      if (!isDatabaseReady()) {
        const why = getDbInitError() ?? "initialization failed (see app logs for details)";
        throw new Error(`Database not available: ${why}`);
      }
      return getSettings();
    } catch (err) {
      console.error("[ipc:settings:get] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_e, partial: Partial<AppSettings>) => {
    try {
      if (!isDatabaseReady()) {
        const why = getDbInitError() ?? "initialization failed (see app logs for details)";
        throw new Error(`Database not available: ${why}`);
      }
      return updateSettings(partial);
    } catch (err) {
      console.error("[ipc:settings:update] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.KEYCHAIN_GET, () => {
    try {
      return getApiKey();
    } catch (err) {
      console.error("[ipc:keychain:get] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.KEYCHAIN_SET, (_e, key: string) => {
    try {
      return setApiKey(key);
    } catch (err) {
      console.error("[ipc:keychain:set] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.KEYCHAIN_DELETE, () => {
    try {
      return deleteApiKey();
    } catch (err) {
      console.error("[ipc:keychain:delete] failed:", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.CLEAR_ALL_DATA, () => {
    try {
      if (!isDatabaseReady()) {
        const why = getDbInitError() ?? "initialization failed (see app logs for details)";
        throw new Error(`Database not available: ${why}`);
      }
      clearAllData();
      deleteApiKey();
      console.log("[ipc:data:clear-all] completed");
    } catch (err) {
      console.error("[ipc:data:clear-all] failed:", err);
      throw err;
    }
  });
}
