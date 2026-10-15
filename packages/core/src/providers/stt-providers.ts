import type { FetchLike, SttProvider } from "../types";
import { ELEVENLABS_BASE_URL, ELEVENLABS_STT_MODEL, ElevenLabsStt } from "./elevenlabs-stt";
import { GROQ_BASE_URL, GROQ_STT_MODEL, OPENAI_BASE_URL, OpenAiCompatibleStt } from "./groq-stt";

export type SttProviderId = "groq" | "openai" | "elevenlabs";

export interface SttProviderInfo {
  id: SttProviderId;
  label: string;
  baseUrl: string;
  /** First entry is the default. */
  models: string[];
  /** Where to get an API key. */
  keyUrl: string;
}

export const STT_PROVIDERS: Record<SttProviderId, SttProviderInfo> = {
  groq: {
    id: "groq",
    label: "Groq Whisper",
    baseUrl: GROQ_BASE_URL,
    models: [GROQ_STT_MODEL, "whisper-large-v3"],
    keyUrl: "https://console.groq.com/keys",
  },
  openai: {
    id: "openai",
    label: "OpenAI GPT-4o Transcribe",
    baseUrl: OPENAI_BASE_URL,
    models: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs Scribe",
    baseUrl: ELEVENLABS_BASE_URL,
    models: [ELEVENLABS_STT_MODEL, "scribe_v1"],
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
};

export interface CreateSttConfig {
  apiKey: string;
  /** Empty or missing → the provider's default model. */
  model?: string;
  fetch?: FetchLike;
}

export function createSttProvider(id: SttProviderId, config: CreateSttConfig): SttProvider {
  const info = STT_PROVIDERS[id];
  const model = config.model || info.models[0];
  if (id === "elevenlabs") return new ElevenLabsStt({ apiKey: config.apiKey, model, fetch: config.fetch });
  return new OpenAiCompatibleStt({ apiKey: config.apiKey, baseUrl: info.baseUrl, model, fetch: config.fetch });
}
