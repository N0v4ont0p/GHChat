import type { IpcMain, IpcMainEvent } from "electron";
import { shell } from "electron";
import { IPC } from "../../../src/types";
import type {
  AppMode,
  OfflineErrorCategory,
  OfflineFailureReason,
  OfflineReadiness,
  OfflineRecommendation,
  OfflineSetupState,
} from "../../../src/types";
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
import { offlineCatalog } from "../services/offline/catalog";
import { formatErrorChain } from "../services/offline/runtime-catalog";
import {
  RuntimeReleaseInstallError,
  AssetDownloadInstallError,
} from "../services/offline/install-manager";
import type { ChatMessage } from "../services/offline/runtime-manager";

/**
 * Number of consecutive **Gemma 4** install failures after which GHchat
 * stops looping the same install path and explicitly offers fallback
 * model choices (Gemma 3) for the user to opt into.
 *
 * Per product requirements: never auto-substitute a different model;
 * give the Gemma 4 path a fair shot first.
 */
const GEMMA4_FAILURE_THRESHOLD = 5;

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

/** Parse the JSON-encoded `last_failure_reasons` blob; defensive on bad data. */
function parseFailureReasons(raw: string | null): OfflineFailureReason[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is OfflineFailureReason =>
        r != null &&
        typeof r === "object" &&
        typeof (r as { at?: unknown }).at === "number" &&
        typeof (r as { modelId?: unknown }).modelId === "string" &&
        typeof (r as { category?: unknown }).category === "string" &&
        typeof (r as { message?: unknown }).message === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Build the renderer-facing `OfflineReadiness` payload from a partial
 * state and the persisted Gemma-4 failure tracking.
 *
 * Always populates `gemma4FailureCount`, `gemma4FailureThreshold`, and
 * `lastFailureReasons` so the UI can render the attempt counter and
 * recent-failure list at any time.  Populates `fallbackOptions` when the
 * state is `fallback-offered`.
 */
async function buildReadiness(
  base: OfflineReadiness,
): Promise<OfflineReadiness> {
  const row = isDatabaseReady() ? getOfflineInstallation() : null;
  const failureCount = row?.gemma4FailureCount ?? 0;
  const reasons = parseFailureReasons(row?.lastFailureReasons ?? null);

  const out: OfflineReadiness = {
    ...base,
    gemma4FailureCount: failureCount,
    gemma4FailureThreshold: GEMMA4_FAILURE_THRESHOLD,
    lastFailureReasons: reasons,
  };

  if (base.state === "fallback-offered" && !out.fallbackOptions) {
    try {
      const profile = await hardwareProfile.detect();
      out.fallbackOptions = recommendationService.recommendFallbacks(profile);
    } catch (err) {
      console.error("[offline] failed to compute fallback options:", err);
      out.fallbackOptions = [];
    }
  }

  return out;
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

  ipcMain.handle(IPC.OFFLINE_STATUS, async (): Promise<OfflineReadiness> => {
    // Re-read from DB on each status request so the renderer always sees
    // the latest persisted state (e.g. after an install step completes).
    if (isDatabaseReady()) {
      try {
        const row = getOfflineInstallation();
        if (row) {
          _offlineReadiness = { state: row.state as OfflineSetupState };
        }
      } catch {
        // Keep last known in-memory state on DB read failure.
      }
    }
    return buildReadiness(_offlineReadiness);
  });

  ipcMain.handle(IPC.OFFLINE_ANALYZE, async (): Promise<OfflineReadiness> => {
    try {
      const profile = await hardwareProfile.detect();

      // If the user has hit the failure threshold and we haven't reset it,
      // jump directly to fallback-offered instead of recommending Gemma 4
      // again — but still leave Gemma 4 listed under `recommendation` so
      // the UI can offer "Try Gemma 4 anyway" as an explicit reset action.
      const row = isDatabaseReady() ? getOfflineInstallation() : null;
      const failureCount = row?.gemma4FailureCount ?? 0;
      const { offlineRecommendation } = recommendationService.recommend(profile);

      if (failureCount >= GEMMA4_FAILURE_THRESHOLD) {
        const fallbackOptions = recommendationService.recommendFallbacks(profile);
        const readiness: OfflineReadiness = {
          state: "fallback-offered",
          recommendation: offlineRecommendation,
          fallbackOptions,
          message:
            `Gemma 4 install failed ${failureCount} times in a row. ` +
            `Please choose a fallback below or reset the counter to keep trying Gemma 4.`,
        };
        setOfflineReadiness(readiness);
        return buildReadiness(readiness);
      }

      const readiness: OfflineReadiness = {
        state: "recommendation-ready",
        recommendation: offlineRecommendation,
      };
      setOfflineReadiness(readiness);
      return buildReadiness(readiness);
    } catch (err) {
      console.error("[offline] analyze failed:", err);
      // Return a safe fallback so the renderer is never stuck.
      const fallback: OfflineReadiness = { state: "not-installed", message: String(err) };
      setOfflineReadiness(fallback);
      return buildReadiness(fallback);
    }
  });

  ipcMain.handle(
    IPC.OFFLINE_INSTALL,
    async (event, modelId: string): Promise<OfflineReadiness> => {
      // Look up the catalog entry up front so we know whether this is a
      // Gemma 4 install (which counts toward the failure threshold) or an
      // explicit user-chosen fallback (which does NOT count — by then the
      // user has already opted in to a different family).
      const entry = offlineCatalog.getById(modelId);
      const isGemma4Install = entry?.family === "gemma-4";

      // Transition to "installing" immediately so status polls are correct.
      setOfflineReadiness({ state: "installing" });

      try {
        await installManager.install(modelId, (progress) => {
          // Push progress events to the renderer window that triggered the install.
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC.OFFLINE_INSTALL_PROGRESS, progress);
          }
        });

        // Successful install — reset the Gemma 4 failure counter so future
        // attempts start fresh.  We reset on ANY successful install (even
        // a fallback) so the user is never left with stale failure state.
        if (isDatabaseReady()) {
          try {
            upsertOfflineInstallation({
              gemma4FailureCount: 0,
              lastFailureReasons: null,
            });
          } catch (err) {
            console.warn("[offline] failed to reset failure counter:", err);
          }
        }

        const installed: OfflineReadiness = { state: "installed" };
        setOfflineReadiness(installed);
        return buildReadiness(installed);
      } catch (err) {
        // Render the full cause chain (top-level message + every nested
        // `.cause`) so technical details are available for the renderer's
        // collapsible "Technical details" section.  The chain walker is
        // defensive and safe for non-Error values.
        const causeChain = formatErrorChain(err);
        console.error("[offline] install failed:\n  " + causeChain);

        // Map structured install errors to a coarse category so the UI can
        // render an actionable message instead of raw network error text.
        // Falls back to "install" for non-network failures (disk space,
        // checksum mismatch, extraction error, etc.).
        let errorCategory: OfflineErrorCategory = "install";
        let errorDetails = causeChain;
        if (err instanceof RuntimeReleaseInstallError) {
          errorCategory = err.category;
        } else if (err instanceof AssetDownloadInstallError) {
          errorCategory = err.category;
          // Prefer the pre-rendered diagnostic block (purpose/host/redirects/
          // headers/body) over the bare error chain so the renderer's
          // "Technical details" section is immediately useful.
          errorDetails = `${err.causeChain}\n\n${causeChain}`;
        }
        const topMessage = err instanceof Error ? err.message : String(err);

        // Record failure metadata so the UI can show the attempt counter
        // and recent-failure list — but ONLY count failures of Gemma 4
        // installs.  An explicit user-chosen fallback that fails does
        // not push the user further toward "give up on Gemma 4".
        let failureCount = 0;
        let recordedReasons: OfflineFailureReason[] = [];
        if (isGemma4Install && isDatabaseReady()) {
          try {
            const existing = getOfflineInstallation();
            failureCount = (existing?.gemma4FailureCount ?? 0) + 1;
            recordedReasons = parseFailureReasons(existing?.lastFailureReasons ?? null);
            recordedReasons.push({
              at: Date.now(),
              modelId,
              category: errorCategory,
              message: topMessage,
            });
            // Cap history at the failure threshold so the list stays bounded.
            if (recordedReasons.length > GEMMA4_FAILURE_THRESHOLD) {
              recordedReasons = recordedReasons.slice(-GEMMA4_FAILURE_THRESHOLD);
            }
            upsertOfflineInstallation({
              gemma4FailureCount: failureCount,
              lastFailureReasons: JSON.stringify(recordedReasons),
            });
          } catch (dbErr) {
            console.warn("[offline] failed to persist failure metadata:", dbErr);
          }
        } else if (isDatabaseReady()) {
          // Read existing counter so the response payload is accurate even
          // when the failure didn't itself bump the counter (fallback install).
          try {
            const existing = getOfflineInstallation();
            failureCount = existing?.gemma4FailureCount ?? 0;
            recordedReasons = parseFailureReasons(existing?.lastFailureReasons ?? null);
          } catch {
            /* best-effort */
          }
        }

        // Decide whether to surface explicit fallback options.  Only
        // happens for Gemma 4 failures that just crossed the threshold.
        const shouldOfferFallback =
          isGemma4Install && failureCount >= GEMMA4_FAILURE_THRESHOLD;
        const nextState: OfflineSetupState = shouldOfferFallback
          ? "fallback-offered"
          : "install-failed";

        let fallbackOptions: OfflineRecommendation[] | undefined;
        if (shouldOfferFallback) {
          try {
            const profile = await hardwareProfile.detect();
            fallbackOptions = recommendationService.recommendFallbacks(profile);
          } catch (profErr) {
            console.error("[offline] failed to compute fallback options:", profErr);
            fallbackOptions = [];
          }
        }

        const failed: OfflineReadiness = {
          state: nextState,
          message: topMessage,
          errorCategory,
          errorDetails,
          ...(fallbackOptions !== undefined && { fallbackOptions }),
        };
        setOfflineReadiness(failed);
        return buildReadiness(failed);
      }
    },
  );

  // Reset the Gemma 4 failure counter so the user can keep trying Gemma 4
  // even after the threshold has been reached.  This is the explicit
  // counterpart to choosing a fallback option — the user is telling us
  // "don't give up on Gemma 4 yet".
  ipcMain.handle(IPC.OFFLINE_RESET_FAILURES, async (): Promise<OfflineReadiness> => {
    if (isDatabaseReady()) {
      try {
        upsertOfflineInstallation({
          gemma4FailureCount: 0,
          lastFailureReasons: null,
        });
      } catch (err) {
        console.error("[offline] failed to reset Gemma 4 failure counter:", err);
      }
    }
    const reset: OfflineReadiness = { state: "not-installed" };
    setOfflineReadiness(reset);
    return buildReadiness(reset);
  });

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

      // Delete all offline assets and clear offline DB state (this also
      // resets the Gemma 4 failure counter via clearOfflineData()).
      await installManager.removeAll();

      const removed: OfflineReadiness = { state: "not-installed" };
      setOfflineReadiness(removed);
      // Also switch mode back to online so the renderer leaves offline mode.
      _currentMode = "online";
      return buildReadiness(removed);
    } catch (err) {
      console.error("[offline] remove failed:", err);
      return buildReadiness({
        state: "install-failed",
        message: err instanceof Error ? err.message : String(err),
      });
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
