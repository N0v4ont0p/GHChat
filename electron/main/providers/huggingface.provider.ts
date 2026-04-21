import { HfInference } from "@huggingface/inference";
import type { LLMProvider, StreamChatOptions } from "./provider.interface";
import type {
  ModelInfo,
  ModelPreset,
  ProviderHealthResult,
  KeyValidationResult,
} from "../../../src/types";

// ── Curated model catalogue ───────────────────────────────────────────────────

export const RECOMMENDED_MODELS: ModelPreset[] = [
  // ── General Chat ────────────────────────────────────────────────────────────
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct",
    category: "general",
    description: "Fast, capable everyday assistant",
    whyChoose:
      "Great balance of speed and quality for most conversations. The best starting point for new users.",
    isDefault: true,
    isPopular: true,
    speed: "fast",
    contextWindow: "32k",
  },
  {
    id: "HuggingFaceH4/zephyr-7b-beta",
    name: "Zephyr 7B",
    category: "general",
    description: "Helpful and harmless — tuned for conversation",
    whyChoose:
      "Excellent at following nuanced instructions and maintaining a natural, helpful tone throughout long chats.",
    speed: "fast",
    contextWindow: "8k",
  },
  {
    id: "google/gemma-2-9b-it",
    name: "Gemma 2 9B",
    category: "general",
    description: "Google's polished conversational model",
    whyChoose:
      "Higher quality responses with Google's safety tuning. Slightly slower but noticeably more thoughtful.",
    speed: "medium",
    contextWindow: "8k",
  },
  // ── Coding ──────────────────────────────────────────────────────────────────
  {
    id: "Qwen/Qwen2.5-Coder-7B-Instruct",
    name: "Qwen 2.5 Coder 7B",
    category: "coding",
    description: "Purpose-built for programming tasks",
    whyChoose:
      "Trained specifically on code. Excels at Python, TypeScript, Rust, Go, and more. Great for debugging and review.",
    isPopular: true,
    speed: "medium",
    contextWindow: "32k",
  },
  {
    id: "microsoft/Phi-3.5-mini-instruct",
    name: "Phi 3.5 Mini",
    category: "coding",
    description: "Compact model, surprisingly strong at code",
    whyChoose:
      "Microsoft's efficiency-focused model delivers fast, quality code completions in a very small package.",
    speed: "fast",
    contextWindow: "128k",
  },
  // ── Fast ────────────────────────────────────────────────────────────────────
  {
    id: "microsoft/Phi-3-mini-4k-instruct",
    name: "Phi 3 Mini",
    category: "fast",
    description: "Ultra-compact — near-instant responses",
    whyChoose:
      "Ideal when you want quick answers with minimal wait. Best for simple Q&A, summaries, and short tasks.",
    isPopular: true,
    speed: "fast",
    contextWindow: "4k",
  },
  {
    id: "Qwen/Qwen2.5-1.5B-Instruct",
    name: "Qwen 2.5 1.5B",
    category: "fast",
    description: "Tiny model, impressively capable",
    whyChoose:
      "One of the smallest available models. Fastest possible responses. Good for quick factual questions.",
    speed: "fast",
    contextWindow: "32k",
  },
  // ── Reasoning ───────────────────────────────────────────────────────────────
  {
    id: "meta-llama/Meta-Llama-3-8B-Instruct",
    name: "Llama 3 8B Instruct",
    category: "reasoning",
    description: "Meta's flagship open model",
    whyChoose:
      "Excellent at multi-step reasoning, analysis, and complex tasks. Meta's most capable openly released model.",
    isPopular: true,
    speed: "medium",
    contextWindow: "8k",
  },
  {
    id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B",
    category: "reasoning",
    description: "Strong reasoning with multilingual support",
    whyChoose:
      "Alibaba's 7B model excels at structured reasoning, analysis, and handles non-English languages especially well.",
    speed: "medium",
    contextWindow: "32k",
  },
];

// ── Provider implementation ───────────────────────────────────────────────────

export class HuggingFaceProvider implements LLMProvider {
  readonly id = "huggingface";
  readonly name = "Hugging Face";
  readonly requiresApiKey = true;

  async healthCheck(): Promise<ProviderHealthResult> {
    try {
      const res = await fetch("https://huggingface.co", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      const ok = res.status < 500;
      return {
        ok,
        message: ok ? "Hugging Face is reachable" : "Hugging Face returned a server error",
      };
    } catch {
      return { ok: false, message: "Unable to reach Hugging Face — check your internet connection" };
    }
  }

  async validateApiKey(key: string): Promise<KeyValidationResult> {
    const trimmed = key.trim();
    if (!trimmed) {
      return { valid: false, message: "No key provided." };
    }
    if (!trimmed.startsWith("hf_")) {
      return {
        valid: false,
        message: "Invalid format — Hugging Face keys begin with 'hf_'.",
      };
    }

    try {
      const res = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${trimmed}` },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = (await res.json()) as { name?: string };
        return {
          valid: true,
          message: `Valid — signed in as @${data.name ?? "user"}`,
        };
      }
      if (res.status === 401) {
        return { valid: false, message: "Authorization failed — key is invalid or revoked." };
      }
      return { valid: false, message: `Unexpected response (HTTP ${res.status}).` };
    } catch {
      return { valid: false, message: "Network error — check your connection and try again." };
    }
  }

  async listModels(_apiKey?: string): Promise<ModelInfo[]> {
    return this.getRecommendedModels().map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    }));
  }

  getRecommendedModels(): ModelPreset[] {
    return RECOMMENDED_MODELS;
  }

  async streamChat(options: StreamChatOptions): Promise<void> {
    const { model, messages, apiKey = "", signal, onToken } = options;

    const hf = new HfInference(apiKey);

    try {
      const stream = hf.chatCompletionStream(
        {
          model,
          messages: messages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
          max_tokens: 2048,
        },
        { signal },
      );

      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const token = chunk.choices[0]?.delta?.content;
        if (token) onToken(token);
      }
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!shouldFallbackToTextGeneration(message)) {
        throw new Error(
          `Chat completion failed and text-generation fallback does not apply (no route/task mismatch detected). Original error: ${message}`,
        );
      }
    }

    const prompt = buildPromptFromMessages(messages);
    const fallbackStream = hf.textGenerationStream(
      {
        model,
        inputs: prompt,
        parameters: {
          max_new_tokens: 2048,
          return_full_text: false,
        },
      },
      { signal },
    );

    for await (const chunk of fallbackStream) {
      if (signal?.aborted) break;
      const token = chunk.token?.text;
      if (token && !chunk.token.special) onToken(token);
    }
  }
}

function shouldFallbackToTextGeneration(rawError: string): boolean {
  const chatRoutePatterns = [
    /\/v1\/chat\/completions/i,
    /chat completion/i,
    /task not found/i,
    /cannot find route/i,
    /route not found/i,
    /does not support chat/i,
    /chat.+not supported/i,
    /unsupported (task|model).+chat/i,
  ];
  return chatRoutePatterns.some((pattern) => pattern.test(rawError));
}

function buildPromptFromMessages(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): string {
  const lines = messages.map((m) => {
    if (m.role === "system") return `System: ${m.content}`;
    if (m.role === "assistant") return `Assistant: ${m.content}`;
    return `User: ${m.content}`;
  });
  lines.push("Assistant:");
  return lines.join("\n\n");
}

export const huggingFaceProvider = new HuggingFaceProvider();
