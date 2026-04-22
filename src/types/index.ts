export type MessageRole = "user" | "assistant" | "system";

export type ModelCategory =
  | "auto"
  | "general"
  | "coding"
  | "fast"
  | "reasoning"
  | "longContext";

export type ModelSpeed = "fast" | "medium" | "slow";
export type ModelCostTier = "free" | "standard" | "premium";
export type ModelVerificationStatus = "unknown" | "verified" | "unavailable";

export interface AppSettings {
  defaultModel: string;
  theme: "dark" | "light" | "system";
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface ModelPreset {
  id: string;
  name: string;
  category: ModelCategory;
  description: string;
  whyChoose: string;
  isDefault?: boolean;
  isPopular?: boolean;
  speed?: ModelSpeed;
  contextWindow?: string;
  supportsStreaming: boolean;
  costTier: ModelCostTier;
  fallbackModel?: string;
  verifiedStatus: ModelVerificationStatus;
  verifiedMessage?: string;
  lastCheckedAt?: number;
}

export interface HuggingFaceDiagnostics {
  tokenValid: boolean;
  tokenMessage: string;
  checkedAt: number;
  models: ModelPreset[];
  bestWorkingModels: string[];
  lastProviderError?: string;
  recommendedFallback?: string;
}

export interface ProviderHealthResult {
  ok: boolean;
  message: string;
}

export interface KeyValidationResult {
  valid: boolean;
  message: string;
  diagnostics?: HuggingFaceDiagnostics;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

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
  HF_MODELS_LIST: "hf:models:list",
  HF_DIAGNOSTICS_GET: "hf:diagnostics:get",
  HF_KEY_VALIDATE: "hf:key:validate",
  HF_CHAT_STREAM: "hf:chat:stream",
  HF_CHAT_STOP: "hf:chat:stop",
  HF_CHAT_TOKEN: "hf:chat:token",
  HF_CHAT_END: "hf:chat:end",
  HF_CHAT_ERROR: "hf:chat:error",
} as const;
