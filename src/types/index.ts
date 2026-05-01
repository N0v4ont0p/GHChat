export type MessageRole = "user" | "assistant" | "system";

// ── App mode ──────────────────────────────────────────────────────────────────

/** Top-level operating mode for GHchat. */
export type AppMode = "online" | "offline" | "auto";

/**
 * States of the offline setup state machine.
 *
 * not-installed      – no offline runtime or model has been set up
 * analyzing-system   – hardware profile detection in progress
 * recommendation-ready – hardware profile done; recommendations available
 * installing         – model download / runtime install in progress
 * installed          – offline runtime is ready and a model is available
 * install-failed     – the last install attempt failed; user can retry
 * fallback-offered   – Gemma 4 has failed to install enough times that
 *                      GHchat is now offering explicit fallback model
 *                      choices (e.g. Gemma 3) for the user to opt into.
 *                      The user MUST choose one — never auto-switched.
 * repair-needed      – files are present but the runtime check failed
 */
export type OfflineSetupState =
  | "not-installed"
  | "analyzing-system"
  | "recommendation-ready"
  | "installing"
  | "installed"
  | "install-failed"
  | "fallback-offered"
  | "repair-needed";

/**
 * Minimal hardware profile summary included in an offline recommendation.
 * Mirrors the main-process HardwareProfile but stripped to renderer-safe fields.
 */
export interface OfflineProfileSummary {
  totalRamGb: number;
  freeDiskGb: number;
  /** Node.js platform string, e.g. "darwin", "win32", "linux". */
  platform: string;
  /** CPU architecture, e.g. "arm64", "x64". */
  arch: string;
  /** True when running on an Apple Silicon Mac (arm64 + darwin). */
  isAppleSilicon: boolean;
  cpuCores: number;
}

/**
 * Top-level model family driving the offline install path.
 * "gemma-4" is the default for fresh users; "gemma-3" entries are only
 * offered after Gemma 4 install has failed repeatedly.
 */
export type OfflineModelFamily = "gemma-4" | "gemma-3";

/**
 * Short purpose label communicating the practical role of an offline
 * catalog entry in the model chooser.  See `OfflineModelEntry.purpose`
 * in the main-process catalog for full semantics.
 *
 *   "test"      – lightweight, fast-to-download model suitable for
 *                 quick setup validation and smooth use on modest
 *                 hardware (e.g. an M2 MacBook Air).
 *   "fastest"   – smallest non-test variant; quickest install.
 *   "balanced"  – default everyday recommendation.
 *   "advanced"  – higher quality at noticeable resource cost.
 *   "strongest" – best quality this catalog can offer; needs a
 *                 workstation-class machine.
 */
export type OfflineModelPurpose =
  | "test"
  | "fastest"
  | "balanced"
  | "advanced"
  | "strongest";

/**
 * Offline model recommendation returned by the main-process analyze step.
 * Contains everything the renderer needs to display the recommendation screen.
 */
export interface OfflineRecommendation {
  /** Catalog model ID, e.g. "gemma4-e4b-q4km". */
  modelId: string;
  /** Human-readable model family label, e.g. "Gemma 4 E4B". */
  label: string;
  /** Variant label combining size and quantization, e.g. "E4B · Q4_K_M". */
  variantLabel: string;
  /** Approximate download / disk size in gigabytes. */
  sizeGb: number;
  /** Quality/speed tier. */
  tier: "balanced" | "quality" | "fast";
  /** Human-readable explanation of why this variant was chosen. */
  reason: string;
  /** Hardware profile that drove the recommendation. */
  profile: OfflineProfileSummary;
  /**
   * Top-level family ("gemma-4" or "gemma-3").  The default recommendation
   * pipeline only ever returns "gemma-4"; "gemma-3" only appears in the
   * `fallbackOptions` list of an `OfflineReadiness` after Gemma 4 has
   * failed repeatedly.
   */
  family: OfflineModelFamily;
  /**
   * True when this recommendation is an explicit fallback (i.e. NOT the
   * preferred Gemma 4 default).  Renderer uses this to label the entry
   * unambiguously in the fallback-choice UI.
   */
  isFallback: boolean;
}

