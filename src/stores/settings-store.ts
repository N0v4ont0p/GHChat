import { create } from "zustand";
import { DEFAULT_MODEL } from "@/lib/models";

export interface AdvancedParams {
  webSearch: boolean;
  reasoningOn: boolean;
  maxTokens: number | null;
}

interface SettingsState {
  selectedModel: string;
  settingsOpen: boolean;
  advancedParams: AdvancedParams;
  /** Whether the main-process database initialized successfully */
  dbAvailable: boolean;
  /** Error message from the DB init failure, or null if DB is ready */
  dbInitError: string | null;
  setSelectedModel: (model: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setAdvancedParams: (partial: Partial<AdvancedParams>) => void;
  setDbAvailable: (ready: boolean, error?: string | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: DEFAULT_MODEL,
  settingsOpen: false,
  advancedParams: { webSearch: false, reasoningOn: false, maxTokens: null },
  dbAvailable: true,
  dbInitError: null,
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdvancedParams: (partial) =>
    set((s) => ({ advancedParams: { ...s.advancedParams, ...partial } })),
  setDbAvailable: (ready, error = null) =>
    set({ dbAvailable: ready, dbInitError: ready ? null : (error ?? null) }),
}));
