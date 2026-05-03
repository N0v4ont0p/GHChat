import type {
  AppMode,
  Conversation,
  OfflineSetupState,
} from "@/types";

/**
 * Discriminated union returned by the resolver — captures every "what
 * model will the next message use?" state every UI surface needs to
 * handle.  Centralising this enum is the whole point of step 1: every
 * caller goes through the same switch, so the chat header, empty state,
 * and dispatcher can never disagree about what the next send will do.
 */
export type ActiveModel =
  | { kind: "online"; modelId: string }
  | { kind: "offline"; modelId: string }
  /**
   * Offline mode is selected but no offline model is installed yet — the
   * caller should route the user to the offline setup flow rather than
   * trying to send.
   */
  | { kind: "needs-setup" }
  /**
   * Offline mode is selected, the install state is "installed", but the
   * resolver returned no usable id (the active model id is null AND no
   * installed models exist).  This is a degenerate state that the
   * startup repair tries to prevent; the caller should open the offline
   * management modal so the user can install or pick a model.
   */
  | { kind: "no-offline-model-installed" };

export interface ResolveGlobals {
  currentMode: AppMode;
  offlineState: OfflineSetupState;
  /** Catalog id of the active offline model (null when nothing usable). */
  activeOfflineModelId: string | null;
  /** OpenRouter model id for online sends. */
  selectedOnlineModel: string;
}

/**
 * Resolve which model the *next* message should run against, given the
 * current global state.  The rules captured here are the contract for
 * the entire app:
 *
 *   - online → use `selectedOnlineModel`
 *   - offline + active id present → use it
 *   - offline + state==='installed' but no active id → caller should
 *     have already auto-promoted via OFFLINE_SET_ACTIVE_MODEL; if it
 *     really is empty, return `no-offline-model-installed`
 *   - offline + nothing installed → `needs-setup`
 *   - auto → online unless `offlineState === 'installed'` AND an active
 *     offline id is resolvable
 */
export function resolveActiveModel(globals: ResolveGlobals): ActiveModel {
  const { currentMode, offlineState, activeOfflineModelId, selectedOnlineModel } = globals;

  if (currentMode === "online") {
    return { kind: "online", modelId: selectedOnlineModel };
  }

  if (currentMode === "auto") {
    // Auto mode silently uses offline only when the runtime is fully
    // installed AND we have a concrete active id to load.  Anything else
    // routes to online — auto must never force the user into the offline
    // setup flow.
    if (offlineState === "installed" && activeOfflineModelId) {
      return { kind: "offline", modelId: activeOfflineModelId };
    }
    return { kind: "online", modelId: selectedOnlineModel };
  }

  // currentMode === "offline" from here on.
  if (offlineState !== "installed") {
    return { kind: "needs-setup" };
  }
  if (!activeOfflineModelId) {
    return { kind: "no-offline-model-installed" };
  }
  return { kind: "offline", modelId: activeOfflineModelId };
}

/**
 * Resolve the model a specific conversation should send against.
 *
 * Conversations created before the v8 migration (or unbound new
 * conversations that haven't been stamped yet) have `modelId === null`.
 * For those we fall back to the live globals so the empty-state remains
 * flexible until the first send stamps a binding.
 *
 * For bound conversations (`modelId` is set) we honour the conversation's
 * own mode + modelId so flipping the global switcher cannot retroactively
 * rewrite an existing chat.  We still consult the offline globals to
 * determine whether a stored offline model is currently reachable —
 * unreachable bindings surface as `needs-setup` /
 * `no-offline-model-installed` so the caller can route to the recovery UI.
 */
export function resolveConversationModel(
  conversation: Pick<Conversation, "mode" | "modelId"> | null | undefined,
  globals: ResolveGlobals,
): ActiveModel {
  // Unbound conversation (legacy or never-sent) → defer to globals.
  if (!conversation || !conversation.modelId) {
    return resolveActiveModel(globals);
  }

  if (conversation.mode === "online") {
    return { kind: "online", modelId: conversation.modelId };
  }

  if (conversation.mode === "offline") {
    // Honour the conversation's stored offline model id verbatim.  The
    // health check (whether the model is currently installed) is the
    // job of useConversationModelHealth — the resolver's contract is
    // "what should the next send target?", not "is the target ready?".
    // The dispatcher is expected to gate sends with the health check
    // before invoking IPC.
    return { kind: "offline", modelId: conversation.modelId };
  }

  // mode === 'auto' on a conversation row is treated like the global
  // auto rule but anchored to the stored modelId where possible.  We
  // intentionally do NOT honour `conversation.modelId` directly here:
  // an auto-bound conversation is meant to follow the live globals
  // (that's the point of the auto choice), so the dispatcher should
  // pick up whatever the user has currently active rather than pinning
  // to the model that happened to be active when the conversation was
  // first stamped.  In practice we never actually stamp `mode='auto'`
  // — the first-send stamp resolves to a concrete `online`/`offline`
  // before writing — so this branch is a defensive backstop for legacy
  // rows or for any future code path that might bind in auto mode.
  if (globals.offlineState === "installed" && globals.activeOfflineModelId) {
    return { kind: "offline", modelId: globals.activeOfflineModelId };
  }
  return { kind: "online", modelId: globals.selectedOnlineModel };
}
