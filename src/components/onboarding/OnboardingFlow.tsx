import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, ArrowRight, CheckCircle2, Loader2, ShieldAlert, Clock, AlertTriangle } from "lucide-react";
import logoUrl from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ipc } from "@/lib/ipc";
import { CATEGORY_META, ALL_CATEGORIES, AUTO_MODEL_ID } from "@/lib/models";
import { useSettingsStore } from "@/stores/settings-store";
import { useModels } from "@/hooks/useModels";
import { cn } from "@/lib/utils";
import type { ModelCategory, HuggingFaceDiagnostics, ModelVerificationStatus } from "@/types";

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
    default:
      return null;
  }
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("auto");
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<HuggingFaceDiagnostics | null>(null);
  const { selectedModel, setSelectedModel } = useSettingsStore();
  const { data: models = [] } = useModels(validatedToken ?? undefined);
  const availableModels = models.length > 0 ? models : (diagnostics?.models ?? []);

  const validateKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    setValidating(true);
    setKeyStatus("idle");
    try {
      const result = await ipc.validateApiKey(trimmed);
      setKeyStatus(result.valid ? "valid" : "invalid");
      setKeyMessage(result.message);
      setValidatedToken(result.valid ? trimmed : null);
      if (result.valid && result.diagnostics) {
        setDiagnostics(result.diagnostics);
        // Pre-select the best working model, or fall back to Auto
        const best = result.diagnostics.bestWorkingModels[0] ?? AUTO_MODEL_ID;
        setSelectedModel(best);
        setSelectedCategory("auto");
        // Auto-advance to model step — the user has validated and we have results
        setStep("model");
      }
    } finally {
      setValidating(false);
    }
  };

  const handleKeyStep = async () => {
    if (keyStatus !== "valid") {
      await validateKey();
      return;
    }
    setStep("model");
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await ipc.setApiKey(apiKey.trim());
      await ipc.updateSettings({ defaultModel: selectedModel });
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  return (
    <div className="relative flex h-screen w-full items-center justify-center bg-background">
      <div
        className="absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-center"
        style={{ WebkitAppRegion: "drag" } as { WebkitAppRegion: "drag" }}
      >
        <span className="select-none text-xs font-medium tracking-wide text-muted-foreground/60">
          GHchat
        </span>
      </div>
      {/* Subtle radial gradient backdrop */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(263_70%_65%_/_0.06)_0%,_transparent_70%)]" />

      <div className="relative w-full max-w-lg px-6">
        {/* Step progress dots */}
        <div className="mb-10 flex items-center justify-center gap-2">
          {(["welcome", "apikey", "model"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
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
                  A reliable AI chat app for Hugging Face — smart model routing,
                  free-tier friendly, and built to stay out of your way.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-left text-sm">
                {[
                  ["🔒", "Secure key storage", "OS-level encryption, never in plain text"],
                  ["💬", "Persistent conversations", "All chats saved locally in SQLite"],
                  ["⚡", "Streaming responses", "Token-by-token, real-time output"],
                  ["🤖", "Verified model routing", "GHchat checks which models actually work for your account"],
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
                  GHchat uses the Hugging Face Inference API to run AI models. After
                  verifying your key, GHchat will probe a set of models to find which
                  ones are available for your account right now.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">How to get a free key</span>
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                  >
                    Open Hugging Face
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
                  <li>Sign up or log in at huggingface.co</li>
                  <li>
                    Go to{" "}
                    <span className="font-mono bg-muted px-1 rounded text-foreground">
                      Settings → Access Tokens
                    </span>
                  </li>
                  <li>Create a new token with read permissions</li>
                  <li>Paste it below</li>
                </ol>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="hf_••••••••••••••••••••"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyStatus("idle");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleKeyStep()}
                    className={cn(
                      "flex-1 font-mono text-sm",
                      keyStatus === "valid" && "border-green-500/50",
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
                      keyStatus === "valid" ? "text-green-400" : "text-red-400",
                    )}
                  >
                    {keyStatus === "valid" && (
                      <CheckCircle2 className="mr-1 inline h-3 w-3" />
                    )}
                    {keyMessage}
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  Stored with OS-level encryption via{" "}
                  <span className="text-foreground">Electron safeStorage</span>. Never written
                  in plain text.
                </p>

                {diagnostics?.tokenValid && diagnostics.bestWorkingModels.length > 0 && (
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 space-y-0.5">
                    <p className="text-xs font-medium text-green-400">
                      ✓ Found {diagnostics.bestWorkingModels.length} working model{diagnostics.bestWorkingModels.length !== 1 ? "s" : ""} for your account
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {diagnostics.bestWorkingModels
                        .map((id) => availableModels.find((m) => m.id === id)?.name ?? id.split("/").pop() ?? id)
                        .join(", ")}
                    </p>
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
                  {keyStatus === "valid" ? (
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
            <motion.div key="model" {...SLIDE} className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">Your models are ready</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  GHchat checked which models work for your account.{" "}
                  <span className="text-foreground font-medium">Auto</span> is selected by
                  default — it routes each prompt to the best working model automatically.
                </p>
              </div>

              {/* Category tabs */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {ALL_CATEGORIES.map((cat) => (
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

              {/* Model cards */}
              <div className="space-y-2">
                {availableModels.filter((m) => m.category === selectedCategory).map((m) => {
                  const isUnavailable = m.verifiedStatus === "unavailable" || m.verifiedStatus === "gated";
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={cn(
                        "w-full rounded-xl border p-3.5 text-left transition-all",
                        selectedModel === m.id
                          ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
                          : isUnavailable
                            ? "border-border/40 bg-card/20 opacity-60"
                            : "border-border bg-card/50 hover:border-border/80 hover:bg-card",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-sm">{m.name}</span>
                            {m.isDefault && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Recommended
                              </Badge>
                            )}
                            {m.isPopular && !m.isDefault && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Popular
                              </Badge>
                            )}
                            <VerificationBadge status={m.verifiedStatus} />
                          </div>
                          <p className="text-xs text-muted-foreground">{m.description}</p>
                          <p className="mt-1.5 text-xs text-muted-foreground/70 leading-relaxed">
                            {m.whyChoose}
                          </p>
                          {m.verifiedStatus === "gated" && (
                            <p className="mt-1 text-[10px] text-amber-400/80">
                              Requires model access approval on Hugging Face
                            </p>
                          )}
                          {m.verifiedStatus === "rate-limited" && (
                            <p className="mt-1 text-[10px] text-amber-400/80">
                              Rate limited during check — may work in a few minutes
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-muted-foreground">
                          {m.speed && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-medium",
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
                          {m.contextWindow && (
                            <span className="text-muted-foreground/60">{m.contextWindow}</span>
                          )}
                          <span className="text-muted-foreground/60">{m.costTier}</span>
                        </div>
                      </div>
                      {selectedModel === m.id && (
                        <div className="mt-2 flex items-center gap-1 text-[11px] text-primary">
                          <CheckCircle2 className="h-3 w-3" />
                          Selected
                        </div>
                      )}
                    </button>
                  );
                })}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
