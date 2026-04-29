import { useEffect, useState } from "react";
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
  ShieldCheck,
  PackageCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModeStore } from "@/stores/mode-store";
import { ipc } from "@/lib/ipc";
import type { OfflineErrorCategory, OfflineInstallProgress, OfflineRecommendation } from "@/types";

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

// ── Installing screen helpers ─────────────────────────────────────────────────

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/**
 * Format a byte count as a human-readable string: "X.X MB" or "X.XX GB".
 */
function fmtBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GB) return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;
  return `${(bytes / BYTES_PER_MB).toFixed(0)} MB`;
}

/**
 * Format bytes/second as a human-readable speed string.
 */
function fmtSpeed(bps: number): string {
  if (bps >= BYTES_PER_MB) return `${(bps / BYTES_PER_MB).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

/**
 * Format an ETA in seconds as a human-readable string.
 */
function fmtEta(sec: number): string {
  if (sec < SECONDS_PER_MINUTE) return "< 1 min";
  const mins = Math.round(sec / SECONDS_PER_MINUTE);
  if (mins < SECONDS_PER_MINUTE) return `~${mins} min`;
  const hrs = (sec / SECONDS_PER_HOUR).toFixed(1);
  return `~${hrs} hr`;
}

interface PhaseInfo {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  ring: string;
  bg: string;
}

function getPhaseInfo(phase: OfflineInstallProgress["phase"] | undefined): PhaseInfo {
  switch (phase) {
    case "preflight":
      return {
        label: "Checking system",
        Icon: Loader2,
        color: "text-primary",
        ring: "ring-primary/20",
        bg: "bg-primary/10",
      };
    case "downloading-runtime":
      return {
        label: "Downloading runtime",
        Icon: Cpu,
        color: "text-sky-400",
        ring: "ring-sky-500/20",
        bg: "bg-sky-500/10",
      };
    case "verifying-runtime":
      return {
        label: "Verifying runtime",
        Icon: ShieldCheck,
        color: "text-sky-400",
        ring: "ring-sky-500/20",
        bg: "bg-sky-500/10",
      };
    case "downloading-model":
      return {
        label: "Downloading model",
        Icon: Download,
        color: "text-primary",
        ring: "ring-primary/20",
        bg: "bg-primary/10",
      };
    case "verifying-model":
      return {
        label: "Verifying integrity",
        Icon: ShieldCheck,
        color: "text-amber-400",
        ring: "ring-amber-500/20",
        bg: "bg-amber-500/10",
      };
    case "finalizing":
      return {
        label: "Finalizing install",
        Icon: PackageCheck,
        color: "text-violet-400",
        ring: "ring-violet-500/20",
        bg: "bg-violet-500/10",
      };
    case "smoke-test":
      return {
        label: "Running readiness check",
        Icon: CheckCircle2,
        color: "text-emerald-400",
        ring: "ring-emerald-500/20",
        bg: "bg-emerald-500/10",
      };
    default:
      return {
        label: "Preparing…",
        Icon: Loader2,
        color: "text-primary",
        ring: "ring-primary/20",
        bg: "bg-primary/10",
      };
  }
}

// ── Installing screen ─────────────────────────────────────────────────────────

interface InstallingScreenProps {
  progress: OfflineInstallProgress | null;
  modelLabel: string;
}

function InstallingScreen({ progress, modelLabel }: InstallingScreenProps) {
  const pct = progress?.pct ?? 0;
  const step = progress?.step ?? "Preparing…";
  const phaseInfo = getPhaseInfo(progress?.phase);
  const { Icon } = phaseInfo;

  // Show download stats during both runtime and model downloads.
  const isAnyDownload =
    progress?.phase === "downloading-runtime" ||
    progress?.phase === "downloading-model";
  const hasBytes =
    isAnyDownload &&
    progress?.downloadedBytes != null &&
    progress.downloadedBytes > 0;
  const hasTotal = hasBytes && progress?.totalBytes != null && progress.totalBytes > 0;
  const hasSpeed = isAnyDownload && progress?.speedBps != null && progress.speedBps > 0;
  const hasEta = hasSpeed && progress?.etaSec != null;

  // Spin the icon during setup phases.
  const shouldSpin =
    progress?.phase === "preflight" ||
    progress?.phase === "verifying-runtime" ||
    progress?.phase === undefined;

  return (
    <motion.div
      key="installing"
      {...SLIDE}
      className="flex flex-1 flex-col items-center justify-center gap-7 px-8 py-10 text-center max-w-sm mx-auto w-full"
    >
      {/* Phase icon */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className={`absolute inset-0 rounded-3xl ${phaseInfo.bg} ring-1 ${phaseInfo.ring}`} />
        <AnimatePresence mode="wait">
          <motion.div
            key={progress?.phase ?? "idle"}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="relative"
          >
            <Icon
              className={`h-9 w-9 ${phaseInfo.color} ${shouldSpin ? "animate-spin" : ""}`}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight">Installing Gemma 4</h2>
        <p className="text-sm text-muted-foreground">{modelLabel}</p>
      </div>

      {/* Phase pill */}
      <AnimatePresence mode="wait">
        <motion.div
          key={progress?.phase ?? "idle"}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18 }}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${phaseInfo.bg} ${phaseInfo.ring} ${phaseInfo.color}`}
        >
          {phaseInfo.label}
        </motion.div>
      </AnimatePresence>

      {/* Progress bar */}
      <div className="w-full space-y-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
            transition={{ duration: 0.25, ease: "linear" }}
          />
        </div>
        <div className="flex items-center justify-between">
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="text-xs text-muted-foreground text-left"
            >
              {step}
            </motion.p>
          </AnimatePresence>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-3">
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      {/* Download stats — shown during runtime and model downloads */}
      <AnimatePresence>
        {isAnyDownload && (hasBytes || hasSpeed) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="w-full overflow-hidden"
          >
            <div className="rounded-xl bg-muted/60 ring-1 ring-border/50 px-4 py-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
              {/* Bytes received */}
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="text-foreground/80 font-medium tabular-nums">
                  {hasBytes ? fmtBytes(progress!.downloadedBytes!) : "—"}
                  {hasTotal ? <> <span className="text-muted-foreground font-normal">/ {fmtBytes(progress!.totalBytes!)}</span></> : null}
                </span>
                <span>downloaded</span>
              </div>

              {/* Speed */}
              {hasSpeed && (
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-foreground/80 font-medium tabular-nums">
                    {fmtSpeed(progress!.speedBps!)}
                  </span>
                  <span>speed</span>
                </div>
              )}

              {/* ETA */}
              {hasEta && (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-foreground/80 font-medium tabular-nums">
                    {fmtEta(progress!.etaSec!)}
                  </span>
                  <span>remaining</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

/**
 * Map a coarse error category to an actionable, user-friendly title +
 * summary.  The raw technical chain remains available in a collapsible
 * details section below.
 */
function describeErrorCategory(
  category: OfflineErrorCategory | undefined,
  state: "install-failed" | "repair-needed",
): { title: string; summary: string } {
  if (state === "repair-needed") {
    return {
      title: "Repair needed",
      summary:
        "Some Gemma 4 files appear to be missing or corrupted. A repair will re-download only what's needed.",
    };
  }
  switch (category) {
    case "network-offline":
      return {
        title: "Can't reach GitHub",
        summary:
          "Your device can't connect to GitHub to download the offline runtime. " +
          "Check your internet connection or firewall settings, then try again.",
      };
    case "dns":
      return {
        title: "Network / DNS problem",
        summary:
          "We couldn't resolve GitHub's address. This is usually a DNS, VPN, " +
          "or Wi-Fi connectivity issue. Check your network and try again.",
      };
    case "timeout":
      return {
        title: "Network timed out",
        summary:
          "The request to GitHub took too long to respond. The connection may " +
          "be slow or unstable — try again in a moment.",
      };
    case "rate-limited":
      return {
        title: "GitHub rate limit reached",
        summary:
          "GitHub has temporarily limited requests from this network. Wait a " +
          "few minutes and try again, or try from a different network.",
      };
    case "tls-proxy":
      return {
        title: "Proxy or TLS issue",
        summary:
          "A proxy or firewall on this network appears to be intercepting the " +
          "secure connection to GitHub. Check your proxy / VPN configuration.",
      };
    case "http-error":
      return {
        title: "GitHub is unavailable",
        summary:
          "GitHub returned an unexpected error. The service may be temporarily " +
          "degraded — please try again in a few minutes.",
      };
    case "install":
      return {
        title: "Installation failed",
        summary:
          "Something went wrong while installing Gemma 4. Make sure you have " +
          "enough disk space and a stable connection, then try again.",
      };
    case "unknown":
    default:
      return {
        title: "Installation failed",
        summary:
          "An unexpected error occurred while setting up offline mode. " +
          "Try again, and if it keeps failing, check the technical details below.",
      };
  }
}

function ErrorScreen({
  state,
  errorMessage,
  errorCategory,
  errorDetails,
  onRetry,
}: {
  state: "install-failed" | "repair-needed";
  errorMessage?: string;
  errorCategory?: OfflineErrorCategory;
  errorDetails?: string;
  onRetry: () => void;
}) {
  const isRepair = state === "repair-needed";
  const { title, summary } = describeErrorCategory(errorCategory, state);
  const [showDetails, setShowDetails] = useState(false);

  // Prefer the rich `errorDetails` (full cause chain) for the technical
  // section; fall back to the top-level message if details aren't provided.
  const technical = errorDetails ?? errorMessage ?? null;
  const hasTechnical = technical !== null && technical.trim().length > 0;

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
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>
      </div>

      {hasTechnical && (
        <div className="w-full text-left">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground transition-colors mx-auto"
            onClick={() => setShowDetails((s) => !s)}
            aria-expanded={showDetails}
            aria-controls="offline-error-details"
            aria-label="Toggle technical error details"
          >
            {showDetails ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showDetails ? "Hide technical details" : "Show technical details"}
          </button>
          {showDetails && (
            <pre
              id="offline-error-details"
              className="mt-3 max-h-48 overflow-auto rounded-md border border-border/40 bg-muted/30 p-3 text-[11px] text-muted-foreground/80 font-mono whitespace-pre-wrap break-words leading-relaxed"
            >
              {technical}
            </pre>
          )}
        </div>
      )}

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

export function OfflineSetupFlow() {
  const offlineState = useModeStore((s) => s.offlineState);
  const setOfflineState = useModeStore((s) => s.setOfflineState);
  const offlineRecommendation = useModeStore((s) => s.offlineRecommendation);
  const setOfflineRecommendation = useModeStore((s) => s.setOfflineRecommendation);
  const installProgress = useModeStore((s) => s.installProgress);
  const setInstallProgress = useModeStore((s) => s.setInstallProgress);
  const setMode = useModeStore((s) => s.setMode);

  // Structured error info from the last failed install attempt — shown in
  // ErrorScreen.  Includes the top-level message, a coarse category for
  // friendly UI mapping, and the full cause chain for the technical-details
  // collapsible section.
  const [installError, setInstallError] = useState<{
    message: string;
    category?: OfflineErrorCategory;
    details?: string;
  } | null>(null);

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
        if (readiness.recommendation) {
          setOfflineRecommendation(readiness.recommendation);
        }
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

  // installing: subscribe to progress events + await IPC result.
  // handleInstall calls ipc.startInstall() which is fire-and-await — when it
  // resolves, the main process has already persisted the final state; we just
  // apply that state to the store here.
  useEffect(() => {
    if (offlineState !== "installing") {
      setInstallProgress(null);
      return;
    }

    // Subscribe to push progress events.
    const unsubscribe = ipc.onInstallProgress((progress) => {
      setInstallProgress(progress);
    });

    return () => {
      unsubscribe();
    };
  }, [offlineState, setInstallProgress]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleStartSetup = () => {
    setInstallError(null);
    setOfflineState("analyzing-system");
  };

  const handleInstall = () => {
    if (!offlineRecommendation) return;
    const modelId = offlineRecommendation.modelId;
    setInstallError(null);
    // Transition to "installing" immediately for instant feedback.
    setOfflineState("installing");
    ipc
      .startInstall(modelId)
      .then((readiness) => {
        if (readiness.state === "install-failed") {
          setInstallError({
            message: readiness.message ?? "Installation failed",
            category: readiness.errorCategory,
            details: readiness.errorDetails,
          });
        }
        // Final state from the main process — "installed" or "install-failed".
        setOfflineState(readiness.state);
      })
      .catch((err: unknown) => {
        // IPC-level failure (main process unreachable, etc.) — we have no
        // structured category here, so render as a generic install error.
        setInstallError({
          message: err instanceof Error ? err.message : String(err),
          category: "unknown",
          details: err instanceof Error ? err.stack ?? err.message : String(err),
        });
        setOfflineState("install-failed");
      });
  };

  const handleRetry = () => {
    setInstallError(null);
    setOfflineState("analyzing-system");
  };

  const handleEnterChat = () => {
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
          <ErrorScreen
            key="rec-missing"
            state="install-failed"
            onRetry={handleRetry}
          />
        )}
        {offlineState === "installing" && (
          <InstallingScreen
            key="installing"
            progress={installProgress}
            modelLabel={offlineRecommendation?.variantLabel ?? "Gemma 4"}
          />
        )}
        {offlineState === "installed" && (
          <SuccessScreen key="success" onEnterChat={handleEnterChat} />
        )}
        {(offlineState === "install-failed" ||
          offlineState === "repair-needed") && (
          <ErrorScreen
            key="error"
            state={offlineState as "install-failed" | "repair-needed"}
            errorMessage={installError?.message}
            errorCategory={installError?.category}
            errorDetails={installError?.details}
            onRetry={handleRetry}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
