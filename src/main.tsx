import React, { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
// Syntax highlighting theme — matches dark background palette
import "highlight.js/styles/github-dark.css";

// ── Error boundary ────────────────────────────────────────────────────────────
// Catches any unhandled React render error and shows a visible screen instead
// of a blank/transparent window.

interface EBState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] React tree crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: "#09090b",
            color: "#ffffff",
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "1rem",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            textAlign: "center",
            padding: "2rem",
          }}
        >
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>GHchat crashed</div>
          <div style={{ fontSize: "0.875rem", color: "#6b7280", maxWidth: "340px", lineHeight: 1.6 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 1.25rem",
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App bootstrap ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
