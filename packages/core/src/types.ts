/** A `fetch`-compatible function. The desktop app passes Tauri's plugin-http fetch (no CORS). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Language hint sent to speech-to-text. `auto` lets the model detect it. */
export type LanguageHint = "auto" | "bn" | "en";

/**
 * How the cleaned text should be written.
 * - `as-spoken`: keep whatever script/language mix the speaker used
 * - `bengali`: Bangla words in Bengali script (English technical terms may stay in Latin)
 * - `banglish`: everything in Latin script (romanized Bangla)
 * - `english`: translate everything to English
 */
export type OutputScript = "as-spoken" | "bengali" | "banglish" | "english";

export interface SttRequest {
  audio: Uint8Array;
  /** e.g. "audio/wav" */
  mimeType: string;
  /** e.g. "clip.wav" — some APIs use the extension to detect format */
  fileName: string;
  language: LanguageHint;
  /** Names and terms the model should spell correctly. */
  vocabulary?: string[];
  signal?: AbortSignal;
}

export interface SttResult {
  text: string;
  /** Language the provider detected, if it reports one. */
  language?: string;
}

export interface SttProvider {
  readonly id: string;
  readonly model: string;
  transcribe(req: SttRequest): Promise<SttResult>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  complete(messages: LlmMessage[], options?: LlmOptions): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
