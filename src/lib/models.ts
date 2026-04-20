/**
 * Curated model presets for the renderer.
 *
 * This mirrors the list in huggingface.provider.ts (main process).
 * Keeping it in the renderer avoids a round-trip IPC call just for
 * static UI data, while the main process still owns the authoritative list.
 */
import type { ModelPreset, ModelCategory } from "@/types";

export const MODEL_PRESETS: ModelPreset[] = [
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
      "Excels at structured reasoning, analysis, and handles non-English languages especially well.",
    speed: "medium",
    contextWindow: "32k",
  },
];

export const DEFAULT_MODEL =
  MODEL_PRESETS.find((m) => m.isDefault)?.id ?? "mistralai/Mistral-7B-Instruct-v0.3";

export const CATEGORY_META: Record<
  ModelCategory,
  { label: string; description: string; emoji: string }
> = {
  general: {
    label: "General Chat",
    description: "Versatile models for everyday conversations and questions",
    emoji: "💬",
  },
  coding: {
    label: "Coding",
    description: "Optimized for programming, debugging, and code review",
    emoji: "🧑‍💻",
  },
  fast: {
    label: "Fast",
    description: "Compact models for quick answers with minimal latency",
    emoji: "⚡",
  },
  reasoning: {
    label: "Reasoning",
    description: "Stronger at analysis, logic, and multi-step problems",
    emoji: "🧠",
  },
};

export function getPreset(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((m) => m.id === id);
}

export function getModelsByCategory(category: ModelCategory): ModelPreset[] {
  return MODEL_PRESETS.filter((m) => m.category === category);
}

export const ALL_CATEGORIES: ModelCategory[] = ["general", "coding", "fast", "reasoning"];
