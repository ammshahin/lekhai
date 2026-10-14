# voice-app

> Working name. The product name is still being decided.

Hold a hotkey, speak (Bangla, English, or both), and clean text appears in whatever app you're using.
Meeting and lecture transcription with summaries comes next.

## Status

v0.1 in progress — personal desktop dictation (Windows first). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup (Windows)

1. Install prerequisites (once):
   - [Rust](https://rustup.rs) with the MSVC toolchain, plus "Desktop development with C++" from Visual Studio Build Tools
   - Node.js 20+ and pnpm (`npm i -g pnpm`)
   - WebView2 is already on Windows 10/11
2. Install and run:
   ```powershell
   pnpm install
   pnpm dev:desktop
   ```
3. In the app's **Settings**, paste your Groq API key (free at console.groq.com). Keys are stored in Windows Credential Manager.
4. Hold **Ctrl+Shift+Space**, speak, release. Or press **Ctrl+Shift+D** to start/stop hands-free.

## Repo layout

```
apps/desktop      Tauri v2 app (Rust core + React UI)
packages/core     STT/LLM providers, prompts, dictation pipeline (platform-neutral TS)
eval              test clips + scoring script for STT and cleanup quality
docs              architecture, decisions, prompt history
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev:desktop` | Run the desktop app with hot reload |
| `pnpm test` | Unit tests |
| `pnpm typecheck` | TypeScript checks |
| `pnpm eval` | Score STT + cleanup on your test clips |
| `pnpm build:desktop` | Build the installer |
