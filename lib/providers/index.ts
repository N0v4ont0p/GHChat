import { normalizeHost } from "@/lib/config";

import { OllamaProvider } from "./ollama";

export function createProvider(host?: string | null) {
  return new OllamaProvider(normalizeHost(host));
}
