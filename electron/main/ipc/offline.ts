import type { IpcMain } from "electron";
import { IPC } from "../../../src/types";
import type { AppMode, OfflineReadiness, OfflineSetupState } from "../../../src/types";
import {
  isDatabaseReady,
  getOfflineInstallation,
  upsertOfflineInstallation,
} from "../services/database";

// ── In-memory mode state ──────────────────────────────────────────────────────
// AppMode is kept in-memory (it resets to "online" on restart — future work
// could persist it to the settings table).
//
// OfflineReadiness is DB-backed: the state machine position is loaded from
// `offline_installation` on first IPC call and persisted on every change.

let _currentMode: AppMode = "online";

/** Load the current offline state from the DB; falls back to "not-installed". */
function loadOfflineStateFromDb(): OfflineSetupState {
  if (!isDatabaseReady()) return "not-installed";
  try {
    const row = getOfflineInstallation();
    return (row?.state ?? "not-installed") as OfflineSetupState;
  } catch {
    return "not-installed";
  }
}

let _offlineReadiness: OfflineReadiness = {
  state: loadOfflineStateFromDb(),
};

export function registerOfflineHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.MODE_GET, (): AppMode => _currentMode);

  ipcMain.handle(IPC.MODE_SET, (_event, mode: AppMode): AppMode => {
    _currentMode = mode;
    return _currentMode;
  });

  ipcMain.handle(IPC.OFFLINE_STATUS, (): OfflineReadiness => {
    // Re-read from DB on each status request so the renderer always sees
    // the latest persisted state (e.g. after an install step completes).
    if (isDatabaseReady()) {
      try {
        const row = getOfflineInstallation();
        if (row) _offlineReadiness = { state: row.state as OfflineSetupState };
      } catch {
        // Keep last known in-memory state on DB read failure.
      }
    }
    return _offlineReadiness;
  });
}

/**
 * Update the offline readiness state from within the main process and
 * persist it to the database so it survives app restarts.
 */
export function setOfflineReadiness(readiness: OfflineReadiness): void {
  _offlineReadiness = readiness;
  if (isDatabaseReady()) {
    try {
      upsertOfflineInstallation({
        state: readiness.state,
        ...(readiness.state === "installed" && { installedAt: Date.now() }),
      });
    } catch (err) {
      console.error("[offline] failed to persist offline state to DB:", err);
    }
  }
}

