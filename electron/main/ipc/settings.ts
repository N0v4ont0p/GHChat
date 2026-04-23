import type { IpcMain } from "electron";
import { getSettings, updateSettings, clearAllData } from "../services/database";
import { getApiKey, setApiKey, deleteApiKey } from "../services/keychain";
import { IPC } from "./channels";
import type { AppSettings } from "../../../src/types";

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_e, partial: Partial<AppSettings>) =>
    updateSettings(partial),
  );

  ipcMain.handle(IPC.KEYCHAIN_GET, () => getApiKey());

  ipcMain.handle(IPC.KEYCHAIN_SET, (_e, key: string) => setApiKey(key));

  ipcMain.handle(IPC.KEYCHAIN_DELETE, () => deleteApiKey());

  ipcMain.handle(IPC.CLEAR_ALL_DATA, () => {
    clearAllData();
    deleteApiKey();
  });
}
