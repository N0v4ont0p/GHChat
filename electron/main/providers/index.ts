import { huggingFaceProvider } from "./huggingface.provider";
import type { LLMProvider } from "./provider.interface";

/**
 * Provider registry.
 *
 * Add new providers here as the app grows.
 * Future entries: ollamaProvider, lmStudioProvider, openAiProvider, …
 */
const providers: LLMProvider[] = [huggingFaceProvider];

export function getProvider(id: string): LLMProvider {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function getDefaultProvider(): LLMProvider {
  return huggingFaceProvider;
}

export { huggingFaceProvider };
export type { LLMProvider };
