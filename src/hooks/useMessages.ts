import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings-store";

export function useMessages(conversationId: string | null) {
  const dbAvailable = useSettingsStore((s) => s.dbAvailable);
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => ipc.listMessages(conversationId!),
    // Only fetch when both a conversation is selected AND the DB is available.
    enabled: conversationId !== null && dbAvailable,
  });
}
