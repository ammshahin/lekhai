# Prompt history

The live prompt is in `packages/core/src/prompts.ts`. When you change it:

1. Bump `CLEANUP_PROMPT_VERSION`.
2. Copy the new prompt here as `cleanup.v<N>.md` with a one-line note on what changed.
3. Run `pnpm eval` and paste the score into the note.

| Version | Change | Eval score |
| --- | --- | --- |
| 1 | Initial prompt | — |
