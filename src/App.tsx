import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { ipc } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore } from "@/stores/chat-store";
import { useModeStore } from "@/stores/mode-store";
import type { AppMode } from "@/types";

type AppState = "loading" | "onboarding" | "ready";

export default function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const setSelectedConversationId = useChatStore((s) => s.setSelectedConversationId);
  const setDbAvailable = useSettingsStore((s) => s.setDbAvailable);
  const setMode = useModeStore((s) => s.setMode);

  useEffect(() => {
    // Safety-net: if IPC never responds, fall through to onboarding after 5 s
    const timeout = setTimeout(() => {
      setAppState((prev) => (prev === "loading" ? "onboarding" : prev));
    }, 5000);

    async function init() {
      try {
        // Fetch key, settings, and DB status independently so a DB failure
        // (e.g. missing better-sqlite3 native binary in the packaged app)
        // does not prevent the rest of the app from loading.
        const [apiKeyResult, settingsResult, dbStatusResult] = await Promise.allSettled([
          ipc.getApiKey(),
          ipc.getSettings(),
          ipc.getDbStatus(),
        ]);

        const apiKey =
          apiKeyResult.status === "fulfilled" ? apiKeyResult.value : "";
        const settings =
          settingsResult.status === "fulfilled" ? settingsResult.value : null;
        const dbStatus =
          dbStatusResult.status === "fulfilled" ? dbStatusResult.value : null;

        // Propagate DB readiness so the UI can disable actions when unavailable.
        // Default to true when we can't reach the IPC handler (shouldn't happen).
        const dbReady = dbStatus?.ready ?? true;
        setDbAvailable(dbReady, dbStatus?.error ?? null);
        if (!dbReady) {
          console.warn("[App] database unavailable:", dbStatus?.error ?? "(no details)");
        }

        // Seed the store with the persisted model choice when available
        if (settings?.defaultModel) {
          setSelectedModel(settings.defaultModel);
        }

        // Restore the persisted mode choice (online / offline / auto).
        // The main process already loaded this from the DB; we mirror it
        // in the renderer store so AppShell's routing is correct before it
        // mounts (avoids a flash of the wrong screen).
        if (settings?.currentMode) {
          setMode(settings.currentMode as AppMode);
        }

        // Skip onboarding when a key is stored AND either:
        //   (a) the DB confirms onboarding was completed, or
        //   (b) the DB is unavailable — the stored key is strong evidence that
        //       the user already completed setup (setApiKey is only called from
        //       handleFinish in OnboardingFlow, so a key cannot exist without
        //       the user having gone through onboarding at least once).
        //       This prevents re-onboarding every time the native DB module
        //       fails to load in a packaged build (e.g. missing better-sqlite3).
        const onboardingDone = settings === null ? true : !!settings.onboardingComplete;
        if (apiKey && onboardingDone) {
          // Restore last active conversation if the DB is available
          if (settings?.lastConversationId) {
            setSelectedConversationId(settings.lastConversationId);
          }
          setAppState("ready");
          return;
        }

        setAppState("onboarding");
      } finally {
        clearTimeout(timeout);
      }
    }
    void init();

    return () => clearTimeout(timeout);
  }, [setSelectedModel, setSelectedConversationId, setDbAvailable]);

  if (appState === "loading") {
    return (
      <div className="relative flex h-screen items-center justify-center bg-background">
        <div
          className="absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-center"
          style={{ WebkitAppRegion: "drag" } as { WebkitAppRegion: "drag" }}
        >
          <span className="select-none text-xs font-medium tracking-wide text-muted-foreground/60">
            GHchat
          </span>
        </div>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (appState === "onboarding") {
    return <OnboardingFlow onComplete={() => setAppState("ready")} />;
  }

  return <AppShell />;
}
