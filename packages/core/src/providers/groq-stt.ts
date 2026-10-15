import { ProviderError, type FetchLike, type SttProvider, type SttRequest, type SttResult } from "../types";

export interface OpenAiCompatibleSttConfig {
  apiKey: string;
  /** Defaults to Groq. Any OpenAI-compatible /audio/transcriptions endpoint works. */
  baseUrl?: string;
  model?: string;
  fetch?: FetchLike;
}

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_STT_MODEL = "whisper-large-v3-turbo";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * Speech-to-text over an OpenAI-compatible `/audio/transcriptions` endpoint.
 * Defaults to Groq `whisper-large-v3-turbo` ($0.04 per audio hour).
 */
export class OpenAiCompatibleStt implements SttProvider {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;

  constructor(config: OpenAiCompatibleSttConfig) {
    if (!config.apiKey) throw new ProviderError("Missing API key for speech-to-text", "stt");
    this.baseUrl = (config.baseUrl ?? GROQ_BASE_URL).replace(/\/+$/, "");
    this.model = config.model ?? GROQ_STT_MODEL;
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? ((input, init) => fetch(input, init));
    this.id = this.baseUrl.includes("groq.com")
      ? "groq"
      : this.baseUrl.includes("api.openai.com")
        ? "openai"
        : "openai-compatible";
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(req.audio)], { type: req.mimeType }), req.fileName);
    form.append("model", this.model);
    // OpenAI's gpt-4o-*-transcribe models only accept "json" (no detected language in the reply).
    form.append("response_format", this.model.startsWith("gpt-") ? "json" : "verbose_json");
    form.append("temperature", "0");
    if (req.language !== "auto") form.append("language", req.language);
    const prompt = buildVocabularyPrompt(req.vocabulary);
    if (prompt) form.append("prompt", prompt);

    const res = await this.fetchFn(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: req.signal,
    });

    if (!res.ok) {
      throw new ProviderError(await describeError(res), this.id, res.status);
    }

    const data = (await res.json()) as { text?: string; language?: string };
    return { text: (data.text ?? "").trim(), language: data.language };
  }
}

/** Whisper's `prompt` biases spelling. Keep it short: it's limited to ~224 tokens. */
export function buildVocabularyPrompt(vocabulary: string[] | undefined): string | undefined {
  const terms = (vocabulary ?? []).map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return undefined;
  return terms.slice(0, 50).join(", ");
}

export async function describeError(res: Response): Promise<string> {
  let detail = "";
  try {
    // OpenAI-style `{error: {message}}` or ElevenLabs-style `{detail: {message} | string}`.
    const body = (await res.json()) as {
      error?: { message?: string };
      detail?: string | { message?: string };
    };
    detail =
      body.error?.message ?? (typeof body.detail === "string" ? body.detail : body.detail?.message) ?? "";
  } catch {
    // body was not JSON
  }
  if (res.status === 401) return "Invalid API key";
  if (res.status === 429) return `Rate limited by provider${detail ? `: ${detail}` : ""}`;
  return `Request failed (${res.status})${detail ? `: ${detail}` : ""}`;
}
