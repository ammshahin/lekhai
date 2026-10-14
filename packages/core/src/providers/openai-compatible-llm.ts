import { ProviderError, type FetchLike, type LlmMessage, type LlmOptions, type LlmProvider } from "../types";
import { GROQ_BASE_URL, describeError } from "./groq-stt";

export interface OpenAiCompatibleLlmConfig {
  apiKey: string;
  /** Groq by default; OpenRouter is "https://openrouter.ai/api/v1". */
  baseUrl?: string;
  /** A small, fast model for cleanup (the app defaults to Groq `openai/gpt-oss-20b`). */
  model: string;
  /** Extra request fields, e.g. `{ reasoning_effort: "low" }` for reasoning models on Groq. */
  extraBody?: Record<string, unknown>;
  fetch?: FetchLike;
}

/** Chat completions over any OpenAI-compatible endpoint (Groq, OpenRouter, Together, local servers). */
export class OpenAiCompatibleLlm implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;
  private readonly extraBody: Record<string, unknown>;

  constructor(config: OpenAiCompatibleLlmConfig) {
    if (!config.apiKey) throw new ProviderError("Missing API key for the cleanup model", "llm");
    if (!config.model) throw new ProviderError("No cleanup model selected", "llm");
    this.baseUrl = (config.baseUrl ?? GROQ_BASE_URL).replace(/\/+$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? ((input, init) => fetch(input, init));
    this.extraBody = config.extraBody ?? defaultExtraBody(this.model);
    this.id = this.baseUrl.includes("groq.com")
      ? "groq"
      : this.baseUrl.includes("openrouter.ai")
        ? "openrouter"
        : "openai-compatible";
  }

  async complete(messages: LlmMessage[], options: LlmOptions = {}): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 2048,
        stream: false,
        ...this.extraBody,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      throw new ProviderError(await describeError(res), this.id, res.status);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    return (data.choices?.[0]?.message?.content ?? "").trim();
  }
}

/** gpt-oss models reason before answering; keep that minimal for low-latency cleanup. */
export function defaultExtraBody(model: string): Record<string, unknown> {
  return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {};
}
