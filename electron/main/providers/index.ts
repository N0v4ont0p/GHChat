import { openRouterProvider } from "./openrouter.provider";
import type { LLMProvider } from "./provider.interface";

const providers: LLMProvider[] = [openRouterProvider];

export function getProvider(id: string): LLMProvider {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function getDefaultProvider(): LLMProvider {
  return openRouterProvider;
}

export { openRouterProvider };
export type { LLMProvider };
