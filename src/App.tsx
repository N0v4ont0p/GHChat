import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { ipc } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings-store";

type AppState = "loading" | "onboarding" | "ready";

export default function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);

  useEffect(() => {
    async function init() {
      try {
        const [apiKey, settings] = await Promise.all([
          ipc.getApiKey(),
          ipc.getSettings(),
        ]);
        // Seed the store with the persisted model choice
        if (settings.defaultModel) {
          setSelectedModel(settings.defaultModel);
        }
        if (!apiKey) {
          setAppState("onboarding");
          return;
        }
        const diagnostics = await ipc.getHfDiagnostics(apiKey);
        setAppState(diagnostics.tokenValid ? "ready" : "onboarding");
      } catch {
        // If anything fails on init, show onboarding
        setAppState("onboarding");
      }
    }
    void init();
  }, [setSelectedModel]);

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
