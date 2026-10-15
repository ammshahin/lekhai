# voice-app (working name — final name TBD)

Cross-platform voice app with two modes:
- **Dictate:** hold a hotkey, speak, cleaned text is pasted into the active app.
- **Record:** record or upload meetings/lectures → transcript, summary, action items (v0.2).

Target users: Bangladesh first (BDT pricing). Bangla + English mixed speech is a key feature.
Full blueprint: `docs/ARCHITECTURE.md`. Decisions log: `docs/DECISIONS.md`.

## Current phase
v0.1 — personal desktop dictation on Windows (macOS from week 3).
Bring-your-own API keys, no backend, no accounts.

## Stack
- Monorepo: pnpm workspaces + Turborepo
- Desktop: Tauri v2 (Rust core) + React + TypeScript + Vite — `apps/desktop`
- AI logic: `packages/core` (TypeScript, no Tauri imports) — `SttProvider`, `LlmProvider`, pipelines, prompts
- STT default: Groq `whisper-large-v3-turbo`; LLM: any OpenAI-compatible endpoint (Groq/OpenRouter)
- HTTP from the app goes through the Rust `http_fetch` command (`src-tauri/src/http.rs`: one shared kept-alive client, host allowlist, warmed on recording start); `packages/core` takes an injected `fetch`
- Local data: SQLite (`tauri-plugin-sql`), settings in `tauri-plugin-store`, API keys in OS keychain (`keyring` crate)
- Later: Supabase + Hono API (`apps/api`), web dashboard (`apps/web`)

## How dictation works (v0.1)
1. Rust registers a global shortcut (default `Ctrl+Shift+Space`). Press → start recording, release → stop.
   A second shortcut (`Ctrl+Shift+D`) toggles recording for hands-free use.
2. Rust (`src-tauri/src/audio/`) captures the default mic with `cpal`, downmixes to mono, resamples to 16 kHz,
   encodes WAV in memory and emits `recording-finished` with the bytes.
3. The UI (`src/dictation.ts`) runs `runDictation()` from `packages/core`: STT → cleanup LLM.
4. The UI calls the Rust command `paste_text`, which swaps the clipboard, sends Ctrl/Cmd+V, then restores it.
5. The result is saved to SQLite history.

## Key paths
- `apps/desktop/src-tauri/src/audio/` — capture, resample, WAV encode
- `apps/desktop/src-tauri/src/hotkey.rs` — hold-to-talk + toggle
- `apps/desktop/src-tauri/src/paste.rs` — clipboard swap + simulated paste
- `apps/desktop/src-tauri/src/secrets.rs` — API keys in the OS keychain
- `apps/desktop/src/` — React UI (settings, history, status pill)
- `packages/core/src/providers/` — one file per provider
- `packages/core/src/prompts.ts` + `docs/prompts/` — versioned cleanup prompt
- `eval/` — test clips + scoring script

## Commands
- `pnpm install`
- `pnpm dev:desktop` — run the Tauri app in dev
- `pnpm test` — unit tests (Vitest); `cargo test` in `apps/desktop/src-tauri`
- `pnpm typecheck`
- `pnpm eval` — run STT/cleanup eval on `eval/clips`
- `pnpm build:desktop` — release build (installer in `apps/desktop/src-tauri/target/release/bundle`)

## Rules
- All model calls go through `SttProvider` / `LlmProvider`; never call a vendor API from UI components.
- `packages/core` must stay platform-neutral (no Tauri imports) so v0.3 can move it behind the API.
- Dictation latency budget: ≤ 1.5 s from hotkey release to paste for a 15 s clip. Log timings per step.
- Cleanup must never add content, answer questions, or translate unless the output-script setting asks for it.
- Preserve the speaker's language mix; output script (Bengali / Banglish / English / as spoken) is a setting.
- Never write API keys to files, logs, or the store. Never upload audio except to the chosen STT provider.
- Restore the user's clipboard after pasting.
- Prompt changes: bump `CLEANUP_PROMPT_VERSION`, copy to `docs/prompts/`, and run `pnpm eval`.
- Record architectural decisions in `docs/DECISIONS.md`.

## Platform notes
- Windows is the primary dev machine. Prereqs: Rust (MSVC), Node 20+, pnpm, WebView2 (preinstalled on Win 10/11).
- macOS needs Microphone + Accessibility permissions (paste); add an onboarding screen before macOS release.
- Windows system audio (v0.2): WASAPI loopback. macOS system audio: ScreenCaptureKit.
- Modifier-only hotkeys (Right-Alt alone) need the `rdev` crate; the Tauri plugin needs a key combo.
