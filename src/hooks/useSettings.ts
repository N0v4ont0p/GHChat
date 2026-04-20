import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ipc } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings-store";
import type { AppSettings } from "@/types";

const KEY = ["settings"] as const;

/** Fetches DB settings and seeds the Zustand store on first load. */
export function useSettings() {
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);

  const query = useQuery({
    queryKey: KEY,
    queryFn: () => ipc.getSettings(),
    staleTime: Infinity,
  });

  // Seed store from DB on first load
  useEffect(() => {
    if (query.data?.defaultModel) {
      setSelectedModel(query.data.defaultModel);
    }
  }, [query.data?.defaultModel, setSelectedModel]);

  return query;
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partial: Partial<AppSettings>) => ipc.updateSettings(partial),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
