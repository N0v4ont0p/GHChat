import type { IpcMain } from "electron";
import { IPC } from "../../../src/types";
import type { AppMode, OfflineReadiness } from "../../../src/types";
import { modelRegistry } from "../services/offline";

// ── In-memory mode state ──────────────────────────────────────────────────────
// Mode and offline state are held in memory for now.
// A future migration (DB schema v3+) will persist them across launches.

let _currentMode: AppMode = "online";

let _offlineReadiness: OfflineReadiness = {
  state: modelRegistry.listInstalled().length > 0 ? "installed" : "not-installed",
};

export function registerOfflineHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.MODE_GET, (): AppMode => _currentMode);

  ipcMain.handle(IPC.MODE_SET, (_event, mode: AppMode): AppMode => {
    _currentMode = mode;
    return _currentMode;
  });

  ipcMain.handle(IPC.OFFLINE_STATUS, (): OfflineReadiness => _offlineReadiness);
}

/** Update the offline readiness state from within the main process. */
export function setOfflineReadiness(readiness: OfflineReadiness): void {
  _offlineReadiness = readiness;
}
