import { describe, expect, it } from "vitest";
import {
  OpenAiCompatibleLlm,
  OpenAiCompatibleStt,
  buildCleanupSystemPrompt,
  createSttProvider,
  runDictation,
  sanitizeCleanupOutput,
  shouldSkipCleanup,
  wordErrorRate,
  type DictationSettings,
  type FetchLike,
  type LlmProvider,
  type SttProvider,
} from "../src";

const settings: DictationSettings = {
  language: "auto",
  outputScript: "as-spoken",
  cleanup: true,
  vocabulary: [],
};

const fakeStt = (text: string): SttProvider => ({
  id: "fake",
  model: "fake",
  transcribe: async () => ({ text, language: "bengali" }),
});

const fakeLlm = (reply: string | Error): LlmProvider & { calls: number } => {
  const llm = {
    id: "fake",
    model: "fake",
    calls: 0,
    complete: async () => {
      llm.calls++;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return llm;
};

const clock = () => {
  let t = 0;
  return () => (t += 100);
};

describe("runDictation", () => {
  it("returns cleaned text and timings", async () => {
    const llm = fakeLlm("Let's meet at 6 pm tomorrow.");
    const result = await runDictation({
      audio: new Uint8Array([1, 2, 3]),
      stt: fakeStt("um let's meet at 5 no wait 6 pm tomorrow"),
      llm,
      settings,
      now: clock(),
    });
    expect(result.clean).toBe("Let's meet at 6 pm tomorrow.");
    expect(result.raw).toContain("um let's meet");
    expect(result.cleanupSkipped).toBe(false);
    expect(result.timings).toEqual({ sttMs: 100, llmMs: 100, totalMs: 200 });
    expect(llm.calls).toBe(1);
  });

  it("skips cleanup for very short clips", async () => {
    const llm = fakeLlm("should not be used");
    const result = await runDictation({
      audio: new Uint8Array(),
      stt: fakeStt("ok thanks"),
      llm,
      settings,
    });
    expect(result.clean).toBe("ok thanks");
    expect(result.cleanupSkipped).toBe(true);
    expect(llm.calls).toBe(0);
  });

  it("still runs the LLM for short clips when transliterating", async () => {
    const llm = fakeLlm("dhonnobad");
    const result = await runDictation({
      audio: new Uint8Array(),
      stt: fakeStt("ধন্যবাদ"),
      llm,
      settings: { ...settings, outputScript: "banglish" },
    });
    expect(result.clean).toBe("dhonnobad");
  });

  it("falls back to the raw transcript when cleanup fails", async () => {
    const result = await runDictation({
      audio: new Uint8Array(),
      stt: fakeStt("this is a longer sentence here"),
      llm: fakeLlm(new Error("Rate limited")),
      settings,
    });
    expect(result.clean).toBe("this is a longer sentence here");
    expect(result.cleanupError).toBe("Rate limited");
  });

  it("returns empty text for silence without calling the LLM", async () => {
    const llm = fakeLlm("x");
    const result = await runDictation({ audio: new Uint8Array(), stt: fakeStt("  "), llm, settings });
    expect(result.clean).toBe("");
    expect(llm.calls).toBe(0);
  });
});

describe("shouldSkipCleanup", () => {
  it("respects the cleanup toggle", () => {
    expect(shouldSkipCleanup("one two three four five", { ...settings, cleanup: false }, true)).toBe(true);
    expect(shouldSkipCleanup("one two three four five", settings, true)).toBe(false);
    expect(shouldSkipCleanup("one two three four five", settings, false)).toBe(true);
  });
});

describe("sanitizeCleanupOutput", () => {
  it("strips wrappers models sometimes add", () => {
    expect(sanitizeCleanupOutput('"Hello there."', "hello there")).toBe("Hello there.");
    expect(sanitizeCleanupOutput("Here is the cleaned text: Hello.", "hello")).toBe("Hello.");
    expect(sanitizeCleanupOutput("<transcript>Hi.</transcript>", "hi")).toBe("Hi.");
    expect(sanitizeCleanupOutput("   ", "raw words")).toBe("raw words");
  });
});

describe("buildCleanupSystemPrompt", () => {
  it("includes script rule, vocabulary and app context", () => {
    const prompt = buildCleanupSystemPrompt({
      outputScript: "bengali",
      appName: "Slack",
      vocabulary: ["Supabase", "bKash"],
    });
    expect(prompt).toContain("Bengali script");
    expect(prompt).toContain("Supabase, bKash");
    expect(prompt).toContain('"Slack"');
  });
});

describe("providers", () => {
  it("STT posts multipart form with model and language", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetchFn: FetchLike = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ text: " hello ", language: "english" }), { status: 200 });
    };
    const stt = new OpenAiCompatibleStt({ apiKey: "k", fetch: fetchFn });
    const result = await stt.transcribe({
      audio: new Uint8Array([0, 1]),
      mimeType: "audio/wav",
      fileName: "clip.wav",
      language: "bn",
      vocabulary: ["Dhaka"],
    });
    expect(result).toEqual({ text: "hello", language: "english" });
    expect(captured?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    const form = captured?.init?.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("bn");
    expect(form.get("prompt")).toBe("Dhaka");
    expect((captured?.init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("STT reports a readable error for a bad key", async () => {
    const fetchFn: FetchLike = async () => new Response("{}", { status: 401 });
    const stt = new OpenAiCompatibleStt({ apiKey: "bad", fetch: fetchFn });
    await expect(
      stt.transcribe({ audio: new Uint8Array(), mimeType: "audio/wav", fileName: "a.wav", language: "auto" }),
    ).rejects.toThrow("Invalid API key");
  });

  it("OpenAI gpt-4o transcribe uses json response format", async () => {
    let form: FormData | undefined;
    let url = "";
    const fetchFn: FetchLike = async (u, init) => {
      url = u;
      form = init?.body as FormData;
      return new Response(JSON.stringify({ text: "ঢাকা" }), { status: 200 });
    };
    const stt = createSttProvider("openai", { apiKey: "k", fetch: fetchFn });
    const result = await stt.transcribe({ audio: new Uint8Array(), mimeType: "audio/wav", fileName: "a.wav", language: "bn" });
    expect(result.text).toBe("ঢাকা");
    expect(stt.id).toBe("openai");
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(form?.get("model")).toBe("gpt-4o-transcribe");
    expect(form?.get("response_format")).toBe("json");
  });

  it("ElevenLabs posts model_id, language and keyterms", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetchFn: FetchLike = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ text: " আমি ", language_code: "ben" }), { status: 200 });
    };
    const stt = createSttProvider("elevenlabs", { apiKey: "xi", model: "", fetch: fetchFn });
    const result = await stt.transcribe({
      audio: new Uint8Array([0]),
      mimeType: "audio/wav",
      fileName: "a.wav",
      language: "bn",
      vocabulary: ["Dhaka", "bKash"],
    });
    expect(result).toEqual({ text: "আমি", language: "ben" });
    expect(captured?.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    const form = captured?.init?.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("language_code")).toBe("bn");
    expect(form.getAll("keyterms")).toEqual(["Dhaka", "bKash"]);
    expect((captured?.init?.headers as Record<string, string>)["xi-api-key"]).toBe("xi");
  });

  it("ElevenLabs error detail is readable", async () => {
    const fetchFn: FetchLike = async () =>
      new Response(JSON.stringify({ detail: { message: "quota exceeded" } }), { status: 402 });
    const stt = createSttProvider("elevenlabs", { apiKey: "xi", fetch: fetchFn });
    await expect(
      stt.transcribe({ audio: new Uint8Array(), mimeType: "audio/wav", fileName: "a.wav", language: "auto" }),
    ).rejects.toThrow("Request failed (402): quota exceeded");
  });

  it("LLM posts chat completion and returns content", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn: FetchLike = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: " Done. " } }] }), { status: 200 });
    };
    const llm = new OpenAiCompatibleLlm({ apiKey: "k", model: "small-model", fetch: fetchFn });
    expect(await llm.complete([{ role: "user", content: "x" }])).toBe("Done.");
    expect(body.model).toBe("small-model");
    expect(llm.id).toBe("groq");
  });
});

describe("wordErrorRate", () => {
  it("is 0 for identical text ignoring case and punctuation", () => {
    expect(wordErrorRate("Ami kal ashbo.", "ami kal ashbo")).toBe(0);
    expect(wordErrorRate("আমি কাল আসবো।", "আমি কাল আসবো")).toBe(0);
  });
  it("counts substitutions, insertions and deletions", () => {
    expect(wordErrorRate("a b c d", "a x c")).toBe(0.5);
  });
});
