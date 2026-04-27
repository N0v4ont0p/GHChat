import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  WifiOff,
  Cpu,
  HardDrive,
  MemoryStick,
  CheckCircle2,
  Download,
  Sparkles,
  ArrowRight,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModeStore } from "@/stores/mode-store";
import { ipc } from "@/lib/ipc";
import type { OfflineRecommendation } from "@/types";

// ── Animation variants ────────────────────────────────────────────────────────

const SLIDE = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
  transition: { duration: 0.22, ease: "easeOut" },
};

// ── Intro screen ──────────────────────────────────────────────────────────────

function IntroScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <motion.div
      key="intro"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10 text-center max-w-md mx-auto w-full"
    >
      {/* Icon */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-3xl bg-primary/10 ring-1 ring-primary/20" />
        <div className="absolute inset-0 rounded-3xl blur-xl bg-primary/5" />
        <WifiOff className="relative h-9 w-9 text-primary" />
      </div>

      {/* Heading */}
      <div className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Offline Mode</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Chat privately with an AI that runs entirely on your device — no
          internet connection required after setup.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 gap-2.5 w-full">
        {[
          {
            icon: Sparkles,
            color: "text-violet-400",
            bg: "bg-violet-500/10 ring-violet-500/20",
            title: "Powered by Gemma 4",
            body: "Google's latest on-device model, running locally inside GHchat.",
          },
          {
            icon: WifiOff,
            color: "text-sky-400",
            bg: "bg-sky-500/10 ring-sky-500/20",
            title: "Fully private",
            body: "Your messages never leave your computer — not even to OpenRouter.",
          },
          {
            icon: HardDrive,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10 ring-emerald-500/20",
            title: "One-time setup",
            body: "Download once (a few GB). After that, offline chat works instantly.",
          },
        ].map(({ icon: Icon, color, bg, title, body }) => (
          <div
            key={title}
            className={`flex items-start gap-3 rounded-xl border p-3.5 text-left ring-1 ${bg}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground leading-snug">{body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 w-full">
        <Button className="w-full gap-2" onClick={onContinue}>
          Set Up Offline Mode
          <ArrowRight className="h-4 w-4" />
        </Button>
        <BackToOnlineButton />
      </div>
    </motion.div>
  );
}

// ── Analyzing screen ──────────────────────────────────────────────────────────

const CHECKS = [
  { icon: MemoryStick, label: "Available memory", delay: 0 },
  { icon: HardDrive, label: "Disk space", delay: 600 },
  { icon: Cpu, label: "CPU cores", delay: 1100 },
];

function AnalyzingScreen() {
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    const timers = CHECKS.map((c, i) =>
      setTimeout(() => setDoneCount((n) => Math.max(n, i + 1)), c.delay + 350),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      key="analyzing"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10 text-center max-w-sm mx-auto w-full"
    >
      {/* Spinner icon */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-3xl bg-primary/10 ring-1 ring-primary/20" />
        <Loader2 className="relative h-9 w-9 text-primary animate-spin" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Checking your system</h2>
        <p className="text-sm text-muted-foreground">
          Finding the best Gemma 4 setup for your device…
        </p>
      </div>

      {/* Check list */}
      <div className="flex flex-col gap-2 w-full">
        {CHECKS.map(({ icon: Icon, label }, i) => {
          const done = i < doneCount;
          const active = i === doneCount;
          return (
            <div
              key={label}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors duration-300 ${
                done
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : active
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-transparent opacity-40"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : active ? (
                <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" />
              ) : (
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium">{label}</span>
              {done && (
                <span className="ml-auto text-xs text-emerald-400/80">OK</span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Recommendation screen ─────────────────────────────────────────────────────

function RecommendationScreen({
  rec,
  onInstall,
}: {
  rec: OfflineRecommendation;
  onInstall: () => void;
}) {
  const sizeLabel = `${rec.sizeGb.toFixed(1)} GB`;
  return (
    <motion.div
      key="recommendation"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-7 px-8 py-10 text-center max-w-md mx-auto w-full"
    >
      {/* Icon */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-3xl bg-primary/10 ring-1 ring-primary/20" />
        <Sparkles className="relative h-9 w-9 text-primary" />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-primary/70">
          Recommended for your device
        </p>
        <h2 className="text-2xl font-bold tracking-tight">{rec.label}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Google's latest on-device model — fast, private, and capable. Runs
          entirely on your machine with no internet required.
        </p>
      </div>

      {/* Details card */}
      <div className="w-full rounded-2xl border border-border bg-secondary/40 p-4 space-y-3 text-left">
        {/* Variant row */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Variant</span>
          <span className="text-xs font-mono font-medium rounded bg-secondary px-2 py-0.5">
            {rec.variantLabel}
          </span>
        </div>
        <div className="h-px bg-border" />

        {/* Download size */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Download size</span>
          <div className="flex items-center gap-1.5">
            <Download className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium">{sizeLabel}</span>
          </div>
        </div>
        <div className="h-px bg-border" />

        {/* Storage */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Storage required</span>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium">{sizeLabel}</span>
          </div>
        </div>

        {/* Apple Silicon badge */}
        {rec.profile.isAppleSilicon && (
          <>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Acceleration</span>
              <span className="text-xs font-medium text-violet-400">
                Apple Silicon · Metal GPU
              </span>
            </div>
          </>
        )}
      </div>

      {/* Why this model */}
      <div className="w-full rounded-xl border border-border/60 bg-primary/5 px-4 py-3 text-left">
        <p className="text-xs text-primary/80 font-medium mb-1">Why {rec.label}?</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{rec.reason}</p>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 w-full">
        <Button className="w-full gap-2" onClick={onInstall}>
          <Download className="h-4 w-4" />
          Install {rec.variantLabel} · {sizeLabel}
        </Button>
        <BackToOnlineButton />
      </div>
    </motion.div>
  );
}

// ── Installing screen ─────────────────────────────────────────────────────────

const INSTALL_STEPS = [
  "Preparing download…",
  "Downloading model weights…",
  "Verifying checksums…",
  "Installing runtime…",
  "Finalizing setup…",
];

function InstallingScreen() {
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Advance progress smoothly, driven by ticks every 80 ms.
    // Progress slows near each step boundary to feel realistic.
    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        const target = ((stepIndex + 1) / INSTALL_STEPS.length) * 100;
        const next = prev + (target - prev) * 0.06 + 0.2;
        return Math.min(next, 99); // Never auto-complete — that's driven by the parent
      });
    }, 80);

    // Advance step label every ~1.8s
    const stepTimer = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, INSTALL_STEPS.length - 1));
    }, 1800);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(stepTimer);
    };
  }, [stepIndex]);

  return (
    <motion.div
      key="installing"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10 text-center max-w-sm mx-auto w-full"
    >
      {/* Icon */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-3xl bg-primary/10 ring-1 ring-primary/20" />
        <Download className="relative h-9 w-9 text-primary" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Installing Gemma 4</h2>
        <p className="text-sm text-muted-foreground">
          This may take a few minutes depending on your connection.
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full space-y-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.15, ease: "linear" }}
          />
        </div>
        <div className="flex items-center justify-between">
          <AnimatePresence mode="wait">
            <motion.p
              key={stepIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="text-xs text-muted-foreground"
            >
              {INSTALL_STEPS[stepIndex]}
            </motion.p>
          </AnimatePresence>
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/50">
        GHchat will notify you when Offline Mode is ready.
      </p>
    </motion.div>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({ onEnterChat }: { onEnterChat: () => void }) {
  return (
    <motion.div
      key="success"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10 text-center max-w-md mx-auto w-full"
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="relative flex h-20 w-20 items-center justify-center"
      >
        <div className="absolute inset-0 rounded-3xl bg-emerald-500/10 ring-1 ring-emerald-500/20" />
        <div className="absolute inset-0 rounded-3xl blur-xl bg-emerald-500/5" />
        <CheckCircle2 className="relative h-9 w-9 text-emerald-400" />
      </motion.div>

      <div className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Gemma 4 is ready</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Offline Mode is all set. Your conversations will stay completely
          private — processed entirely on your device.
        </p>
      </div>

      {/* What to expect cards */}
      <div className="grid grid-cols-1 gap-2 w-full">
        {[
          {
            icon: WifiOff,
            color: "text-sky-400",
            label: "No internet needed",
            body: "Chat even when you're offline.",
          },
          {
            icon: Sparkles,
            color: "text-violet-400",
            label: "Gemma 4 · on-device",
            body: "Google's fastest local model, ready to go.",
          },
        ].map(({ icon: Icon, color, label, body }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-secondary/30 px-4 py-3"
          >
            <Icon className={`h-4 w-4 shrink-0 ${color}`} />
            <div className="text-left">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{body}</p>
            </div>
          </div>
        ))}
      </div>

      <Button className="w-full gap-2" onClick={onEnterChat}>
        Start chatting offline
        <ArrowRight className="h-4 w-4" />
      </Button>
    </motion.div>
  );
}

// ── Error / repair screen ─────────────────────────────────────────────────────

function ErrorScreen({
  state,
  onRetry,
}: {
  state: "install-failed" | "repair-needed";
  onRetry: () => void;
}) {
  const isRepair = state === "repair-needed";
  return (
    <motion.div
      key="error"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10 text-center max-w-sm mx-auto w-full"
    >
      {/* Icon */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-3xl bg-red-500/10 ring-1 ring-red-500/20" />
        <AlertTriangle className="relative h-9 w-9 text-red-400" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          {isRepair ? "Repair needed" : "Installation failed"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {isRepair
            ? "Some Gemma 4 files appear to be missing or corrupted. A repair will re-download only what's needed."
            : "Something went wrong during the Gemma 4 install. Make sure you have enough disk space and a stable connection, then try again."}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 w-full">
        <Button className="w-full gap-2" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          {isRepair ? "Repair Gemma 4" : "Retry Installation"}
        </Button>
        <BackToOnlineButton />
      </div>
    </motion.div>
  );
}

// ── Shared: back to online button ─────────────────────────────────────────────

function BackToOnlineButton() {
  const setMode = useModeStore((s) => s.setMode);
  return (
    <button
      className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
      onClick={() => setMode("online")}
    >
      Back to Online Mode
    </button>
  );
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/** Minimum time (ms) to show the analyzing screen for UX continuity. */
const ANALYSIS_MIN_DISPLAY_MS = 1800;

/** How long (ms) to simulate the install before advancing to "installed". */
const INSTALL_SIMULATION_MS = 9000;

export function OfflineSetupFlow() {
  const offlineState = useModeStore((s) => s.offlineState);
  const setOfflineState = useModeStore((s) => s.setOfflineState);
  const offlineRecommendation = useModeStore((s) => s.offlineRecommendation);
  const setOfflineRecommendation = useModeStore((s) => s.setOfflineRecommendation);
  const setMode = useModeStore((s) => s.setMode);

  // ── Transitions ──────────────────────────────────────────────────────────────

  // analyzing-system → recommendation-ready: call real IPC + enforce a minimum
  // display time so the analyzing screen never flashes by instantly.
  useEffect(() => {
    if (offlineState !== "analyzing-system") return;

    let cancelled = false;
    const start = Date.now();

    ipc.analyzeSystem()
      .then((readiness) => {
        if (cancelled) return;
        // Store the recommendation regardless of state returned.
        if (readiness.recommendation) {
          setOfflineRecommendation(readiness.recommendation);
        }
        // Respect the minimum display time for the analyze animation.
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, ANALYSIS_MIN_DISPLAY_MS - elapsed);
        setTimeout(() => {
          if (!cancelled) {
            setOfflineState(
              readiness.state === "recommendation-ready"
                ? "recommendation-ready"
                : "not-installed",
            );
          }
        }, remaining);
      })
      .catch(() => {
        if (cancelled) return;
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, ANALYSIS_MIN_DISPLAY_MS - elapsed);
        setTimeout(() => {
          if (!cancelled) setOfflineState("not-installed");
        }, remaining);
      });

    return () => {
      cancelled = true;
    };
  }, [offlineState, setOfflineState, setOfflineRecommendation]);

  // installing → installed after INSTALL_SIMULATION_MS
  useEffect(() => {
    if (offlineState !== "installing") return;
    const t = setTimeout(
      () => setOfflineState("installed"),
      INSTALL_SIMULATION_MS,
    );
    return () => clearTimeout(t);
  }, [offlineState, setOfflineState]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleStartSetup = () => setOfflineState("analyzing-system");
  const handleInstall = () => setOfflineState("installing");
  const handleRetry = () => setOfflineState("analyzing-system");
  const handleEnterChat = () => {
    // State is already "installed". Ensure the mode is set to "offline" (or
    // "auto") so that AppShell routes to the chat window instead of the setup
    // flow. We unconditionally set "offline" here because the user explicitly
    // chose to enter offline chat.
    setMode("offline");
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-y-auto">
      <AnimatePresence mode="wait">
        {offlineState === "not-installed" && (
          <IntroScreen key="intro" onContinue={handleStartSetup} />
        )}
        {offlineState === "analyzing-system" && (
          <AnalyzingScreen key="analyzing" />
        )}
        {offlineState === "recommendation-ready" && offlineRecommendation && (
          <RecommendationScreen
            key="recommendation"
            rec={offlineRecommendation}
            onInstall={handleInstall}
          />
        )}
        {offlineState === "recommendation-ready" && !offlineRecommendation && (
          // Fallback: recommendation-ready but no recommendation data — show
          // a minimal retry screen so the user is never stuck.
          <ErrorScreen
            key="rec-missing"
            state="install-failed"
            onRetry={handleRetry}
          />
        )}
        {offlineState === "installing" && (
          <InstallingScreen key="installing" />
        )}
        {offlineState === "installed" && (
          <SuccessScreen key="success" onEnterChat={handleEnterChat} />
        )}
        {(offlineState === "install-failed" ||
          offlineState === "repair-needed") && (
          <ErrorScreen
            key="error"
            state={offlineState as "install-failed" | "repair-needed"}
            onRetry={handleRetry}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

