import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "@/stores/chat-store";

const KEY = ["conversations"] as const;

export function useConversations() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => ipc.listConversations(),
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  const setSelected = useChatStore((s) => s.setSelectedConversationId);
  return useMutation({
    mutationFn: (title?: string) => ipc.createConversation(title),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: KEY });
      setSelected(conv.id);
    },
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      ipc.renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  const { selectedConversationId, setSelectedConversationId } = useChatStore();
  return useMutation({
    mutationFn: (id: string) => ipc.deleteConversation(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: KEY });
      if (selectedConversationId === id) setSelectedConversationId(null);
    },
  });
}
