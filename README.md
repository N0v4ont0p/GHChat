<div align="center">

# GHchat

**A premium macOS desktop AI chat app powered by free open-source models via OpenRouter.**

Built with Electron, React, and the OpenRouter API — fast, private, and beautiful.

<br/>

![macOS](https://img.shields.io/badge/macOS-13%2B-black?style=flat-square&logo=apple)
![Electron](https://img.shields.io/badge/Electron-34-47848F?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

</div>

---

## What is GHchat?

GHchat is a native macOS desktop application that lets you have real conversations with powerful open-source AI models — for free, without sending your data to a cloud service, without a monthly subscription, and without leaving the comfort of your own machine.

GHchat fetches free models live from [`https://openrouter.ai/api/v1/models`](https://openrouter.ai/api/v1/models), supports all current free OpenRouter models, uses intelligent routing to pick the best model for each prompt, and adapts the UI to each model's capabilities instead of pretending every model supports the same features.

Your conversations are stored locally in SQLite. Your API key is encrypted by the OS. Your data doesn't leave your computer except to reach OpenRouter's public API.

**Who it's for:**  
Developers, researchers, and power users who want a clean, fast AI chat experience without the overhead of a browser or a web dashboard.

---

## Features

| Feature | Detail |
|---|---|
| 🆓 Free OpenRouter models | Live catalog of all current free models — Gemma, Llama, Qwen, Nemotron, Dolphin, and more |
| 🤖 Intelligent Auto routing | Classifies your prompt (coding/reasoning/creative/fast/general) and picks the best model |
| 🎯 Capability-adaptive UI | UI adapts per model — coding badge for code models, reasoning mode for analytical models |
| 🔄 Live model catalog | Fetches `GET openrouter.ai/api/v1/models` on startup — always current, never stale |
| 🔒 Secure key storage | API key encrypted via `electron.safeStorage` — never plain text |
| 💬 Persistent history | All conversations stored locally in SQLite |
| ⚡ Streaming responses | Real-time token-by-token output with stop generation support |
| 🔁 Regenerate replies | Re-run any assistant response with one click |
| 📝 Markdown rendering | Full markdown with syntax-highlighted code blocks |
| 📋 Copy code | One-click copy on every code block |
| 🖥️ Native macOS shell | Traffic lights, vibrancy, `hiddenInset` title bar |
| 🚀 Onboarding flow | Step-by-step first-run setup for API key and model selection |

---

## How Free Model Routing Works

GHchat's main process handles all model intelligence so the renderer stays clean:

1. **Fetch** — `GET https://openrouter.ai/api/v1/models` on startup and cache for 5 minutes
2. **Filter** — Keep only models where `pricing.prompt === "0"` and `pricing.completion === "0"`
3. **Detect capabilities** — Rule-based detection from model ID/name: coding, reasoning, creative, fast, long context, tool use, special reasoning (chain-of-thought)
4. **Build catalog** — Normalized free-model catalog with friendly names and capability metadata
5. **Track runtime health** — `available`, `degraded`, `rate-limited`, `unavailable` per model
6. **Route** — Auto mode classifies your prompt and scores candidates; manual mode uses your selection
7. **Fallback** — If a direct free model fails, try the next best; ultimate fallback: `openrouter/free`
8. **Stream** — Send tokens to the renderer with full lifecycle state (validating → routing → streaming → completed)
9. **Adapt UI** — Renderer uses capability metadata to show relevant badges and modes

### Verified free model IDs (as of initial release)

| Model ID | Capability |
|---|---|
| `openrouter/free` | Auto fallback router |
| `google/gemma-4-31b-it:free` | General chat |
| `google/gemma-4-26b-a4b-it:free` | General chat (fallback) |
| `meta-llama/llama-3.3-70b-instruct:free` | Reasoning / general |
| `nvidia/nemotron-3-nano-30b-a3b:free` | Reasoning |
| `qwen/qwen3-coder:free` | Coding |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | Creative |
| `google/gemma-3-12b-it:free` | General |
| `google/gemma-3n-e2b-it:free` | Fast |
| `inclusionai/ling-2.6-flash:free` | General / fast |
| `liquid/lfm-2.5-1.2b-instruct:free` | Fast / lightweight |

---

## Screenshots

> _Screenshots coming once the app is packaged. Run `pnpm dev` to see the live UI._

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://electronjs.org) 34 |
| Build tooling | [electron-vite](https://electron-vite.org) + Vite |
| Packaging | [electron-builder](https://electron.build) |
| Frontend | [React](https://react.dev) 18 + [TypeScript](https://typescriptlang.org) 5 |
| Styling | [Tailwind CSS](https://tailwindcss.com) v3 |
| Components | [shadcn/ui](https://ui.shadcn.com) (Radix UI + CVA) |
| Animation | [Framer Motion](https://framer.motion.com) |
| State | [Zustand](https://zustand-demo.pmnd.rs) |
| Server state | [TanStack Query](https://tanstack.com/query) v5 |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team) |
| AI provider | [OpenRouter API](https://openrouter.ai/docs) (free models) |
| Syntax highlighting | [highlight.js](https://highlightjs.org) via rehype |

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/N0v4ont0p/GHChat.git
cd GHChat

# Install dependencies
pnpm install --ignore-scripts   # skips native rebuild in CI

# (Optional) Rebuild better-sqlite3 for your Electron version
pnpm run rebuild:native

# Start in development mode
pnpm dev
```

Then open Settings, paste your OpenRouter API key, pick a model (or leave on Auto), and start chatting.

---

## Full Setup Guide

### Prerequisites

- **Node.js** 20 or later
- **pnpm** 9 or later (`npm install -g pnpm` or use corepack)
- **macOS** 13 Ventura or later (for vibrancy and `electron.safeStorage`)
- **Xcode Command Line Tools** (for building native modules)
  ```bash
  xcode-select --install
  ```

### Install

```bash
pnpm install --ignore-scripts
pnpm run rebuild:native          # builds better-sqlite3 for Electron
```

### Develop

```bash
pnpm dev
# Electron opens automatically with Vite HMR
```

### Build

```bash
pnpm build
# Outputs to out/ (main, preload, renderer)
```

### Package for macOS

```bash
# Universal (both arm64 and x64 in one run)
pnpm run package:mac

# Apple Silicon only
pnpm run package:mac:arm64

# Intel only
pnpm run package:mac:x64
```

The packaged `.dmg` and `.zip` output goes to the `dist/` directory.

> **Note:** Code signing is not configured for distribution. For personal use, open System Preferences → Security & Privacy and allow the app after first launch.

---

## OpenRouter API Key Setup

### Getting your key

1. Go to [openrouter.ai](https://openrouter.ai) and create a free account
2. Navigate to **Keys** (or visit [openrouter.ai/keys](https://openrouter.ai/keys) directly)
3. Click **Create key**, give it a name
4. Copy the key — it starts with `sk-or-`

Free-tier keys have access to all free models. No credit card required.

### Adding it to GHchat

- On first launch, the onboarding flow will walk you through entering and verifying your key
- You can update it any time from **Settings → API Key**
- Click **Verify** to confirm the key is valid before saving

### How GHchat stores your key

GHchat uses **`electron.safeStorage`**, Electron's built-in OS-level secret storage:

- On **macOS**, secrets are encrypted using the system Keychain
- The encrypted blob is written to a file in your app data directory (e.g. `~/Library/Application Support/ghchat/.or-key`)
- The key is **never stored in plain text**, never written to localStorage, and never logged
- Removing the app's data directory clears the key

### Changing or removing your key

- Open **Settings → API Key** and paste a new key, then click **Save**
- To remove the key entirely, click **Clear stored key** in the settings panel
- After clearing, GHchat will restart the onboarding flow on next launch

---

## Model Recommendation Guide

GHchat curates a list of models that work reliably with the Hugging Face Inference API, organized into four categories. You don't need to know model internals to make a good choice.

### 💬 General Chat — Best for most people

| Model | Why choose it |
|---|---|
| **Mistral 7B Instruct** *(default)* | Fast, balanced, works great for everyday questions and long conversations |
| **Zephyr 7B** | Excellent at following instructions with a natural, helpful tone |
| **Gemma 2 9B** | More thoughtful responses with Google's safety tuning |

### 🧑‍💻 Coding — For programming tasks

| Model | Why choose it |
|---|---|
| **Qwen 2.5 Coder 7B** | Purpose-built for code — strong at Python, TypeScript, Rust, Go, and debugging |
| **Phi 3.5 Mini** | Compact but surprisingly capable for code tasks and long contexts |

### ⚡ Fast — For quick answers

| Model | Why choose it |
|---|---|
| **Phi 3 Mini** | Ultra-fast, low latency, great for simple Q&A and summaries |
| **Qwen 2.5 1.5B** | Smallest available, instant responses for lightweight tasks |

### �� Reasoning — For complex problems

| Model | Why choose it |
|---|---|
| **Llama 3 8B Instruct** | Meta's flagship open model — excellent at analysis and multi-step reasoning |
| **Qwen 2.5 7B** | Strong structured reasoning, especially good for non-English languages |

**Recommendation for new users:** Start with **Mistral 7B Instruct**. It's the best all-rounder and responds quickly. Switch to a specialized model once you know what you need.

---

## External Drive Guide

GHchat's repository and packaged app can live on an external SSD. Here's what you need to know.

### Running from an external drive

You can clone the repo and run `pnpm dev` from any path — the app doesn't have to live on your internal disk.

```bash
# On an external drive mounted at /Volumes/MySSD
cd /Volumes/MySSD/GHChat
pnpm install --ignore-scripts
pnpm run rebuild:native   # important — native modules must be rebuilt for your Electron
pnpm dev
```

### Where data lives at runtime

Even if GHchat's source code is on an external drive, macOS stores **runtime data on your internal disk**:

| Data | Location |
|---|---|
| SQLite database | `~/Library/Application Support/ghchat/ghchat.db` |
| Encrypted API key | `~/Library/Application Support/ghchat/.hf-key` |
| Electron logs | `~/Library/Logs/ghchat/` |

This is intentional: macOS apps write to `app.getPath('userData')` which always resolves to the internal Library. This ensures:
- Data persists even when the drive is unplugged
- The OS can encrypt and secure the API key
- No risk of data loss on drive ejection

### Caveats for external drives

| Scenario | What happens |
|---|---|
| Drive ejected while app runs | App keeps running; your data is safe on the internal disk |
| Reinstall on a different machine | You need to re-enter your API key; conversations stay on the original machine |
| Moving the packaged `.app` | Drag the app from `dist/mac-arm64/GHchat.app` to `/Applications` — data path is unchanged |
| Native module mismatch | If you move `node_modules` between machines, run `pnpm run rebuild:native` |

---

## Architecture Overview

```
GHchat
├── Electron Main Process
│   ├── Window management (hiddenInset titleBar, vibrancy)
│   ├── IPC handlers (conversations, messages, settings, HF streaming)
│   ├── SQLite + Drizzle ORM (better-sqlite3)
│   ├── electron.safeStorage (API key encryption)
│   └── Provider system
│       └── HuggingFaceProvider
│           ├── healthCheck()
│           ├── validateApiKey()
│           ├── listModels() / getRecommendedModels()
│           └── streamChat() + AbortController for stop
│
├── Electron Preload
│   └── contextBridge → window.ghchat.{invoke, send, on}
│
└── React Renderer
    ├── Onboarding flow (first-run)
    ├── App shell (Sidebar + ChatWindow)
    ├── Zustand (UI state: streaming, draft, selected conversation)
    ├── TanStack Query (conversations, messages, settings)
    ├── Settings modal (API key + category model picker)
    └── Chat UI (MessageBubble + markdown + syntax highlighting)
```

### Provider interface

The `LLMProvider` interface makes it straightforward to add future providers:

```typescript
interface LLMProvider {
  id: string;
  name: string;
  requiresApiKey: boolean;

  healthCheck(): Promise<ProviderHealthResult>;
  validateApiKey(key: string): Promise<KeyValidationResult>;
  listModels(apiKey?: string): Promise<ModelInfo[]>;
  getRecommendedModels(): ModelPreset[];
  streamChat(options: StreamChatOptions): Promise<void>;
}
```

Adding **Ollama**, **LM Studio**, or an **OpenAI-compatible API** means implementing this interface and registering the provider in `electron/main/providers/index.ts`.

---

## Troubleshooting

### Invalid API key

- Make sure the key starts with `hf_` and was copied in full
- Use the **Verify** button in Settings before saving
- Keys need at least **Read** permissions — write-only tokens won't work
- If you recently created the token, wait 30 seconds and try again

### No response / streaming stops

- Check your internet connection
- The model may be loading on Hugging Face — wait 20–30 seconds and retry
- Some models require a Pro subscription; try a different model
- Click **Regenerate** to retry the last response without retyping

### Model errors

- `503 loading`: The model is cold-starting on HF infrastructure. Try again in ~30 seconds
- `403 Forbidden`: Your account may not have access to gated models (e.g. Llama requires accepting terms on HF)
- `404 Not Found`: The model ID may have changed — check the model page on huggingface.co
- `429 Rate limit`: You've hit the free tier limit. Wait a few minutes or upgrade to HF Pro

### Database / path issues

- DB path: `~/Library/Application Support/ghchat/ghchat.db`
- If the app fails to open, delete the DB file and restart (you'll lose conversation history)
- WAL mode is enabled by default for performance and concurrent access safety

### External drive issues

- If the app crashes on launch after moving between machines: run `pnpm run rebuild:native`
- The app's SQLite data is always on the internal disk — the external drive only holds source code

### macOS app launch / security

- On first launch of a packaged `.app`: right-click → Open, then click "Open" in the dialog
- Or go to System Settings → Privacy & Security → click "Open Anyway" next to GHchat
- This is required for unsigned apps — expected behavior on macOS

---

## Development Commands

```bash
pnpm dev                    # Start Electron + Vite HMR
pnpm build                  # Build main, preload, and renderer
pnpm preview                # Preview the built renderer
pnpm lint                   # Run ESLint
pnpm format                 # Format with Prettier
pnpm format:check           # Check formatting without writing
pnpm run rebuild:native     # Rebuild better-sqlite3 for Electron
pnpm run package:mac        # Build + package macOS .dmg (arm64 + x64)
pnpm run package:mac:arm64  # Build + package macOS .dmg (Apple Silicon)
pnpm run package:mac:x64    # Build + package macOS .dmg (Intel)
```

---

## Roadmap

- [ ] Ollama provider (local models, no API key needed)
- [ ] LM Studio provider (OpenAI-compatible local API)
- [ ] Conversation search
- [ ] Export conversations as Markdown / JSON
- [ ] System prompt customization
- [ ] Light mode
- [ ] Keyboard shortcuts panel
- [ ] Token usage display
- [ ] Multiple provider support in a single session

---

## License

[MIT](LICENSE) — do whatever you want with this code.

---

<div align="center">
<sub>Built with ☕ and open-source models · No cloud lock-in · No tracking · Just chat</sub>
</div>
