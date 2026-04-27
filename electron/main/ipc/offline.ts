import type { IpcMain } from "electron";
import { IPC } from "../../../src/types";
import type { AppMode, OfflineReadiness, OfflineSetupState } from "../../../src/types";
import {
  isDatabaseReady,
  getOfflineInstallation,
  upsertOfflineInstallation,
} from "../services/database";
import { hardwareProfile } from "../services/offline/hardware-profile";
import { recommendationService } from "../services/offline/recommendation";
import { installManager } from "../services/offline/install-manager";

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

  ipcMain.handle(IPC.OFFLINE_ANALYZE, async (): Promise<OfflineReadiness> => {
    try {
      const profile = await hardwareProfile.detect();
      const { offlineRecommendation } = recommendationService.recommend(profile);
      const readiness: OfflineReadiness = {
        state: "recommendation-ready",
        recommendation: offlineRecommendation,
      };
      setOfflineReadiness(readiness);
      return readiness;
    } catch (err) {
      console.error("[offline] analyze failed:", err);
      // Return a safe fallback so the renderer is never stuck.
      const fallback: OfflineReadiness = { state: "not-installed", message: String(err) };
      setOfflineReadiness(fallback);
      return fallback;
    }
  });

  ipcMain.handle(
    IPC.OFFLINE_INSTALL,
    async (event, modelId: string): Promise<OfflineReadiness> => {
      // Transition to "installing" immediately so status polls are correct.
      setOfflineReadiness({ state: "installing" });

      try {
        await installManager.install(modelId, (progress) => {
          // Push progress events to the renderer window that triggered the install.
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC.OFFLINE_INSTALL_PROGRESS, progress);
          }
        });

        const installed: OfflineReadiness = { state: "installed" };
        setOfflineReadiness(installed);
        return installed;
      } catch (err) {
        console.error("[offline] install failed:", err);
        const failed: OfflineReadiness = {
          state: "install-failed",
          message: err instanceof Error ? err.message : String(err),
        };
        setOfflineReadiness(failed);
        return failed;
      }
    },
  );
}

/**
 * Update the offline readiness state from within the main process and
 * persist it to the database so it survives app restarts.
 *
 * `installedAt` is written only on the first transition to "installed"
 * and is left untouched on subsequent calls so the original timestamp
 * is preserved.
 */
export function setOfflineReadiness(readiness: OfflineReadiness): void {
  _offlineReadiness = readiness;
  if (isDatabaseReady()) {
    try {
      const existing = getOfflineInstallation();
      upsertOfflineInstallation({
        state: readiness.state,
        // Only record installedAt the very first time we reach "installed".
        ...(readiness.state === "installed" && existing?.installedAt == null && {
          installedAt: Date.now(),
        }),
      });
    } catch (err) {
      console.error("[offline] failed to persist offline state to DB:", err);
    }
  }
}
