import { create } from "zustand";
import type { AppMode, OfflineSetupState, OfflineRecommendation, OfflineInstallProgress } from "@/types";

interface ModeState {
  /** Current operating mode selected by the user. */
  currentMode: AppMode;
  /**
   * Current position in the offline setup state machine.
   * Only meaningful when currentMode is "offline" or "auto".
   */
  offlineState: OfflineSetupState;
  /**
   * Recommendation produced by the analyze step.
   * Populated when offlineState is "recommendation-ready" or later.
   * Null before the analysis has completed.
   */
  offlineRecommendation: OfflineRecommendation | null;
  /**
   * Live install progress while offlineState is "installing".
   * Null before or after an install attempt.
   */
  installProgress: OfflineInstallProgress | null;
  setMode: (mode: AppMode) => void;
  setOfflineState: (state: OfflineSetupState) => void;
  setOfflineRecommendation: (rec: OfflineRecommendation | null) => void;
  setInstallProgress: (progress: OfflineInstallProgress | null) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  currentMode: "online",
  offlineState: "not-installed",
  offlineRecommendation: null,
  installProgress: null,
  setMode: (currentMode) => set({ currentMode }),
  setOfflineState: (offlineState) => set({ offlineState }),
  setOfflineRecommendation: (offlineRecommendation) => set({ offlineRecommendation }),
  setInstallProgress: (installProgress) => set({ installProgress }),
}));
