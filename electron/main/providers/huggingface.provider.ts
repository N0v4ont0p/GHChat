import type { LLMProvider, StreamChatOptions } from "./provider.interface";
import type {
  ModelInfo,
  ModelPreset,
  ProviderHealthResult,
  KeyValidationResult,
  HuggingFaceDiagnostics,
  ModelCategory,
  ModelVerificationStatus,
} from "../../../src/types";

const HF_ROUTER_BASE_URL = "https://router.huggingface.co/v1";
const AUTO_MODEL_ID = "__auto__";
const PROBE_TIMEOUT_MS = 9000;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const DIAGNOSTIC_CACHE_TTL_MS = 3 * 60 * 1000;
// Roughly where prompt size starts to benefit from long-context routing for free-tier models.
const LONG_CONTEXT_THRESHOLD = 2800;
const MAX_ERROR_MESSAGE_LENGTH = 180;
const LONG_CONTEXT_REGEX = /\b(transcript|contract|full\s+document|long\s+context|large\s+file)\b/;
const SCORE_HIGH = 3;
const SCORE_MEDIUM = 2;
const SCORE_LOW = 1;

type Role = "user" | "assistant" | "system";

interface RouterChatMessage {
  role: Role;
  content: string;
}

interface RouterStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

interface RouterCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface RouterError extends Error {
  status?: number;
  model?: string;
  fallbackModel?: string;
}

interface ProbeResult {
  status: ModelVerificationStatus;
  message: string;
}

const BASE_MODELS: ModelPreset[] = [
  {
    id: AUTO_MODEL_ID,
    name: "Auto (Recommended)",
    category: "auto",
    description: "Routes each prompt to the best verified model for your account",
    whyChoose: "Best default for free-tier reliability and changing model availability.",
    isDefault: true,
    isPopular: true,
    speed: "fast",
    contextWindow: "adaptive",
    supportsStreaming: true,
    costTier: "free",
    fallbackModel: "Qwen/Qwen2.5-7B-Instruct",
    verifiedStatus: "verified",
    verifiedMessage: "Router mode",
  },
  {
    id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B Instruct",
    category: "general",
    description: "Reliable everyday chat model with strong quality/speed balance",
    whyChoose: "Great default for normal chat and mixed tasks.",
    isPopular: true,
    speed: "medium",
    contextWindow: "32k",
    supportsStreaming: true,
    costTier: "free",
    fallbackModel: "meta-llama/Llama-3.1-8B-Instruct",
    verifiedStatus: "unknown",
  },
  {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B Instruct",
    category: "general",
    description: "High-quality general assistant responses",
    whyChoose: "Good general quality when available for your account.",
    speed: "medium",
    contextWindow: "8k",
    supportsStreaming: true,
    costTier: "standard",
    fallbackModel: "Qwen/Qwen2.5-7B-Instruct",
    verifiedStatus: "unknown",
  },
  {
    id: "Qwen/Qwen2.5-Coder-7B-Instruct",
    name: "Qwen 2.5 Coder 7B",
    category: "coding",
    description: "Code-focused model for debugging and generation",
    whyChoose: "Reliable coding output with good instruction following.",
    isPopular: true,
    speed: "medium",
    contextWindow: "32k",
    supportsStreaming: true,
    costTier: "free",
    fallbackModel: "Qwen/Qwen2.5-7B-Instruct",
    verifiedStatus: "unknown",
  },
  {
    id: "microsoft/Phi-3-mini-4k-instruct",
    name: "Phi 3 Mini",
    category: "fast",
    description: "Small and fast model for quick answers",
    whyChoose: "Best for low-latency and low-credit usage.",
    isPopular: true,
    speed: "fast",
    contextWindow: "4k",
    supportsStreaming: true,
    costTier: "free",
    fallbackModel: "Qwen/Qwen2.5-1.5B-Instruct",
    verifiedStatus: "unknown",
  },
  {
    id: "Qwen/Qwen2.5-1.5B-Instruct",
    name: "Qwen 2.5 1.5B",
    category: "fast",
    description: "Tiny model optimized for speed and cost",
    whyChoose: "Excellent fallback when credits are tight or rate-limited.",
    speed: "fast",
    contextWindow: "32k",
    supportsStreaming: true,
    costTier: "free",
    fallbackModel: "microsoft/Phi-3-mini-4k-instruct",
    verifiedStatus: "unknown",
  },
  {
    id: "mistralai/Mistral-Nemo-Instruct-2407",
    name: "Mistral Nemo Instruct",
    category: "reasoning",
    description: "Better for analytical and multi-step instructions",
    whyChoose: "Strong reasoning quality for harder prompts.",
    speed: "medium",
    contextWindow: "128k",
    supportsStreaming: true,
    costTier: "standard",
    fallbackModel: "Qwen/Qwen2.5-7B-Instruct",
    verifiedStatus: "unknown",
  },
  {
    id: "microsoft/Phi-3.5-mini-instruct",
    name: "Phi 3.5 Mini",
    category: "longContext",
    description: "Large context window model for long prompts/files",
    whyChoose: "Prefer this when you need bigger context on free-tier compatible hardware.",
    speed: "fast",
    contextWindow: "128k",
    supportsStreaming: true,
    costTier: "free",
    fallbackModel: "Qwen/Qwen2.5-7B-Instruct",
    verifiedStatus: "unknown",
  },
];

