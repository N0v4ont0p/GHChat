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
        setAppState(apiKey ? "ready" : "onboarding");
      } catch {
        // If anything fails on init, show onboarding
        setAppState("onboarding");
      }
    }
    void init();
  }, [setSelectedModel]);

  if (appState === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (appState === "onboarding") {
    return <OnboardingFlow onComplete={() => setAppState("ready")} />;
  }

  return <AppShell />;
}

