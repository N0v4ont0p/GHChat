import { IPC } from "@/types";
import type {
  Conversation,
  Message,
  AppSettings,
  ModelPreset,
  KeyValidationResult,
  HuggingFaceDiagnostics,
} from "@/types";

const api = () => window.ghchat;

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

  // HF
  listModels: (apiKey?: string) => api().invoke<ModelPreset[]>(IPC.HF_MODELS_LIST, apiKey),
  validateApiKey: (key: string) => api().invoke<KeyValidationResult>(IPC.HF_KEY_VALIDATE, key),
  getHfDiagnostics: (apiKey?: string) =>
    api().invoke<HuggingFaceDiagnostics>(IPC.HF_DIAGNOSTICS_GET, apiKey),

  // Streaming
  stopStream: (requestId: string) =>
    api().send(IPC.HF_CHAT_STOP, { requestId }),
};
