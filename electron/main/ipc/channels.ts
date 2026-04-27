export const IPC = {
  CONVERSATIONS_LIST: "conversations:list",
  CONVERSATIONS_CREATE: "conversations:create",
  CONVERSATIONS_RENAME: "conversations:rename",
  CONVERSATIONS_DELETE: "conversations:delete",
  MESSAGES_LIST: "messages:list",
  MESSAGES_APPEND: "messages:append",
  MESSAGES_DELETE: "messages:delete",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  KEYCHAIN_GET: "keychain:get",
  KEYCHAIN_SET: "keychain:set",
  KEYCHAIN_DELETE: "keychain:delete",
  CLEAR_ALL_DATA: "data:clear-all",
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
} as const;
