import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";

export function useModels(apiKey?: string) {
  return useQuery({
    queryKey: ["models", apiKey ?? "__stored__"],
    queryFn: () => ipc.listModels(apiKey),
    staleTime: 30_000,
  });
}
