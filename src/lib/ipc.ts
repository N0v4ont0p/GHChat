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
  createConversation: (title?: string) =>
    api().invoke<Conversation>(IPC.CONVERSATIONS_CREATE, title),
  renameConversation: (id: string, title: string) =>
    api().invoke<void>(IPC.CONVERSATIONS_RENAME, id, title),
  deleteConversation: (id: string) =>
    api().invoke<void>(IPC.CONVERSATIONS_DELETE, id),

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
};
