import { GROQ_BASE_URL, type LanguageHint, type OutputScript } from "@voice-app/core";
import { load, type Store } from "@tauri-apps/plugin-store";

export interface AppSettings {
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

/** Groq's key works for both STT and cleanup when the LLM also runs on Groq. */
export function llmUsesGroqKey(settings: AppSettings): boolean {
  return settings.llmBaseUrl.includes("api.groq.com");
}
