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
  setSelectedModel: (model: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setAdvancedParams: (partial: Partial<AdvancedParams>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: DEFAULT_MODEL,
  settingsOpen: false,
  advancedParams: { webSearch: false, reasoningOn: false, maxTokens: null },
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdvancedParams: (partial) =>
    set((s) => ({ advancedParams: { ...s.advancedParams, ...partial } })),
}));
