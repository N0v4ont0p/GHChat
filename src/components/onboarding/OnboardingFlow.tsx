import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, ArrowRight, CheckCircle2, Loader2, ShieldAlert, Clock, AlertTriangle, RefreshCw, Search, X } from "lucide-react";
import logoUrl from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { CATEGORY_META, ALL_CATEGORIES, AUTO_MODEL_ID } from "@/lib/models";
import { useSettingsStore } from "@/stores/settings-store";
import { useModels } from "@/hooks/useModels";
import { cn } from "@/lib/utils";
import type { ModelCategory, OpenRouterDiagnostics, ModelVerificationStatus, ValidationLayerState } from "@/types";

interface OnboardingFlowProps {
  onComplete: () => void;
}

type Step = "welcome" | "apikey" | "model" | "done";

const SLIDE = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -32 },
  transition: { duration: 0.25, ease: "easeOut" },
};

/** Badge shown on model cards based on verification status */
function VerificationBadge({ status }: { status: ModelVerificationStatus }) {
  switch (status) {
    case "verified":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-green-300 gap-0.5">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Working
        </Badge>
      );
    case "gated":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-amber-300 gap-0.5">
          <ShieldAlert className="h-2.5 w-2.5" />
          Gated
        </Badge>
      );
    case "rate-limited":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-amber-300 gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          Rate limited
        </Badge>
      );
    case "unavailable":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-muted-foreground gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" />
          Unavailable
        </Badge>
      );
    case "billing-blocked":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-red-300 gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" />
          Billing blocked
        </Badge>
      );
    default:
      return null;
  }
}

