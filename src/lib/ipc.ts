import { IPC } from "@/types";
import type {
  Conversation,
  Message,
  AppSettings,
  ModelPreset,
  KeyValidationResult,
  OpenRouterDiagnostics,
  AppMode,
  OfflineReadiness,
  OfflineInstallProgress,
  OfflineInfo,
  OfflineModelSummary,
  OfflineCatalogEntrySummary,
  OfflineSettings,
  OfflineHardwareProfileSnapshot,
  OfflineActiveModelInfo,
} from "@/types";
import type { IpcRendererEvent } from "electron";

function api() {
  if (typeof window === "undefined" || !window.ghchat) {
    const msg =
      "[ipc] window.ghchat is unavailable — the Electron preload script did not load. " +
      "IPC calls will not work.";
    console.error(msg);
    throw new Error(msg);
  }
  return window.ghchat;
}

export const ipc = {
  // Conversations
  listConversations: () => api().invoke<Conversation[]>(IPC.CONVERSATIONS_LIST),
  createConversation: (
    payload?:
      | string
      | { title?: string; mode?: AppMode; modelId?: string | null },
  ) => api().invoke<Conversation>(IPC.CONVERSATIONS_CREATE, payload),
  renameConversation: (id: string, title: string) =>
    api().invoke<void>(IPC.CONVERSATIONS_RENAME, id, title),
  deleteConversation: (id: string) =>
    api().invoke<void>(IPC.CONVERSATIONS_DELETE, id),
  /**
   * Update the mode/model binding for a conversation.  Used to stamp
   * the resolved mode/model on first send and from the missing-model
   * recovery surface to migrate a stuck conversation.
   */
  updateConversationModel: (
    id: string,
    partial: { mode?: AppMode; modelId?: string | null },
  ) => api().invoke<void>(IPC.CONVERSATIONS_UPDATE_MODEL, id, partial),

  duplicateConversation: (
    id: string,
    binding?: { mode?: AppMode; modelId?: string | null },
  ) => api().invoke<Conversation>(IPC.CONVERSATIONS_DUPLICATE, id, binding),

  // Messages
  listMessages: (conversationId: string) =>
    api().invoke<Message[]>(IPC.MESSAGES_LIST, conversationId),
  appendMessage: (payload: { conversationId: string; role: string; content: string }) =>
    api().invoke<Message>(IPC.MESSAGES_APPEND, payload),
  deleteMessage: (id: string) => api().invoke<void>(IPC.MESSAGES_DELETE, id),

  // Settings
  getSettings: () => api().invoke<AppSettings>(IPC.SETTINGS_GET),
  updateSettings: (partial: Partial<AppSettings>) =>
    api().invoke<AppSettings>(IPC.SETTINGS_UPDATE, partial),

  // Keychain
  getApiKey: () => api().invoke<string>(IPC.KEYCHAIN_GET),
  setApiKey: (key: string) => api().invoke<void>(IPC.KEYCHAIN_SET, key),
  deleteApiKey: () => api().invoke<void>(IPC.KEYCHAIN_DELETE),

  // Data management
  clearAllData: () => api().invoke<void>(IPC.CLEAR_ALL_DATA),

  // Database health
  getDbStatus: () => api().invoke<{ ready: boolean; error: string | null }>(IPC.DB_STATUS),

  // OpenRouter
  listModels: (apiKey?: string) => api().invoke<ModelPreset[]>(IPC.OR_MODELS_LIST, apiKey),
  validateApiKey: (key: string) => api().invoke<KeyValidationResult>(IPC.OR_KEY_VALIDATE, key),
  getDiagnostics: (apiKey?: string) =>
    api().invoke<OpenRouterDiagnostics>(IPC.OR_DIAGNOSTICS_GET, apiKey),
  refreshDiagnostics: (apiKey?: string) =>
    api().invoke<OpenRouterDiagnostics>(IPC.OR_DIAGNOSTICS_REFRESH, apiKey),

  // Streaming
  stopStream: (requestId: string) =>
    api().send(IPC.OR_CHAT_STOP, { requestId }),

  // Mode
  getMode: () => api().invoke<AppMode>(IPC.MODE_GET),
  setMode: (mode: AppMode) => api().invoke<AppMode>(IPC.MODE_SET, mode),
  getOfflineStatus: () => api().invoke<OfflineReadiness>(IPC.OFFLINE_STATUS),
  /**
   * Runs hardware profiling and recommendation logic in the main process.
   * Returns OfflineReadiness with state="recommendation-ready" and a populated
   * recommendation field, or state="not-installed" on failure.
   */
  analyzeSystem: () => api().invoke<OfflineReadiness>(IPC.OFFLINE_ANALYZE),
  /**
   * Start the full offline install pipeline for the given catalog model ID.
   * Returns the final OfflineReadiness (state = "installed" or "install-failed").
   * Live progress is delivered via onInstallProgress.
   */
  startInstall: (modelId: string) =>
    api().invoke<OfflineReadiness>(IPC.OFFLINE_INSTALL, modelId),
  /**
   * Subscribe to install progress events.
   * Returns an unsubscribe function — call it when the component unmounts.
   */
  onInstallProgress: (cb: (progress: OfflineInstallProgress) => void) =>
    api().on(IPC.OFFLINE_INSTALL_PROGRESS, (_event: IpcRendererEvent, progress: OfflineInstallProgress) =>
      cb(progress),
    ),

  /**
   * Send a local-inference chat stream request (offline mode).
   * Tokens are delivered via the OFFLINE_CHAT_TOKEN, OFFLINE_CHAT_END,
   * and OFFLINE_CHAT_ERROR push events.
   */
  sendOfflineChatStream: (payload: {
    requestId: string;
    modelId: string;
    messages: Array<{ role: string; content: string }>;
  }) => api().send(IPC.OFFLINE_CHAT_STREAM, payload),

  /** Cancel an in-progress offline chat stream. */
  stopOfflineStream: (requestId: string) =>
    api().send(IPC.OFFLINE_CHAT_STOP, { requestId }),

  /**
   * Retrieve details about the installed offline package: model info, disk
   * usage, install path, and whether the runtime is currently running.
   */
  getOfflineInfo: () => api().invoke<OfflineInfo>(IPC.OFFLINE_GET_INFO),

  /**
   * Fully remove the offline installation — runtime binary, model files,
   * downloads/tmp cache, manifests, and DB state.
   * Online data is untouched.  Returns the new OfflineReadiness (state = "not-installed").
   */
  removeOfflineMode: () => api().invoke<OfflineReadiness>(IPC.OFFLINE_REMOVE),

  /**
   * Open the offline root directory in the OS file manager.
   */
  revealOfflineFolder: () => api().invoke<void>(IPC.OFFLINE_REVEAL_FOLDER),

  // ── Multi-model offline management ────────────────────────────────────
  /** List every installed offline model with health, active flag, and timestamps. */
  listInstalledOfflineModels: () =>
    api().invoke<OfflineModelSummary[]>(IPC.OFFLINE_LIST_INSTALLED),
  /** List installable catalog entries with installed/fitsHardware flags. */
  listAvailableOfflineModels: () =>
    api().invoke<OfflineCatalogEntrySummary[]>(IPC.OFFLINE_LIST_AVAILABLE),
  /**
   * Install an additional offline model from the management UI without
   * touching the global offline state machine.  Live progress is delivered
   * via the same OFFLINE_INSTALL_PROGRESS push events as the setup flow.
   */
  installAdditionalOfflineModel: (modelId: string) =>
    api().invoke<{ ok: boolean; error?: string }>(
      IPC.OFFLINE_INSTALL_ADDITIONAL,
      modelId,
    ),
  /** Remove a single installed offline model by id. */
  removeOfflineModel: (modelId: string) =>
    api().invoke<{ ok: boolean; error?: string }>(IPC.OFFLINE_REMOVE_MODEL, modelId),
  /** Set the currently active offline model (returns the new active model info, or null on unknown). */
  setActiveOfflineModel: (modelId: string) =>
    api().invoke<OfflineActiveModelInfo | null>(IPC.OFFLINE_SET_ACTIVE_MODEL, modelId),
  /** Get the currently active offline model info ({id,name,variantLabel}), or null. */
  getActiveOfflineModel: () =>
    api().invoke<OfflineActiveModelInfo | null>(IPC.OFFLINE_GET_ACTIVE_MODEL),
  /** Reveal a single model's storage location in the OS file manager. */
  revealOfflineModelFolder: (modelId: string) =>
    api().invoke<void>(IPC.OFFLINE_REVEAL_MODEL_FOLDER, modelId),

  // ── Offline-specific settings ─────────────────────────────────────────
  /** Read the persisted offline-specific settings record. */
  getOfflineSettings: () => api().invoke<OfflineSettings>(IPC.OFFLINE_SETTINGS_GET),
  /** Update one or more offline-specific settings; returns the new state. */
  updateOfflineSettings: (partial: Partial<OfflineSettings>) =>
    api().invoke<OfflineSettings>(IPC.OFFLINE_SETTINGS_UPDATE, partial),
  /** Reset all offline-specific settings to defaults. */
  resetOfflineSettings: () => api().invoke<OfflineSettings>(IPC.OFFLINE_SETTINGS_RESET),
  /** Get a snapshot of host hardware (RAM/CPU/disk + tier) for diagnostics. */
  getOfflineHardwareProfile: () =>
    api().invoke<OfflineHardwareProfileSnapshot | null>(IPC.OFFLINE_GET_HARDWARE_PROFILE),

  /**
   * Wipe the offline `tmp/` and `downloads/` subdirectories. Returns the
   * number of bytes freed.  Installed models and runtime binary stay put.
   */
  clearOfflineCache: () =>
    api().invoke<{ ok: boolean; freedBytes: number; error?: string }>(
      IPC.OFFLINE_CLEAR_CACHE,
    ),

  /**
   * Reset the consecutive Gemma 4 install failure counter.  Used when
   * the user explicitly chooses to keep trying Gemma 4 after the
   * fallback-offered screen instead of installing a Gemma 3 fallback.
   */
  resetOfflineFailures: () =>
    api().invoke<OfflineReadiness>(IPC.OFFLINE_RESET_FAILURES),

  /** Stop the offline runtime subprocess gracefully. */
  stopOfflineRuntime: () =>
    api().invoke<{ ok: boolean }>(IPC.OFFLINE_RUNTIME_STOP),
  /** Force-stop (SIGKILL) the offline runtime subprocess immediately. */
  forceStopOfflineRuntime: () =>
    api().invoke<{ ok: boolean }>(IPC.OFFLINE_RUNTIME_FORCE_STOP),
  /**
   * Restart the offline runtime: stop it, then start it again for the
   * currently active model.  Resolves with `{ ok: false, error }` when
   * there is no active model or start fails — callers should surface
   * the error to the user.
   */
  restartOfflineRuntime: () =>
    api().invoke<{ ok: boolean; error?: string }>(IPC.OFFLINE_RUNTIME_RESTART),
};
