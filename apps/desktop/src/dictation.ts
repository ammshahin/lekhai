import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  OpenAiCompatibleLlm,
  STT_PROVIDERS,
  createSttProvider,
  runDictation,
  type DictationResult,
} from "@voice-app/core";
import { useEffect, useRef, useState } from "react";
import { addDictation } from "./history";
import { httpFetch, warmUp } from "./http";
import { llmKeyName, type AppSettings } from "./settings";
import { playError, playStart, playStop } from "./sounds";

export type Status =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "processing" }
  | { kind: "error"; message: string };

interface FinishedEvent {
  source: "hotkey" | "ui";
  durationMs: number;
  /** Hotkey release, ms since epoch. */
  releasedAtMs: number;
  encodeMs: number;
  skipped: "too-short" | "silent" | null;
}

export interface LastResult extends DictationResult {
  pasted: boolean;
  /** Hotkey release → text pasted (or shown, for UI recordings). */
  e2eMs: number;
}

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
        const s = settingsRef.current;
        if (!s) return;
        if (s.sounds) playStart();
        // Connect to the providers while the user speaks, not after they stop.
        const sttUrl = STT_PROVIDERS[s.sttProvider].baseUrl;
        warmUp(s.cleanup ? [sttUrl, s.llmBaseUrl] : [sttUrl]);
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
      const [sttKey, llmKey, clip] = await Promise.all([
        invoke<string | null>("get_secret", { name: s.sttProvider }),
        s.cleanup ? invoke<string | null>("get_secret", { name: llmKeyName(s) }) : null,
        invoke<ArrayBuffer>("take_clip"),
      ]);
      if (!sttKey) throw new Error(`Add your ${STT_PROVIDERS[s.sttProvider].label} API key in Settings first.`);

      const stt = createSttProvider(s.sttProvider, { apiKey: sttKey, model: s.sttModel, fetch: httpFetch });
      const llm =
        s.cleanup && llmKey && s.llmModel
          ? new OpenAiCompatibleLlm({
              apiKey: llmKey,
              baseUrl: s.llmBaseUrl,
              model: s.llmModel,
              fetch: httpFetch,
            })
          : undefined;

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
      const pasteStart = performance.now();
      if (shouldPaste) await invoke("paste_text", { text: result.clean });
      const pasteMs = Math.round(performance.now() - pasteStart);
      const e2eMs = Date.now() - finished.releasedAtMs;

      setLast({ ...result, pasted: shouldPaste, e2eMs });
      console.info(
        `[dictation] e2e ${e2eMs}ms = encode ${finished.encodeMs}ms, stt ${Math.round(result.timings.sttMs)}ms, ` +
          `llm ${Math.round(result.timings.llmMs)}ms, paste ${pasteMs}ms (rest: IPC + keychain)`,
      );

      if (result.raw) {
        await addDictation({
          duration_ms: finished.durationMs,
          language: result.detectedLanguage ?? null,
          raw_text: result.raw,
          clean_text: result.clean,
          stt_provider: `${stt.id}/${stt.model}`,
          llm_model: result.cleanupSkipped ? null : (llm?.model ?? null),
          stt_ms: Math.round(result.timings.sttMs),
          llm_ms: Math.round(result.timings.llmMs),
          total_ms: Math.round(result.timings.totalMs),
          encode_ms: finished.encodeMs,
          paste_ms: shouldPaste ? pasteMs : null,
          e2e_ms: e2eMs,
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
