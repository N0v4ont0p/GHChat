export const IPC = {
  CONVERSATIONS_LIST: "conversations:list",
  CONVERSATIONS_CREATE: "conversations:create",
  CONVERSATIONS_RENAME: "conversations:rename",
  CONVERSATIONS_DELETE: "conversations:delete",
  CONVERSATIONS_UPDATE_MODEL: "conversations:update-model",
  MESSAGES_LIST: "messages:list",
  MESSAGES_APPEND: "messages:append",
  MESSAGES_DELETE: "messages:delete",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  KEYCHAIN_GET: "keychain:get",
  KEYCHAIN_SET: "keychain:set",
  KEYCHAIN_DELETE: "keychain:delete",
  CLEAR_ALL_DATA: "data:clear-all",
  /** Duplicate a conversation (copies all messages) into a new conversation with an optional new mode/model binding. */
  CONVERSATIONS_DUPLICATE: "conversations:duplicate",
  /** Returns { ready: boolean; error: string | null } — whether the DB initialized successfully */
  DB_STATUS: "db:status",
  OR_MODELS_LIST: "or:models:list",
  OR_DIAGNOSTICS_GET: "or:diagnostics:get",
  OR_DIAGNOSTICS_REFRESH: "or:diagnostics:refresh",
  OR_KEY_VALIDATE: "or:key:validate",
  OR_CHAT_STREAM: "or:chat:stream",
  OR_CHAT_STOP: "or:chat:stop",
  OR_CHAT_TOKEN: "or:chat:token",
  OR_CHAT_END: "or:chat:end",
  OR_CHAT_ERROR: "or:chat:error",
  /** Emitted before streaming starts; tells the renderer which model was chosen and why */
  OR_CHAT_ROUTING: "or:chat:routing",
  /** Returns the current AppMode */
  MODE_GET: "mode:get",
  /** Sets the current AppMode; returns the updated AppMode */
  MODE_SET: "mode:set",
  /** Returns OfflineReadiness — current offline state machine position */
  OFFLINE_STATUS: "offline:status",
  /**
   * Runs hardware profiling + recommendation logic.
   * Transitions state → "recommendation-ready" and returns OfflineReadiness
   * (with the recommendation field populated).
   */
  OFFLINE_ANALYZE: "offline:analyze",
  /**
   * Starts the full offline install pipeline for a given catalog model ID.
   * Returns OfflineReadiness — state is "installed" on success or
   * "install-failed" on error.  Live progress is pushed via OFFLINE_INSTALL_PROGRESS.
   */
  OFFLINE_INSTALL: "offline:install",
  /**
   * Push event (main → renderer) carrying OfflineInstallProgress.
   * Fired repeatedly while an install is in progress.
   */
  OFFLINE_INSTALL_PROGRESS: "offline:install:progress",
  /**
   * Start a local-inference chat stream for offline mode.
   * Sent from renderer to main via `window.ghchat.send()`.
   * Payload: { requestId, messages }
   */
  OFFLINE_CHAT_STREAM: "offline:chat:stream",
  /**
   * Cancel an in-progress offline chat stream.
   * Sent from renderer to main.  Payload: { requestId }
   */
  OFFLINE_CHAT_STOP: "offline:chat:stop",
  /** Push (main → renderer): incremental token from local inference. Payload: { requestId, token } */
  OFFLINE_CHAT_TOKEN: "offline:chat:token",
  /** Push (main → renderer): stream complete. Payload: { requestId } */
  OFFLINE_CHAT_END: "offline:chat:end",
  /** Push (main → renderer): stream error. Payload: { requestId, error } */
  OFFLINE_CHAT_ERROR: "offline:chat:error",
  /**
   * Returns OfflineInfo — installed package details, storage used, install path,
   * and whether the runtime process is currently alive.
   */
  OFFLINE_GET_INFO: "offline:get-info",
  /**
   * Fully removes the offline installation — runtime binary, model files,
   * downloads/tmp cache, manifests, and DB records.
   * Online chats, API keys, and app settings are untouched.
   * Returns OfflineReadiness with state="not-installed" on success.
   */
  OFFLINE_REMOVE: "offline:remove",
  /**
   * Opens the offline root directory in the OS file manager
   * (Finder on macOS, Explorer on Windows, file manager on Linux).
   */
  OFFLINE_REVEAL_FOLDER: "offline:reveal-folder",
  /** Returns OfflineModelSummary[] — every installed offline model. */
  OFFLINE_LIST_INSTALLED: "offline:list-installed",
  /** Returns OfflineCatalogEntrySummary[] — installable catalog entries. */
  OFFLINE_LIST_AVAILABLE: "offline:list-available",
  /** Install an additional offline model w/o flipping global state. */
  OFFLINE_INSTALL_ADDITIONAL: "offline:install-additional",
  /** Remove a single installed offline model by id. */
  OFFLINE_REMOVE_MODEL: "offline:remove-model",
  /** Set the currently active offline model. */
  OFFLINE_SET_ACTIVE_MODEL: "offline:set-active-model",
  /** Get the currently active offline model id, or null. */
  OFFLINE_GET_ACTIVE_MODEL: "offline:get-active-model",
  /** Reveal a specific offline model file/folder in the OS file manager. */
  OFFLINE_REVEAL_MODEL_FOLDER: "offline:reveal-model-folder",
  /** Reset Gemma 4 install failure counter (renderer-facing copy of internal handler). */
  OFFLINE_RESET_FAILURES: "offline:reset-failures",
  /** Push (main → renderer): active offline model changed. */
  OFFLINE_ACTIVE_MODEL_CHANGED: "offline:active-model-changed",
  /** Get the offline-specific settings record. */
  OFFLINE_SETTINGS_GET: "offline:settings-get",
  /** Update one or more offline-specific settings. */
  OFFLINE_SETTINGS_UPDATE: "offline:settings-update",
  /** Reset offline-specific settings to defaults. */
  OFFLINE_SETTINGS_RESET: "offline:settings-reset",
  /** Stop the offline runtime subprocess gracefully. */
  OFFLINE_RUNTIME_STOP: "offline:runtime:stop",
  /** Force-stop (SIGKILL) the offline runtime subprocess immediately. */
  OFFLINE_RUNTIME_FORCE_STOP: "offline:runtime:force-stop",
  /**
   * Get the cached HardwareProfile snapshot used by the recommendation
   * engine.  Used by the management UI to render hardware tier and to
   * warn when the active model exceeds the local capacity.
   */
  OFFLINE_GET_HARDWARE_PROFILE: "offline:get-hardware-profile",
} as const;
