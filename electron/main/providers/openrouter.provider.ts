import type { LLMProvider, StreamChatOptions } from "./provider.interface";
import type {
  ModelInfo,
  ModelPreset,
  ModelCapabilities,
  ModelRuntimeHealth,
  ModelCategory,
  ProviderHealthResult,
  KeyValidationResult,
  OpenRouterDiagnostics,
  ValidationLayerState,
  ChatFailureKind,
} from "../../../src/types";

const OR_BASE_URL = "https://openrouter.ai/api/v1";
const OR_FREE_ROUTER_ID = "openrouter/free";
const AUTO_MODEL_ID = "__auto__";
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const HEALTH_CACHE_TTL_MS = 3 * 60 * 1000;

type Role = "user" | "assistant" | "system";

interface RouterChatMessage {
  role: Role;
  content: string;
}

interface RouterStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

interface RouterError extends Error {
  status?: number;
  model?: string;
  fallbackModel?: string;
  kind?: ChatFailureKind;
}

interface RawOrModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  architecture?: { modality?: string; tokenizer?: string };
  top_provider?: { context_length?: number; max_completion_tokens?: number };
}

const FRIENDLY_NAMES: Record<string, string> = {
  "openrouter/free": "OpenRouter Free (Auto)",
  "google/gemma-4-31b-it:free": "Gemma 4 31B IT",
  "google/gemma-4-26b-a4b-it:free": "Gemma 4 26B A4B IT",
  "google/gemma-3-12b-it:free": "Gemma 3 12B IT",
  "google/gemma-3n-e2b-it:free": "Gemma 3n E2B IT",
  "qwen/qwen3-coder:free": "Qwen3 Coder",
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
  "nvidia/nemotron-3-nano-30b-a3b:free": "Nemotron Nano 30B",
  "inclusionai/ling-2.6-flash:free": "Ling 2.6 Flash",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": "Dolphin Mistral 24B",
  "liquid/lfm-2.5-1.2b-instruct:free": "LFM 2.5 1.2B",
};

const KNOWN_FREE_IDS = [
  OR_FREE_ROUTER_ID,
  "inclusionai/ling-2.6-flash:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-coder:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "google/gemma-3-12b-it:free",
  "google/gemma-3n-e2b-it:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "liquid/lfm-2.5-1.2b-instruct:free",
];

const LARGE_MODEL_REGEX = /\b(70b|65b|40b|34b|33b|30b|27b|26b)\b/i;

function detectCapabilities(id: string, name: string, contextLength: number): ModelCapabilities {
  const combined = id + " " + name;
  const isLargeModel = LARGE_MODEL_REGEX.test(combined);
  const coding = /coder|code|coding/i.test(combined);
  const reasoning = /nemotron|deepseek-r|qwq|o1|o3|thinking|reason/i.test(combined);
  const creative = /dolphin|hermes|roleplay|creative|uncensored/i.test(combined);
  const longContext = contextLength > 32768;
  const toolUse = /tool/i.test(name);
  const fastBySize = /nano|mini|tiny|small|1\.5b|1b|2b|flash/i.test(combined);
  const fast = !isLargeModel && (contextLength <= 8192 || fastBySize);
  const specialReasoning = reasoning;
  return { coding, reasoning, fast, creative, longContext, toolUse, specialReasoning, streaming: true };
}

function formatContextWindow(length: number): string {
  if (length >= 1_000_000) return `${Math.round(length / 1_000_000)}M`;
  if (length >= 1000) return `${Math.round(length / 1000)}k`;
  return String(length);
}

