import { ProviderError, type FetchLike, type SttProvider, type SttRequest, type SttResult } from "../types";
import { describeError } from "./groq-stt";

export interface ElevenLabsSttConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: FetchLike;
}

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
export const ELEVENLABS_STT_MODEL = "scribe_v2";

/** ElevenLabs Scribe speech-to-text (`POST /v1/speech-to-text`). Strong on Bangla. */
export class ElevenLabsStt implements SttProvider {
  readonly id = "elevenlabs";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;

  constructor(config: ElevenLabsSttConfig) {
    if (!config.apiKey) throw new ProviderError("Missing ElevenLabs API key", "elevenlabs");
    this.baseUrl = (config.baseUrl ?? ELEVENLABS_BASE_URL).replace(/\/+$/, "");
    this.model = config.model ?? ELEVENLABS_STT_MODEL;
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(req.audio)], { type: req.mimeType }), req.fileName);
    form.append("model_id", this.model);
    // Otherwise Scribe inserts tags like "(laughter)" into the text.
    form.append("tag_audio_events", "false");
    if (req.language !== "auto") form.append("language_code", req.language);
    for (const term of (req.vocabulary ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 50)) {
      form.append("keyterms", term);
    }

    const res = await this.fetchFn(`${this.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
      signal: req.signal,
    });

    if (!res.ok) {
      throw new ProviderError(await describeError(res), this.id, res.status);
    }

    const data = (await res.json()) as { text?: string; language_code?: string };
    return { text: (data.text ?? "").trim(), language: data.language_code };
  }
}
