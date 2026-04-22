import { useState, useEffect } from "react";
import { ExternalLink, CheckCircle2, XCircle, Loader2, Check, Key, Cpu, ShieldAlert, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/stores/settings-store";
import { ipc } from "@/lib/ipc";
import { CATEGORY_META, ALL_CATEGORIES } from "@/lib/models";
import { useModels } from "@/hooks/useModels";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ModelCategory, HuggingFaceDiagnostics, ModelVerificationStatus, ValidationLayerState } from "@/types";

/** Compact verification badge used inside model cards */
function VerificationBadge({ status }: { status: ModelVerificationStatus }) {
  switch (status) {
    case "verified":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-green-300 gap-0.5">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Working
        </Badge>
      );
    case "gated":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-amber-300 gap-0.5">
          <ShieldAlert className="h-2.5 w-2.5" />
          Gated
        </Badge>
      );
    case "rate-limited":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-amber-300 gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          Rate limited
        </Badge>
      );
    case "unavailable":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" />
          Unavailable
        </Badge>
      );
    case "billing-blocked":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-red-300 gap-0.5">
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
      ? "text-green-400/90"
      : layer.status === "warning"
        ? "text-amber-400/90"
        : layer.status === "failed"
          ? "text-red-400/90"
          : "text-muted-foreground";
  return (
    <p className={color}>
      <span className="font-medium">{label}:</span> {layer.message}
    </p>
  );
}

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, selectedModel, setSelectedModel } =
    useSettingsStore();

  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "ready" | "warning" | "invalid">("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"apikey" | "model">("apikey");
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("auto");
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<HuggingFaceDiagnostics | null>(null);
  const { data: models = [] } = useModels(validatedToken ?? undefined);
  const availableModels = models.length > 0 ? models : (diagnostics?.models ?? []);

  useEffect(() => {
    if (settingsOpen) {
      ipc.getApiKey().then((k) => {
        setApiKey(k);
        setValidatedToken(k || null);
        setKeyStatus("idle");
        setKeyMessage("");
      }).catch(() => {});
      ipc.getHfDiagnostics().then(setDiagnostics).catch(() => {});
    }
  }, [settingsOpen]);

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
        diag.inferenceValidation.status === "success" &&
        diag.modelValidation.status === "success" &&
        diag.streamingValidation.status === "success"
      ) {
        setKeyStatus("ready");
      } else {
        setKeyStatus("warning");
      }
      setKeyMessage(result.message);
      setValidatedToken(result.valid ? trimmed : null);
      setDiagnostics(diag ?? null);
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipc.setApiKey(apiKey.trim());
      await ipc.updateSettings({ defaultModel: selectedModel });
      toast.success("Settings saved");
      setSettingsOpen(false);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="text-lg">Settings</DialogTitle>
          <DialogDescription className="text-sm">
            Configure your API key and preferred model.
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex gap-0 border-b border-border/50 px-6">
          {(["apikey", "model"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors -mb-px",
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "apikey" ? <Key className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
              {tab === "apikey" ? "API Key" : "Model"}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 max-h-[480px] overflow-y-auto">
          {activeTab === "apikey" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Hugging Face API Key</label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="hf_••••••••••••••••••••"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyStatus("idle");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && validateKey()}
                    className={cn(
                      "flex-1 font-mono text-sm",
                       keyStatus === "ready" && "border-green-500/50",
                       keyStatus === "warning" && "border-amber-500/50",
                       keyStatus === "invalid" && "border-red-500/50",
                    )}
                    autoComplete="off"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={validateKey}
                    disabled={!apiKey.trim() || validating}
                    className="shrink-0"
                  >
                    {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify"}
                  </Button>
                </div>

                {keyMessage && (
                  <p
                    className={cn(
                      "flex items-center gap-1 text-xs",
                       keyStatus === "ready"
                         ? "text-green-400"
                         : keyStatus === "warning"
                           ? "text-amber-400"
                           : "text-red-400",
                     )}
                   >
                     {keyStatus === "ready" ? (
                       <CheckCircle2 className="h-3 w-3" />
                     ) : keyStatus === "warning" ? (
                       <AlertTriangle className="h-3 w-3" />
                     ) : (
                       <XCircle className="h-3 w-3" />
                     )}
                    {keyMessage}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border/50 bg-card/50 p-3 text-xs text-muted-foreground space-y-1.5">
                <p>
                  Get a free key at{" "}
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    hf.co/settings/tokens
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </p>
                <p>
                  Stored with OS-level encryption via{" "}
                  <span className="text-foreground font-medium">Electron safeStorage</span>.
                  Never written in plain text or uploaded anywhere.
                </p>
                {diagnostics && (
                  <div className="space-y-1 pt-1">
                    <LayerStatus label="Token" layer={diagnostics.tokenValidation} />
                    <LayerStatus label="Inference" layer={diagnostics.inferenceValidation} />
                    <LayerStatus label="Models" layer={diagnostics.modelValidation} />
                    <LayerStatus label="Streaming" layer={diagnostics.streamingValidation} />
                    {diagnostics.bestWorkingModels.length > 0 && (
                      <p>
                        Best working:{" "}
                        <span className="text-green-400/90">
                          {diagnostics.bestWorkingModels
                            .map((id) => availableModels.find((m) => m.id === id)?.name ?? id.split("/").pop() ?? id)
                            .join(", ")}
                        </span>
                      </p>
                    )}
                    {diagnostics.lastProviderError && (
                      <p className="text-red-400/90">Last error: {diagnostics.lastProviderError}</p>
                    )}
                    {diagnostics.recommendedFallback && (
                      <p className="text-amber-400/90">
                        Recommended fallback:{" "}
                        {availableModels.find((m) => m.id === diagnostics.recommendedFallback)?.name ??
                          diagnostics.recommendedFallback}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={async () => {
                          const refreshed = await ipc.refreshHfDiagnostics(apiKey.trim() || undefined);
                          setDiagnostics(refreshed);
                        }}
                      >
                        <RefreshCw className="mr-1 h-2.5 w-2.5" />
                        Refresh model availability
                      </Button>
                      <span className="text-[10px] text-muted-foreground/70">
                        Last checked {new Date(diagnostics.checkedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                )}
                {apiKey && (
                  <button
                    onClick={() => {
                      setApiKey("");
                      setValidatedToken(null);
                      setDiagnostics(null);
                      setKeyStatus("idle");
                      setKeyMessage("");
                    }}
                    className="text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    Clear stored key
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === "model" && (
            <div className="space-y-4">
              {/* Category filter */}
              <div className="flex gap-1.5 flex-wrap">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
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

              <p className="text-xs text-muted-foreground">
                {CATEGORY_META[selectedCategory].description}
              </p>

              {/* Model cards */}
              <div className="space-y-2">
                {availableModels.filter((m) => m.category === selectedCategory).map((m) => {
                  const isLimitedAccess = m.verifiedStatus === "unavailable" || m.verifiedStatus === "gated";
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-all",
                        selectedModel === m.id
                          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                          : isLimitedAccess
                            ? "border-border/40 bg-card/20 opacity-60"
                            : "border-border/60 bg-card/30 hover:border-border hover:bg-card/60",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                            <span className="font-medium text-sm">{m.name}</span>
                            {m.isDefault && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                Recommended
                              </Badge>
                            )}
                            {m.isPopular && !m.isDefault && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                Popular
                              </Badge>
                            )}
                            <VerificationBadge status={m.verifiedStatus} />
                          </div>
                          <p className="text-xs text-muted-foreground">{m.description}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground/60 leading-relaxed">
                            {m.whyChoose}
                          </p>
                          {m.verifiedStatus === "gated" && (
                            <p className="mt-1 text-[10px] text-amber-400/80">
                              Requires model access approval on Hugging Face
                            </p>
                          )}
                          {m.verifiedStatus === "rate-limited" && (
                            <p className="mt-1 text-[10px] text-amber-400/80">
                              Rate limited — may work again shortly
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {selectedModel === m.id && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                              <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                          {m.speed && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
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
                            <span className="text-[10px] text-muted-foreground/50">
                              {m.contextWindow}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground/50">{m.costTier}</span>
                          {m.freeTierFriendly && (
                            <span className="text-[10px] text-green-400/70">free-tier friendly</span>
                          )}
                          {m.isSlow && (
                            <span className="text-[10px] text-amber-400/70">slow</span>
                          )}
                          {m.isExperimental && (
                            <span className="text-[10px] text-fuchsia-400/70">experimental</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
