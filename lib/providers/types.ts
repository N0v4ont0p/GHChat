import type { ModelInfo } from "@/types";

export interface ProviderHealth {
  ok: boolean;
  statusCode?: number;
  message?: string;
}

export interface ProviderMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatStreamOptions {
  model: string;
  messages: ProviderMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
}

export interface LLMProvider {
  id: string;
  name: string;
  healthCheck(): Promise<ProviderHealth>;
  listModels(): Promise<ModelInfo[]>;
  streamChat(options: ChatStreamOptions): Promise<{ final: string }>;
  getModelInfo(model: string): Promise<ModelInfo | null>;
}
