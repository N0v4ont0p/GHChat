export type MessageRole = "user" | "assistant" | "system";

export type ModelCategory =
  | "auto"
  | "best"
  | "general"
  | "coding"
  | "fast"
  | "reasoning"
  | "longContext"
  | "creative"
  | "all";

export type ModelSpeed = "fast" | "medium" | "slow";
export type ModelCostTier = "free" | "standard" | "premium";

export type ModelRuntimeHealth =
  | "available"
  | "degraded"
  | "unavailable"
  | "rate-limited"
  | "overcrowded"
  | "fallback-only";

export interface ModelCapabilities {
  coding: boolean;
  reasoning: boolean;
  fast: boolean;
  creative: boolean;
  longContext: boolean;
  toolUse: boolean;
  specialReasoning: boolean;
  streaming: boolean;
  /** Model supports OpenRouter web-search plugin */
  webSearch?: boolean;
  /** Model can output images */
  imageOutput?: boolean;
  /** Model supports function/tool calling */
  functionCalling?: boolean;
  /** Model exposes explicit reasoning controls (e.g. effort level) */
  reasoningMode?: boolean;
  /** Model supports web browsing / fetch capability */
  browsing?: boolean;
}
/**
 * Per-model probe result returned after a boot-time verification request.
 *
 * - verified      – probe request succeeded; model is usable for this token
 * - unknown       – not yet probed, or probe returned an ambiguous response
 * - unavailable   – model is missing from the router (404) or down (503)
 * - gated         – model exists but requires explicit access approval (403)
 * - rate-limited  – token or account hit a rate limit during the probe (429)
 */
export type ModelVerificationStatus =
  | "unknown"
  | "verified"
  | "unavailable"
  | "gated"
  | "rate-limited"
  | "billing-blocked";

export type ModelHealthTag =
  | "free-tier-friendly"
  | "slow"
  | "experimental"
  | "fallback-ready";

export type ValidationStatus = "idle" | "pending" | "success" | "warning" | "failed";

export interface ValidationLayerState {
  status: ValidationStatus;
  message: string;
  checkedAt?: number;
  statusCode?: number;
}

export interface AppSettings {
  defaultModel: string;
  theme: "dark" | "light" | "system";
  /** Set to true once the user has completed the onboarding flow */
  onboardingComplete?: boolean;
  /** ID of the last active conversation, restored on next launch */
  lastConversationId?: string | null;
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
  /** Short display name for the vendor (e.g. "Google", "Meta", "Mistral") */
  vendor?: string;
  /** Model family name (e.g. "Gemma", "Llama", "Qwen") */
  family?: string;
  /** True when this is a top-tier, broadly recommended model */
  isFeatured?: boolean;
  isDefault?: boolean;
  isPopular?: boolean;
  speed?: ModelSpeed;
  contextWindow?: string;
  supportsStreaming: boolean;
  costTier: ModelCostTier;
  freeTierFriendly?: boolean;
  fallbackModel?: string;
  verifiedStatus: ModelVerificationStatus;
  verifiedMessage?: string;
  verificationReason?: string;
  avgLatencyMs?: number;
  healthTags?: ModelHealthTag[];
  isExperimental?: boolean;
  isSlow?: boolean;
  lastCheckedAt?: number;
  capabilities?: ModelCapabilities;
  runtimeHealth?: ModelRuntimeHealth;
}

export interface OpenRouterDiagnostics {
  apiKeyValid: boolean;
  apiKeyMessage: string;
  keyValidation: ValidationLayerState;
  catalogValidation: ValidationLayerState;
  modelValidation: ValidationLayerState;
  streamingValidation: ValidationLayerState;
  checkedAt: number;
  models: ModelPreset[];
  freeModelCount: number;
  bestWorkingModels: string[];
  noVerifiedModels?: boolean;
  lastProviderError?: string;
  recommendedFallback?: string;
  usedFallbackRouter?: boolean;
}

/**
 * Recovery action types surfaced by the inline ChatErrorPanel.
 * Each value maps to a specific one-click handler in the UI.
 */
export type ChatErrorRecoveryAction =
  | "retry"          // Re-send the same conversation to the same model
  | "fallback"       // Switch to the recommended fallback model and retry
  | "auto"           // Switch to Auto mode and retry
  | "refresh-models" // Re-probe runtime model availability for this token
  | "settings"       // Open the Settings modal
  | "verify-token";  // Re-open onboarding / Settings to re-enter the API key

export type ChatFailureKind =
  | "token-invalid"
  | "billing-blocked"
  | "model-gated"
  | "model-unavailable"
  | "rate-limited"
  | "provider-unavailable"
  | "network"
  | "route-unsupported"
  | "unknown";

/**
 * Structured chat error stored in the UI layer after a streaming failure.
 * Contains everything needed to render an actionable error panel.
 */
export interface StructuredChatError {
  /** Human-friendly message already mapped from the provider error */
  message: string;
  /** Normalized internal error kind for recovery UX */
  kind?: ChatFailureKind;
  /** HTTP status code from the provider, if available */
  status?: number;
  /** Model ID that actually failed */
  failedModel?: string;
  /** Recommended fallback model ID from the provider */
  fallbackModel?: string;
  /** Friendly display name for the fallback model */
  fallbackModelName?: string;
  /** Ordered list of recovery actions to offer the user */
  actions: ChatErrorRecoveryAction[];
}

/**
 * Routing decision info emitted by the provider before streaming begins.
 * Drives the "Chosen because…" caption in the streaming indicator and
 * the model-used annotation after a successful response.
 */
export interface ChatRoutingInfo {
  /** Resolved model ID that will be used for the request */
  model: string;
  /** Display name for the resolved model */
  modelName: string;
  /** Human-friendly explanation of why this model was chosen */
  reason: string;
  /** True when the routing came from Auto mode prompt classification */
  isAuto: boolean;
  /** True when this is a fallback choice (previous model failed) */
  isFallback: boolean;
}

export type StreamLifecycleState =
  | "idle"
  | "validating"
  | "routing"
  | "streaming"
  | "stopping"
  | "completed"
  | "fallback-switching"
  | "failed";

export interface ProviderHealthResult {
  ok: boolean;
  message: string;
}

export interface KeyValidationResult {
  valid: boolean;
  message: string;
  diagnostics?: OpenRouterDiagnostics;
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
  KEYCHAIN_DELETE: "keychain:delete",
  CLEAR_ALL_DATA: "data:clear-all",
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
} as const;
