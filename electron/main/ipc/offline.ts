import type { IpcMain, IpcMainEvent } from "electron";
import { dirname, join } from "path";
import { existsSync, statSync, rmSync, mkdirSync, readdirSync, lstatSync } from "fs";
import { shell, BrowserWindow } from "electron";
import { IPC } from "../../../src/types";
import type {
  AppMode,
  OfflineCatalogEntrySummary,
  OfflineErrorCategory,
  OfflineFailureReason,
  OfflineHardwareProfileSnapshot,
  OfflineModelSummary,
  OfflinePerformancePreset,
  OfflineReadiness,
  OfflineRecommendation,
  OfflineSettings,
  OfflineSetupState,
} from "../../../src/types";
import {
  isDatabaseReady,
  getOfflineInstallation,
  upsertOfflineInstallation,
  listOfflineModels,
  getSettings,
  updateSettings,
  getOfflineSettings,
  updateOfflineSettings,
} from "../services/database";
import { hardwareProfile } from "../services/offline/hardware-profile";
import { recommendationService } from "../services/offline/recommendation";
import { installManager } from "../services/offline/install-manager";
import { runtimeManager, getRuntimeFailureLogPath } from "../services/offline/runtime-manager";
import { modelRegistry } from "../services/offline/model-registry";
import { storageService } from "../services/offline/storage";
import { offlineCatalog } from "../services/offline/catalog";
import { formatErrorChain } from "../services/offline/runtime-catalog";
import {
  RuntimeReleaseInstallError,
  AssetDownloadInstallError,
} from "../services/offline/install-manager";
import type { ChatMessage } from "../services/offline/runtime-manager";
import * as os from "os";

// ── Offline settings: presets & defaults ──────────────────────────────────────

/**
 * Default cancel-timeout: how long we wait after the user clicks Stop
 * before hard-restarting the runtime.  Picked so that on Apple Silicon
 * generating one token of Gemma 4 (~150–800 ms typical) has time to
 * complete cleanly, while not feeling indefinite to the user.
 *
 * Cross-platform note: Linux/Windows builds of llama.cpp behave the
 * same way for HTTP cancellation — they detect a closed socket on the
 * next emitted token and abort generation.  The 1500 ms ceiling is a
 * safety net for the worst case (a model mid-batch on slow hardware);
 * users on faster machines will rarely hit the timeout because the
 * fetch unwinds first.  Users on very slow machines can raise this
 * value via the Offline settings tab.
 */
const DEFAULT_CANCEL_TIMEOUT_MS = 1500;

/**
 * Resolve a complete OfflineSettings record from the persisted partial,
 * filling in `null` fields with values derived from the active
 * performance preset.  This is the single source of truth for what the
 * runtime manager and chat handler should actually use.
 */