/**
 * Coarse category of an install failure, used by the renderer to render
 * an actionable, friendly message in the offline-setup UI.  Mirrors
 * `ReleaseLookupErrorCategory` in `runtime-catalog.ts` plus a generic
 * `install` bucket for non-network install failures.
 */
export type OfflineErrorCategory =
  | "network-offline"
  | "dns"
  | "timeout"
  | "rate-limited"
  | "tls-proxy"
  | "http-error"
  | "auth-required"
  | "install"
  | "unknown";

/** Structured record of a Gemma 4 install failure, surfaced to the UI. */
export interface OfflineFailureReason {
  /** Epoch ms when the failure occurred. */
  at: number;
  /** Catalog model ID that was being installed. */
  modelId: string;
  /** Coarse error category (same vocabulary as `OfflineReadiness.errorCategory`). */
  category: OfflineErrorCategory;
  /** Top-level error message. */
  message: string;
}

/** Current offline readiness returned by the main process. */
export interface OfflineReadiness {
  /** Current position in the offline setup state machine. */
  state: OfflineSetupState;
  /** Human-readable status message (progress, error detail, etc.). */
  message?: string;
  /**
   * Coarse error category — only present on failure states.  Allows the
   * renderer to map to an actionable, localised title/summary instead of
   * displaying raw network error text.
   */
  errorCategory?: OfflineErrorCategory;
  /**
   * Full technical details (error chain, URL, attempts) — only present on
   * failure states.  Rendered inside the collapsible "Technical details"
   * section of the error screen so users can copy them when reporting bugs.
   */
  errorDetails?: string;
  /**
   * Populated when state is "recommendation-ready".
   * Contains the recommended Gemma 4 variant and the hardware profile used
   * to derive it.
   */
  recommendation?: OfflineRecommendation;
  /**
   * Cumulative count of consecutive **Gemma 4** install failures since the
   * last successful install (or the last explicit failure-counter reset).
   * Reset to 0 on any successful install.  Used by the UI to display
   * "Attempt N of M" and to know when fallback options will be offered.
   */
  gemma4FailureCount?: number;
  /**
   * Threshold (number of consecutive Gemma 4 failures) at which GHchat
   * stops looping the same install path and transitions to
   * "fallback-offered".  Surfaced to the UI so the attempt counter stays
   * accurate without hard-coding it in the renderer.
   */
  gemma4FailureThreshold?: number;
  /**
   * Most recent Gemma 4 failure reasons (newest last), capped at the
   * threshold size.  Surfaced in the UI so users can see *why* their
   * Gemma 4 installs keep failing instead of being trapped in a silent
   * retry loop.
   */
  lastFailureReasons?: OfflineFailureReason[];
  /**
   * Populated only when state is "fallback-offered".  Ranked list of
   * explicit fallback model choices (Gemma 3 variants) the user may opt
   * into.  GHchat NEVER auto-installs from this list — the user must
   * click a specific option to install it.
   */
  fallbackOptions?: OfflineRecommendation[];
}

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
  /** Last selected app mode, restored on next launch */
  currentMode?: AppMode;
}

/**
 * Performance preset bundles a few related runtime knobs (context size,
 * thread count, max tokens) into a single user-friendly choice.
 *   - "speed":    smallest context, capped output, generous thread count
 *   - "balanced": sensible defaults for most machines
 *   - "quality":  large context, longer outputs, may be slower
 *   - "custom":   the user has tweaked individual sliders
 */
export type OfflinePerformancePreset = "speed" | "balanced" | "quality" | "custom";

/**
 * Offline-specific settings persisted in the offline_settings table.
 * Separate from `AppSettings` so universal/online preferences and local
 * inference knobs can evolve independently.  All fields are optional —
 * `null` / `undefined` means "use the runtime default".
 */
