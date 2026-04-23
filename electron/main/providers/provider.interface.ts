import type {
  ModelInfo,
  ModelPreset,
  ProviderHealthResult,
  KeyValidationResult,
} from "../../../src/types";

export interface StreamChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChatOptions {
  model: string;
  messages: StreamChatMessage[];
  apiKey?: string;
  signal?: AbortSignal;
  onToken: (token: string) => void;
  /**
   * Called once (or twice if a fallback is triggered) with the resolved model
   * and a human-readable explanation of why it was chosen.  The UI uses this
   * to render "Using Qwen 2.5 · code detected" in the streaming indicator.
   */
  onRoutingDecision?: (info: {
    model: string;
    modelName: string;
    reason: string;
    isAuto: boolean;
    isFallback: boolean;
  }) => void;
  /** Enable OpenRouter web-search plugin if the model supports it */
  webSearch?: boolean;
  /** Enable explicit reasoning mode (e.g. reasoning effort: high) */
  reasoningOn?: boolean;
  /** Override max_tokens for this request */
  maxTokens?: number | null;
  /** User-preference flags used by auto-routing to boost matching models */
  preferences?: {
    webSearch?: boolean;
    reasoningOn?: boolean;
  };
}

/**
 * Common interface for all LLM providers.
 *
 * Implement this to add support for Ollama, LM Studio,
 * OpenAI-compatible APIs, or any future provider.
 */
export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresApiKey: boolean;

  /** Ping the provider to see if it is reachable. */
  healthCheck(): Promise<ProviderHealthResult>;

  /** Validate that the supplied API key is accepted by the provider. */
  validateApiKey(key: string): Promise<KeyValidationResult>;

  /** Return models available on this provider. */
  listModels(apiKey?: string): Promise<ModelInfo[]>;

  /** Return curated model presets with rich metadata. */
  getRecommendedModels(): ModelPreset[];

  /**
   * Stream a chat completion, calling onToken for each
   * incremental piece of content.  Rejects on error.
   */
  streamChat(options: StreamChatOptions): Promise<void>;
}