function resolveOfflineSettings(): Required<{
  [K in keyof OfflineSettings]: NonNullable<OfflineSettings[K]>;
}> {
  const stored = isDatabaseReady() ? getOfflineSettings() : null;
  const preset = (stored?.performancePreset ?? "balanced") as OfflinePerformancePreset;

  const presetDefaults: Record<OfflinePerformancePreset, {
    contextSize: number;
    maxTokens: number;
    temperature: number;
    topP: number;
    threads: number;
  }> = {
    speed: {
      contextSize: 2048,
      maxTokens: 512,
      temperature: 0.7,
      topP: 0.9,
      threads: Math.max(1, Math.floor(os.cpus().length * 0.75)),
    },
    balanced: {
      contextSize: 4096,
      maxTokens: 1024,
      temperature: 0.7,
      topP: 0.9,
      threads: Math.max(1, Math.floor(os.cpus().length / 2)),
    },
    quality: {
      contextSize: 8192,
      maxTokens: 2048,
      temperature: 0.6,
      topP: 0.9,
      threads: Math.max(1, Math.floor(os.cpus().length / 2)),
    },
    custom: {
      contextSize: 4096,
      maxTokens: 1024,
      temperature: 0.7,
      topP: 0.9,
      threads: Math.max(1, Math.floor(os.cpus().length / 2)),
    },
  };

  const d = presetDefaults[preset] ?? presetDefaults.balanced;
  return {
    defaultModelId: stored?.defaultModelId ?? "",
    performancePreset: preset,
    contextSize: stored?.contextSize ?? d.contextSize,
    maxTokens: stored?.maxTokens ?? d.maxTokens,
    temperature: stored?.temperature ?? d.temperature,
    topP: stored?.topP ?? d.topP,
    threads: stored?.threads ?? d.threads,
    cancelTimeoutMs: stored?.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS,
    streamingEnabled: stored?.streamingEnabled ?? true,
  };
}

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
        //
        // Also promote the just-installed model to active so the runtime
        // and new chats use it.  Per product requirements: any installed
        // model becomes the active default unless the user has explicitly
        // selected something else via the management UI.  This keeps the
        // installed-model state, active-model setting, and new-chat
        // default in sync after a setup-flow install.
        if (isDatabaseReady()) {
          try {
            upsertOfflineInstallation({
              gemma4FailureCount: 0,
              lastFailureReasons: null,
              activeModelId: modelId,
            });
            broadcastActiveModelChanged(modelId);
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

  /**
   * Map of in-flight offline chat requests → their AbortController.
   * Removed when the stream completes naturally OR when the user cancels.
   */
  const activeStreams = new Map<string, AbortController>();
  /**
   * Set of requestIds that have been cancelled by the user.  The stream
   * handler checks this to skip sending a duplicate OFFLINE_CHAT_END (the
   * stop handler sends one immediately so the UI is responsive).
   */
  const cancelledRequests = new Set<string>();

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
      // Validate required args before kicking off any runtime work so a
      // malformed payload from the renderer surfaces as a clean
      // OFFLINE_CHAT_ERROR instead of crashing inside child_process.spawn
      // or in the IPC bridge with the cryptic "conversion failure from
      // undefined" message.
      const missingArgs: string[] = [];
      if (typeof requestId !== "string" || requestId.length === 0) missingArgs.push("requestId");
      if (typeof modelId !== "string" || modelId.length === 0) missingArgs.push("modelId");
      if (!Array.isArray(messages) || messages.length === 0) missingArgs.push("messages");
      if (missingArgs.length > 0) {
        const errorMsg =
          `[offline] OFFLINE_CHAT_STREAM rejected: missing required args ` +
          `[${missingArgs.join(", ")}] ` +
          `(requestId=${requestId ?? "<undef>"}, modelId=${modelId ?? "<undef>"}, ` +
          `messageCount=${Array.isArray(messages) ? messages.length : "<not-array>"})`;
        console.error(errorMsg);
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.OFFLINE_CHAT_ERROR, {
            requestId: requestId ?? "unknown",
            error: errorMsg,
          });
          // Always emit END so the renderer's streaming state is reset.
          event.sender.send(IPC.OFFLINE_CHAT_END, { requestId: requestId ?? "unknown" });
        }
        return;
      }

      const controller = new AbortController();
      activeStreams.set(requestId, controller);

      const send = (channel: string, payload: unknown) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel, payload);
        }
      };

      // Coarse lifecycle hook — gated by `cancelledRequests` so a user-cancel
      // mid-boot doesn't leak a stale "loading model" label after the END
      // event has already fired.  Phase events are advisory; the renderer
      // is responsible for ignoring late events for a request it cancelled.
      let firstTokenSeen = false;
      const emitPhase = (
        phase:
          | "runtime-starting"
          | "loading-model"
          | "processing-prompt"
          | "generating"
          | "checking-model"
          | "checking-binary"
          | "preparing-config"
          | "launching-process"
          | "waiting-for-server"
          | "warming-up",
      ) => {
        if (cancelledRequests.has(requestId)) return;
        send(IPC.OFFLINE_CHAT_PHASE, { requestId, phase });
      };

      // Forward fine-grained runtime startup phases coming out of
      // runtimeManager.start() to BOTH the per-request OFFLINE_CHAT_PHASE
      // channel (so the streaming indicator updates) AND the broadcast
      // OFFLINE_RUNTIME_PHASE channel (so the Settings → Runtime status
      // panel updates in lockstep, even though it didn't initiate the
      // start).  `ready` / `failed` are terminal — we forward them on
      // OFFLINE_RUNTIME_PHASE only; the chat indicator advances on its
      // own milestones (processing-prompt / generating / END / ERROR).
      const handleRuntimePhase = (
        phase: import("../services/offline/runtime-manager").RuntimeStartupPhase,
        detail?: string,
        failure?: import("../services/offline/runtime-manager").RuntimeStartupFailureDetails,
      ) => {
        broadcastRuntimePhase({ phase, modelId, detail, failure, requestId });
        if (cancelledRequests.has(requestId)) return;
        if (
          phase === "checking-model" ||
          phase === "checking-binary" ||
          phase === "preparing-config" ||
          phase === "launching-process" ||
          phase === "waiting-for-server" ||
          phase === "warming-up"
        ) {
          emitPhase(phase);
        }
      };

      // Resolve the user's runtime knobs once per request.
      const settings = resolveOfflineSettings();

      // Decide whether the upcoming start() is a cold spawn (label
      // "starting runtime") or a warm request against an already-running
      // server.  When the runtime is up but on a different model, label
      // "loading model" instead so the user knows the wait is real.
      const sameModelRunning =
        runtimeManager.isRunning() &&
        runtimeManager.getCurrentModelId() === modelId;
      if (!runtimeManager.isRunning()) {
        emitPhase("runtime-starting");
      } else if (!sameModelRunning) {
        emitPhase("loading-model");
      } else {
        emitPhase("processing-prompt");
      }

      try {
        await runtimeManager.streamChat(
          modelId,
          messages,
          (token) => {
            // First token marks the transition to "generating".  Emit
            // exactly once per request so the renderer doesn't churn.
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              emitPhase("generating");
            }
            // Drop tokens for cancelled requests so the renderer never
            // sees post-stop content even if llama.cpp emits a few more
            // batches before the abort propagates.
            if (cancelledRequests.has(requestId)) return;
            send(IPC.OFFLINE_CHAT_TOKEN, { requestId, token });
          },
          controller.signal,
          {
            spawn: {
              contextSize: settings.contextSize,
              threads: settings.threads,
            },
            generation: {
              temperature: settings.temperature,
              topP: settings.topP,
              maxTokens: settings.maxTokens,
            },
            // After the runtime is healthy and we've POSTed the request
            // body, we're waiting on the model to ingest the prompt.
            onPromptSent: () => {
              if (!firstTokenSeen) emitPhase("processing-prompt");
            },
            // Forward fine-grained startup phases (checking-model →
            // launching-process → warming-up → ready) so the chat
            // indicator and Settings panel both reflect what
            // llama-server is actually doing instead of the previous
            // single "starting runtime…" placeholder.
            onRuntimePhase: handleRuntimePhase,
          },
        );
        // Only send END when the stop handler hasn't already done so.
        if (!cancelledRequests.has(requestId)) {
          send(IPC.OFFLINE_CHAT_END, { requestId });
        }
      } catch (err) {
        if (controller.signal.aborted || cancelledRequests.has(requestId)) {
          // Cancel path — stop handler already sent OFFLINE_CHAT_END.
          if (!cancelledRequests.has(requestId)) {
            send(IPC.OFFLINE_CHAT_END, { requestId });
          }
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
        cancelledRequests.delete(requestId);
      }
    },
  );

  ipcMain.on(
    IPC.OFFLINE_CHAT_STOP,
    (event: IpcMainEvent, { requestId }: { requestId: string }) => {
      const controller = activeStreams.get(requestId);
      if (!controller) return;

      // Mark cancelled BEFORE aborting so any in-flight token callbacks
      // racing with the abort are dropped.
      cancelledRequests.add(requestId);
      controller.abort();

      // Tell the renderer the stream has ended *immediately*.  We don't
      // wait for the fetch to unwind — on slow models (e.g. M2 + Gemma
      // 4 31B) the fetch reader can be blocked for seconds on the next
      // SSE chunk.  This makes the UI feel instantly responsive.
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.OFFLINE_CHAT_END, { requestId });
      }

      // Cancel-watchdog: if the runtime is still busy after the
      // configured timeout, hard-restart it so the next request lands on
      // a clean slate.  This is rare in practice (HTTP TCP close usually
      // makes llama.cpp abort within one token), but is the safety net
      // that guarantees Stop is always responsive.
      const settings = resolveOfflineSettings();
      const timeoutMs = settings.cancelTimeoutMs;
      if (timeoutMs > 0) {
        setTimeout(() => {
          // If the abort already drained, activeStreams no longer
          // contains this requestId — nothing to do.
          if (!activeStreams.has(requestId)) return;
          console.warn(
            `[offline] stop watchdog: stream ${requestId} did not unwind ` +
              `within ${timeoutMs}ms — force-restarting runtime`,
          );
          // Force-stop the runtime; the next chat request will lazy-start it.
          void runtimeManager.stop({ force: true });
        }, timeoutMs);
      }
    },
  );

  // ── Offline-specific settings ───────────────────────────────────────────────

  ipcMain.handle(IPC.OFFLINE_SETTINGS_GET, async (): Promise<OfflineSettings> => {
    if (!isDatabaseReady()) {
      // Return safe defaults so the renderer never breaks even if the DB
      // hasn't initialized yet.
      return {
        defaultModelId: null,
        performancePreset: "balanced",
        contextSize: null,
        maxTokens: null,
        temperature: null,
        topP: null,
        threads: null,
        cancelTimeoutMs: null,
        streamingEnabled: true,
      };
    }
    const r = getOfflineSettings();
    return {
      defaultModelId: r.defaultModelId,
      performancePreset: r.performancePreset,
      contextSize: r.contextSize,
      maxTokens: r.maxTokens,
      temperature: r.temperature,
      topP: r.topP,
      threads: r.threads,
      cancelTimeoutMs: r.cancelTimeoutMs,
      streamingEnabled: r.streamingEnabled,
    };
  });

  ipcMain.handle(
    IPC.OFFLINE_SETTINGS_UPDATE,
    async (_e, partial: Partial<OfflineSettings>): Promise<OfflineSettings> => {
      // Any direct slider change implicitly switches the preset to
      // "custom" so the preset label stays honest.  The renderer can
      // still send a non-null performancePreset to take a different
      // preset path (which then resets the per-knob overrides to null).
      const presetSwitch = partial.performancePreset !== undefined;
      const knobChanged =
        partial.contextSize !== undefined ||
        partial.maxTokens !== undefined ||
        partial.temperature !== undefined ||
        partial.topP !== undefined ||
        partial.threads !== undefined;
      const effective: Partial<OfflineSettings> = { ...partial };
      if (knobChanged && !presetSwitch) {
        effective.performancePreset = "custom";
      }
      // If the user picked a non-custom preset, clear the per-knob
      // overrides so the preset's defaults take effect.
      if (
        presetSwitch &&
        partial.performancePreset !== "custom" &&
        partial.performancePreset !== undefined
      ) {
        effective.contextSize = null;
        effective.maxTokens = null;
        effective.temperature = null;
        effective.topP = null;
        effective.threads = null;
      }
      const r = updateOfflineSettings(effective);
      // Stop the runtime so the next chat request picks up the new
      // ctx-size / threads.  Cheap: a no-op if not running.
      if (
        partial.contextSize !== undefined ||
        partial.threads !== undefined ||
        presetSwitch
      ) {
        void runtimeManager.stop();
      }
      return {
        defaultModelId: r.defaultModelId,
        performancePreset: r.performancePreset,
        contextSize: r.contextSize,
        maxTokens: r.maxTokens,
        temperature: r.temperature,
        topP: r.topP,
        threads: r.threads,
        cancelTimeoutMs: r.cancelTimeoutMs,
        streamingEnabled: r.streamingEnabled,
      };
    },
  );

  ipcMain.handle(IPC.OFFLINE_SETTINGS_RESET, async (): Promise<OfflineSettings> => {
    const r = updateOfflineSettings({
      performancePreset: "balanced",
      contextSize: null,
      maxTokens: null,
      temperature: null,
      topP: null,
      threads: null,
      cancelTimeoutMs: null,
      streamingEnabled: true,
    });
    void runtimeManager.stop();
    return {
      defaultModelId: r.defaultModelId,
      performancePreset: r.performancePreset,
      contextSize: r.contextSize,
      maxTokens: r.maxTokens,
      temperature: r.temperature,
      topP: r.topP,
      threads: r.threads,
      cancelTimeoutMs: r.cancelTimeoutMs,
      streamingEnabled: r.streamingEnabled,
    };
  });

  ipcMain.handle(
    IPC.OFFLINE_GET_HARDWARE_PROFILE,
    async (): Promise<OfflineHardwareProfileSnapshot | null> => {
      try {
        const p = await hardwareProfile.detect();
        // Tier heuristics — calibrated to match the catalog tiers used
        // by the recommendation engine.  Apple Silicon gets a one-tier
        // bump because of unified memory + Metal acceleration.
        let tier: OfflineHardwareProfileSnapshot["tier"] = "low";
        if (p.totalRamGb >= 48) tier = "ultra";
        else if (p.totalRamGb >= 16) tier = "high";
        else if (p.totalRamGb >= 8) tier = "mid";
        if (p.isAppleSilicon && tier === "mid") tier = "high";
        return {
          totalRamGb: p.totalRamGb,
          freeDiskGb: p.freeDiskGb,
          cpuCores: p.cpuCores,
          platform: p.platform,
          arch: p.arch,
          isAppleSilicon: p.isAppleSilicon,
          tier,
        };
      } catch (err) {
        console.warn("[offline] get-hardware-profile failed:", err);
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_RUNTIME_STOP,
    async (): Promise<{ ok: boolean }> => {
      try {
        await runtimeManager.stop();
        return { ok: true };
      } catch (err) {
        console.warn("[offline] runtime stop failed:", err);
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_RUNTIME_FORCE_STOP,
    async (): Promise<{ ok: boolean }> => {
      try {
        await runtimeManager.stop({ force: true });
        return { ok: true };
      } catch (err) {
        console.warn("[offline] runtime force-stop failed:", err);
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_RUNTIME_RESTART,
    async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        const activeId = resolveActiveModelId();
        console.log(
          `[offline] OFFLINE_RUNTIME_RESTART invoked ` +
            `(activeModelId=${activeId ?? "<none>"}, ` +
            `installedCount=${modelRegistry.listInstalled().length})`,
        );
        if (!activeId) {
          const error =
            "No active offline model to restart. Install or activate a model first.";
          console.warn(`[offline] OFFLINE_RUNTIME_RESTART aborted: ${error}`);
          // Surface the failure as a runtime-phase event so the
          // Settings panel's progress trail shows *which* step failed
          // instead of just toast-erroring.
          broadcastRuntimePhase({
            phase: "failed",
            modelId: null,
            detail: error,
            requestId: null,
          });
          return { ok: false, error };
        }
        // Stop first so start() spawns a fresh process even when the
        // current spawn options match — restart must always recycle.
        await runtimeManager.stop();
        const settings = resolveOfflineSettings();
        await runtimeManager.start(
          activeId,
          {
            contextSize: settings.contextSize,
            threads: settings.threads,
          },
          (phase, detail, failure) => {
            broadcastRuntimePhase({
              phase,
              modelId: activeId,
              detail,
              failure,
              requestId: null,
            });
          },
        );
        return { ok: true };
      } catch (err) {
        console.warn("[offline] runtime restart failed:", err);
        const error = err instanceof Error ? err.message : String(err);
        // start() already broadcast its own "failed" phase with the
        // step-specific detail; re-broadcast here only as a safety
        // net for the rare path where the throw originated outside
        // start() (e.g. resolveOfflineSettings).
        broadcastRuntimePhase({
          phase: "failed",
          modelId: resolveActiveModelId(),
          detail: error,
          requestId: null,
        });
        return {
          ok: false,
          error,
        };
      }
    },
  );

  // ── Offline management ──────────────────────────────────────────────────────

  /**
   * Resolve which model the user-facing OfflineInfo / runtime should treat
   * as active.  Preference order:
   *   1. The persisted active_model_id (when it points at an installed row)
   *   2. The first installed model (legacy single-model installs)
   *   3. null (no models installed)
   */
  /**
   * Broadcast the new active offline model to every open renderer
   * window so the header/empty-state/sidebar refresh without polling.
   * Best-effort — any send failures are swallowed.
   */
  function broadcastActiveModelChanged(modelId: string | null): void {
    try {
      const info = buildActiveModelInfo(modelId);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.OFFLINE_ACTIVE_MODEL_CHANGED, info);
        }
      }
    } catch (err) {
      console.warn("[offline] failed to broadcast active-model-changed:", err);
    }
  }

  /**
   * Broadcast a fine-grained runtime startup phase to every open
   * window so non-chat callers (Settings → Restart runtime, headless
   * starts, future status panels) can render the same step-by-step
   * status as a chat-driven start.  Best-effort — send failures on a
   * destroyed window are swallowed.
   */
  function broadcastRuntimePhase(payload: {
    phase: import("../services/offline/runtime-manager").RuntimeStartupPhase;
    modelId: string | null;
    detail?: string;
    failure?: import("../services/offline/runtime-manager").RuntimeStartupFailureDetails;
    requestId?: string | null;
  }): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.OFFLINE_RUNTIME_PHASE, payload);
        }
      }
    } catch (err) {
      console.warn("[offline] failed to broadcast runtime-phase:", err);
    }
  }

  function resolveActiveModelId(): string | null {
    if (!isDatabaseReady()) return null;
    try {
      const installation = getOfflineInstallation();
      const models = listOfflineModels();
      const persisted = installation?.activeModelId ?? null;
      if (persisted && models.some((m) => m.id === persisted)) return persisted;
      // Auto-promote: when the persisted active model is missing/null but
      // installed models exist, promote the first one and persist that
      // choice so the DB stops drifting and every consumer (renderer +
      // runtime) sees the same answer on the very next read.  Notify
      // listeners so any open window updates its label in-place.
      const promoted = models[0]?.id ?? null;
      if (promoted && persisted !== promoted) {
        try {
          upsertOfflineInstallation({ activeModelId: promoted });
          broadcastActiveModelChanged(promoted);
        } catch (err) {
          console.warn(
            "[offline] auto-promote of active_model_id failed (read still returns the promoted id):",
            err,
          );
        }
      }
      return promoted;
    } catch {
      return null;
    }
  }

  ipcMain.handle(IPC.OFFLINE_GET_INFO, async () => {
    const installRoot = storageService.getOfflineRoot();
    const storageBytesUsed = storageService.computeUsedBytes();

    // Pick the *active* installed model (or the first one when no
    // explicit selection has been made yet) so the UI shows the model
    // that chats will actually use.
    const models = isDatabaseReady() ? listOfflineModels() : [];
    const activeId = resolveActiveModelId();
    const model =
      models.find((m) => m.id === activeId) ?? models[0] ?? null;

    // Pull install timestamp from the installation record.
    const installation = isDatabaseReady() ? getOfflineInstallation() : null;

    // Determine whether the runtime subprocess is alive by checking its
    // internal state (the runtime manager tracks this without extra IPC).
    const isRuntimeRunning = runtimeManager.isRunning();

    // Look up catalog metadata so we can render the variant label even
    // when the DB row predates the multi-model schema.
    const catalogEntry = model ? offlineCatalog.getById(model.id) : undefined;

    return {
      modelId: model?.id ?? "",
      modelName: model?.name ?? "",
      variantLabel: catalogEntry?.variantLabel ?? model?.name ?? "",
      quantization: model?.quantization ?? "",
      sizeGb: model?.sizeGb ?? 0,
      storageBytesUsed,
      installPath: installRoot,
      installedAt: installation?.installedAt ?? null,
      isRuntimeRunning,
    };
  });

  ipcMain.handle(
    IPC.OFFLINE_LIST_INSTALLED,
    async (): Promise<OfflineModelSummary[]> => {
      if (!isDatabaseReady()) return [];
      const models = listOfflineModels();
      const activeId = resolveActiveModelId();
      return models.map((m): OfflineModelSummary => {
        const check = installManager.verifyModel(m.id);
        const catalog = offlineCatalog.getById(m.id);
        return {
          id: m.id,
          name: m.name,
          variantLabel: catalog?.variantLabel ?? m.name,
          quantization: m.quantization ?? "",
          family: catalog?.family ?? "unknown",
          declaredSizeGb: m.sizeGb,
          sizeOnDiskBytes: check.sizeBytes,
          modelPath: m.modelPath,
          modelDir: dirname(m.modelPath),
          health: check.health,
          ...(check.reason ? { healthReason: check.reason } : {}),
          isActive: m.id === activeId,
          installedAt: m.installedAt,
          lastUsedAt: m.lastUsedAt,
          ...(catalog?.tier ? { tier: catalog.tier } : {}),
        };
      });
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_LIST_AVAILABLE,
    async (): Promise<OfflineCatalogEntrySummary[]> => {
      const installedIds = isDatabaseReady()
        ? new Set(listOfflineModels().map((m) => m.id))
        : new Set<string>();

      // Best-effort hardware fit check.  Failures here are non-fatal —
      // we just mark every entry as fitsHardware=true so the user can
      // still install something.
      let profile: Awaited<ReturnType<typeof hardwareProfile.detect>> | null = null;
      try {
        profile = await hardwareProfile.detect();
      } catch (err) {
        console.warn("[offline] hardware profile detection failed:", err);
      }

      return offlineCatalog.listAvailable().map((entry): OfflineCatalogEntrySummary => {
        let fitsHardware = true;
        let fitReason: string | undefined;
        if (profile) {
          if (!(entry.platforms as string[]).includes(profile.platform)) {
            fitsHardware = false;
            fitReason = `Not supported on ${profile.platform}`;
          } else if (profile.totalRamGb < entry.ramRequiredGb) {
            fitsHardware = false;
            fitReason = `Requires ${entry.ramRequiredGb} GB RAM (have ${Math.round(profile.totalRamGb)} GB)`;
          } else if (profile.freeDiskGb < entry.diskRequiredGb * 1.1) {
            fitsHardware = false;
            fitReason = `Requires ${entry.diskRequiredGb} GB free disk (have ${Math.round(profile.freeDiskGb)} GB)`;
          }
        }
        return {
          id: entry.id,
          name: entry.name,
          variantLabel: entry.variantLabel,
          quantization: entry.quantization,
          family: entry.family,
          isFallback: entry.isFallback,
          sizeGb: entry.sizeGb,
          ramRequiredGb: entry.ramRequiredGb,
          diskRequiredGb: entry.diskRequiredGb,
          tier: entry.tier,
          purpose: entry.purpose,
          installed: installedIds.has(entry.id),
          fitsHardware,
          ...(fitReason ? { fitReason } : {}),
        };
      });
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_INSTALL_ADDITIONAL,
    async (event, modelId: string): Promise<{ ok: boolean; error?: string }> => {
      // Sanity-check the catalog entry up front.
      const entry = offlineCatalog.getById(modelId);
      if (!entry) {
        return { ok: false, error: `Unknown catalog model: ${modelId}` };
      }
      try {
        await installManager.install(modelId, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC.OFFLINE_INSTALL_PROGRESS, progress);
          }
        });
        // Promote the just-installed model to active so the runtime
        // knows what to load and new offline chats use it.  This matches
        // the OFFLINE_INSTALL behaviour and keeps the installed-model
        // state, active-model setting, and new-chat default in sync —
        // installing a model is an implicit "use this model" gesture
        // unless/until the user explicitly switches active model via
        // setActiveOfflineModel.
        if (isDatabaseReady()) {
          upsertOfflineInstallation({ activeModelId: modelId });
          // Reset Gemma 4 failure counter on any successful install.
          upsertOfflineInstallation({
            gemma4FailureCount: 0,
            lastFailureReasons: null,
          });
          broadcastActiveModelChanged(modelId);
        }
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[offline] additional install failed:", err);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_REMOVE_MODEL,
    async (_event, modelId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        // If the runtime is currently serving this model, stop it first
        // so the file isn't locked on Windows and so the next chat picks
        // up a freshly-loaded model cleanly.
        if (runtimeManager.getCurrentModelId() === modelId) {
          await runtimeManager.stop();
        }

        await installManager.uninstall(modelId);

        // If this was the active model, pick a new one (or clear it).
        if (isDatabaseReady()) {
          const installation = getOfflineInstallation();
          if (installation?.activeModelId === modelId) {
            const remaining = listOfflineModels();
            const nextActive = remaining[0]?.id ?? null;
            upsertOfflineInstallation({ activeModelId: nextActive });
            broadcastActiveModelChanged(nextActive);
          }

          // If no models remain, transition the global state back so the
          // sidebar/header reflects "no offline model installed".
          const stillInstalled = listOfflineModels();
          if (stillInstalled.length === 0) {
            setOfflineReadiness({ state: "not-installed" });
          }
        }
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[offline] remove-model failed:", err);
        return { ok: false, error: message };
      }
    },
  );

  /**
   * Build a renderer-facing OfflineActiveModelInfo for a given installed
   * model id (joins DB row + catalog metadata).  Returns null when the id
   * is not actually installed.
   */
  function buildActiveModelInfo(modelId: string | null) {
    if (!modelId) return null;
    if (!isDatabaseReady()) return null;
    const record = listOfflineModels().find((m) => m.id === modelId);
    if (!record) return null;
    const catalog = offlineCatalog.getById(modelId);
    return {
      id: record.id,
      name: record.name,
      variantLabel: catalog?.variantLabel ?? record.name,
    };
  }

  ipcMain.handle(
    IPC.OFFLINE_SET_ACTIVE_MODEL,
    async (_event, modelId: string) => {
      if (!isDatabaseReady()) return null;
      const exists = listOfflineModels().some((m) => m.id === modelId);
      if (!exists) return null;
      // Stop the runtime so the next chat lazy-starts with the new model.
      if (runtimeManager.getCurrentModelId() !== modelId) {
        try {
          await runtimeManager.stop();
        } catch (err) {
          console.warn("[offline] failed to stop runtime when switching active model:", err);
        }
      }
      upsertOfflineInstallation({ activeModelId: modelId });
      broadcastActiveModelChanged(modelId);
      return buildActiveModelInfo(modelId);
    },
  );

  ipcMain.handle(IPC.OFFLINE_GET_ACTIVE_MODEL, () => {
    return buildActiveModelInfo(resolveActiveModelId());
  });

  ipcMain.handle(IPC.OFFLINE_REVEAL_FOLDER, async (): Promise<void> => {
    storageService.ensureDirectories();
    const dir = storageService.getOfflineRoot();
    await shell.openPath(dir);
  });

  ipcMain.handle(IPC.OFFLINE_REVEAL_RUNTIME_LOG, async (): Promise<void> => {
    // Reveal the runtime-last-failure.log if it exists; otherwise fall
    // back to opening the offline root so the user always lands on
    // something meaningful instead of getting a silent no-op.
    storageService.ensureDirectories();
    const logPath = getRuntimeFailureLogPath();
    try {
      if (existsSync(logPath) && statSync(logPath).isFile()) {
        shell.showItemInFolder(logPath);
        return;
      }
    } catch {
      /* fall through to folder open */
    }
    await shell.openPath(storageService.getOfflineRoot());
  });

  /**
   * Wipe the offline `tmp/` and `downloads/` subdirectories.  These hold
   * partial downloads, runtime archives, and extract scratch space — none
   * of which are needed once an install completes.  Installed models,
   * runtime binary, manifests, and DB state are preserved.
   */
  ipcMain.handle(
    IPC.OFFLINE_CLEAR_CACHE,
    async (): Promise<{ ok: boolean; freedBytes: number; error?: string }> => {
      const subdirs = ["tmp", "downloads"] as const;
      let freedBytes = 0;
      try {
        for (const sub of subdirs) {
          const dir = storageService.getSubdir(sub);
          if (!existsSync(dir)) continue;
          // Sum sizes before deletion so the UI can report freed bytes.
          const walk = (d: string): number => {
            let total = 0;
            try {
              for (const entry of readdirSync(d, { withFileTypes: true })) {
                const p = join(d, entry.name);
                if (entry.isDirectory()) {
                  total += walk(p);
                } else {
                  try {
                    total += lstatSync(p).size;
                  } catch {
                    /* file vanished mid-walk */
                  }
                }
              }
            } catch {
              /* dir vanished or unreadable */
            }
            return total;
          };
          freedBytes += walk(dir);
          rmSync(dir, { recursive: true, force: true });
          mkdirSync(dir, { recursive: true });
        }
        return { ok: true, freedBytes };
      } catch (err) {
        console.error("[offline] clear-cache failed:", err);
        return {
          ok: false,
          freedBytes,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.OFFLINE_REVEAL_MODEL_FOLDER,
    async (_event, modelId: string): Promise<void> => {
      // When the model file exists, show it selected in the OS file
      // manager so the user lands on exactly what they asked about.
      // Otherwise fall back to opening the parent models/ directory.
      const filePath = storageService.getModelFilePath(modelId);
      try {
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          shell.showItemInFolder(filePath);
          return;
        }
      } catch {
        /* fall through to folder open */
      }
      storageService.ensureDirectories();
      await shell.openPath(storageService.getModelStorePath());
    },
  );

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
      return;
    }

    // Self-heal stale active_model_id state.  This catches the case where
    // an earlier version persisted (or failed to update) active_model_id
    // pointing at a model that is no longer installed (e.g. user removed
    // the previous active model before installing a new one, or upgraded
    // from a build that did not promote new installs to active).  Without
    // this, OFFLINE_GET_ACTIVE_MODEL would still return a sensible
    // fallback via resolveActiveModelId, but the persisted DB column
    // would stay wrong forever and the renderer's old sessionStorage
    // could keep sending the wrong modelId until restart.
    try {
      const installation = getOfflineInstallation();
      const installedModels = listOfflineModels();
      if (installedModels.length === 0) {
        // "installed" state with no model rows is impossible to recover
        // from without a fresh install — bounce back to not-installed
        // so the UI offers the setup flow rather than failing mid-chat.
        console.warn(
          "[offline] state=installed but no offline models registered — transitioning to not-installed",
        );
        setOfflineReadiness({ state: "not-installed" });
        // Also clear the stale active_model_id so a future install isn't
        // shadowed by a dangling reference.
        upsertOfflineInstallation({ activeModelId: null });
        return;
      }
      const persisted = installation?.activeModelId ?? null;
      const persistedExists =
        persisted != null && installedModels.some((m) => m.id === persisted);
      if (!persistedExists) {
        // Repair: pick the first installed model (most recently installed
        // first via installed_at desc would be nicer, but listOfflineModels
        // returns install-order — either way the user always ends up on
        // an actually-installed model, never on a missing Gemma 4 ghost).
        const repaired = installedModels[0].id;
        console.warn(
          `[offline] active_model_id "${persisted ?? "<null>"}" is not installed — repairing to "${repaired}"`,
        );
        upsertOfflineInstallation({ activeModelId: repaired });
      }
    } catch (err) {
      console.warn("[offline] active model repair on startup failed:", err);
    }
  }
}
