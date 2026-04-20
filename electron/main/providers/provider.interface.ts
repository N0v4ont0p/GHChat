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