function deriveFriendlyName(id: string): string {
  if (FRIENDLY_NAMES[id]) return FRIENDLY_NAMES[id];
  const base = id.replace(/:free$/, "").split("/").pop() ?? id;
  return base
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeToPreset(raw: RawOrModel): ModelPreset {
  const capabilities = detectCapabilities(raw.id, raw.name, raw.context_length);
  let category: ModelCategory = "general";
  if (capabilities.coding) category = "coding";
  else if (capabilities.reasoning) category = "reasoning";
  else if (capabilities.creative) category = "creative";
  else if (capabilities.fast) category = "fast";
  else if (capabilities.longContext) category = "longContext";

  const isLarge = LARGE_MODEL_REGEX.test(raw.id + raw.name);
  const speed = capabilities.fast ? "fast" : isLarge ? "slow" : "medium";

  const whyParts: string[] = [];
  if (capabilities.coding) whyParts.push("coding");
  if (capabilities.reasoning) whyParts.push("reasoning");
  if (capabilities.creative) whyParts.push("creative writing");
  if (capabilities.longContext) whyParts.push("long context");
  if (capabilities.fast) whyParts.push("fast responses");
  const whyChoose = whyParts.length > 0
    ? `Good for ${whyParts.join(", ")}. Free via OpenRouter.`
    : "General purpose free model via OpenRouter.";

  return {
    id: raw.id,
    name: deriveFriendlyName(raw.id),
    category,
    description: raw.description ?? "Free model via OpenRouter",
    whyChoose,
    speed,
    contextWindow: formatContextWindow(raw.context_length),
    supportsStreaming: true,
    costTier: "free",
    freeTierFriendly: true,
    verifiedStatus: "unknown",
    capabilities,
    runtimeHealth: "available",
  };
}

function buildAutoPreset(): ModelPreset {
  return {
    id: AUTO_MODEL_ID,
    name: "Auto (Recommended)",
    category: "auto",
    description: "Routes each prompt to the best free model via OpenRouter",
    whyChoose: "Best default — intelligently picks the right free model for each prompt.",
    isDefault: true,
    isPopular: true,
    speed: "fast",
    contextWindow: "adaptive",
    supportsStreaming: true,
    costTier: "free",
    freeTierFriendly: true,
    healthTags: ["free-tier-friendly", "fallback-ready"],
    fallbackModel: OR_FREE_ROUTER_ID,
    verifiedStatus: "verified",
    verifiedMessage: "Router mode",
    capabilities: {
      coding: true, reasoning: true, fast: true, creative: true,
      longContext: true, toolUse: false, specialReasoning: true, streaming: true,
    },
    runtimeHealth: "available",
  };
}

function buildFallbackPresets(): ModelPreset[] {
  const known = KNOWN_FREE_IDS.filter((id) => id !== OR_FREE_ROUTER_ID);
  return known.map((id) =>
    normalizeToPreset({
      id,
      name: FRIENDLY_NAMES[id] ?? id,
      context_length: 32768,
      pricing: { prompt: "0", completion: "0" },
    }),
  );
}

function validationLayer(
  status: ValidationLayerState["status"],
  message: string,
  checkedAt: number,
  statusCode?: number,
): ValidationLayerState {
  return { status, message, checkedAt, statusCode };
}

type PromptIntent = "coding" | "reasoning" | "creative" | "fast" | "longContext" | "general";

function classifyPrompt(messages: Array<{ role: string; content: string }>): PromptIntent {
  const last = messages.filter((m) => m.role === "user").slice(-1)[0];
  if (!last) return "general";
  const text = last.content;
  if (/\b(code|bug|debug|typescript|javascript|python|rust|go|sql|refactor|compile|function|class|import|syntax|error|lint)\b/i.test(text)) return "coding";
  if (/\b(explain why|prove|reason|analyze|analysis|tradeoff|step by step|derive|logic|proof)\b/i.test(text)) return "reasoning";
  if (/\b(story|poem|creative|imagine|write a|roleplay|character|fiction)\b/i.test(text)) return "creative";
  if (/\b(quick|brief|tl;dr|short|one line|summarize)\b/i.test(text)) return "fast";
  if (text.length > 2800) return "longContext";
  return "general";
}

function scoreModel(preset: ModelPreset, intent: PromptIntent): number {
  const health = preset.runtimeHealth ?? "available";
  let score = 0;
  if (health === "available") score += 4;
  else if (health === "degraded") score += 3;
  else if (health === "rate-limited") score += 2;
  else score += 1;

  const cap = preset.capabilities;
  if (!cap) return score;

  if (intent === "coding" && cap.coding) score += 3;
  if (intent === "reasoning" && cap.reasoning) score += 3;
  if (intent === "creative" && cap.creative) score += 3;
  if (intent === "fast" && cap.fast) score += 3;
  if (intent === "longContext" && cap.longContext) score += 3;
  if (intent === "fast" && preset.speed === "fast") score += 2;

  return score;
}

interface RouteDecision {
  primaryModel: string;
  fallbackModel: string;
  reason: string;
  isAuto: boolean;
}

/**
 * Maps HTTP status codes to typed failure kinds.
 * OpenRouter uses standard HTTP semantics:
 * 401 - invalid/expired API key
 * 402 - insufficient credits
 * 403 - model access denied (e.g. moderation block)
 * 404 - model not found or not available in region
 * 429 - rate limited (per-minute or per-day quota)
 * 503 - provider overloaded or temporarily unavailable
 */
function inferFailureKind(status: number | undefined, message: string): ChatFailureKind {
  if (status === 401) return "token-invalid";
  if (status === 402) return "billing-blocked";
  if (status === 403) return "model-gated";
  if (status === 404) return "model-unavailable";
  if (status === 429) return "rate-limited";
  if (status === 503) return "provider-unavailable";
  if (/network|fetch|connect/i.test(message)) return "network";
  if (/unsupported|not supported|incompatible/i.test(message)) return "route-unsupported";
  return "unknown";
}

export class OpenRouterProvider implements LLMProvider {
  readonly id = "openrouter";
  readonly name = "OpenRouter";
  readonly requiresApiKey = true;

  private catalogByToken = new Map<string, { models: ModelPreset[]; fetchedAt: number }>();
  private diagnosticsByToken = new Map<string, OpenRouterDiagnostics>();
  private runtimeHealthMap = new Map<string, ModelRuntimeHealth>();

  async healthCheck(): Promise<ProviderHealthResult> {
    try {
      const res = await fetch("https://openrouter.ai", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      const ok = res.status < 500;
      return { ok, message: ok ? "OpenRouter is reachable" : "OpenRouter returned a server error" };
    } catch {
      return { ok: false, message: "Unable to reach OpenRouter — check your internet connection" };
    }
  }

  async warmupForToken(key: string): Promise<void> {
    const token = key.trim();
    if (!token) return;
    try {
      await this.getDiagnostics(token, { forceProbe: true });
    } catch {
      // best-effort warmup only
    }
  }

  async validateApiKey(key: string): Promise<KeyValidationResult> {
    const token = key.trim();
    if (!token) return { valid: false, message: "No key provided." };

    try {
      const res = await fetch(`${OR_BASE_URL}/auth/key`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 401) {
        return { valid: false, message: "Invalid API key — check your OpenRouter key." };
      }
      if (!res.ok) {
        return { valid: false, message: `OpenRouter returned ${res.status} — try again later.` };
      }

      const diagnostics = await this.getDiagnostics(token, { forceProbe: true });
      return {
        valid: true,
        message: `API key valid. ${diagnostics.freeModelCount} free model(s) available.`,
        diagnostics,
      };
    } catch {
      return { valid: false, message: "Network error — check your connection and try again." };
    }
  }

  async listModels(apiKey?: string): Promise<ModelInfo[]> {
    const models = await this.listModelPresets(apiKey);
    return models.map((m) => ({ id: m.id, name: m.name, description: m.description }));
  }

  async listModelPresets(apiKey?: string): Promise<ModelPreset[]> {
    const token = apiKey?.trim();
    if (!token) return this.getRecommendedModels();
    return this.fetchLiveCatalog(token);
  }

  getRecommendedModels(): ModelPreset[] {
    return [buildAutoPreset(), ...buildFallbackPresets()];
  }

  private async fetchLiveCatalog(apiKey: string): Promise<ModelPreset[]> {
    const cached = this.catalogByToken.get(apiKey);
    if (cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
      return cached.models;
    }

    try {
      const res = await fetch(`${OR_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return this.getRecommendedModels();

      const data = (await res.json()) as { data: RawOrModel[] };
      const freeModels = data.data.filter(
        (m) => m.pricing.prompt === "0" && m.pricing.completion === "0",
      );

      const presets: ModelPreset[] = [buildAutoPreset()];
      for (const raw of freeModels) {
        presets.push(normalizeToPreset(raw));
      }

      for (const p of presets) {
        const h = this.runtimeHealthMap.get(p.id);
        if (h) p.runtimeHealth = h;
      }

      this.catalogByToken.set(apiKey, { models: presets, fetchedAt: Date.now() });
      return presets;
    } catch {
      return this.getRecommendedModels();
    }
  }

  async getDiagnostics(
    apiKey: string,
    options: { forceProbe?: boolean } = {},
  ): Promise<OpenRouterDiagnostics> {
    const token = apiKey.trim();
    const cached = this.diagnosticsByToken.get(token);
    const isFresh = cached && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL_MS;
    if (cached && isFresh && !options.forceProbe) return cached;

    const now = Date.now();

    let keyValid = false;
    let keyMsg = "";
    let keyStatus: ValidationLayerState["status"] = "failed";
    let keyStatusCode: number | undefined;
    try {
      const res = await fetch(`${OR_BASE_URL}/auth/key`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      keyStatusCode = res.status;
      if (res.ok) {
        keyValid = true;
        keyMsg = "API key is valid.";
        keyStatus = "success";
      } else if (res.status === 401) {
        keyMsg = "Invalid API key.";
      } else {
        keyMsg = `OpenRouter returned ${res.status}.`;
      }
    } catch {
      keyMsg = "Network error during key validation.";
    }

    if (!keyValid) {
      const diag: OpenRouterDiagnostics = {
        apiKeyValid: false,
        apiKeyMessage: keyMsg,
        keyValidation: validationLayer(keyStatus, keyMsg, now, keyStatusCode),
        catalogValidation: validationLayer("failed", "Catalog unavailable until key is valid.", now),
        modelValidation: validationLayer("failed", "Model checks skipped — invalid key.", now),
        streamingValidation: validationLayer("failed", "Streaming unavailable — invalid key.", now),
        checkedAt: now,
        models: this.getRecommendedModels(),
        freeModelCount: 0,
        bestWorkingModels: [],
        noVerifiedModels: true,
        recommendedFallback: OR_FREE_ROUTER_ID,
      };
      this.diagnosticsByToken.set(token, diag);
      return diag;
    }

    const models = await this.fetchLiveCatalog(token);
    const freeCount = models.filter((m) => m.id !== AUTO_MODEL_ID && m.costTier === "free").length;
    const catalogOk = freeCount > 0;
    const catalogValidation = validationLayer(
      catalogOk ? "success" : "warning",
      catalogOk ? `${freeCount} free model(s) found in catalog.` : "No free models found in catalog.",
      now,
    );

    const modelValidation = validationLayer(
      freeCount > 0 ? "success" : "warning",
      freeCount > 0
        ? `${freeCount} free model(s) ready to use.`
        : "No verified free models. openrouter/free will be used as fallback.",
      now,
    );

    const streamingValidation = validationLayer(
      "success",
      "All OpenRouter models support streaming.",
      now,
    );

    const bestWorkingModels = models
      .filter((m) => m.id !== AUTO_MODEL_ID && (m.runtimeHealth ?? "available") === "available")
      .slice(0, 4)
      .map((m) => m.id);

    const diag: OpenRouterDiagnostics = {
      apiKeyValid: true,
      apiKeyMessage: keyMsg,
      keyValidation: validationLayer("success", keyMsg, now),
      catalogValidation,
      modelValidation,
      streamingValidation,
      checkedAt: now,
      models,
      freeModelCount: freeCount,
      bestWorkingModels,
      noVerifiedModels: freeCount === 0,
      recommendedFallback: bestWorkingModels[0] ?? OR_FREE_ROUTER_ID,
    };
    this.diagnosticsByToken.set(token, diag);
    return diag;
  }

  private resolveRoute(
    selectedModel: string,
    messages: Array<{ role: string; content: string }>,
    models: ModelPreset[],
  ): RouteDecision {
    const isAuto = selectedModel === AUTO_MODEL_ID || selectedModel === OR_FREE_ROUTER_ID;

    if (!isAuto) {
      const preset = models.find((m) => m.id === selectedModel);
      return {
        primaryModel: selectedModel,
        fallbackModel: preset?.fallbackModel ?? OR_FREE_ROUTER_ID,
        reason: "Selected by you",
        isAuto: false,
      };
    }

    const intent = classifyPrompt(messages);
    const candidates = models.filter((m) => m.id !== AUTO_MODEL_ID);

    const scored = candidates
      .map((m) => ({ model: m, score: scoreModel(m, intent) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.model;
    if (!best) {
      return {
        primaryModel: OR_FREE_ROUTER_ID,
        fallbackModel: OR_FREE_ROUTER_ID,
        reason: "Fallback router",
        isAuto: true,
      };
    }

    const intentLabels: Record<PromptIntent, string> = {
      coding: "code detected",
      reasoning: "reasoning needed",
      creative: "creative prompt",
      fast: "quick response requested",
      longContext: "long context",
      general: "general prompt",
    };

    return {
      primaryModel: best.id,
      fallbackModel: OR_FREE_ROUTER_ID,
      reason: intentLabels[intent],
      isAuto: true,
    };
  }

  private async streamOpenRouterChat(opts: {
    apiKey: string;
    model: string;
    messages: RouterChatMessage[];
    signal?: AbortSignal;
    onToken: (t: string) => void;
  }): Promise<void> {
    const res = await fetch(`${OR_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/N0v4ont0p/GHChat",
        "X-Title": "GHchat",
      },
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
        messages: opts.messages,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        text.length > 0 ? text.slice(0, 180) : `OpenRouter returned ${res.status}`,
      ) as RouterError;
      err.status = res.status;
      err.model = opts.model;
      err.kind = inferFailureKind(res.status, err.message);
      throw err;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data:")) continue;
          try {
            const chunk = JSON.parse(trimmed.slice(5).trim()) as RouterStreamChunk;
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) opts.onToken(token);
          } catch {
            // skip malformed chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async streamChat(options: StreamChatOptions): Promise<void> {
    const token = options.apiKey?.trim() ?? "";
    if (!token) {
      const err = new Error("No API key set.") as RouterError;
      err.status = 401;
      err.kind = "token-invalid";
      throw err;
    }

    const diagnostics = await this.getDiagnostics(token);
    const models = diagnostics.models;

    const route = this.resolveRoute(options.model, options.messages, models);
    const modelName = (id: string) =>
      models.find((m) => m.id === id)?.name ?? id.split("/").pop() ?? id;

    options.onRoutingDecision?.({
      model: route.primaryModel,
      modelName: modelName(route.primaryModel),
      reason: route.reason,
      isAuto: route.isAuto,
      isFallback: false,
    });

    const attempted = new Set<string>();
    let activeModel = route.primaryModel;
    let usedFallback = false;

    while (activeModel && !attempted.has(activeModel)) {
      attempted.add(activeModel);
      try {
        await this.streamOpenRouterChat({
          apiKey: token,
          model: activeModel,
          messages: options.messages as RouterChatMessage[],
          signal: options.signal,
          onToken: options.onToken,
        });
        this.runtimeHealthMap.set(activeModel, "available");
        if (usedFallback) {
          // Update diagnostics to record fallback was used, instead of clearing the whole cache
          const cached = this.diagnosticsByToken.get(token);
          if (cached) {
            this.diagnosticsByToken.set(token, { ...cached, usedFallbackRouter: activeModel === OR_FREE_ROUTER_ID });
          }
        }
        return;
      } catch (err) {
        const routerErr = err as RouterError;
        if (options.signal?.aborted) throw err;

        const status = routerErr.status;
        if (status === 429) this.runtimeHealthMap.set(activeModel, "rate-limited");
        else if (status === 503) this.runtimeHealthMap.set(activeModel, "degraded");
        else if (status === 404) this.runtimeHealthMap.set(activeModel, "unavailable");
        else if (status === 401 || status === 402) throw err;

        const nextModel = attempted.has(route.fallbackModel)
          ? OR_FREE_ROUTER_ID
          : route.fallbackModel;

        if (nextModel && !attempted.has(nextModel)) {
          usedFallback = true;
          activeModel = nextModel;
          options.onRoutingDecision?.({
            model: nextModel,
            modelName: modelName(nextModel),
            reason: "Fallback after error",
            isAuto: route.isAuto,
            isFallback: true,
          });
        } else if (!attempted.has(OR_FREE_ROUTER_ID)) {
          usedFallback = true;
          activeModel = OR_FREE_ROUTER_ID;
          options.onRoutingDecision?.({
            model: OR_FREE_ROUTER_ID,
            modelName: "OpenRouter Free (Auto)",
            reason: "Ultimate fallback",
            isAuto: route.isAuto,
            isFallback: true,
          });
        } else {
          throw err;
        }
      }
    }
  }
}

export const openRouterProvider = new OpenRouterProvider();
