# Eval clips

Your own test recordings. Audio files here are git-ignored; only this README and the example manifest are committed.

1. Record ~20 short clips (5–30 s): about a third Bangla, a third English, a third mixed.
   Any format Whisper accepts works: wav, mp3, m4a, ogg, webm, flac.
2. Copy `manifest.example.json` to `manifest.json` and add one entry per clip with exactly what you said
   (`reference`) and, optionally, how you'd want the cleaned text to read (`expectedClean`).
3. From the repo root:
   ```powershell
   $env:GROQ_API_KEY = "gsk_..."
   pnpm eval                 # STT only: word error rate per clip
   pnpm eval -- --cleanup    # also run the cleanup model and show its output
   ```
   Results are written to `eval/results/`.
