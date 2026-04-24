import { useState, useEffect } from "react";
import { ExternalLink, CheckCircle2, XCircle, Loader2, Check, Key, Cpu, ShieldAlert, Clock, AlertTriangle, RefreshCw, LogOut, Trash2, Search, SlidersHorizontal } from "lucide-react";
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
import { useChatStore } from "@/stores/chat-store";
import { ipc } from "@/lib/ipc";
import { CATEGORY_META, ALL_CATEGORIES, AUTO_MODEL_ID } from "@/lib/models";
import { useModels } from "@/hooks/useModels";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { ModelCategory, ModelPreset, OpenRouterDiagnostics, ModelVerificationStatus, ValidationLayerState } from "@/types";

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

/** Capability pill badges — compact visual row shown on each model card */
function CapabilityPills({ preset }: { preset: ModelPreset }) {
  const cap = preset.capabilities;
  const isAuto = preset.id === AUTO_MODEL_ID;
  const pills: Array<{ label: string; icon: string; color: string }> = [];

  if (isAuto) {
    pills.push({ label: "Coding", icon: "🧑‍💻", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" });
    pills.push({ label: "Reasoning", icon: "🧠", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" });
    pills.push({ label: "Creative", icon: "✨", color: "bg-pink-500/10 text-pink-400 border-pink-500/20" });
    pills.push({ label: "Fast", icon: "⚡", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" });
  } else if (cap) {
    if (cap.coding) pills.push({ label: "Coding", icon: "🧑‍💻", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" });
    if (cap.reasoning || cap.specialReasoning) pills.push({ label: "Reasoning", icon: "🧠", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" });
    if (cap.creative) pills.push({ label: "Creative", icon: "✨", color: "bg-pink-500/10 text-pink-400 border-pink-500/20" });
    if (cap.fast) pills.push({ label: "Fast", icon: "⚡", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" });
    if (cap.longContext) pills.push({ label: "Long ctx", icon: "📚", color: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20" });
    if (cap.webSearch) pills.push({ label: "Search", icon: "🔍", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" });
    if (cap.reasoningMode) pills.push({ label: "Think", icon: "💭", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {pills.slice(0, 5).map((p) => (
        <span
          key={p.label}
          className={cn("inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none", p.color)}
        >
          <span className="text-[9px]">{p.icon}</span>
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** Parse a context window string like "128k ctx", "1M ctx", "8192 ctx" into a numeric token count */
function parseContextWindowTokens(contextWindow: string | undefined): number {
  if (!contextWindow) return 0;
  const num = Number(contextWindow.replace(/[^0-9]/g, ""));
  if (contextWindow.includes("M")) return num * 1_000_000;
  if (contextWindow.includes("k")) return num * 1_000;
  return num;
}

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, selectedModel, setSelectedModel } =
    useSettingsStore();
  const setSelectedConversationId = useChatStore((s) => s.setSelectedConversationId);
  const qc = useQueryClient();

  const [apiKey, setApiKey] = useState("");
  const [storedKeyExists, setStoredKeyExists] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "ready" | "warning" | "invalid">("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [activeTab, setActiveTab] = useState<"apikey" | "model">("model");
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("best");
  const [modelSearch, setModelSearch] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "context" | "name">("default");
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<OpenRouterDiagnostics | null>(null);
  const { data: models = [] } = useModels(validatedToken ?? undefined);
  const availableModels = models.length > 0 ? models : (diagnostics?.models ?? []);

  useEffect(() => {
    if (settingsOpen) {
      ipc.getApiKey().then((k) => {
        setStoredKeyExists(!!k);
        setApiKey(k);
        setValidatedToken(k || null);
        setKeyStatus("idle");
        setKeyMessage("");
        setChangingKey(!k); // show input immediately when no key is stored
      }).catch(() => {});
      ipc.getDiagnostics().then(setDiagnostics).catch(() => {});
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
      setStoredKeyExists(true);
      setChangingKey(false);
      toast.success("Settings saved");
      setSettingsOpen(false);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    setRemovingKey(true);
    try {
      await ipc.deleteApiKey();
      await ipc.updateSettings({ onboardingComplete: false, lastConversationId: null });
      toast.success("API key removed. Please re-enter your key to continue.");
      setSettingsOpen(false);
      // Reload the window to go back to onboarding
      window.location.reload();
    } catch {
      toast.error("Failed to remove API key");
    } finally {
      setRemovingKey(false);
    }
  };

  const handleClearAllData = async () => {
    setClearingData(true);
    try {
      // clearAllData resets conversations, messages, settings flags, and the key
      await ipc.clearAllData();
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedConversationId(null);
      toast.success("All data cleared. Re-enter your key to continue.");
      setSettingsOpen(false);
      window.location.reload();
    } catch {
      toast.error("Failed to clear data");
    } finally {
      setClearingData(false);
    }
  };

  const handleCancelKeyChange = () => {
    setChangingKey(false);
    setApiKey("");
    setKeyStatus("idle");
    setKeyMessage("");
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/50">
          <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure your OpenRouter API key and preferred model.
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
              {tab === "apikey" ? "API Key" : "Models"}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 max-h-[520px] overflow-y-auto">
          {activeTab === "apikey" && (
            <div className="space-y-4">
              {/* Connected status banner */}
              {storedKeyExists && !changingKey && (
                <div className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <span className="text-sm font-medium text-green-400">Connected</span>
                    <span className="text-xs text-muted-foreground">OpenRouter API key is stored securely.</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setChangingKey(true)}
                  >
                    Change key
                  </Button>
                </div>
              )}

              {/* Key input — shown when no key stored or user wants to change */}
              {(!storedKeyExists || changingKey) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">OpenRouter API Key</label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="sk-or-••••••••••••••••••••"
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

                  {changingKey && (
                    <button
                      onClick={handleCancelKeyChange}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-border/50 bg-card/50 p-3 text-xs text-muted-foreground space-y-1.5">
                <p>
                  Get a free key at{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    openrouter.ai/keys
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
                    <LayerStatus label="API Key" layer={diagnostics.keyValidation} />
                    <LayerStatus label="Catalog" layer={diagnostics.catalogValidation} />
                    <LayerStatus label="Models" layer={diagnostics.modelValidation} />
                    <LayerStatus label="Streaming" layer={diagnostics.streamingValidation} />
                    {diagnostics.freeModelCount > 0 && (
                      <p className="text-muted-foreground">
                        Free models: <span className="text-green-400/90">{diagnostics.freeModelCount}</span>
                      </p>
                    )}
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
                    {diagnostics.usedFallbackRouter && (
                      <p className="text-amber-400/70">openrouter/free was used as fallback router.</p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={async () => {
                          const refreshed = await ipc.refreshDiagnostics(apiKey.trim() || undefined);
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
              </div>

              {/* Danger zone */}
              {storedKeyExists && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-red-400/80">Danger zone</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-red-500/30 text-red-400/80 hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/10"
                      onClick={handleRemoveKey}
                      disabled={removingKey || clearingData}
                    >
                      {removingKey ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <LogOut className="mr-1.5 h-3 w-3" />}
                      Remove API key / Sign out
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-red-500/30 text-red-400/80 hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/10"
                      onClick={handleClearAllData}
                      disabled={removingKey || clearingData}
                    >
                      {clearingData ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1.5 h-3 w-3" />}
                      Clear all data
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">
                    "Remove key" clears your API key and returns to setup. "Clear all data" removes conversations, messages, and your key.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "model" && (() => {
              const q = modelSearch.trim().toLowerCase();

              // Category filter
              const categoryFiltered = availableModels.filter((m) => {
                if (selectedCategory === "all") return true;
                if (selectedCategory === "auto") return m.id === AUTO_MODEL_ID;
                if (selectedCategory === "best") return m.isFeatured || m.id === AUTO_MODEL_ID;
                return m.category === selectedCategory;
              });

              // Text search filter
              const filteredModels = q
                ? categoryFiltered.filter((m) =>
                    m.name.toLowerCase().includes(q) ||
                    m.id.toLowerCase().includes(q) ||
                    (m.vendor ?? "").toLowerCase().includes(q) ||
                    (m.family ?? "").toLowerCase().includes(q) ||
                    (m.description ?? "").toLowerCase().includes(q),
                  )
                : categoryFiltered;

              // Sort
              const sortedModels = [...filteredModels].sort((a, b) => {
                // Auto always first
                if (a.id === AUTO_MODEL_ID) return -1;
                if (b.id === AUTO_MODEL_ID) return 1;
                if (sortBy === "name") return a.name.localeCompare(b.name);
                if (sortBy === "context") {
                  const aCtx = parseContextWindowTokens(a.contextWindow);
                  const bCtx = parseContextWindowTokens(b.contextWindow);
                  return bCtx - aCtx;
                }
                // Default: featured first, then by speed
                if (a.isFeatured && !b.isFeatured) return -1;
                if (!a.isFeatured && b.isFeatured) return 1;
                const speedOrder = { fast: 0, medium: 1, slow: 2 };
                return (speedOrder[a.speed ?? "medium"] ?? 1) - (speedOrder[b.speed ?? "medium"] ?? 1);
              });

              // Count models per category for badges
              const getCatCount = (cat: ModelCategory) => {
                if (cat === "auto") return availableModels.filter((m) => m.id === AUTO_MODEL_ID).length;
                if (cat === "best") return availableModels.filter((m) => m.isFeatured || m.id === AUTO_MODEL_ID).length;
                if (cat === "all") return availableModels.length;
                return availableModels.filter((m) => m.category === cat).length;
              };

              return (
            <div className="space-y-3">
              {/* Search + sort row */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models by name, vendor, or capability…"
                    className="w-full rounded-lg border border-border/60 bg-secondary/50 pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {modelSearch && (
                    <button
                      onClick={() => setModelSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Sort control */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "default" | "context" | "name")}
                    className="rounded-lg border border-border/60 bg-secondary/50 px-2 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                  >
                    <option value="default">Recommended</option>
                    <option value="context">Context size</option>
                    <option value="name">A–Z</option>
                  </select>
                </div>
              </div>

              {/* Category filter — horizontally scrollable */}
              <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-hide">
                {ALL_CATEGORIES.map((cat) => {
                  const count = getCatCount(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={cn(
                        "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0",
                        selectedCategory === cat
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="text-[11px]">{CATEGORY_META[cat].emoji}</span>
                      {CATEGORY_META[cat].label}
                      {count > 0 && selectedCategory !== cat && (
                        <span className="ml-0.5 text-[10px] opacity-50">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Category description */}
              <p className="text-[11px] text-muted-foreground/60 leading-snug">
                {CATEGORY_META[selectedCategory].description}
                {sortedModels.length > 0 && (
                  <span className="ml-1 opacity-60">· {sortedModels.length} model{sortedModels.length !== 1 ? "s" : ""}</span>
                )}
              </p>

              {/* Model cards */}
              <div className="space-y-2">
                {sortedModels.map((m) => {
                  const isAuto = m.id === AUTO_MODEL_ID;
                  const isSelected = selectedModel === m.id;
                  const isLimitedAccess = m.verifiedStatus === "unavailable" || m.verifiedStatus === "gated";

                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-all",
                        isSelected
                          ? isAuto
                            ? "border-cyan-500/40 bg-cyan-500/5 ring-1 ring-cyan-500/20"
                            : "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                          : isAuto
                            ? "border-cyan-500/20 bg-cyan-500/5 hover:border-cyan-500/40 hover:bg-cyan-500/8"
                            : isLimitedAccess
                              ? "border-border/40 bg-card/20 opacity-60"
                              : "border-border/60 bg-card/30 hover:border-border hover:bg-card/60",
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="flex-1 min-w-0">
                          {/* Name row */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn("font-semibold text-sm leading-tight", isAuto && "text-cyan-300")}>
                              {m.name}
                            </span>
                            {/* Vendor chip */}
                            {m.vendor && (
                              <span className="rounded border border-border/50 bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none">
                                {m.vendor}
                              </span>
                            )}
                            {isAuto && (
                              <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-400 font-medium leading-none">
                                Recommended
                              </span>
                            )}
                            {m.isFeatured && !isAuto && (
                              <span className="rounded border border-amber-500/20 bg-amber-500/8 px-1.5 py-0.5 text-[10px] text-amber-400/80 leading-none">
                                ⭐ Top pick
                              </span>
                            )}
                            <VerificationBadge status={m.verifiedStatus} />
                          </div>

                          {/* Model ID in mono */}
                          <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/35 truncate">{m.id}</p>

                          {/* Description */}
                          <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug line-clamp-2">
                            {m.description}
                          </p>

                          {/* whyChoose */}
                          {m.whyChoose && !isAuto && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground/50 leading-snug">
                              {m.whyChoose}
                            </p>
                          )}
                          {isAuto && (
                            <p className="mt-0.5 text-[11px] text-cyan-400/70 leading-snug">
                              {m.whyChoose}
                            </p>
                          )}

                          {/* Status warnings */}
                          {m.verifiedStatus === "gated" && (
                            <p className="mt-1 text-[10px] text-amber-400/80">
                              ⚠ Requires model access approval on OpenRouter
                            </p>
                          )}
                          {m.verifiedStatus === "rate-limited" && (
                            <p className="mt-1 text-[10px] text-amber-400/80">
                              ⚠ Rate limited — may work again shortly
                            </p>
                          )}

                          {/* Capability pills */}
                          <CapabilityPills preset={m} />
                        </div>

                        {/* Right column: check + metadata */}
                        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                          {isSelected && (
                            <div className={cn(
                              "flex h-5 w-5 items-center justify-center rounded-full",
                              isAuto ? "bg-cyan-500" : "bg-primary",
                            )}>
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                          {m.contextWindow && (
                            <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/60 leading-none font-mono whitespace-nowrap">
                              {m.contextWindow}
                            </span>
                          )}
                          {m.speed && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
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
                        </div>
                      </div>
                    </button>
                  );
                })}
                {sortedModels.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground/50">
                      {modelSearch ? `No models match "${modelSearch}"` : "No models in this category yet."}
                    </p>
                    {modelSearch && (
                      <button
                        onClick={() => setModelSearch("")}
                        className="mt-2 text-xs text-primary/70 hover:text-primary transition-colors"
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
              );
            })()}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || (activeTab === "apikey" && storedKeyExists && !changingKey)}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
