# GHchat

<div align="center">

![GHchat logo](./public/ghchat-logo.svg)

**Premium local-first AI chat for macOS, built for Ollama.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

GHchat is a polished local AI chat app designed for people who want a beautiful, modern chat experience on macOS without depending on cloud inference for day-to-day use.

> Built with Apple Silicon workflows in mind (especially M2 MacBook Air) and Ollama as the default local provider.

---

## 1) Project intro

### What GHchat is
GHchat is a local-first AI chat interface that connects to your local Ollama runtime, lets you choose installed models, streams responses smoothly, renders markdown/code beautifully, and stores history/settings in local SQLite.

### Who it is for
- macOS users who want a premium local chat UX
- developers experimenting with local models
- privacy-conscious users who prefer local inference where possible

### Key features
- automatic Ollama status detection + fallback host config
- model picker + streaming responses
- SQLite-backed local chat history
- premium dark UI with smooth motion and tasteful depth
- native macOS desktop packaging via Tauri (`.app` bundle target)
- external-drive-friendly project and data directory setup

### Screenshots
> Add screenshots in `docs/screenshots/` and link them here.

- `![Main chat](docs/screenshots/main-chat.png)`
- `![Settings](docs/screenshots/settings.png)`

---

## 2) Features

- **Local-first AI chat** with provider abstraction
- **Ollama detection** (`online`, `not running`, `not detected`, `unreachable`)
- **Model picker** for installed local models
- **Streaming assistant responses**
- **Markdown + code rendering** with syntax highlighting + copy button
- **Local persistence** for chats/messages/settings (SQLite)
- **Premium UI** (dark by default, restrained animation, polished composition)
- **External-drive-ready** data directory support via `GHCHAT_DATA_DIR`

---

## 3) Tech stack

- **Next.js (App Router)**
- **React + TypeScript (strict)**
- **Tailwind CSS**
- **shadcn-style UI primitives**
- **Framer Motion**
- **Zustand**
- **TanStack Query**
- **react-markdown + remark-gfm + rehype-highlight**
- **SQLite + Drizzle ORM + better-sqlite3**
- **pnpm**

---

## 4) Quick start

```bash
# 1) Clone
git clone https://github.com/N0v4ont0p/GHChat.git
cd GHChat

# 2) Install
corepack enable
pnpm install

# 3) Run Ollama separately
ollama serve

# 4) Pull at least one model
ollama pull gemma3:4b

# 5) Start GHchat
pnpm dev
```

Open: `http://localhost:3000`

---

## 5) Full installation guide for macOS

1. Install Homebrew if needed:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
2. Install Node.js 20+ (example):
   ```bash
   brew install node
   ```
3. Enable pnpm via Corepack:
   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   ```
4. Clone and install:
   ```bash
   git clone https://github.com/N0v4ont0p/GHChat.git
   cd GHChat
   pnpm install
   ```
5. Start GHchat:
    ```bash
    pnpm dev
    ```

> **Desktop development only:** If you plan to use `pnpm desktop:dev` or build the native `.app`, you also need Rust installed (see section 6 below).

---

## 6) Desktop app packaging (Tauri, macOS)

GHchat includes a first-class desktop target under `src-tauri/` so you can build and ship a native macOS `.app` while keeping the React/Next.js UI.

### Prerequisites for desktop development

Tauri requires the **Rust toolchain**. If you see an error like `failed to run 'cargo metadata'`, Rust is not installed. Install it with:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal (or run `source ~/.cargo/env`) after installation. Verify with:

```bash
rustc --version
cargo --version
```

### Desktop development
Run the web UI in dev mode inside a native Tauri window:

```bash
pnpm desktop:dev
```

### Build a macOS `.app` bundle

**No Apple account or Apple Developer subscription required.**

GHchat uses ad-hoc code signing (`-`), which lets you build and run a personal `.app` without registering with Apple. The build commands bake in the right signing environment automatically:

```bash
pnpm desktop:build
```

For Apple Silicon-specific output (M1/M2/M3):

```bash
pnpm desktop:build:apple-silicon
```

Generated app bundle path:

```text
src-tauri/target/release/bundle/macos/GHchat.app
```

### First launch: clearing the Gatekeeper quarantine

macOS quarantines apps that were not downloaded from the App Store or signed by a registered Apple Developer. On the first launch you may see a dialog saying the app "cannot be opened because the developer cannot be verified."

To clear it, run once after building (or after copying the `.app` from another location):

```bash
xattr -rd com.apple.quarantine src-tauri/target/release/bundle/macos/GHchat.app
```

Alternatively: right-click `GHchat.app` in Finder → **Open** → click **Open** in the confirmation dialog.

After either step the app will open normally on every subsequent launch.

> **Note:** If you want to distribute GHchat to other users without the quarantine warning, you would need a paid Apple Developer account to notarize the app. That is only relevant for public distribution — for personal use, the ad-hoc build above works fine.

---

## 7) Ollama setup instructions

### Install Ollama on macOS
- Download from: https://ollama.com/download
- Or follow official install docs.

### Verify installation
```bash
ollama --version
```

### Start Ollama
```bash
ollama serve
```

### Check models
```bash
ollama list
```

### Pull a model (example)
```bash
ollama pull gemma3:4b
```

### Choose model in GHchat
- Open GHchat
- Use the top-bar model selector
- Start chatting

---

## 8) External drive setup guide

You can run GHchat from an external SSD and also store GHchat data there.

### A) Keep the project on an external SSD
```bash
cd /Volumes/YourExternalSSD
git clone https://github.com/N0v4ont0p/GHChat.git
cd GHChat
pnpm install
pnpm dev
```

### B) Store GHchat local data on external SSD
Set `GHCHAT_DATA_DIR` before running:

```bash
export GHCHAT_DATA_DIR="/Volumes/YourExternalSSD/ghchat-data"
pnpm dev
```

GHchat stores SQLite and app data under that directory.

### C) Ollama model storage and disk usage
Local models can consume substantial disk space. Depending on your Ollama setup, model storage may be configured separately from GHchat.

Practical approach:
- Keep GHchat code + data on external SSD
- Keep Ollama running locally and point GHchat to its host (default `http://localhost:11434`)
- If you relocate Ollama/model storage, follow Ollama’s official storage/config guidance

