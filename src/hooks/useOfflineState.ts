import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IpcRendererEvent } from "electron";
import { ipc } from "@/lib/ipc";
import { IPC } from "@/types";
import { useModeStore } from "@/stores/mode-store";
import type {
  OfflineActiveModelInfo,
  OfflineModelSummary,
  OfflineReadiness,
} from "@/types";

const KEY = ["offline-state"] as const;

export interface OfflineStateSnapshot {
  /** Current offline setup-state from the main process. */
  status: OfflineReadiness | null;
  /** Every installed offline model with health + active flag. */
  installedModels: OfflineModelSummary[];
  /** Currently active model info, or null when none is selected. */
  activeModel: OfflineActiveModelInfo | null;
  /** True when the runtime subprocess is currently alive. */
  runtimeRunning: boolean;
}

/**
 * Single React-Query-backed source of truth for the renderer's offline
 * view.  Every offline-aware component (header, empty state, sidebar,
 * management modal, recovery surface) reads from this hook so they
 * cannot disagree about the current state.
 *
 * Side-effects:
 *   - Mirrors `activeModel` / `status` into useModeStore so existing
 *     subscribers (TitleBar, ChatHeader, EmptyState) keep working
 *     without each having to do their own IPC fetch.
 *   - Subscribes to OFFLINE_ACTIVE_MODEL_CHANGED so install / remove /
 *     set-active events from the main process invalidate the cache
 *     immediately, with no polling.
 */
export function useOfflineState() {
  const qc = useQueryClient();
  const setActiveOfflineModel = useModeStore((s) => s.setActiveOfflineModel);
  const setOfflineState = useModeStore((s) => s.setOfflineState);

  const query = useQuery<OfflineStateSnapshot>({
    queryKey: KEY,
    queryFn: async () => {
      // Run the four reads in parallel — they are independent and the
      // main-process handlers are cheap.  Each one is guarded so a
      // partial DB or a stopped runtime doesn't cause the whole query
      // to error out.
      const [statusR, installedR, activeR, infoR] = await Promise.allSettled([
        ipc.getOfflineStatus(),
        ipc.listInstalledOfflineModels(),
        ipc.getActiveOfflineModel(),
        ipc.getOfflineInfo(),
      ]);
      const snapshot: OfflineStateSnapshot = {
        status: statusR.status === "fulfilled" ? statusR.value : null,
        installedModels: installedR.status === "fulfilled" ? installedR.value : [],
        activeModel: activeR.status === "fulfilled" ? activeR.value : null,
        runtimeRunning:
          infoR.status === "fulfilled" ? infoR.value.isRuntimeRunning : false,
      };
      // Mirror into the global store so legacy subscribers stay live.
      setActiveOfflineModel(snapshot.activeModel);
      if (snapshot.status) setOfflineState(snapshot.status.state);
      return snapshot;
    },
    // Stale data is fine for the duration of a single render pass; we
    // explicitly invalidate on the OFFLINE_ACTIVE_MODEL_CHANGED push,
    // and after install / remove / set-active mutations.
    staleTime: 5_000,
  });

  useEffect(() => {
    // Push subscription — when the main process announces an active
    // model change (install promotes, remove demotes, set-active, or
    // the resolver's auto-promote path), drop the cache so the next
    // render sees the fresh snapshot.
    const off = window.ghchat?.on(
      IPC.OFFLINE_ACTIVE_MODEL_CHANGED,
      (_e: IpcRendererEvent, info: OfflineActiveModelInfo | null) => {
        // Keep the store in sync immediately so subscribers don't have
        // to wait for the refetch to land.
        setActiveOfflineModel(info ?? null);
        qc.invalidateQueries({ queryKey: KEY });
      },
    );
    return () => {
      try {
        off?.();
      } catch {
        /* listener may already have been removed during HMR */
      }
    };
  }, [qc, setActiveOfflineModel]);

  return query;
}

/**
 * Helper to invalidate the offline-state cache from mutations that
 * affect it (install / remove / set-active in the management modal,
 * setup flow, or recovery surface).  Centralised so we don't sprinkle
 * the same `qc.invalidateQueries({queryKey: ["offline-state"]})` call
 * across every consumer.
 */
export function useInvalidateOfflineState() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}