export interface OfflineSettings {
  /** Catalog id of the user's preferred default model, or null. */
  defaultModelId: string | null;
  /** Active performance preset. */
  performancePreset: OfflinePerformancePreset;
  /** llama-server context window in tokens (e.g. 4096). */
  contextSize: number | null;
  /** Per-request generation cap.  -1 = unlimited.  null = preset default. */
  maxTokens: number | null;
  /** Sampling temperature (0.0–2.0).  null = preset default. */
  temperature: number | null;
  /** top-p sampling (0.0–1.0).  null = preset default. */
  topP: number | null;
  /** Worker thread override.  null = auto. */
  threads: number | null;
  /** Cancel-timeout (ms) before forcing a runtime restart. */
  cancelTimeoutMs: number | null;
  /** Whether streaming is enabled. */
  streamingEnabled: boolean;
}

/**
 * Snapshot of the host machine's hardware capabilities, returned to the
 * renderer so the management UI can render a hardware tier banner and
 * warn when the active model is heavier than the local hardware.
 */
export interface OfflineHardwareProfileSnapshot {
  totalRamGb: number;
  freeDiskGb: number;
  cpuCores: number;
  platform: string;
  arch: string;
  isAppleSilicon: boolean;
  /**
   * Human-readable hardware tier:
   *   - "low":   limited RAM/CPU; recommend the smallest variants
   *   - "mid":   typical laptop; recommend mid-size variants
   *   - "high":  desktop or Apple Silicon w/ ≥16 GB RAM
   *   - "ultra": ≥48 GB RAM; can comfortably run 30B+ variants
   */
  tier: "low" | "mid" | "high" | "ultra";
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

/**
 * Phase labels for the offline install pipeline.
 *
 * preflight           – checking disk space, platform compatibility, directories
 * downloading-runtime – fetching the llama.cpp server binary
 * verifying-runtime   – confirming the binary size/hash is sane
 * downloading-model   – fetching the GGUF file from the download URL
 * verifying-model     – computing and comparing the SHA-256 checksum
 * finalizing          – moving file to managed storage, writing manifest, updating DB
 * smoke-test          – confirming the installed file is usable
 */
export type OfflineInstallPhase =
  | "preflight"
  | "downloading-runtime"
  | "verifying-runtime"
  | "downloading-model"
  | "verifying-model"
  | "finalizing"
  | "smoke-test";

/** Live progress snapshot pushed from the main-process installer to the renderer. */
export interface OfflineInstallProgress {
  /** Current pipeline phase. */
  phase: OfflineInstallPhase;
  /** Short human-readable description of the current step. */
  step: string;
  /** Overall percent complete (0–100). */
  pct: number;
  /** Bytes received so far (populated during downloading-model phase). */
  downloadedBytes?: number;
  /** Total expected bytes (populated during downloading-model when Content-Length is known). */
  totalBytes?: number;
  /** Current download speed in bytes/second (populated during downloading-model). */
  speedBps?: number;
  /** Estimated seconds remaining in the current download (populated during downloading-model). */
  etaSec?: number;
}


/** Information about a fully installed offline setup, returned by OFFLINE_GET_INFO. */
export interface OfflineInfo {
  /** Catalog model ID of the installed model (e.g. "gemma4-e4b-q4km"). */
  modelId: string;
  /** Human-readable model name (e.g. "Gemma 4 4B"). */
  modelName: string;
  /** Short variant label (e.g. "4B · Q4_K_M"). */
  variantLabel: string;
  /** Quantization string (e.g. "Q4_K_M"). */
  quantization: string;
  /** Declared model size in GB from the catalog. */
  sizeGb: number;
  /** Total bytes consumed on disk by all offline assets (runtime + model + manifests). */
  storageBytesUsed: number;
  /** Absolute path to the offline root directory. */
  installPath: string;
  /** Epoch ms when the model was first installed; null before first install. */
  installedAt: number | null;
  /** Whether the runtime subprocess is currently alive and responding. */
  isRuntimeRunning: boolean;
}

/** Per-model health/availability status. */
export type OfflineModelHealth = "ok" | "missing" | "incomplete" | "unknown";

/**
 * Identity of the currently active offline model — the model that the
 * runtime will load and that new offline chats will use by default.
 *
 * Returned by OFFLINE_GET_ACTIVE_MODEL / OFFLINE_SET_ACTIVE_MODEL.  When
 * no installed offline model is available this is `null` and the renderer
 * is expected to route the user back through the offline install flow
 * before attempting to chat.
 */
export interface OfflineActiveModelInfo {
  /** Catalog ID, e.g. "gemma3-1b-q4km". */
  id: string;
  /** Human-readable model name (e.g. "Gemma 3 1B (Test)"). */
  name: string;
  /** Short variant label (e.g. "1B · Q4_K_M"). */
  variantLabel: string;
}

/**
 * Renderer-facing summary for one installed offline model.  Returned from
 * OFFLINE_LIST_INSTALLED, one entry per model row in the offline_models DB
 * table.  Includes whatever the renderer needs to render a row in the
 * Offline Models management UI without follow-up IPC calls.
 */
export interface OfflineModelSummary {
  /** Catalog ID, e.g. "gemma4-e4b-q4km". */
  id: string;
  /** Human-readable model name (e.g. "Gemma 4 E4B"). */
  name: string;
  /** Short variant label (e.g. "E4B · Q4_K_M"). */
  variantLabel: string;
  /** Quantization string (e.g. "Q4_K_M"), or empty when unknown. */
  quantization: string;
  /** Top-level family ("gemma-4" / "gemma-3"), or "unknown" if not in the current catalog. */
  family: OfflineModelFamily | "unknown";
  /** Declared catalog size in GB (the "expected" size). */
  declaredSizeGb: number;
  /** Actual size on disk in bytes (0 if the file is missing). */
  sizeOnDiskBytes: number;
  /** Absolute path to the model file. */
  modelPath: string;
  /** Absolute path to the directory containing the model file. */
  modelDir: string;
  /** Per-model health: "ok", "missing", "incomplete", "unknown". */
  health: OfflineModelHealth;
  /** Human-readable explanation when health != "ok". */
  healthReason?: string;
  /** True when this model is the currently selected (active) model. */
  isActive: boolean;
  /** Epoch ms when the model was first installed. */
  installedAt: number;
  /** Epoch ms of last successful chat with this model, or null. */
  lastUsedAt: number | null;
}

/**
 * Renderer-facing summary for one *installable* catalog entry.  Returned
 * from OFFLINE_LIST_AVAILABLE so the management UI can render the
 * "Install another model" picker without re-implementing the catalog.
 */
export interface OfflineCatalogEntrySummary {
  /** Catalog ID. */
  id: string;
  /** Human-readable model name. */
  name: string;
  /** Short variant label. */
  variantLabel: string;
  /** Quantization string. */
  quantization: string;
  /** Family ("gemma-4" or "gemma-3"). */
  family: OfflineModelFamily;
  /** True when this entry is an explicit fallback (Gemma 3). */
  isFallback: boolean;
  /** Approximate download/disk size in GB. */
  sizeGb: number;
  /** Minimum total system RAM in GB required to run this variant. */
  ramRequiredGb: number;
  /** Minimum free disk space in GB required to download + install. */
  diskRequiredGb: number;
  /** Quality / speed tradeoff tier. */
  tier: "balanced" | "quality" | "fast";
  /**
   * Short purpose label for the offline-setup model chooser.
   * Independent of `tier` — see `OfflineModelPurpose` for semantics.
   */
  purpose: OfflineModelPurpose;
  /** True when this model is already installed. */
  installed: boolean;
  /**
   * True when the local hardware meets the RAM/disk requirements.
   * Computed against the cached hardware profile in the main process.
   */
  fitsHardware: boolean;
  /** Short human-readable reason why fitsHardware is false (if applicable). */
  fitReason?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * AppMode this conversation is bound to.  Stamped on the first user
   * message; persists for the life of the conversation so global mode
   * switches do not retroactively rewrite older chats.
   */
  mode: AppMode;
  /**
   * Model id this conversation is bound to.
   *   - For `mode === "online"` this is an OpenRouter model id.
   *   - For `mode === "offline"` this is an offline catalog id.
   *   - NULL for an "unbound" conversation (no message has been sent
   *     yet); the resolver falls back to the current globals in that
   *     case so the empty state stays flexible until first send.
   */
  modelId: string | null;
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
  /** Update the mode/model binding of a conversation (recovery flow + first-send stamp). */
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
   * Reset the consecutive Gemma 4 failure counter and clear the
   * `fallback-offered` state, returning the offline state machine to the
   * default "Try Gemma 4 again" path.  Used by the UI when the user
   * explicitly chooses to keep trying Gemma 4 instead of accepting a
   * fallback.
   */
  OFFLINE_RESET_FAILURES: "offline:reset-failures",
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
  /**
   * Returns OfflineModelSummary[] — every installed offline model with
   * size on disk, health, active flag, and last-used timestamp.  Used by
   * the Offline Models management UI.
   */
  OFFLINE_LIST_INSTALLED: "offline:list-installed",
  /**
   * Returns OfflineCatalogEntrySummary[] — every catalog model the user
   * could install, with installed/fitsHardware flags pre-computed.  Used
   * by the "Install another model" picker.
   */
  OFFLINE_LIST_AVAILABLE: "offline:list-available",
  /**
   * Install an additional offline model from the management UI without
   * touching the global offline state machine.  Same arguments and
   * progress events as OFFLINE_INSTALL but does not flip offlineState
   * to "installing".  Returns true on success, false on failure.
   */
  OFFLINE_INSTALL_ADDITIONAL: "offline:install-additional",
  /**
   * Remove a single installed offline model by id.  Stops the runtime
   * first when the target model is currently active.  Reassigns the
   * active model to another installed model when possible (or null when
   * none remain).  Returns true on success.
   */
  OFFLINE_REMOVE_MODEL: "offline:remove-model",
  /**
   * Set the currently active offline model.  Stops the runtime so the
   * next chat picks up the new model cleanly.  Returns the new active
   * model info ({id,name,variantLabel}) or null if the id is unknown
   * / not installed.
   */
  OFFLINE_SET_ACTIVE_MODEL: "offline:set-active-model",
  /**
   * Returns the currently active offline model as
   * {id,name,variantLabel}, or null when no offline model is installed.
   */
  OFFLINE_GET_ACTIVE_MODEL: "offline:get-active-model",
  /**
   * Reveal a specific offline model's storage location in the OS file
   * manager.  When given an id whose model file exists, shows the file
   * itself selected; otherwise opens the models/ directory.
   */
  OFFLINE_REVEAL_MODEL_FOLDER: "offline:reveal-model-folder",
  /**
   * Push event (main → renderer) fired whenever the active offline
   * model changes (install/remove/explicit set/auto-promotion in the
   * resolver).  Lets every open window refresh without polling.
   * Payload: OfflineActiveModelInfo | null
   */
  OFFLINE_ACTIVE_MODEL_CHANGED: "offline:active-model-changed",
  /** Get the offline-specific settings record. */
  OFFLINE_SETTINGS_GET: "offline:settings-get",
  /** Update one or more offline-specific settings. */
  OFFLINE_SETTINGS_UPDATE: "offline:settings-update",
  /** Reset offline-specific settings to defaults. */
  OFFLINE_SETTINGS_RESET: "offline:settings-reset",
  /**
   * Get a cached HardwareProfile snapshot for the management UI to render
   * hardware tier diagnostics and to warn when the active model is heavier
   * than the local hardware can comfortably handle.
   */
  OFFLINE_GET_HARDWARE_PROFILE: "offline:get-hardware-profile",
} as const;
