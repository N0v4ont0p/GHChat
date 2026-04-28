import type { IpcMain, IpcMainEvent } from "electron";
import { shell } from "electron";
import { IPC } from "../../../src/types";
import type { AppMode, OfflineReadiness, OfflineSetupState } from "../../../src/types";
import {
  isDatabaseReady,
  getOfflineInstallation,
  upsertOfflineInstallation,
  listOfflineModels,
  getSettings,
  updateSettings,
} from "../services/database";
import { hardwareProfile } from "../services/offline/hardware-profile";
import { recommendationService } from "../services/offline/recommendation";
import { installManager } from "../services/offline/install-manager";
import { runtimeManager } from "../services/offline/runtime-manager";
import { storageService } from "../services/offline/storage";
import type { ChatMessage } from "../services/offline/runtime-manager";

// ── In-memory mode state ──────────────────────────────────────────────────────
// AppMode is persisted to the settings table so it survives restarts.
// It is loaded from the DB in registerOfflineHandlers() which is called
// after initDatabase() has completed.
//
// OfflineReadiness is DB-backed: the state machine position is loaded from
// `offline_installation` on first IPC call and persisted on every change.

let _currentMode: AppMode = "online";

/** Load the persisted app mode from settings; falls back to "online". */
function loadCurrentModeFromDb(): AppMode {
  if (!isDatabaseReady()) return "online";
  try {
    const settings = getSettings();
    const m = settings.currentMode;
    if (m === "online" || m === "offline" || m === "auto") return m;
  } catch {
    // ignore
  }
  return "online";
}

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
  // Restore the persisted mode choice on every startup.
  _currentMode = loadCurrentModeFromDb();

  ipcMain.handle(IPC.MODE_GET, (): AppMode => _currentMode);

  ipcMain.handle(IPC.MODE_SET, (_event, mode: AppMode): AppMode => {
    _currentMode = mode;
    // Persist so the choice survives restarts.
    if (isDatabaseReady()) {
      try {
        updateSettings({ currentMode: mode });
      } catch (err) {
        console.error("[offline] failed to persist mode to settings:", err);
      }
    }
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

  // ── Offline chat streaming ──────────────────────────────────────────────────

  const activeStreams = new Map<string, AbortController>();

  ipcMain.on(
    IPC.OFFLINE_CHAT_STREAM,
    async (
      event: IpcMainEvent,
      {
        requestId,
        modelId,
        messages,
      }: { requestId: string; modelId: string; messages: ChatMessage[] },
    ) => {
      const controller = new AbortController();
      activeStreams.set(requestId, controller);

      const send = (channel: string, payload: unknown) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel, payload);
        }
      };

      try {
        await runtimeManager.streamChat(
          modelId,
          messages,
          (token) => send(IPC.OFFLINE_CHAT_TOKEN, { requestId, token }),
          controller.signal,
        );
        send(IPC.OFFLINE_CHAT_END, { requestId });
      } catch (err) {
        if (controller.signal.aborted) {
          send(IPC.OFFLINE_CHAT_END, { requestId });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[offline] chat stream error:", err);

          // If the state was "installed" but the stream failed (e.g. binary
          // missing or runtime process crashed), run an integrity check.  When
          // files are actually gone we proactively transition to repair-needed
          // so the user sees the repair screen rather than a generic chat error.
          if (_offlineReadiness.state === "installed") {
            const check = installManager.verifyIntegrity();
            if (!check.ok) {
              console.warn(
                `[offline] runtime failure + integrity check failed: ${check.reason} — repair-needed`,
              );
              setOfflineReadiness({
                state: "repair-needed",
                message: check.reason ?? "Runtime failed and installation appears corrupt.",
              });
            }
          }

          send(IPC.OFFLINE_CHAT_ERROR, { requestId, error: message });
        }
      } finally {
        activeStreams.delete(requestId);
      }
    },
  );

  ipcMain.on(
    IPC.OFFLINE_CHAT_STOP,
    (_e, { requestId }: { requestId: string }) => {
      activeStreams.get(requestId)?.abort();
      activeStreams.delete(requestId);
    },
  );

  // ── Offline management ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.OFFLINE_GET_INFO, async () => {
    const installRoot = storageService.getOfflineRoot();
    const storageBytesUsed = storageService.computeUsedBytes();

    // Pull the first (and normally only) installed model record.
    const models = isDatabaseReady() ? listOfflineModels() : [];
    const model = models[0] ?? null;

    // Pull install timestamp from the installation record.
    const installation = isDatabaseReady() ? getOfflineInstallation() : null;

    // Determine whether the runtime subprocess is alive by checking its
    // internal state (the runtime manager tracks this without extra IPC).
    const isRuntimeRunning = runtimeManager.isRunning();

    return {
      modelId: model?.id ?? "",
      modelName: model?.name ?? "Gemma 4",
      variantLabel: model?.name ?? "Gemma 4",
      quantization: model?.quantization ?? "",
      sizeGb: model?.sizeGb ?? 0,
      storageBytesUsed,
      installPath: installRoot,
      installedAt: installation?.installedAt ?? null,
      isRuntimeRunning,
    };
  });

  ipcMain.handle(IPC.OFFLINE_REMOVE, async (): Promise<OfflineReadiness> => {
    try {
      // Stop the runtime before deleting its binary (required on Windows to
      // avoid file-in-use errors).
      await runtimeManager.stop();

      // Delete all offline assets and clear offline DB state.
      await installManager.removeAll();

      const removed: OfflineReadiness = { state: "not-installed" };
      setOfflineReadiness(removed);
      // Also switch mode back to online so the renderer leaves offline mode.
      _currentMode = "online";
      return removed;
    } catch (err) {
      console.error("[offline] remove failed:", err);
      return {
        state: "install-failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(IPC.OFFLINE_REVEAL_FOLDER, async (): Promise<void> => {
    const dir = storageService.getOfflineRoot();
    await shell.openPath(dir);
  });
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

/**
 * Run on every app startup (after DB and IPC handlers are ready).
 *
 * Detects two critical failure scenarios and automatically transitions the
 * offline state to "repair-needed" so the UI can guide the user:
 *
 * 1. `"installing"` on disk — the app was quit during an install.  The
 *    partial download/extract is left on disk; the state is marked as
 *    repair-needed so the user is prompted to re-install rather than
 *    silently being stuck in a phantom "installing" state forever.
 *
 * 2. `"installed"` on disk but files are missing/corrupt — the model .gguf
 *    or runtime binary was removed or is truncated (e.g. manual deletion,
 *    a failed download whose temp file was mistakenly renamed, or a disk
 *    error).  The user is shown the repair screen instead of a cryptic
 *    runtime start failure mid-chat.
 *
 * All other states (not-installed, recommendation-ready, install-failed,
 * repair-needed) are left unchanged — they already represent a known-broken
 * or pre-install condition.
 */
export function checkAndRepairOnStartup(): void {
  if (!isDatabaseReady()) return;

  const state = loadOfflineStateFromDb();

  if (state === "installing") {
    // The app was quit or crashed while an install was in progress.
    // The _installing lock was never cleared because the process exited.
    // Treat this as a partial install that needs repair.
    console.warn(
      "[offline] detected interrupted install on startup — transitioning to repair-needed",
    );
    setOfflineReadiness({
      state: "repair-needed",
      message: "Installation was interrupted. Please repair to continue.",
    });
    return;
  }

  if (state === "installed") {
    // Verify that the files the "installed" state relies on are still intact.
    const check = installManager.verifyIntegrity();
    if (!check.ok) {
      console.warn(
        `[offline] install integrity check failed on startup: ${check.reason} — transitioning to repair-needed`,
      );
      setOfflineReadiness({
        state: "repair-needed",
        message: check.reason ?? "Offline files appear to be missing or corrupt.",
      });
    }
  }
}
