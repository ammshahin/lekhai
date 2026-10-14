# Architecture

One app, two modes, one speech-to-text backend:
**Dictate** (hold a hotkey, speak, cleaned text is pasted into any app) and
**Record** (meeting/lecture → transcript, summary, action items).

## Phases

| Phase | Features | Gate to move on |
| --- | --- | --- |
| Spike (days 1–2) | Bangla STT comparison (Groq Whisper, ElevenLabs Scribe, Soniox), hotkey + paste demo | STT provider chosen |
| v0.1 core (weeks 1–2) | Hotkey, mic capture, STT, LLM cleanup, paste, tray, local history, settings | Works end to end |
| v0.1 polish (week 3) | Latency tuning, prompt eval, macOS, installers, updater | Used daily for a week |
| v0.2 record (weeks 4–5) | Mic + system audio recording, uploads, chunking, summaries, export | 1-hr lecture processed in < 5 min |
| v0.3 accounts (weeks 6–8) | Supabase auth, API proxy, metering, credits, bKash/card payments, dashboard | First 10 paying users |

Not building yet: meeting bots that join Zoom/Meet, live captions, iOS, own models.

## Components

```
┌──────────────── Desktop app (Tauri v2) ────────────────┐      ┌──── AI providers ────┐
│ hotkey.rs ──► audio/ (cpal → 16 kHz mono WAV)          │      │ STT: Groq Whisper     │
│                    │ event: recording-finished         │      │      (Scribe/Soniox)  │
│                    ▼                                   │ ───► │ LLM: cleanup/summary  │
│ React UI ──► packages/core runDictation() ─────────────┼──────┘ (OpenAI-compatible)  │
│     │                                                  │      └───────────────────────┘
│     ├─► paste.rs (clipboard swap + Ctrl/Cmd+V)          │
│     └─► SQLite history · store settings · keychain keys │      ┌── Backend (v0.3) ─────┐
└────────────────────────────────────────────────────────┘ ···► │ Hono API + Supabase   │
                                                                 │ auth, metering, jobs  │
                                                                 └───────────────────────┘
```

In v0.1 the app calls providers directly with the user's own keys. In v0.3 the same
`packages/core` code moves behind the API so users never see keys and usage can be billed.

## Dictation pipeline

Target: text pasted ≤ 1.5 s after releasing the hotkey for a 15 s clip.

1. Record while the hotkey is held. Clips < 0.5 s are discarded.
2. Encode 16 kHz mono WAV; send to STT with a language hint (`auto`/`bn`/`en`) and a vocabulary prompt.
3. Send the raw transcript to the cleanup LLM (skip if < 4 words).
4. Paste the result; save raw + clean text to history with per-step timings.

Cleanup rules (see `packages/core/src/prompts.ts`): remove fillers and false starts, apply
self-corrections, fix punctuation and lists, never add content or answer questions, keep the
language mix, output script per setting (as spoken / Bengali / Banglish / English).

## Meeting/lecture pipeline (v0.2)

Record in 30 s segments (crash-safe) or accept uploads → split into ~10 min chunks on silence
with 2 s overlap → transcribe in parallel → stitch → per-chunk notes → final summary, key points,
action items. Speaker labels in v0.4.

## Data model

| Table | Key fields | Phase |
| --- | --- | --- |
| `dictations` | id, created_at, duration_ms, language, raw_text, clean_text, stt_provider, llm_model, latency_ms | v0.1 (local) |
| `recordings` | id, user_id, title, kind, duration_s, status, audio_path | v0.2 |
| `transcripts` | recording_id, segments JSON, summary_md, action_items JSON | v0.2 |
| `vocabulary` | user_id, term, replacement | v0.2 |
| `usage`, `credits` | user_id, kind, audio_seconds, llm_tokens, cost_usd; plan, balance | v0.3 |

## API (v0.3)

- `POST /v1/dictate` — audio in, `{raw, clean}` out
- `POST /v1/recordings`, `POST /v1/recordings/:id/process`, `GET /v1/recordings/:id`
- `GET /v1/usage`
- `POST /v1/billing/checkout`, `POST /v1/billing/webhook`

## Cost model (approximate)

Groq Whisper turbo is $0.04 per audio hour. A heavy user (≈7 hr dictation + 20 hr meetings/month)
costs about $2.50/month including LLM. Suggested plans: Free (2,000 words/week + 1 hr recording),
Pro BDT 399–499/month, pay-as-you-go credits, USD 4–5 internationally.
