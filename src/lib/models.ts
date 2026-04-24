import type { ModelCategory, ModelPreset } from "@/types";

export const AUTO_MODEL_ID = "__auto__";
export const DEFAULT_MODEL = AUTO_MODEL_ID;

export const CATEGORY_META: Record<
  ModelCategory,
  { label: string; description: string; emoji: string }
> = {
  all: {
    label: "All Models",
    description: "Every free model available via OpenRouter",
    emoji: "🌐",
  },
  auto: {
    label: "Auto",
    description: "Automatically chooses the best free model for your prompt",
    emoji: "🤖",
  },
  best: {
    label: "Best",
    description: "Top-tier free models — large, capable, and broadly recommended",
    emoji: "⭐",
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
  creative: {
    label: "Creative",
    description: "Open-ended, imaginative, and story-oriented conversations",
    emoji: "✨",
  },
};

export const ALL_CATEGORIES: ModelCategory[] = [
  "auto",
  "best",
  "general",
  "coding",
  "fast",
  "reasoning",
  "longContext",
  "creative",
  "all",
];

export function getPreset(models: ModelPreset[], id: string): ModelPreset | undefined {
  return models.find((m) => m.id === id);
}

export function getModelsByCategory(models: ModelPreset[], category: ModelCategory): ModelPreset[] {
  if (category === "best") return models.filter((m) => m.isFeatured || m.category === "best");
  return models.filter((m) => m.category === category);
}
