import { create } from "zustand";
import { DEFAULT_MODEL } from "@/lib/models";

interface SettingsState {
  selectedModel: string;
  settingsOpen: boolean;
  setSelectedModel: (model: string) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: DEFAULT_MODEL,
  settingsOpen: false,
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
