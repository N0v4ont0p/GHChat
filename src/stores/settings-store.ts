import { create } from "zustand";

interface SettingsState {
  selectedModel: string;
  settingsOpen: boolean;
  setSelectedModel: (model: string) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: "mistralai/Mistral-7B-Instruct-v0.3",
  settingsOpen: false,
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
