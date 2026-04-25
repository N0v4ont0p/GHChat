import { create } from "zustand";
import type { AppMode, OfflineSetupState } from "@/types";

interface ModeState {
  /** Current operating mode selected by the user. */
  currentMode: AppMode;
  /**
   * Current position in the offline setup state machine.
   * Only meaningful when currentMode is "offline" or "auto".
   */
  offlineState: OfflineSetupState;
  setMode: (mode: AppMode) => void;
  setOfflineState: (state: OfflineSetupState) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  currentMode: "online",
  offlineState: "not-installed",
  setMode: (currentMode) => set({ currentMode }),
  setOfflineState: (offlineState) => set({ offlineState }),
}));
