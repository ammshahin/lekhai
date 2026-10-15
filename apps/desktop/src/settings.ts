import {
  GROQ_BASE_URL,
  type LanguageHint,
  type OutputScript,
  type SttProviderId,
} from "@voice-app/core";
import { load, type Store } from "@tauri-apps/plugin-store";

export interface AppSettings {
  sttProvider: SttProviderId;
  /** Empty → the provider's default model. */
  sttModel: string;
  language: LanguageHint;
  outputScript: OutputScript;
  cleanup: boolean;
  vocabulary: string[];
  llmBaseUrl: string;
  llmModel: string;
  holdHotkey: string;
  toggleHotkey: string;
  sounds: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sttProvider: "groq",
  sttModel: "",
  language: "auto",
  outputScript: "as-spoken",
  cleanup: true,
  vocabulary: [],
  llmBaseUrl: GROQ_BASE_URL,
  llmModel: "openai/gpt-oss-20b",
  holdHotkey: "CommandOrControl+Shift+Space",
  toggleHotkey: "CommandOrControl+Shift+D",
  sounds: true,
};

const KEY = "settings";
let storePromise: Promise<Store> | undefined;

function store(): Promise<Store> {
  storePromise ??= load("settings.json", { autoSave: true, defaults: {} });
  return storePromise;
}

export async function loadSettings(): Promise<AppSettings> {
  const saved = await (await store()).get<Partial<AppSettings>>(KEY);
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await (await store()).set(KEY, settings);
}

/** Keychain entries the UI can set. Provider keys are shared between STT and cleanup. */
export type SecretName = SttProviderId | "llm";

/** The Groq or OpenAI key is reused when cleanup runs on that provider; anything else uses "llm". */
export function llmKeyName(settings: AppSettings): SecretName {
  if (settings.llmBaseUrl.includes("api.groq.com")) return "groq";
  if (settings.llmBaseUrl.includes("api.openai.com")) return "openai";
  return "llm";
}