### D) Realistic portability notes
- GHchat project and GHchat data can live externally
- The built `GHchat.app` can be copied and run from an external SSD
- Some macOS-managed support files can still be created internally (for example in `~/Library/Application Support`, `~/Library/Caches`, or system-managed WebKit/state locations)
- Full system-level portability is not always possible for every dependency/toolchain

---

## 9) Model recommendations for M2 MacBook Air

These are practical starting points (not benchmark claims):

| Scenario | Recommendation | Why |
|---|---|---|
| Lower memory setup | Gemma-family small variant (e.g. ~2B class where available) | Faster and lighter under memory pressure |
| Balanced setup | Smaller “edge” style variant (e.g. Gemma 4 / Gemma 3 around 4B) | Good quality-speed balance for daily chat |
| Heavier / experimental | Larger variants (7B+) | Better quality potential, but slower and more thermal/memory heavy on Air |

Guidance:
- Start small, confirm smooth UX, then scale up.
- Larger models may reduce responsiveness and increase thermals on fanless laptops.

---

## 10) Troubleshooting

### `cargo metadata` not found / Rust not installed
- This error appears when running `pnpm desktop:dev` or `pnpm desktop:build` without Rust installed.
- Install Rust via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` and restart your terminal.
- Verify with `cargo --version`, then retry the desktop command.

### Ollama not found
- Install Ollama first
- Verify with `ollama --version`

### Ollama installed but not running
- Run `ollama serve`
- Refresh GHchat status

### No models listed
- Pull a model: `ollama pull gemma3:4b`
- Check `ollama list`

### Port issues
- Ensure host/port in Settings matches Ollama (`http://localhost:11434` by default)

### App launches but chat fails
- Verify selected model exists
- Verify Ollama status is `online`
- Check terminal for API errors

### External drive path issues
- Confirm drive is mounted
- Verify `GHCHAT_DATA_DIR` points to a writable path

### Permissions issues
- Ensure terminal/app has file access permissions to external volume

---

## 11) Development

```bash
pnpm install
pnpm dev
pnpm desktop:dev
pnpm desktop:web:prepare
pnpm desktop:build
pnpm lint
pnpm build
pnpm format
```

### Important folders
- `app/` – Next.js routes + API
- `components/` – layout/chat/settings/ui
- `lib/providers/` – provider abstraction + Ollama provider
- `lib/db/` – SQLite + Drizzle schema/repository
- `stores/` – Zustand state
- `src-tauri/` – native desktop shell + macOS bundle config
- `scripts/prepare-desktop-web.mjs` – prepares bundled Next standalone output for desktop packaging
- `types/` – shared types

---

## 12) Architecture overview

- **App shell:** sidebar + topbar + chat + composer
- **Provider abstraction:** `LLMProvider` interface with Ollama implementation
- **Persistence layer:** SQLite with Drizzle schema and repository access
- **UI/state layers:** React UI, Zustand for local UI state, TanStack Query for server state
- **Desktop shell:** Tauri runtime launches the packaged standalone Next server and wraps it as a native macOS app

---

## 13) Future roadmap

- pluggable providers beyond Ollama
- richer keyboard navigation + prompt tools
- optional import/export for conversation archives

---

## 14) License

Released under the [MIT License](./LICENSE).

---

## Environment variables

See `.env.example`.

- `GHCHAT_BACKEND_HOST` – default Ollama host in settings
- `GHCHAT_DATA_DIR` – custom GHchat data directory (great for external SSD workflows)
