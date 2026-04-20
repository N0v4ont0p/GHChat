import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => ipc.listMessages(conversationId!),
    enabled: conversationId !== null,
  });
}