function LayerStatus({ label, layer }: { label: string; layer: ValidationLayerState }) {
  const color =
    layer.status === "success"
      ? "text-green-400"
      : layer.status === "warning"
        ? "text-amber-400"
        : layer.status === "failed"
          ? "text-red-400"
          : "text-muted-foreground";
  return (
    <p className={`text-xs ${color}`}>
      <span className="font-medium">{label}:</span> {layer.message}
    </p>
  );
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "ready" | "warning" | "invalid">("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("best");
  const [modelSearch, setModelSearch] = useState("");
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<OpenRouterDiagnostics | null>(null);
  const { selectedModel, setSelectedModel } = useSettingsStore();
  const { data: models = [], isLoading: modelsLoading } = useModels(validatedToken ?? undefined);
  const availableModels = useMemo(
    () => (models.length > 0 ? models : (diagnostics?.models ?? [])),
    [models, diagnostics?.models],
  );

  // Category tabs for the model step (auto is shown separately as a recommendation card)
  const MODEL_STEP_TABS = ALL_CATEGORIES.filter((c) => c !== "auto");

  // Count of non-auto models (for the header description)
  const nonAutoModelCount = useMemo(
    () => availableModels.filter((m) => m.id !== AUTO_MODEL_ID).length,
    [availableModels],
  );

  // Filtered model list: when search is active it spans all categories
  const filteredModels = useMemo(() => {
    return availableModels.filter((m) => {
      if (m.id === AUTO_MODEL_ID) return false; // shown separately in the recommendation card

      const q = modelSearch.trim().toLowerCase();
      if (q) {
        // Search overrides category filter
        return (
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          (m.vendor?.toLowerCase().includes(q) ?? false) ||
          (m.family?.toLowerCase().includes(q) ?? false) ||
          m.id.toLowerCase().includes(q)
        );
      }

      // Category filter (no search)
      if (selectedCategory === "all") return true;
      if (selectedCategory === "best") return !!m.isFeatured;
      return m.category === selectedCategory;
    });
  }, [availableModels, selectedCategory, modelSearch]);

  // After models finish loading, auto-switch from "best" to "general" if the
  // "best" category has no entries (no isFeatured models in the live catalog).
  useEffect(() => {
    if (modelsLoading || availableModels.length === 0) return;
    if (selectedCategory === "best") {
      const hasBestModels = availableModels.some(
        (m) => m.id !== AUTO_MODEL_ID && !!m.isFeatured,
      );
      if (!hasBestModels) setSelectedCategory("general");
    }
  }, [modelsLoading, availableModels, selectedCategory]);

  const validateKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    setValidating(true);
    setKeyStatus("idle");
    try {
      const result = await ipc.validateApiKey(trimmed);
      const diag = result.diagnostics;
      if (!result.valid) {
        setKeyStatus("invalid");
      } else if (
        diag &&
        diag.catalogValidation.status === "success" &&
        diag.modelValidation.status === "success" &&
        diag.streamingValidation.status === "success"
      ) {
        setKeyStatus("ready");
      } else {
        setKeyStatus("warning");
      }
      setKeyMessage(result.message);
      setValidatedToken(result.valid ? trimmed : null);
      if (result.valid && diag) {
        setDiagnostics(diag);
        // Always pre-select Auto — the recommendation card makes it obvious and
        // the user can override by tapping any specific model in the list.
        setSelectedModel(AUTO_MODEL_ID);
        setSelectedCategory("best");
        // Auto-advance to model step — the user has validated and we have results
        setStep("model");
      }
    } catch (err) {
      console.error("[OnboardingFlow] validateKey failed:", err);
      setKeyStatus("invalid");
      setKeyMessage(err instanceof Error ? err.message : "Validation failed. Check your connection and try again.");
    } finally {
      setValidating(false);
    }
  };

  const handleKeyStep = async () => {
    if (keyStatus === "idle" || keyStatus === "invalid") {
      await validateKey();
      return;
    }
    setStep("model");
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await ipc.setApiKey(apiKey.trim());
      // Settings save is best-effort. A DB failure (e.g. missing better-sqlite3
      // native binary in the packaged build) must not strand the user here —
      // App.tsx already treats a stored key + unavailable DB as onboarding-done.
      try {
        await ipc.updateSettings({ defaultModel: selectedModel, onboardingComplete: true });
      } catch (settingsErr) {
        console.warn("[OnboardingFlow] updateSettings failed (non-fatal):", settingsErr);
      }
      onComplete();
    } catch (err) {
      console.error("[OnboardingFlow] handleFinish failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save settings. Please try again.",
        { duration: 6000 },
      );
    } finally {
      setSaving(false);
    }
  };

  // Auto model object for the recommendation card
  const autoModel = useMemo(
    () => availableModels.find((m) => m.id === AUTO_MODEL_ID),
    [availableModels],
  );

  // Human-friendly name for the currently selected model (used in footer summary)
  const selectedModelName = useMemo(() => {
    if (selectedModel === AUTO_MODEL_ID) return "Auto — smart routing";
    const preset = availableModels.find((m) => m.id === selectedModel);
    return preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;
  }, [selectedModel, availableModels]);

  return (
    <div
      className={cn(
        "relative h-screen w-full bg-background",
        step === "model"
          ? "flex flex-col items-center overflow-hidden"
          : "flex items-center justify-center",
      )}
    >
      <div
        className="absolute inset-x-0 top-0 z-20 flex h-11 shrink-0 items-center justify-center"
        style={{ WebkitAppRegion: "drag" } as { WebkitAppRegion: "drag" }}
      >
        <span className="select-none text-xs font-medium tracking-wide text-muted-foreground/60">
          GHchat
        </span>
      </div>
      {/* Subtle radial gradient backdrop */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(263_70%_65%_/_0.06)_0%,_transparent_70%)]" />

      <div
        className={cn(
          "relative",
          step === "model"
            ? "mt-11 flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-6 pb-4"
            : "w-full max-w-lg px-6",
        )}
      >
        {/* Step progress dots */}
        <div
          className={cn(
            "flex items-center justify-center gap-2",
            step === "model" ? "mb-5 shrink-0 pt-4" : "mb-10",
          )}
        >
          {(["welcome", "apikey", "model"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out",
                step === s || (step === "done" && i === 2)
                  ? "w-6 bg-primary"
                  : ["welcome", "apikey", "model", "done"].indexOf(step) > i
                    ? "w-1.5 bg-primary/40"
                    : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <motion.div key="welcome" {...SLIDE} className="space-y-8 text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center">
                <img src={logoUrl} alt="GHchat logo" className="h-24 w-24 object-contain" />
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-bold tracking-tight">Welcome to GHchat</h1>
                <p className="mx-auto max-w-sm text-base text-muted-foreground leading-relaxed">
                  Chat with free AI models via OpenRouter — smart routing,
                  live catalog, and built to stay out of your way.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-left text-sm">
                {[
                  ["🔒", "Secure key storage", "OS-level encryption, never in plain text"],
                  ["💬", "Persistent conversations", "All chats saved locally in SQLite"],
                  ["⚡", "Streaming responses", "Token-by-token, real-time output"],
                  ["🤖", "Smart model routing", "Picks the best free OpenRouter model for each prompt"],
                ].map(([icon, title, desc]) => (
                  <div key={title} className="rounded-xl border border-border bg-card/50 p-3">
                    <div className="mb-1 text-lg">{icon}</div>
                    <div className="font-medium">{title}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                ))}
              </div>
              <Button className="w-full gap-2" size="lg" onClick={() => setStep("apikey")}>
                Get started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {step === "apikey" && (
            <motion.div key="apikey" {...SLIDE} className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">Add your API key</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  GHchat uses the OpenRouter API to access free AI models.
                  After verifying your key, GHchat will fetch the live catalog of
                  available free models.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">How to get a free key</span>
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                  >
                    Open OpenRouter
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
                  <li>Sign up or log in at openrouter.ai</li>
                  <li>
                    Go to{" "}
                    <span className="font-mono bg-muted px-1 rounded text-foreground">
                      Keys
                    </span>
                  </li>
                  <li>Create a new API key</li>
                  <li>Paste it below</li>
                </ol>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="sk-or-••••••••••••••••••••"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyStatus("idle");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleKeyStep()}
                    className={cn(
                      "flex-1 font-mono text-sm",
                       keyStatus === "ready" && "border-green-500/50",
                       keyStatus === "warning" && "border-amber-500/50",
                       keyStatus === "invalid" && "border-red-500/50",
                    )}
                    autoComplete="off"
                    autoFocus
                  />
                  <Button
                    variant="outline"
                    onClick={validateKey}
                    disabled={!apiKey.trim() || validating}
                    className="shrink-0"
                  >
                    {validating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                </div>

                {validating && (
                  <p className="text-xs text-muted-foreground animate-pulse">
                    Verifying key and checking which models work for your account…
                  </p>
                )}

                {keyMessage && !validating && (
                  <p
                    className={cn(
                      "text-xs",
                       keyStatus === "ready"
                         ? "text-green-400"
                         : keyStatus === "warning"
                           ? "text-amber-400"
                           : "text-red-400",
                     )}
                   >
                     {keyStatus === "ready" && (
                       <CheckCircle2 className="mr-1 inline h-3 w-3" />
                     )}
                     {keyStatus === "warning" && (
                       <AlertTriangle className="mr-1 inline h-3 w-3" />
                     )}
                     {keyMessage}
                   </p>
                 )}

                <p className="text-xs text-muted-foreground">
                  Stored with OS-level encryption via{" "}
                  <span className="text-foreground">Electron safeStorage</span>. Never written
                  in plain text.
                </p>

                 {diagnostics && (
                   <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 space-y-1">
                     <LayerStatus label="API Key" layer={diagnostics.keyValidation} />
                     <LayerStatus label="Catalog" layer={diagnostics.catalogValidation} />
                     <LayerStatus label="Models" layer={diagnostics.modelValidation} />
                     <LayerStatus label="Streaming" layer={diagnostics.streamingValidation} />
                     {diagnostics.freeModelCount > 0 && (
                       <p className="text-xs text-muted-foreground">
                         Free models available: <span className="text-green-400">{diagnostics.freeModelCount}</span>
                       </p>
                     )}
                     {diagnostics.bestWorkingModels.length > 0 && (
                       <p className="text-xs text-muted-foreground">
                         Best models right now:{" "}
                         <span className="text-foreground">
                           {diagnostics.bestWorkingModels
                             .map((id) => availableModels.find((m) => m.id === id)?.name ?? id.split("/").pop() ?? id)
                             .join(", ")}
                         </span>
                       </p>
                     )}
                   </div>
                 )}
              </div>

              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep("welcome")} className="flex-1">
                  Back
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={handleKeyStep}
                  disabled={!apiKey.trim() || validating}
                >
                   {keyStatus === "ready" || keyStatus === "warning" ? (
                     <>
                       Continue <ArrowRight className="h-4 w-4" />
                     </>
                  ) : (
                    "Verify & continue"
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "model" && (
            <motion.div key="model" {...SLIDE} className="flex flex-1 flex-col overflow-hidden min-h-0">
              {/* ── Header ─────────────────────────────────────────────── */}
              <div className="shrink-0 space-y-1.5 mb-4">
                <h2 className="text-2xl font-bold tracking-tight">Choose your starting model</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  GHchat fetched{" "}
                  <span className="text-foreground font-medium">
                    {diagnostics?.freeModelCount ?? nonAutoModelCount}
                  </span>{" "}
                  free models from OpenRouter. Pick one below — you can always change it later in
                  Settings.
                </p>
                {diagnostics && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={async () => {
                        const next = await ipc.refreshDiagnostics(apiKey.trim() || undefined);
                        setDiagnostics(next);
                      }}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Refresh availability
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Checked {new Date(diagnostics.checkedAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>

              {/* ── Auto recommendation card ────────────────────────── */}
              <div className="shrink-0 mb-3">
                <button
                  onClick={() => setSelectedModel(AUTO_MODEL_ID)}
                  className={cn(
                    "w-full rounded-xl border-2 p-3.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out motion-safe:hover:-translate-y-px motion-safe:active:scale-[0.997] motion-safe:active:translate-y-0",
                    selectedModel === AUTO_MODEL_ID
                      ? "border-cyan-500/60 bg-cyan-500/8 ring-1 ring-cyan-500/30"
                      : "border-cyan-500/20 bg-cyan-500/5 hover:border-cyan-500/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="mt-0.5 text-xl shrink-0">🤖</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                          <span className="font-semibold text-sm text-cyan-300">Auto</span>
                          <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-400 font-medium leading-none">
                            Recommended
                          </span>
                          {autoModel && <VerificationBadge status={autoModel.verifiedStatus} />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Routes each prompt to the best available free model automatically —
                          coding, reasoning, creative, and fast queries each get the right model.
                        </p>
                      </div>
                    </div>
                    {selectedModel === AUTO_MODEL_ID && (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan-400" />
                    )}
                  </div>
                </button>
              </div>

              {/* ── Search + category tabs ──────────────────────────── */}
              <div className="shrink-0 space-y-2 mb-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search models by name, vendor, or capability…"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {modelSearch && (
                    <button
                      onClick={() => setModelSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {!modelSearch && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
                    {MODEL_STEP_TABS.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                          selectedCategory === cat
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span>{CATEGORY_META[cat].emoji}</span>
                        {CATEGORY_META[cat].label}
                      </button>
                    ))}
                  </div>
                )}
                {modelSearch && (
                  <p className="text-[11px] text-muted-foreground">
                    Searching across all categories
                  </p>
                )}
              </div>

              {/* ── Scrollable model list ────────────────────────────── */}
              <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1 pb-2 [scrollbar-width:thin]">
                {modelsLoading && availableModels.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading models…
                  </div>
                ) : (
                  <>
                    {filteredModels.map((m) => {
                      const isLimitedAccess =
                        m.verifiedStatus === "unavailable" || m.verifiedStatus === "gated";
                      return (
                        <button
                          key={m.id}
                          onClick={() => setSelectedModel(m.id)}
                          className={cn(
                            "w-full rounded-xl border p-3.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out motion-safe:hover:-translate-y-px motion-safe:active:scale-[0.997] motion-safe:active:translate-y-0",
                            selectedModel === m.id
                              ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
                              : isLimitedAccess
                                ? "border-border/40 bg-card/20 opacity-60"
                                : "border-border bg-card/50 hover:border-border/80 hover:bg-card",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-semibold">{m.name}</span>
                                {m.vendor && (
                                  <span className="rounded border border-border/50 bg-secondary/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                                    {m.vendor}
                                  </span>
                                )}
                                <VerificationBadge status={m.verifiedStatus} />
                              </div>
                              <p className="text-xs text-muted-foreground">{m.description}</p>
                              <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
                                {m.whyChoose}
                              </p>
                              {m.verifiedStatus === "gated" && (
                                <p className="mt-1 text-[10px] text-amber-400/80">
                                  Requires model access approval
                                </p>
                              )}
                              {m.verifiedStatus === "rate-limited" && (
                                <p className="mt-1 text-[10px] text-amber-400/80">
                                  Rate limited during check — may work in a few minutes
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-muted-foreground">
                              {m.contextWindow && (
                                <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono leading-none text-muted-foreground/60 whitespace-nowrap">
                                  {m.contextWindow}
                                </span>
                              )}
                              {m.speed && (
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 font-medium leading-none",
                                    m.speed === "fast"
                                      ? "bg-green-500/10 text-green-400"
                                      : m.speed === "medium"
                                        ? "bg-yellow-500/10 text-yellow-400"
                                        : "bg-orange-500/10 text-orange-400",
                                  )}
                                >
                                  {m.speed}
                                </span>
                              )}
                              {selectedModel === m.id && (
                                <CheckCircle2 className="h-4 w-4 text-primary" />
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {filteredModels.length === 0 && (
                      <div className="py-10 text-center">
                        <p className="text-sm text-muted-foreground">
                          {modelSearch
                            ? `No models match "${modelSearch}"`
                            : "No models in this category"}
                        </p>
                        {modelSearch ? (
                          <button
                            onClick={() => setModelSearch("")}
                            className="mt-2 text-xs text-primary hover:underline"
                          >
                            Clear search
                          </button>
                        ) : (
                          <button
                            onClick={() => setSelectedCategory("all")}
                            className="mt-2 text-xs text-primary hover:underline"
                          >
                            Browse all models
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Footer ──────────────────────────────────────────── */}
              <div className="mt-4 shrink-0 space-y-2.5">
                {/* Selected model summary — keeps the user informed even while scrolled */}
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" />
                  <span className="truncate">
                    Starting with:{" "}
                    <span className="font-medium text-foreground">{selectedModelName}</span>
                  </span>
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep("apikey")} className="flex-1">
                    Back
                  </Button>
                  <Button className="flex-1 gap-2" onClick={handleFinish} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Start chatting <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
