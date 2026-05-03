import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy, Download, RefreshCw, Settings2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { useModeStore } from "@/stores/mode-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useInvalidateOfflineState } from "@/hooks/useOfflineState";
import { useDuplicateConversation } from "@/hooks/useConversations";

interface MissingModelRecoveryProps {
  conversationId: string;
  /** Catalog id of the model the conversation was bound to. */
  missingId: string;
  /** Display label for the missing id (best-effort; may equal the id). */
  missingLabel: string;
}

/**
 * Rendered above the composer in ChatWindow when the conversation's
 * stored offline model is no longer installed.  Three recovery actions,
 * all wired to existing IPC:
 *
 *   1. Install this model        – installAdditionalOfflineModel(id)
 *   2. Switch to current active  – updateConversationModel(...activeOfflineModelId)
 *   3. Switch to Online          – updateConversationModel(mode='online', ...selectedOnlineModel)
 *
 * The composer is disabled by ChatWindow while this is rendered, so a
 * send never silently routes to the wrong model.
 */
export function MissingModelRecovery({
  conversationId,
  missingId,
  missingLabel,
}: MissingModelRecoveryProps) {
  const qc = useQueryClient();
  const invalidateOffline = useInvalidateOfflineState();
  const { activeOfflineModelId, activeOfflineModelLabel, setOfflineManagementOpen } = useModeStore();
  const selectedOnlineModel = useSettingsStore((s) => s.selectedModel);
  const duplicateConversation = useDuplicateConversation();

  const [pending, setPending] = useState<
    "install" | "switch-active" | "switch-online" | null
  >(null);

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["conversations"] }),
      invalidateOffline(),
    ]);
  }

  async function onInstall() {
    setPending("install");
    try {
      const result = await ipc.installAdditionalOfflineModel(missingId);
      if (!result.ok) {
        toast.error(result.error ?? "Install failed.");
        return;
      }
      // The install handler also promotes the freshly-installed model
      // to active and broadcasts OFFLINE_ACTIVE_MODEL_CHANGED, so the
      // useOfflineState push-listener will refresh installed-models on
      // its own.  We still rebind the conversation just in case the user
      // wants this conversation locked to this specific id rather than
      // following the active model going forward.
      await ipc.updateConversationModel(conversationId, {
        mode: "offline",
        modelId: missingId,
      });
      toast.success("Model installed and conversation rebound.");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed.");
    } finally {
      setPending(null);
    }
  }

  async function onSwitchToActive() {
    if (!activeOfflineModelId) {
      toast.error("No other offline model is active. Install one first.");
      return;
    }
    setPending("switch-active");
    try {
      await ipc.updateConversationModel(conversationId, {
        mode: "offline",
        modelId: activeOfflineModelId,
      });
      toast.success(
        `Conversation switched to ${activeOfflineModelLabel ?? activeOfflineModelId}.`,
      );
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Switch failed.");
    } finally {
      setPending(null);
    }
  }

  async function onSwitchToOnline() {
    setPending("switch-online");
    try {
      await ipc.updateConversationModel(conversationId, {
        mode: "online",
        modelId: selectedOnlineModel,
      });
      toast.success("Conversation switched to Online.");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Switch failed.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null || duplicateConversation.isPending;

  function onDuplicate() {
    // Fork the conversation bound to the current active offline model (or
    // online if no offline model is available).  The user ends up in a new
    // conversation that is ready to chat immediately.
    const binding = activeOfflineModelId
      ? { mode: "offline" as const, modelId: activeOfflineModelId }
      : { mode: "online" as const, modelId: selectedOnlineModel };
    duplicateConversation.mutate({ id: conversationId, binding });
  }

  return (
    <div className="mx-3 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <div className="mb-2 flex items-start gap-2 text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-medium">Offline model not installed</div>
          <div className="text-xs text-amber-200/80">
            This conversation was bound to{" "}
            <code className="rounded bg-amber-500/20 px-1 py-0.5 text-[11px]">
              {missingLabel}
            </code>
            , which is no longer installed. Choose how to recover:
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        <Button
          size="sm"
          variant="default"
          onClick={() => void onInstall()}
          disabled={busy}
        >
          {pending === "install" ? (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          Install this model
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onSwitchToActive()}
          disabled={busy || !activeOfflineModelId}
          title={
            activeOfflineModelId
              ? undefined
              : "No other offline model is currently active."
          }
        >
          Switch to {activeOfflineModelLabel ?? "current active model"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onSwitchToOnline()}
          disabled={busy}
        >
          <Wifi className="mr-1.5 h-3.5 w-3.5" />
          Switch this conversation to Online
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDuplicate}
          disabled={busy}
          title={
            activeOfflineModelId
              ? `Fork this conversation bound to ${activeOfflineModelLabel ?? activeOfflineModelId}`
              : "Fork this conversation in Online mode"
          }
        >
          {duplicateConversation.isPending ? (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="mr-1.5 h-3.5 w-3.5" />
          )}
          Duplicate with{" "}
          {activeOfflineModelLabel ?? (activeOfflineModelId ? activeOfflineModelId : "Online")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOfflineManagementOpen(true)}
          disabled={busy}
        >
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          Manage offline models
        </Button>
      </div>
    </div>
  );
}
