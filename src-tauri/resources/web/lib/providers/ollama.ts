import type { ModelInfo } from "@/types";

import type {
  ChatStreamOptions,
  LLMProvider,
  ProviderHealth,
} from "./types";

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    size?: number;
    modified_at?: string;
    details?: {
      family?: string;
    };
  }>;
}

interface OllamaChatStreamChunk {
  message?: { content?: string };
  done?: boolean;
}

function formatBytes(bytes?: number) {
  if (!bytes || Number.isNaN(bytes)) return undefined;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value > 10 ? 1 : 2)} ${units[unit]}`;
}

export class OllamaProvider implements LLMProvider {
  id = "ollama";
  name = "Ollama";

  constructor(private readonly host: string) {}

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        cache: "no-store",
      });

      return {
        ok: res.ok,
        statusCode: res.status,
        message: res.ok ? "Ollama reachable" : "Ollama returned an error",
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to reach Ollama host",
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.host}/api/tags`, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Unable to list models from Ollama");
    }

    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((model) => ({
      id: model.name,
      name: model.name,
      size: formatBytes(model.size),
      modifiedAt: model.modified_at,
      family: model.details?.family,
    }));
  }

  async getModelInfo(model: string) {
    const models = await this.listModels();
    return models.find((item) => item.id === model) ?? null;
  }

  async streamChat(options: ChatStreamOptions): Promise<{ final: string }> {
    const response = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        stream: true,
        messages: options.messages,
      }),
    });

    if (!response.ok || !response.body) {
      const reason = await response.text().catch(() => "stream unavailable");
      throw new Error(reason || "Unable to start stream from Ollama");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    let pending = "";
    let finalText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      for (const line of lines) {
        const content = line.trim();
        if (!content) continue;

        const parsed = JSON.parse(content) as OllamaChatStreamChunk;
        const token = parsed.message?.content ?? "";

        if (token) {
          finalText += token;
          options.onToken(token);
        }
      }
    }

    if (pending.trim()) {
      const parsed = JSON.parse(pending.trim()) as OllamaChatStreamChunk;
      const token = parsed.message?.content ?? "";
      if (token) {
        finalText += token;
        options.onToken(token);
      }
    }

    return { final: finalText };
  }
}