function cloneBaseModels(): ModelPreset[] {
  return BASE_MODELS.map((m) => ({ ...m }));
}

export class HuggingFaceProvider implements LLMProvider {
  readonly id = "huggingface";
  readonly name = "Hugging Face";
  readonly requiresApiKey = true;

  private diagnosticsByToken = new Map<string, HuggingFaceDiagnostics>();
  private tokenValidatedAt = new Map<string, number>();
  private lastProviderErrorByToken = new Map<string, string>();

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
    if (!token.startsWith("hf_")) {
      return {
        valid: false,
        message: "Invalid format — Hugging Face keys begin with 'hf_'.",
      };
    }

    try {
      const whoami = await this.fetchWhoAmI(token, AbortSignal.timeout(PROBE_TIMEOUT_MS));
      if (!whoami.ok) {
        return { valid: false, message: whoami.message };
      }

      this.tokenValidatedAt.set(token, Date.now());
      const diagnostics = await this.getDiagnostics(token, { forceProbe: true });
      return {
        valid: true,
        message: `Valid — signed in as @${whoami.username ?? "user"}`,
        diagnostics,
      };
    } catch {
      return { valid: false, message: "Network error — check your connection and try again." };
    }
  }

  async listModels(apiKey?: string): Promise<ModelInfo[]> {
    const models = await this.listModelPresets(apiKey);
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    }));
  }

  async listModelPresets(apiKey?: string): Promise<ModelPreset[]> {
    const token = apiKey?.trim();
    if (!token) return cloneBaseModels();
    const diagnostics = await this.getDiagnostics(token);
    return diagnostics.models;
  }

  getRecommendedModels(): ModelPreset[] {
    return cloneBaseModels();
  }

  async getDiagnostics(
    apiKey: string,
    options: { forceProbe?: boolean } = {},
  ): Promise<HuggingFaceDiagnostics> {
    const token = apiKey.trim();
    const cached = this.diagnosticsByToken.get(token);
    const isFresh = cached && Date.now() - cached.checkedAt < DIAGNOSTIC_CACHE_TTL_MS;
    if (cached && isFresh && !options.forceProbe) {
      return cached;
    }

    const models = cloneBaseModels();
    const now = Date.now();
    const whoami = await this.fetchWhoAmI(token, AbortSignal.timeout(PROBE_TIMEOUT_MS));
    if (!whoami.ok) {
      const invalid = {
        tokenValid: false,
        tokenMessage: whoami.message,
        checkedAt: now,
        models: models.map((m) => ({
          ...m,
          verifiedStatus: m.id === AUTO_MODEL_ID ? "verified" : "unknown",
          verifiedMessage: m.id === AUTO_MODEL_ID ? "Router mode" : "Token invalid",
          lastCheckedAt: now,
        })),
        bestWorkingModels: [],
        lastProviderError: this.lastProviderErrorByToken.get(token),
        recommendedFallback: "Qwen/Qwen2.5-1.5B-Instruct",
      } satisfies HuggingFaceDiagnostics;
      this.diagnosticsByToken.set(token, invalid);
      return invalid;
    }

    const probeTargets = models.filter((m) => m.id !== AUTO_MODEL_ID);
    const updatedModels = await Promise.all(
      probeTargets.map(async (model) => {
        const result = await this.probeModel(token, model.id);
        return {
          ...model,
          verifiedStatus: result.status,
          verifiedMessage: result.message,
          lastCheckedAt: now,
        };
      }),
    );

    const merged = models.map((model) => {
      if (model.id === AUTO_MODEL_ID) {
        return {
          ...model,
          verifiedStatus: "verified" as const,
          verifiedMessage: "Router mode",
          lastCheckedAt: now,
        };
      }
      return updatedModels.find((m) => m.id === model.id) ?? model;
    });

    const bestWorkingModels = rankWorkingModels(merged)
      .filter((m) => m.id !== AUTO_MODEL_ID)
      .slice(0, 4)
      .map((m) => m.id);

    const diagnostics = {
      tokenValid: true,
      tokenMessage: `Valid — signed in as @${whoami.username ?? "user"}`,
      checkedAt: now,
      models: merged,
      bestWorkingModels,
      lastProviderError: this.lastProviderErrorByToken.get(token),
      recommendedFallback: bestWorkingModels[0] ?? "Qwen/Qwen2.5-1.5B-Instruct",
    } satisfies HuggingFaceDiagnostics;

    this.diagnosticsByToken.set(token, diagnostics);
    return diagnostics;
  }

  async streamChat(options: StreamChatOptions): Promise<void> {
    const token = options.apiKey?.trim() ?? "";
    if (!token) {
      const err = new Error("401 Missing API key") as RouterError;
      err.status = 401;
      throw err;
    }

    await this.ensureValidToken(token);
    const diagnostics = await this.getDiagnostics(token);
    const route = this.resolveRoute(options.model, options.messages, diagnostics.models);
    const attempted = new Set<string>();
    let activeModel = route.primaryModel;
    let lastError: RouterError | null = null;

    while (activeModel && !attempted.has(activeModel)) {
      attempted.add(activeModel);
      try {
        await this.streamRouterChat({
          apiKey: token,
          model: activeModel,
          messages: options.messages,
          signal: options.signal,
          onToken: options.onToken,
        });
        this.updateModelVerification(token, activeModel, "verified", "Streaming OK");
        return;
      } catch (error) {
        const routerError = toRouterError(error, activeModel);
        lastError = routerError;
        this.lastProviderErrorByToken.set(token, formatProviderError(routerError));
        this.updateModelVerification(token, activeModel, "unavailable", formatProviderError(routerError));

        const fallback = this.pickFallbackModel({
          requestedModel: options.model,
          currentModel: activeModel,
          routeFallback: route.fallbackModel,
          diagnosticsModels: diagnostics.models,
          status: routerError.status,
          attempted,
        });

        if (fallback) {
          activeModel = fallback;
          continue;
        }
        break;
      }
    }

    throw decorateFinalError(lastError, route.fallbackModel);
  }

  private async ensureValidToken(token: string): Promise<void> {
    const lastChecked = this.tokenValidatedAt.get(token);
    if (lastChecked && Date.now() - lastChecked < TOKEN_CACHE_TTL_MS) return;
    const whoami = await this.fetchWhoAmI(token, AbortSignal.timeout(PROBE_TIMEOUT_MS));
    if (!whoami.ok) {
      const err = new Error(whoami.message) as RouterError;
      err.status = whoami.status;
      throw err;
    }
    this.tokenValidatedAt.set(token, Date.now());
  }

  private async fetchWhoAmI(
    token: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; username?: string; message: string; status?: number }> {
    try {
      const res = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { name?: string };
        return { ok: true, username: data.name, message: `Valid — signed in as @${data.name ?? "user"}` };
      }
      if (res.status === 401) {
        return { ok: false, status: 401, message: "Authorization failed — key is invalid or revoked." };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, message: "Access denied for this key." };
      }
      return { ok: false, status: res.status, message: `Unexpected response (HTTP ${res.status}).` };
    } catch {
      return { ok: false, message: "Network error — check your connection and try again." };
    }
  }

  private async probeModel(token: string, model: string): Promise<ProbeResult> {
    try {
      await this.runProbeCompletion(token, model);
      return { status: "verified", message: "Verified for this account" };
    } catch (error) {
      const routerError = toRouterError(error, model);
      if (routerError.status === 403) {
        return { status: "unavailable", message: "Forbidden for current account (403)" };
      }
      if (routerError.status === 404) {
        return { status: "unavailable", message: "Model unavailable on router (404)" };
      }
      if (routerError.status === 429) {
        return { status: "unknown", message: "Rate-limited during probe (429)" };
      }
      if (routerError.status === 503) {
        return { status: "unknown", message: "Temporarily unavailable (503)" };
      }
      return { status: "unknown", message: formatProviderError(routerError) };
    }
  }

  private async runProbeCompletion(token: string, model: string): Promise<void> {
    const res = await fetch(`${HF_ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 1,
        temperature: 0,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!res.ok) throw await createRouterErrorFromResponse(res, model);
    // Consume and minimally validate the payload so probing confirms a real completion shape.
    const parsed = (await res.json().catch(() => ({} as RouterCompletionResponse))) as RouterCompletionResponse;
    if (!Array.isArray(parsed.choices)) {
      const err = new Error("Probe response did not include completion choices.") as RouterError;
      err.status = 503;
      err.model = model;
      throw err;
    }
  }

  private resolveRoute(
    selectedModel: string,
    messages: StreamChatOptions["messages"],
    models: ModelPreset[],
  ): { primaryModel: string; fallbackModel?: string } {
    if (selectedModel && selectedModel !== AUTO_MODEL_ID) {
      const selected = models.find((m) => m.id === selectedModel);
      if (selected) {
        return { primaryModel: selected.id, fallbackModel: selected.fallbackModel };
      }
    }

    const prompt = getLastUserMessage(messages);
    const category = classifyPromptCategory(prompt);
    const candidates = rankWorkingModels(models).filter(
      (m) => m.category === category && m.id !== AUTO_MODEL_ID,
    );
    const primary =
      candidates[0]?.id ??
      rankWorkingModels(models).find((m) => m.id !== AUTO_MODEL_ID)?.id ??
      "Qwen/Qwen2.5-1.5B-Instruct";
    const fallback = models.find((m) => m.id === primary)?.fallbackModel;
    return { primaryModel: primary, fallbackModel: fallback };
  }

  private pickFallbackModel(options: {
    requestedModel: string;
    currentModel: string;
    routeFallback?: string;
    diagnosticsModels: ModelPreset[];
    status?: number;
    attempted: Set<string>;
  }): string | undefined {
    if (!shouldFallbackByStatus(options.status)) return undefined;

    const byCurrent = options.diagnosticsModels.find((m) => m.id === options.currentModel)?.fallbackModel;
    const byRequested = options.diagnosticsModels.find((m) => m.id === options.requestedModel)?.fallbackModel;
    const ranked = rankWorkingModels(options.diagnosticsModels)
      .filter((m) => m.id !== AUTO_MODEL_ID)
      .map((m) => m.id);

    const candidates = [options.routeFallback, byCurrent, byRequested, ...ranked].filter(
      (v): v is string => Boolean(v),
    );
    return candidates.find((id) => !options.attempted.has(id));
  }

  private async streamRouterChat(params: {
    apiKey: string;
    model: string;
    messages: StreamChatOptions["messages"];
    signal?: AbortSignal;
    onToken: (token: string) => void;
  }): Promise<void> {
    const response = await fetch(`${HF_ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      throw await createRouterErrorFromResponse(response, params.model);
    }
    if (!response.body) {
      const err = new Error("No response stream body.") as RouterError;
      err.status = 503;
      err.model = params.model;
      throw err;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: RouterStreamChunk;
        try {
          parsed = JSON.parse(payload) as RouterStreamChunk;
        } catch {
          continue;
        }
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) params.onToken(token);
      }
    }
  }

  private updateModelVerification(
    token: string,
    modelId: string,
    status: ModelVerificationStatus,
    message: string,
  ): void {
    const diagnostics = this.diagnosticsByToken.get(token);
    if (!diagnostics) return;
    const checkedAt = Date.now();
    const models = diagnostics.models.map((m) =>
      m.id === modelId
        ? {
            ...m,
            verifiedStatus: status,
            verifiedMessage: message,
            lastCheckedAt: checkedAt,
          }
        : m,
    );
    this.diagnosticsByToken.set(token, {
      ...diagnostics,
      checkedAt,
      models,
      lastProviderError: this.lastProviderErrorByToken.get(token),
      bestWorkingModels: rankWorkingModels(models)
        .filter((m) => m.id !== AUTO_MODEL_ID)
        .slice(0, 4)
        .map((m) => m.id),
      recommendedFallback:
        rankWorkingModels(models).find((m) => m.id !== AUTO_MODEL_ID)?.id ??
        diagnostics.recommendedFallback,
    });
  }
}

