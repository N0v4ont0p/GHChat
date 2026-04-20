# GHchat

A premium macOS desktop AI chat application built with Electron, React, and TypeScript. Powered by the [Hugging Face Inference API](https://huggingface.co/inference-api) for access to state-of-the-art open-source language models.

## Features

- 🤖 **Multiple AI models** — Mistral, Llama 3, Zephyr, Gemma, Qwen and more
- 💬 **Streaming responses** — real-time token streaming via IPC
- 🗄️ **Local persistence** — conversations stored in SQLite via Drizzle ORM
- 🔑 **Secure key storage** — API key encrypted via `electron.safeStorage` (OS keychain)
- 🎨 **Premium UI** — dark theme, Framer Motion animations, shadcn/ui components
- 📝 **Markdown rendering** — full GFM support with syntax highlighting

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (`npm install -g pnpm` or `corepack enable`)
- A free [Hugging Face account](https://huggingface.co)

## Quick Start

```bash
# Install dependencies
pnpm install

# Start in development mode
pnpm dev
```

## Getting a Hugging Face API Key

1. Sign up at [huggingface.co](https://huggingface.co)
2. Go to [Settings → Access Tokens](https://huggingface.co/settings/tokens)
3. Create a new token with **Read** permissions
4. Open GHchat → Settings → paste your key

## Architecture

```
electron/
  main/          # Node.js main process
    services/    # Database, keychain, HF client
    ipc/         # IPC handlers
  preload/       # Context bridge (exposes window.ghchat)
src/             # React renderer
  components/    # UI components
  hooks/         # TanStack Query + streaming hooks
  stores/        # Zustand state
  lib/           # IPC wrappers, utilities
  types/         # Shared TypeScript types
```
