import type { Metadata } from "next";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "GHchat — Premium local-first AI chat",
  description:
    "A polished local-first AI chat app for macOS with Ollama integration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-theme="dark">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
