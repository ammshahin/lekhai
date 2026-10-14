import { buildCleanupSystemPrompt, buildCleanupUserMessage } from "./prompts";
import type { LanguageHint, LlmProvider, OutputScript, SttProvider } from "./types";

export interface DictationSettings {
  language: LanguageHint;
  outputScript: OutputScript;
  /** Turn LLM cleanup off to paste the raw transcript. */
  cleanup: boolean;
  vocabulary: string[];
}

export interface DictationInput {
  audio: Uint8Array;
  mimeType?: string;
  fileName?: string;
  stt: SttProvider;
  /** Optional: without it the raw transcript is returned. */
  llm?: LlmProvider;
  settings: DictationSettings;
  appName?: string;
  signal?: AbortSignal;
  /** Injected clock for tests. */
  now?: () => number;
}

export interface DictationTimings {
  sttMs: number;
  llmMs: number;
  totalMs: number;
}

export interface DictationResult {
  raw: string;
  clean: string;
  detectedLanguage?: string;
  cleanupSkipped: boolean;
  /** Set when cleanup failed and the raw transcript was used instead. */
  cleanupError?: string;
  timings: DictationTimings;
}

/** Below this many words, cleanup costs more latency than it adds value. */
export const MIN_WORDS_FOR_CLEANUP = 4;

export async function runDictation(input: DictationInput): Promise<DictationResult> {
  const now = input.now ?? (() => performance.now());
  const t0 = now();

  const stt = await input.stt.transcribe({
    audio: input.audio,
    mimeType: input.mimeType ?? "audio/wav",
    fileName: input.fileName ?? "clip.wav",
    language: input.settings.language,
    vocabulary: input.settings.vocabulary,
    signal: input.signal,
  });
  const t1 = now();

  const raw = stt.text.trim();
  const base = { raw, detectedLanguage: stt.language };

  const skip = shouldSkipCleanup(raw, input.settings, Boolean(input.llm));
  if (skip || !input.llm) {
    return {
      ...base,
      clean: raw,
      cleanupSkipped: true,
      timings: { sttMs: t1 - t0, llmMs: 0, totalMs: t1 - t0 },
    };
  }

  try {
    const output = await input.llm.complete(
      [
        {
          role: "system",
          content: buildCleanupSystemPrompt({
            outputScript: input.settings.outputScript,
            appName: input.appName,
            vocabulary: input.settings.vocabulary,
          }),
        },
        { role: "user", content: buildCleanupUserMessage(raw) },
      ],
      { temperature: 0, maxTokens: Math.max(512, raw.length * 2), signal: input.signal },
    );
    const t2 = now();
    const clean = sanitizeCleanupOutput(output, raw);
    return {
      ...base,
      clean,
      cleanupSkipped: false,
      timings: { sttMs: t1 - t0, llmMs: t2 - t1, totalMs: t2 - t0 },
    };
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const t2 = now();
    // Never lose the user's words: fall back to the raw transcript.
    return {
      ...base,
      clean: raw,
      cleanupSkipped: false,
      cleanupError: err instanceof Error ? err.message : String(err),
      timings: { sttMs: t1 - t0, llmMs: t2 - t1, totalMs: t2 - t0 },
    };
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function shouldSkipCleanup(raw: string, settings: DictationSettings, hasLlm: boolean): boolean {
  if (!raw) return true;
  if (!hasLlm || !settings.cleanup) return true;
  // Translation/transliteration needs the LLM even for short clips.
  if (settings.outputScript !== "as-spoken") return false;
  return countWords(raw) < MIN_WORDS_FOR_CLEANUP;
}

/** Strip wrappers some models add despite instructions. Falls back to raw if the model returned nothing. */
export function sanitizeCleanupOutput(output: string, raw: string): string {
  let text = output.trim();
  text = text.replace(/^<\/?transcript>\s*/i, "").replace(/\s*<\/?transcript>$/i, "");
  text = text.replace(/^(here is|here's) (the )?(cleaned|corrected)[^:\n]*:\s*/i, "");
  const quoted = /^(["“'])([\s\S]*)(["”'])$/.exec(text);
  if (quoted && !/^["“']/.test(raw.trim())) text = quoted[2] ?? text;
  text = text.trim();
  return text || raw;
}
