"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";

import { QueryProvider } from "@/components/providers/query-provider";
import { useChatStore } from "@/stores/chat-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useChatStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <QueryProvider>
      {children}
      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          style: {
            background: "#111827",
            color: "#f8fafc",
            border: "1px solid rgba(148, 163, 184, 0.2)",
          },
        }}
      />
    </QueryProvider>
  );
}
