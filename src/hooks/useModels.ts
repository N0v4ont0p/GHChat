import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => ipc.listModels(),
    staleTime: Infinity,
  });
}
