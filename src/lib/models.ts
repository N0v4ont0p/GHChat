import type { ModelCategory, ModelPreset } from "@/types";

export const AUTO_MODEL_ID = "__auto__";
export const DEFAULT_MODEL = AUTO_MODEL_ID;

export const CATEGORY_META: Record<
  ModelCategory,
  { label: string; description: string; emoji: string }
> = {
  auto: {
    label: "Auto",
    description: "Automatically chooses the best verified model for your prompt",
    emoji: "🤖",
  },
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
    description: "Better for analysis and multi-step problem solving",
    emoji: "🧠",
  },
  longContext: {
    label: "Long Context",
    description: "Better for long documents and larger context windows",
    emoji: "📚",
  },
};

export const ALL_CATEGORIES: ModelCategory[] = [
  "auto",
  "general",
  "coding",
  "fast",
  "reasoning",
  "longContext",
];

export function getPreset(models: ModelPreset[], id: string): ModelPreset | undefined {
  return models.find((m) => m.id === id);
}

export function getModelsByCategory(models: ModelPreset[], category: ModelCategory): ModelPreset[] {
  return models.filter((m) => m.category === category);
}
