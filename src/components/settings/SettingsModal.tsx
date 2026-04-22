import { useState, useEffect } from "react";
import { ExternalLink, CheckCircle2, XCircle, Loader2, Check, Key, Cpu } from "lucide-react";
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
import type { ModelCategory, HuggingFaceDiagnostics } from "@/types";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, selectedModel, setSelectedModel } =
    useSettingsStore();

  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"apikey" | "model">("apikey");
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("general");
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
      setKeyStatus(result.valid ? "valid" : "invalid");
      setKeyMessage(result.message);
      setValidatedToken(result.valid ? trimmed : null);
      setDiagnostics(result.diagnostics ?? null);
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
                      keyStatus === "valid" && "border-green-500/50",
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
                      keyStatus === "valid" ? "text-green-400" : "text-red-400",
                    )}
                  >
                    {keyStatus === "valid" ? (
                      <CheckCircle2 className="h-3 w-3" />
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
                    <p className={cn(diagnostics.tokenValid ? "text-green-400/90" : "text-red-400/90")}>
                      Token: {diagnostics.tokenMessage}
                    </p>
                    <p>
                      Best working models now:{" "}
                      {diagnostics.bestWorkingModels.length > 0
                        ? diagnostics.bestWorkingModels
                            .map((id) => availableModels.find((m) => m.id === id)?.name ?? id.split("/").pop() ?? id)
                            .join(", ")
                        : "None verified yet"}
                    </p>
                    {diagnostics.lastProviderError && (
                      <p className="text-red-400/90">Last provider error: {diagnostics.lastProviderError}</p>
                    )}
                    {diagnostics.recommendedFallback && (
                      <p className="text-amber-400/90">
                        Recommended fallback:{" "}
                        {availableModels.find((m) => m.id === diagnostics.recommendedFallback)?.name ??
                          diagnostics.recommendedFallback}
                      </p>
                    )}
                    <p>
                      Model validity:{" "}
                      {diagnostics.models.filter((m) => m.id !== "__auto__" && m.verifiedStatus === "verified").length} verified
                      {" · "}
                      {diagnostics.models.filter((m) => m.id !== "__auto__" && m.verifiedStatus === "unavailable").length} unavailable
                    </p>
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
                {availableModels.filter((m) => m.category === selectedCategory).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-all",
                      selectedModel === m.id
                        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
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
                          {m.verifiedStatus === "verified" && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-green-300">
                              Verified
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground/60 leading-relaxed">
                          {m.whyChoose}
                        </p>
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
                      </div>
                    </div>
                  </button>
                ))}
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
