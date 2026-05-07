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
  OfflineRuntimeState,
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
  /**
   * Snapshot of the offline runtime state machine.  Replaces the
   * old habit of stitching `runtimeRunning` together with the last
   * `OFFLINE_RUNTIME_PHASE` event.  Updated in-place from
   * `OFFLINE_RUNTIME_STATE` pushes so the UI reflects the actual
   * runtime lifecycle without polling.
   *
   * Defaults to `{kind:"stopped"}` until the first IPC read lands
   * — this guarantees no UI surface ever sees `undefined` and silently
   * falls back to "idle".
   */
  runtimeState: OfflineRuntimeState;
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
        runtimeState:
          infoR.status === "fulfilled" && infoR.value.runtimeState
            ? infoR.value.runtimeState
            : { kind: "stopped", enteredAt: Date.now() },
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
    // Push subscription — runtime state machine transitions
    // (`validating` → `launching` → … → `stopped`/`failed`).  Patch the
    // cached snapshot in-place so consumers reflect the new kind on
    // the very next render without needing a full IPC refetch.  Also
    // mirror `runtimeRunning` from `kind === "ready"` so legacy
    // subscribers stay accurate.
    const offState = window.ghchat?.on(
      IPC.OFFLINE_RUNTIME_STATE,
      (_e: IpcRendererEvent, state: OfflineRuntimeState) => {
        qc.setQueryData<OfflineStateSnapshot | undefined>(KEY, (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            runtimeState: state,
            runtimeRunning: state.kind === "ready",
          };
        });
      },
    );
    return () => {
      try {
        off?.();
      } catch {
        /* listener may already have been removed during HMR */
      }
      try {
        offState?.();
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
