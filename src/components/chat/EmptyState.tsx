import { motion } from "framer-motion";
import { Sparkles, Code2, Lightbulb, BookOpen, MessageSquarePlus, EyeOff, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateConversation } from "@/hooks/useConversations";
import { getPreset, CATEGORY_META } from "@/lib/models";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import { useModels } from "@/hooks/useModels";
import { cn } from "@/lib/utils";

const PROMPTS = [
  {
    icon: Code2,
    label: "Write code",
    prompt: "Help me write a TypeScript function that debounces any async function with proper typing.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20",
  },
  {
    icon: Lightbulb,
    label: "Explain a concept",
    prompt: "Explain how transformer attention mechanisms work, with an intuitive analogy.",
    color: "text-amber-400",
    bg: "bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/20",
  },
  {
    icon: BookOpen,
    label: "Summarize",
    prompt: "Summarize the key differences between React Server Components and client components.",
    color: "text-blue-400",
    bg: "bg-blue-500/10 hover:bg-blue-500/15 border-blue-500/20",
  },
  {
    icon: Sparkles,
    label: "Brainstorm",
    prompt: "Give me 10 creative ideas for a side project that can be built in a weekend with an LLM API.",
    color: "text-violet-400",
    bg: "bg-violet-500/10 hover:bg-violet-500/15 border-violet-500/20",
  },
] as const;

export function EmptyState() {
  const createConversation = useCreateConversation();
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const { setDraft, incognitoMode } = useChatStore();
  const { data: models = [] } = useModels();
  const { currentMode, offlineState, activeOfflineModelLabel, setOfflineManagementOpen } = useModeStore();
  const preset = getPreset(models, selectedModel);
  const modelName = preset?.name ?? selectedModel.split("/").pop() ?? selectedModel;
  const category = preset?.category ?? "general";
  const categoryMeta = CATEGORY_META[category] ?? CATEGORY_META.general;

  const isLocalMode =
    currentMode === "offline" ||
    (currentMode === "auto" && offlineState === "installed");

  // Show the *active installed* offline model only.  Falling back to
  // the analyze-step recommendation here would advertise a model the
  // user has not actually installed (e.g. Gemma 4 E4B as the default
  // recommendation), giving the wrong impression about what their next
  // message will hit.  When no active model is set, render a neutral
  // "Choose an offline model" affordance that opens the management
  // modal.  See ChatHeader for the same rule.
  const localModelName = activeOfflineModelLabel ?? "Choose an offline model";
  const hasActiveOffline = activeOfflineModelLabel !== null;

  const handlePromptClick = async (prompt: string) => {
    await createConversation.mutateAsync();
    // A tiny delay lets the conversation selection settle before we inject the draft
    setTimeout(() => {
      setDraft(prompt);
    }, 80);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 py-10 text-center max-w-xl mx-auto w-full">
      {/* Logo / Icon */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex h-20 w-20 items-center justify-center"
      >
        <div className={cn(
          "absolute inset-0 rounded-3xl ring-1",
          incognitoMode ? "bg-amber-500/10 ring-amber-500/20"
            : isLocalMode ? "bg-emerald-500/10 ring-emerald-500/20"
            : "bg-primary/10 ring-primary/20",
        )} />
        <div className={cn(
          "absolute inset-0 rounded-3xl blur-xl",
          incognitoMode ? "bg-amber-500/5"
            : isLocalMode ? "bg-emerald-500/5"
            : "bg-primary/5",
        )} />
        {incognitoMode
          ? <EyeOff className="relative h-9 w-9 text-amber-400" />
          : isLocalMode
            ? <Cpu className="relative h-9 w-9 text-emerald-400" />
            : <Sparkles className="relative h-9 w-9 text-primary" />
        }
      </motion.div>

      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.06, ease: "easeOut" }}
        className="space-y-2"
      >
        <h2 className="text-2xl font-bold tracking-tight">
          {incognitoMode ? "Incognito session" : "Start a conversation"}
        </h2>
        {incognitoMode ? (
          <p className="text-sm text-amber-400/80 leading-relaxed">
            Messages won't be saved to your local database.
            <br />
            <span className="text-muted-foreground">Chat with <span className="font-medium text-foreground">{isLocalMode ? localModelName : modelName}</span> privately.</span>
          </p>
        ) : isLocalMode ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {hasActiveOffline ? (
              <>
                Chat with{" "}
                <button
                  type="button"
                  onClick={() => setOfflineManagementOpen(true)}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {localModelName}
                </button>
                {" "}running locally on your device.{" "}
                <span className="text-emerald-400/80 text-[12px]">No internet required.</span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOfflineManagementOpen(true)}
                  className="font-medium text-amber-300 underline-offset-4 hover:underline"
                >
                  Choose an offline model
                </button>
                {" "}to start chatting locally.
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Chat with{" "}
            <span className="font-medium text-foreground">{modelName}</span>
            {" "}
            <span className={cn("text-[11px] rounded-full px-1.5 py-0.5 font-medium", "bg-secondary text-muted-foreground")}>
              {categoryMeta.emoji}
            </span>
            {" "}via OpenRouter. Free models, fully local data.
          </p>
        )}
      </motion.div>

      {/* Quick-start prompts */}
      <div className="grid grid-cols-2 gap-2 w-full">
        {PROMPTS.map((p, i) => (
          <motion.button
            key={p.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 + i * 0.05, ease: "easeOut" }}
            onClick={() => void handlePromptClick(p.prompt)}
            disabled={createConversation.isPending}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all active:scale-[0.98]",
              "disabled:pointer-events-none disabled:opacity-50",
              p.bg,
            )}
          >
            <p.icon className={cn("h-4 w-4", p.color)} />
            <span className="text-xs font-medium">{p.label}</span>
            <span className="text-[11px] text-muted-foreground/70 leading-snug line-clamp-2">
              {p.prompt}
            </span>
          </motion.button>
        ))}
      </div>

      {/* New chat button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        <Button
          onClick={() => createConversation.mutate()}
          disabled={createConversation.isPending}
          variant="outline"
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New blank conversation
        </Button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.35 }}
        className="text-xs text-muted-foreground/50"
      >
        <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
        {" "}to send · {" "}
        <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">⇧↵</kbd>
        {" "}for newline
      </motion.p>
    </div>
  );
}
