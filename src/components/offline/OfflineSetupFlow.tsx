import { useModeStore } from "@/stores/mode-store";
import type { OfflineSetupState } from "@/types";

const STATE_LABELS: Record<OfflineSetupState, string> = {
  "not-installed": "Offline mode is not set up yet",
  "analyzing-system": "Analyzing your system…",
  "recommendation-ready": "Ready to recommend a model",
  installing: "Installing…",
  installed: "Offline mode is ready",
  "install-failed": "Installation failed",
  "repair-needed": "Repair required",
};

const STATE_DESCRIPTIONS: Record<OfflineSetupState, string> = {
  "not-installed":
    "To use offline mode, GHchat needs to download a local model and set up a lightweight inference runtime on your machine.",
  "analyzing-system":
    "GHchat is scanning your hardware to find the best model for your device.",
  "recommendation-ready":
    "A model recommendation is ready. Review it and start the installation when you're ready.",
  installing:
    "Downloading and installing your offline model. This may take a few minutes.",
  installed:
    "Your local model is installed and ready. Switch to Offline mode to use it.",
  "install-failed":
    "Something went wrong during installation. Check your disk space and try again.",
  "repair-needed":
    "The offline runtime files appear to be damaged or incomplete. A repair is required.",
};

export function OfflineSetupFlow() {
  const offlineState = useModeStore((s) => s.offlineState);
  const setMode = useModeStore((s) => s.setMode);

  const label = STATE_LABELS[offlineState];
  const description = STATE_DESCRIPTIONS[offlineState];
  const showSetupCta = offlineState === "not-installed";
  const showRetry =
    offlineState === "install-failed" || offlineState === "repair-needed";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <OfflineIcon />
      </div>

      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="flex gap-3">
        {showSetupCta && (
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled
            aria-label="Set Up Offline Mode (not yet available in this build)"
            title="Offline setup is not yet available in this build"
          >
            Set Up Offline Mode
          </button>
        )}

        {showRetry && (
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled
            aria-label="Retry Installation (not yet available in this build)"
            title="Retry is not yet available in this build"
          >
            Retry Installation
          </button>
        )}

        <button
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          onClick={() => setMode("online")}
        >
          Back to Online Mode
        </button>
      </div>

      {offlineState === "installing" && (
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}
    </div>
  );
}

function OfflineIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
      <path d="M12 14v-4" />
      <path d="M12 17.5h.01" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