function classifyPromptCategory(prompt: string): ModelCategory {
  const lower = prompt.toLowerCase();
  if (/\b(code|bug|debug|typescript|javascript|python|rust|go|sql|refactor|compile|stack\s+trace)\b/.test(lower)) {
    return "coding";
  }
  if (/\b(explain why|prove|reason|analyze|analysis|tradeoff|step by step|derive)\b/.test(lower)) {
    return "reasoning";
  }
  if (/\b(summarize|tl;dr|quick|brief|short answer|one line)\b/.test(lower)) {
    return "fast";
  }
  if (prompt.length > LONG_CONTEXT_THRESHOLD || LONG_CONTEXT_REGEX.test(lower)) {
    return "longContext";
  }
  return "general";
}

function getLastUserMessage(messages: RouterChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

function rankWorkingModels(models: ModelPreset[]): ModelPreset[] {
  const verificationScore: Record<ModelVerificationStatus, number> = {
    verified: SCORE_HIGH,
    unknown: SCORE_MEDIUM,
    unavailable: SCORE_LOW,
  };
  const costScore: Record<ModelPreset["costTier"], number> = {
    free: SCORE_HIGH,
    standard: SCORE_MEDIUM,
    premium: SCORE_LOW,
  };
  const speedScore: Record<NonNullable<ModelPreset["speed"]>, number> = {
    fast: SCORE_HIGH,
    medium: SCORE_MEDIUM,
    slow: SCORE_LOW,
  };
  return [...models].sort((a, b) => {
    const scoreA =
      verificationScore[a.verifiedStatus] * 100 +
      costScore[a.costTier] * 10 +
      speedScore[a.speed ?? "medium"];
    const scoreB =
      verificationScore[b.verifiedStatus] * 100 +
      costScore[b.costTier] * 10 +
      speedScore[b.speed ?? "medium"];
    return scoreB - scoreA;
  });
}

function shouldFallbackByStatus(status?: number): boolean {
  return status === 403 || status === 404 || status === 429 || status === 503;
}

function toRouterError(error: unknown, model: string): RouterError {
  if (isRouterError(error)) return error;
  const err = new Error(error instanceof Error ? error.message : String(error)) as RouterError;
  err.model = model;
  return err;
}

function isRouterError(error: unknown): error is RouterError {
  return typeof error === "object" && error !== null && "message" in error;
}

function formatProviderError(error: RouterError): string {
  const msg = error.message || "Unknown provider error";
  if (error.status) return `${msg} (HTTP ${error.status})`;
  return msg;
}

async function createRouterErrorFromResponse(response: Response, model: string): Promise<RouterError> {
  let message = `Request failed with HTTP ${response.status}`;
  try {
    const data = (await response.json()) as { error?: { message?: string }; message?: string };
    message = data.error?.message ?? data.message ?? message;
  } catch {
    // ignore parse errors
  }
  const err = new Error(message) as RouterError;
  err.status = response.status;
  err.model = model;
  return err;
}

function decorateFinalError(error: RouterError | null, fallbackModel?: string): RouterError {
  if (!error) {
    const unknown = new Error("Unknown model routing failure.") as RouterError;
    unknown.status = 500;
    return unknown;
  }
  const mapped = mapRouterErrorToUserMessage(error.status, error.message, fallbackModel);
  const decorated = new Error(mapped) as RouterError;
  decorated.status = error.status;
  decorated.model = error.model;
  decorated.fallbackModel = fallbackModel;
  return decorated;
}

function mapRouterErrorToUserMessage(
  status: number | undefined,
  message: string,
  fallbackModel?: string,
): string {
  const fallbackHint = fallbackModel ? ` Try fallback model: ${fallbackModel}.` : "";
  if (status === 401) return "Invalid API key — open Settings to update it.";
  if (status === 403)
    return `Access denied for the selected model (403).${fallbackHint || " Try another verified model."}`;
  if (status === 404)
    return `Model not found on Hugging Face router (404).${fallbackHint || " Select another model."}`;
  if (status === 429)
    return `Rate limit reached (429).${fallbackHint || " Wait briefly and retry."}`;
  if (status === 503)
    return `Model/provider temporarily unavailable (503).${fallbackHint || " Retry in a moment."}`;
  if (/network|fetch|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return "Network error — check your internet connection and try again.";
  }
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

export const huggingFaceProvider = new HuggingFaceProvider();
