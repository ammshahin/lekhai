// Recording indicator window (see src-tauri/src/overlay.rs). Rust shows it without taking focus;
// this page animates the recording/transcribing states and asks Rust to hide it when done.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type State = "hidden" | "listening" | "processing" | "done" | "error";

const pill = document.getElementById("pill")!;
const barsEl = document.getElementById("bars")!;
const label = document.getElementById("label")!;

/** Center bars move most, like a voice waveform. */
const PROFILE = [0.35, 0.55, 0.75, 0.92, 1, 0.92, 0.75, 0.55, 0.35];
const MIN_H = 4;
const MAX_H = 22;
const DONE_MS = 450;
const ERROR_MS = 3500;
const LEAVE_MS = 160;

const bars = PROFILE.map(() => barsEl.appendChild(document.createElement("i")));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let state: State = "hidden";
let startedAt = 0;
let target = 0; // latest mic level from Rust, 0–1
let level = 0; // smoothed
let frame = 0;
let hideTimer: number | undefined;

function setState(next: State, text = "") {
  window.clearTimeout(hideTimer);
  const entering = state === "hidden";
  state = next;
  // Keeping "in" across state changes doesn't replay the animation; dropping "out" cancels a leave.
  pill.className = `pill ${next} in`;
  if (entering) {
    pill.style.animation = "none";
    void pill.offsetWidth; // restart the enter animation
    pill.style.animation = "";
  }
  label.textContent = text;
  if (!frame) frame = requestAnimationFrame(tick);
}

function leave(after: number) {
  hideTimer = window.setTimeout(() => {
    pill.classList.add("out");
    hideTimer = window.setTimeout(() => {
      state = "hidden";
      pill.className = "pill";
      target = level = 0;
      // Via Rust: the window was shown with a raw Win32 call, so Tauri's own hide() is a no-op.
      void invoke("hide_overlay");
    }, LEAVE_MS);
  }, after);
}

function tick(now: number) {
  if (state === "hidden") {
    frame = 0;
    return;
  }
  // Fast attack, slow release, so speech looks lively but doesn't flicker.
  level += (target - level) * (target > level ? 0.5 : 0.12);

  bars.forEach((bar, i) => {
    const p = PROFILE[i]!;
    let h = MIN_H;
    if (state === "listening") {
      const wobble = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(now * 0.013 + i * 1.7);
      h = MIN_H + (MAX_H - MIN_H) * level * p * wobble;
    } else if (state === "processing" && !reducedMotion) {
      // A wave travelling left to right while we wait for the transcript.
      h = MIN_H + 7 * (0.5 + 0.5 * Math.sin(now * 0.009 - i * 0.75));
    }
    bar.style.height = `${h.toFixed(1)}px`;
  });

  if (state === "listening") {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    label.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  frame = requestAnimationFrame(tick);
}

void listen("recording-started", () => {
  startedAt = Date.now();
  target = level = 0;
  setState("listening", "0:00");
});
void listen<number>("audio-level", (e) => {
  target = e.payload;
});
void listen<{ skipped: string | null }>("recording-finished", (e) => {
  if (e.payload.skipped) {
    if (state !== "hidden") leave(0);
  } else {
    setState("processing", "Transcribing");
  }
});
void listen<{ message: string }>("recording-error", (e) => {
  setState("error", e.payload.message);
  leave(ERROR_MS);
});
// Emitted by the main window once the text is pasted (or failed).
void listen<{ error: string | null }>("dictation-done", (e) => {
  if (state === "hidden") return;
  if (e.payload.error) {
    setState("error", e.payload.error);
    leave(ERROR_MS);
  } else {
    setState("done", "✓ Done");
    leave(DONE_MS);
  }
});
