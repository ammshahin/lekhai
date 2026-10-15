/**
 * Scores speech-to-text (and optionally cleanup) on your own clips.
 *
 *   GROQ_API_KEY=... pnpm eval
 *   GROQ_API_KEY=... pnpm eval -- --cleanup --model openai/gpt-oss-20b
 *   STT_PROVIDER=openai STT_API_KEY=sk-... pnpm eval            # groq | openai | elevenlabs
 *   STT_PROVIDER=elevenlabs STT_MODEL=scribe_v1 STT_API_KEY=... pnpm eval
 *   STT_BASE_URL=... STT_MODEL=... STT_API_KEY=... pnpm eval   # any other OpenAI-compatible STT
 */
import {
  OpenAiCompatibleLlm,
  OpenAiCompatibleStt,
  STT_PROVIDERS,
  createSttProvider,
  runDictation,
  wordErrorRate,
  type LanguageHint,
  type SttProviderId,
} from "@voice-app/core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

interface ClipSpec {
  file: string;
  language?: LanguageHint;
  reference: string;
  expectedClean?: string;
}

const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
};

const args = process.argv.slice(2);
const withCleanup = args.includes("--cleanup");
const modelArg = args[args.indexOf("--model") + 1];
const llmModel = args.includes("--model") && modelArg ? modelArg : "openai/gpt-oss-20b";

const clipsDir = join(import.meta.dirname, "..", "clips");
const resultsDir = join(import.meta.dirname, "..", "results");

async function main() {
  const apiKey = process.env.STT_API_KEY ?? process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY (or STT_API_KEY).");

  let clips: ClipSpec[];
  try {
    clips = JSON.parse(await readFile(join(clipsDir, "manifest.json"), "utf8"));
  } catch {
    throw new Error("Create eval/clips/manifest.json (see manifest.example.json).");
  }

  const providerId = (process.env.STT_PROVIDER ?? "groq") as SttProviderId;
  if (!(providerId in STT_PROVIDERS)) {
    throw new Error(`STT_PROVIDER must be one of: ${Object.keys(STT_PROVIDERS).join(", ")}`);
  }
  const stt = process.env.STT_BASE_URL
    ? new OpenAiCompatibleStt({ apiKey, baseUrl: process.env.STT_BASE_URL, model: process.env.STT_MODEL })
    : createSttProvider(providerId, { apiKey, model: process.env.STT_MODEL });
  const llm = withCleanup
    ? new OpenAiCompatibleLlm({ apiKey: process.env.GROQ_API_KEY ?? apiKey, model: llmModel })
    : undefined;

  console.log(`STT: ${stt.id}/${stt.model}${llm ? `  cleanup: ${llm.model}` : ""}\n`);
  const rows = [];
  for (const clip of clips) {
    const audio = new Uint8Array(await readFile(join(clipsDir, clip.file)));
    const language = clip.language ?? "auto";
    try {
      const result = await runDictation({
        audio,
        mimeType: MIME[extname(clip.file).toLowerCase()] ?? "application/octet-stream",
        fileName: clip.file,
        stt,
        llm,
        settings: { language, outputScript: "as-spoken", cleanup: withCleanup, vocabulary: [] },
      });
      const wer = wordErrorRate(clip.reference, result.raw);
      rows.push({ ...clip, raw: result.raw, clean: result.clean, wer, timings: result.timings });
      console.log(`${(wer * 100).toFixed(1).padStart(5)}% WER  ${Math.round(result.timings.sttMs)}ms  ${clip.file}`);
      if (wer > 0) console.log(`         ref: ${clip.reference}\n         got: ${result.raw}`);
      if (llm) console.log(`       clean: ${result.clean}${clip.expectedClean ? `\n    expected: ${clip.expectedClean}` : ""}`);
    } catch (err) {
      console.log(`  ERROR  ${clip.file}: ${err instanceof Error ? err.message : err}`);
      rows.push({ ...clip, error: String(err) });
    }
  }

  const scored = rows.filter((r): r is typeof r & { wer: number } => "wer" in r && typeof r.wer === "number");
  const byLang = new Map<string, number[]>();
  for (const r of scored) {
    const key = r.language ?? "auto";
    byLang.set(key, [...(byLang.get(key) ?? []), r.wer]);
  }
  console.log("\nAverage WER by language:");
  for (const [lang, wers] of byLang) {
    const avg = wers.reduce((a, b) => a + b, 0) / wers.length;
    console.log(`  ${lang.padEnd(5)} ${(avg * 100).toFixed(1)}%  (${wers.length} clips)`);
  }

  await mkdir(resultsDir, { recursive: true });
  const out = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${stt.model}.json`);
  await writeFile(out, JSON.stringify({ stt: stt.model, llm: llm?.model, rows }, null, 2));
  console.log(`\nSaved ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
