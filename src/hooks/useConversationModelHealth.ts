import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Conversation, OfflineModelSummary } from "@/types";
import { useConversations } from "@/hooks/useConversations";
import { useOfflineState } from "@/hooks/useOfflineState";

/**
 * Per-conversation health check.  Returned discriminated union tells the
 * caller exactly what (if anything) is wrong with sending into the
 * given conversation:
 *
 *   ok                    – the conversation's bound model is currently
 *                           reachable (or the conversation is unbound,
 *                           in which case the resolver decides at send
 *                           time).
 *   missing-offline-model – the conversation is bound to an offline
 *                           catalog id that is no longer installed.
 *                           Caller should disable the composer and
 *                           render the recovery surface.
 */
export type ConversationModelHealth =
  | { kind: "ok" }
  | {
      kind: "missing-offline-model";
      missingId: string;
      /** Best-guess display name from the catalog (may equal the id). */
      missingLabel: string;
    };

export function useConversationModelHealth(
  conversationId: string | null,
): ConversationModelHealth {
  const qc = useQueryClient();
  // Subscribe to both the conversations list (for the bound modelId)
  // and the offline state snapshot (for the installed-models list) so
  // the health re-computes whenever either changes.
  const { data: conversations } = useConversations();
  const { data: offline } = useOfflineState();

  return useMemo<ConversationModelHealth>(() => {
    if (!conversationId) return { kind: "ok" };
    const conversation =
      conversations?.find((c) => c.id === conversationId) ??
      qc
        .getQueryData<Conversation[]>(["conversations"])
        ?.find((c) => c.id === conversationId) ??
      null;
    if (!conversation || !conversation.modelId) return { kind: "ok" };
    if (conversation.mode !== "offline") return { kind: "ok" };

    const installed: OfflineModelSummary[] = offline?.installedModels ?? [];
    const match = installed.find((m) => m.id === conversation.modelId);
    if (match) return { kind: "ok" };

    return {
      kind: "missing-offline-model",
      missingId: conversation.modelId,
      // We don't have the catalog here; fall back to the id which the
      // recovery component can still render legibly.
      missingLabel: conversation.modelId,
    };
  }, [conversationId, conversations, offline, qc]);
}
