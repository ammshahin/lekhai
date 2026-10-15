import Database from "@tauri-apps/plugin-sql";

export interface DictationRow {
  id: number;
  created_at: string;
  duration_ms: number;
  language: string | null;
  raw_text: string;
  clean_text: string;
  stt_provider: string;
  llm_model: string | null;
  stt_ms: number | null;
  llm_ms: number | null;
  total_ms: number | null;
  /** Release → WAV ready (Rust). */
  encode_ms: number | null;
  paste_ms: number | null;
  /** Hotkey release → text pasted. The number to hold to the 1.5 s budget. */
  e2e_ms: number | null;
  error: string | null;
}

export type NewDictation = Omit<DictationRow, "id" | "created_at">;

let dbPromise: Promise<Database> | undefined;
const db = () => (dbPromise ??= Database.load("sqlite:voice-app.db"));

export async function addDictation(row: NewDictation): Promise<void> {
  await (await db()).execute(
    `INSERT INTO dictations
      (duration_ms, language, raw_text, clean_text, stt_provider, llm_model, stt_ms, llm_ms, total_ms,
       encode_ms, paste_ms, e2e_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      row.duration_ms,
      row.language,
      row.raw_text,
      row.clean_text,
      row.stt_provider,
      row.llm_model,
      row.stt_ms,
      row.llm_ms,
      row.total_ms,
      row.encode_ms,
      row.paste_ms,
      row.e2e_ms,
      row.error,
    ],
  );
}

export async function listDictations(limit = 100): Promise<DictationRow[]> {
  return (await db()).select<DictationRow[]>(
    "SELECT * FROM dictations ORDER BY id DESC LIMIT $1",
    [limit],
  );
}

export async function clearHistory(): Promise<void> {
  await (await db()).execute("DELETE FROM dictations");
}
