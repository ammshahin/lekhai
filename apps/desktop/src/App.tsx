import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useDictation, type Status } from "./dictation";
import { clearHistory, listDictations, type DictationRow } from "./history";
import { DEFAULT_SETTINGS, llmUsesGroqKey, loadSettings, saveSettings, type AppSettings } from "./settings";

type Tab = "dictate" | "history" | "settings";

export function App() {
  const [tab, setTab] = useState<Tab>("dictate");
  const [settings, setSettings] = useState<AppSettings>();
  const [history, setHistory] = useState<DictationRow[]>([]);
  const [hasKey, setHasKey] = useState<boolean>();
  const [loadError, setLoadError] = useState<string>();

  const refreshHistory = useCallback(() => {
    listDictations().then(setHistory).catch(console.error);
  }, []);

  const dictation = useDictation(settings, refreshHistory);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setLoadError("This page only works inside the voice-app window. Run `pnpm dev:desktop` and use the app window, not a browser tab.");
      return;
    }
    loadSettings()
      .then(async (s) => {
        setSettings(s);
        try {
          await invoke("set_hotkeys", { hold: s.holdHotkey, toggle: s.toggleHotkey });
        } catch (e) {
          console.warn("hotkeys:", e);
        }
      })
      .catch((e) => setLoadError(`Could not load settings: ${e}`));
    invoke<boolean>("has_secret", { name: "groq" }).then(setHasKey).catch(() => setHasKey(false));
    refreshHistory();
  }, [refreshHistory]);

  if (loadError) return <div className="app loading error">{loadError}</div>;
  if (!settings) return <div className="app loading">Loading…</div>;

  return (
    <div className="app">
      <header>
        <h1>voice-app</h1>
        <nav>
          {(["dictate", "history", "settings"] as const).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      {hasKey === false && tab !== "settings" && (
        <div className="banner">
          Add your Groq API key to start. <button onClick={() => setTab("settings")}>Open Settings</button>
        </div>
      )}

      <main>
        {tab === "dictate" && <DictateView settings={settings} {...dictation} />}
        {tab === "history" && (
          <HistoryView
            rows={history}
            onClear={async () => {
              await clearHistory();
              refreshHistory();
            }}
          />
        )}
        {tab === "settings" && (
          <SettingsView
            settings={settings}
            onSaved={(s) => setSettings(s)}
            onKeyChange={() => invoke<boolean>("has_secret", { name: "groq" }).then(setHasKey)}
          />
        )}
      </main>
    </div>
  );
}

function prettyHotkey(h: string) {
  return h.replace("CommandOrControl", navigator.userAgent.includes("Mac") ? "Cmd" : "Ctrl");
}

function StatusBadge({ status }: { status: Status }) {
  const label = {
    idle: "Ready",
    listening: "Listening…",
    processing: "Transcribing…",
    error: "Error",
  }[status.kind];
  return <span className={`badge ${status.kind}`}>{label}</span>;
}

function DictateView({
  settings,
  status,
  last,
  start,
  stop,
}: { settings: AppSettings } & ReturnType<typeof useDictation>) {
  const listening = status.kind === "listening";
  return (
    <section>
      <div className="row">
        <StatusBadge status={status} />
        <button className="primary" onClick={() => (listening ? stop() : start())}>
          {listening ? "Stop" : "Test recording"}
        </button>
      </div>
      {status.kind === "error" && <p className="error">{status.message}</p>}

      <p className="hint">
        Hold <kbd>{prettyHotkey(settings.holdHotkey)}</kbd> and speak, then release — text is pasted into the
        app you're using. Press <kbd>{prettyHotkey(settings.toggleHotkey)}</kbd> to start/stop hands-free.
        Closing this window keeps the app in the tray.
      </p>

      {last && (
        <div className="card">
          <h3>Last result {last.pasted ? "(pasted)" : ""}</h3>
          <p className="clean">{last.clean || <em>Nothing heard.</em>}</p>
          {last.raw !== last.clean && (
            <details>
              <summary>Raw transcript</summary>
              <p className="raw">{last.raw}</p>
            </details>
          )}
          <p className="meta">
            Release → done {last.e2eMs} ms · STT {Math.round(last.timings.sttMs)} ms · cleanup {Math.round(last.timings.llmMs)} ms · total{" "}
            {Math.round(last.timings.totalMs)} ms{last.detectedLanguage ? ` · ${last.detectedLanguage}` : ""}
          </p>
          <button onClick={() => navigator.clipboard.writeText(last.clean)}>Copy</button>
        </div>
      )}
    </section>
  );
}

