# Decisions

One line per decision. Newest first. Change a decision by adding a new line, not editing old ones.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-15 | No floating "listening" pill in v0.1; start/stop sounds + tray tooltip instead | Showing a window can steal focus from the app we paste into; revisit with a non-activating window |
| 2026-10-15 | Default cleanup model: Groq `openai/gpt-oss-20b` with `reasoning_effort: low` | Fastest cheap model on Groq ($0.075/$0.30 per M tokens); change in Settings |
| 2026-10-15 | v0.1 encodes 16 kHz mono WAV (not FLAC) | Simpler (`hound`), clips are short; switch to FLAC/Opus for meeting mode |
| 2026-10-15 | HTTP from the app goes through `tauri-plugin-http`; `packages/core` takes an injected `fetch` | Avoids CORS, keeps core platform-neutral |
| 2026-10-15 | Default hotkeys: hold `Ctrl+Shift+Space`, toggle `Ctrl+Shift+D` | Tauri global-shortcut needs a key combo; Right-Alt alone needs `rdev` (later) |
| 2026-10-14 | Product name TBD; repo uses working name `voice-app` | Name candidates: Fushfash, Jhotpot, Lekhai, Kothalipi |
| 2026-10-14 | Tauri v2 + React + TypeScript, pnpm + Turborepo monorepo | Small installer, Rust for audio/OS hooks, shared TS later |
| 2026-10-14 | Default STT Groq `whisper-large-v3-turbo`, final choice after Bangla spike | $0.04/audio hour, fast; compare ElevenLabs Scribe and Soniox on Bangla |
| 2026-10-14 | v0.1 = bring-your-own keys, no backend | Personal use first; backend proxy in v0.3 |
| 2026-10-14 | Backend (v0.3): Supabase + Hono; payments: SSLCommerz/bKash (BD), Paddle (intl) | Auth/DB out of the box; Stripe doesn't onboard BD merchants |
