import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  OpenAiCompatibleLlm,
  OpenAiCompatibleStt,
  runDictation,
  type DictationResult,
  type FetchLike,
} from "@voice-app/core";
import { useEffect, useRef, useState } from "react";
import { addDictation } from "./history";
import { llmUsesGroqKey, type AppSettings } from "./settings";
import { playError, playStart, playStop } from "./sounds";

export type Status =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "processing" }
  | { kind: "error"; message: string };

interface FinishedEvent {
  source: "hotkey" | "ui";
  durationMs: number;
  skipped: "too-short" | "silent" | null;
}

export interface LastResult extends DictationResult {
  pasted: boolean;
}

const httpFetch: FetchLike = (input, init) => tauriFetch(input, init);

/** Wires Rust recording events to the STT → cleanup → paste pipeline. */
export function useDictation(settings: AppSettings | undefined, onSaved: () => void) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [last, setLast] = useState<LastResult>();
  // Latest settings without re-subscribing listeners on every change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // Clips are processed one at a time, in order.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const unlisteners = [
      listen("recording-started", () => {
        setStatus({ kind: "listening" });
        if (settingsRef.current?.sounds) playStart();
      }),
      listen<FinishedEvent>("recording-finished", (event) => {
        if (settingsRef.current?.sounds) playStop();
        const finished = event.payload;
        if (finished.skipped) {
          setStatus({ kind: "idle" });
          return;
        }
        queue.current = queue.current.then(() => process(finished));
      }),
      listen<{ message: string }>("recording-error", (event) => {
        fail(event.payload.message);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()));
    };
  }, []);

  function fail(message: string) {
    setStatus({ kind: "error", message });
    if (settingsRef.current?.sounds) playError();
    void invoke("set_status", { status: `Error: ${message}` });
  }

  async function process(finished: FinishedEvent) {
    const s = settingsRef.current;
    if (!s) return;
    setStatus({ kind: "processing" });
    try {
      const groqKey = await invoke<string | null>("get_secret", { name: "groq" });
      if (!groqKey) throw new Error("Add your Groq API key in Settings first.");
      const llmKey = llmUsesGroqKey(s)
        ? groqKey
        : await invoke<string | null>("get_secret", { name: "llm" });

      const stt = new OpenAiCompatibleStt({ apiKey: groqKey, fetch: httpFetch });
      const llm =
        s.cleanup && llmKey && s.llmModel
          ? new OpenAiCompatibleLlm({
              apiKey: llmKey,
              baseUrl: s.llmBaseUrl,
              model: s.llmModel,
              fetch: httpFetch,
            })
          : undefined;

      const clip = await invoke<ArrayBuffer>("take_clip");
      const result = await runDictation({
        audio: new Uint8Array(clip),
        stt,
        llm,
        settings: {
          language: s.language,
          outputScript: s.outputScript,
          cleanup: s.cleanup,
          vocabulary: s.vocabulary,
        },
      });

      const shouldPaste = finished.source === "hotkey" && result.clean.length > 0;
      if (shouldPaste) await invoke("paste_text", { text: result.clean });

      setLast({ ...result, pasted: shouldPaste });
      console.info(
        `[dictation] stt ${Math.round(result.timings.sttMs)}ms, llm ${Math.round(result.timings.llmMs)}ms, total ${Math.round(result.timings.totalMs)}ms`,
      );

      if (result.raw) {
        await addDictation({
          duration_ms: finished.durationMs,
          language: result.detectedLanguage ?? null,
          raw_text: result.raw,
          clean_text: result.clean,
          stt_provider: stt.id,
          llm_model: result.cleanupSkipped ? null : (llm?.model ?? null),
          stt_ms: Math.round(result.timings.sttMs),
          llm_ms: Math.round(result.timings.llmMs),
          total_ms: Math.round(result.timings.totalMs),
          error: result.cleanupError ?? null,
        });
        onSavedRef.current();
      }

      setStatus(
        result.cleanupError
          ? { kind: "error", message: `Cleanup failed, pasted raw text: ${result.cleanupError}` }
          : { kind: "idle" },
      );
      void invoke("set_status", { status: "Ready" });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    status,
    last,
    start: () => invoke("start_recording"),
    stop: () => invoke("stop_recording"),
  };
}