function HistoryView({ rows, onClear }: { rows: DictationRow[]; onClear: () => void }) {
  if (rows.length === 0) return <p className="hint">No dictations yet.</p>;
  return (
    <section>
      <div className="row">
        <span className="meta">{rows.length} most recent</span>
        <button onClick={onClear}>Clear history</button>
      </div>
      <ul className="history">
        {rows.map((r) => (
          <li key={r.id} className="card">
            <p className="clean">{r.clean_text}</p>
            <p className="meta">
              {new Date(r.created_at + "Z").toLocaleString()} · {(r.duration_ms / 1000).toFixed(1)} s audio ·{" "}
              {r.e2e_ms ?? r.total_ms ?? "?"} ms{r.error ? ` · cleanup error: ${r.error}` : ""}
            </p>
            <button onClick={() => navigator.clipboard.writeText(r.clean_text)}>Copy</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsView({
  settings,
  onSaved,
  onKeyChange,
}: {
  settings: AppSettings;
  onSaved: (s: AppSettings) => void;
  onKeyChange: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [vocab, setVocab] = useState(settings.vocabulary.join("\n"));
  const [groqKey, setGroqKey] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [message, setMessage] = useState<string>();
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft({ ...draft, [k]: v });

  async function save() {
    const next: AppSettings = {
      ...draft,
      vocabulary: vocab
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      await invoke("set_hotkeys", { hold: next.holdHotkey, toggle: next.toggleHotkey });
      if (groqKey) await invoke("set_secret", { name: "groq", value: groqKey });
      if (llmKey) await invoke("set_secret", { name: "llm", value: llmKey });
      await saveSettings(next);
      setGroqKey("");
      setLlmKey("");
      onSaved(next);
      onKeyChange();
      setMessage("Saved.");
    } catch (e) {
      setMessage(`Not saved: ${e}`);
    }
  }

  return (
    <section className="settings">
      <h3>API keys</h3>
      <label>
        Groq API key (speech-to-text)
        <input
          type="password"
          placeholder="gsk_… (leave empty to keep the saved key)"
          value={groqKey}
          onChange={(e) => setGroqKey(e.target.value)}
        />
      </label>
      <p className="hint">Stored in Windows Credential Manager / macOS Keychain, never in files.</p>

      <h3>Speech</h3>
      <label>
        Language
        <select value={draft.language} onChange={(e) => set("language", e.target.value as AppSettings["language"])}>
          <option value="auto">Auto-detect</option>
          <option value="bn">Bangla</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        Output
        <select
          value={draft.outputScript}
          onChange={(e) => set("outputScript", e.target.value as AppSettings["outputScript"])}
        >
          <option value="as-spoken">As spoken (keep language mix)</option>
          <option value="bengali">Bangla in Bengali script</option>
          <option value="banglish">Banglish (Latin script)</option>
          <option value="english">Translate to English</option>
        </select>
      </label>
      <label>
        Custom vocabulary (one per line: names, products, jargon)
        <textarea rows={4} value={vocab} onChange={(e) => setVocab(e.target.value)} />
      </label>

      <h3>Cleanup</h3>
      <label className="check">
        <input type="checkbox" checked={draft.cleanup} onChange={(e) => set("cleanup", e.target.checked)} />
        Clean up text with an LLM (remove fillers, fix punctuation)
      </label>
      <label>
        LLM base URL (OpenAI-compatible)
        <input value={draft.llmBaseUrl} onChange={(e) => set("llmBaseUrl", e.target.value)} />
      </label>
      <label>
        Model
        <input
          value={draft.llmModel}
          onChange={(e) => set("llmModel", e.target.value)}
          list="model-suggestions"
        />
        <datalist id="model-suggestions">
          <option value="openai/gpt-oss-20b" />
          <option value="openai/gpt-oss-120b" />
        </datalist>
      </label>
      {!llmUsesGroqKey(draft) && (
        <label>
          API key for this LLM provider
          <input
            type="password"
            placeholder="leave empty to keep the saved key"
            value={llmKey}
            onChange={(e) => setLlmKey(e.target.value)}
          />
        </label>
      )}

      <h3>Hotkeys</h3>
      <label>
        Hold to talk
        <input value={draft.holdHotkey} onChange={(e) => set("holdHotkey", e.target.value)} />
      </label>
      <label>
        Toggle hands-free
        <input value={draft.toggleHotkey} onChange={(e) => set("toggleHotkey", e.target.value)} />
      </label>
      <p className="hint">Format: CommandOrControl+Shift+Space, Alt+F9 … Leave empty to disable.</p>
      <label className="check">
        <input type="checkbox" checked={draft.sounds} onChange={(e) => set("sounds", e.target.checked)} />
        Play start/stop sounds
      </label>

      <div className="row">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button
          onClick={() => {
            setDraft(DEFAULT_SETTINGS);
            setVocab("");
          }}
        >
          Reset to defaults
        </button>
        {message && <span className="meta">{message}</span>}
      </div>
    </section>
  );
}
