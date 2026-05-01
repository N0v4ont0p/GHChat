import { create } from "zustand";
import type {
  AppMode,
  OfflineSetupState,
  OfflineRecommendation,
  OfflineInstallProgress,
  OfflineFailureReason,
  OfflineActiveModelInfo,
} from "@/types";

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
  /** Whether the offline management modal is open. */
  offlineManagementOpen: boolean;
  /**
   * Number of consecutive Gemma 4 install failures since the last
   * successful install / explicit reset.  Mirrors the persisted DB
   * counter so the UI can render the attempt counter.
   */
  gemma4FailureCount: number;
  /**
   * Threshold (consecutive Gemma 4 failures) at which the IPC layer
   * switches to the "fallback-offered" state.  Mirrors the main-process
   * constant so the UI can render "Attempt N of M" without hard-coding
   * the limit.
   */
  gemma4FailureThreshold: number;
  /** Most recent Gemma 4 failure reasons (newest last). */
  lastFailureReasons: OfflineFailureReason[];
  /**
   * Explicit fallback choices (Gemma 3 variants) shown to the user when
   * offlineState is "fallback-offered".  Empty until the threshold is
   * reached.  Never auto-installed.
   */
  fallbackOptions: OfflineRecommendation[];
  /**
   * Catalog id of the currently active offline model, mirrored from the
   * main process via OFFLINE_GET_ACTIVE_MODEL.  Null when no offline
   * model is installed or selected.  When set, this is the model the
   * runtime will load for chat requests.
   */
  activeOfflineModelId: string | null;
  /**
   * Human-readable label for the active offline model, e.g.
   * "Gemma 3 1B (Test) · 1B · Q4_K_M".  Mirrored from the main process
   * alongside `activeOfflineModelId` so UI surfaces (chat header, empty
   * state) can show the model that chats will actually use without
   * re-deriving it from a stale recommendation.
   */
  activeOfflineModelLabel: string | null;
  setMode: (mode: AppMode) => void;
  setOfflineState: (state: OfflineSetupState) => void;
  setOfflineRecommendation: (rec: OfflineRecommendation | null) => void;
  setInstallProgress: (progress: OfflineInstallProgress | null) => void;
  setOfflineManagementOpen: (open: boolean) => void;
  setGemma4FailureCount: (count: number) => void;
  setGemma4FailureThreshold: (threshold: number) => void;
  setLastFailureReasons: (reasons: OfflineFailureReason[]) => void;
  setFallbackOptions: (options: OfflineRecommendation[]) => void;
  /**
   * Update the active offline model (id + display label) atomically.
   * Pass `null` to clear it (e.g. after the last installed model is
   * removed).  Accepts the OfflineActiveModelInfo payload returned by
   * OFFLINE_GET_ACTIVE_MODEL / OFFLINE_SET_ACTIVE_MODEL directly.
   */
  setActiveOfflineModel: (info: OfflineActiveModelInfo | null) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  currentMode: "online",
  offlineState: "not-installed",
  offlineRecommendation: null,
  installProgress: null,
  offlineManagementOpen: false,
  gemma4FailureCount: 0,
  gemma4FailureThreshold: 5,
  lastFailureReasons: [],
  fallbackOptions: [],
  activeOfflineModelId: null,
  activeOfflineModelLabel: null,
  setMode: (currentMode) => set({ currentMode }),
  setOfflineState: (offlineState) => set({ offlineState }),
  setOfflineRecommendation: (offlineRecommendation) => set({ offlineRecommendation }),
  setInstallProgress: (installProgress) => set({ installProgress }),
  setOfflineManagementOpen: (offlineManagementOpen) => set({ offlineManagementOpen }),
  setGemma4FailureCount: (gemma4FailureCount) => set({ gemma4FailureCount }),
  setGemma4FailureThreshold: (gemma4FailureThreshold) => set({ gemma4FailureThreshold }),
  setLastFailureReasons: (lastFailureReasons) => set({ lastFailureReasons }),
  setFallbackOptions: (fallbackOptions) => set({ fallbackOptions }),
  setActiveOfflineModel: (info) =>
    set({
      activeOfflineModelId: info?.id ?? null,
      activeOfflineModelLabel: info
        ? `${info.name} · ${info.variantLabel}`
        : null,
    }),
}));
