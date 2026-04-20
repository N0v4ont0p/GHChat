import { HfInference } from "@huggingface/inference";
import type { ModelInfo } from "../../../src/types";

export const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct v0.3",
    description: "Fast, efficient instruction-following",
  },
  {
    id: "meta-llama/Meta-Llama-3-8B-Instruct",
    name: "Llama 3 8B Instruct",
    description: "Meta's capable open model",
  },
  {
    id: "HuggingFaceH4/zephyr-7b-beta",
    name: "Zephyr 7B Beta",
    description: "Excellent general-purpose chat",
  },
  {
    id: "google/gemma-2-9b-it",
    name: "Gemma 2 9B Instruct",
    description: "Google's powerful chat model",
  },
  {
    id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B Instruct",
    description: "Strong multilingual model",
  },
];

export async function* streamChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): AsyncGenerator<string> {
  const hf = new HfInference(apiKey);
  const stream = hf.chatCompletionStream({
    model,
    messages: messages as Parameters<typeof hf.chatCompletionStream>[0]["messages"],
    max_tokens: 2048,
  });
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) yield token;
  }
}
