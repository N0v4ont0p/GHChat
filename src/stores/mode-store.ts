import { create } from "zustand";
import type { AppMode, OfflineSetupState, OfflineRecommendation } from "@/types";

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
  setMode: (mode: AppMode) => void;
  setOfflineState: (state: OfflineSetupState) => void;
  setOfflineRecommendation: (rec: OfflineRecommendation | null) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  currentMode: "online",
  offlineState: "not-installed",
  offlineRecommendation: null,
  setMode: (currentMode) => set({ currentMode }),
  setOfflineState: (offlineState) => set({ offlineState }),
  setOfflineRecommendation: (offlineRecommendation) => set({ offlineRecommendation }),
}));
