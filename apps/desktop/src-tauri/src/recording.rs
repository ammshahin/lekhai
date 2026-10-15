//! Start/stop logic shared by the hotkeys and the UI buttons. Emits events the UI listens to.

use crate::audio::{analyse, encode_wav, resample_linear, TARGET_SAMPLE_RATE};
use crate::AppState;
use serde::Serialize;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Shorter presses are treated as accidental.
const MIN_DURATION_MS: u128 = 500;

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Started from a global hotkey: the result is pasted into the focused app.
    Hotkey,
    /// Started from the app window: the result is shown, not pasted.
    Ui,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Started {
    source: Source,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub source: Source,
    pub duration_ms: u128,
    /// Wall-clock time of the hotkey release (ms since epoch), for end-to-end latency in the UI.
    pub released_at_ms: u128,
    /// Time from release until the WAV was ready.
    pub encode_ms: u128,
    /// `None` when a clip is ready to fetch with `take_clip`; otherwise why it was dropped.
    pub skipped: Option<&'static str>,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
    message: String,
}

pub fn is_recording(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let recording = state
        .recorder
        .lock()
        .map(|r| r.is_recording())
        .unwrap_or(false);
    recording
}

pub fn start(app: &AppHandle, source: Source) {
    let state = app.state::<AppState>();
    let result = {
        let Ok(mut recorder) = state.recorder.lock() else {
            return;
        };
        if recorder.is_recording() {
            return;
        }
        recorder.start()
    };
    match result {
        Ok(()) => {
            if let Ok(mut s) = state.source.lock() {
                *s = source;
            }
            set_tray_tooltip(app, "Listening…");
            let _ = app.emit("recording-started", Started { source });
        }
        Err(message) => {
            let _ = app.emit("recording-error", ErrorPayload { message });
        }
    }
}

pub fn stop(app: &AppHandle) {
    let released = Instant::now();
    let released_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let state = app.state::<AppState>();
    let captured = {
        let Ok(mut recorder) = state.recorder.lock() else {
            return;
        };
        if !recorder.is_recording() {
            return;
        }
        recorder.stop()
    };
    let source = state.source.lock().map(|s| *s).unwrap_or(Source::Ui);
    set_tray_tooltip(app, "Processing…");

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let payload = match captured {
            Err(message) => {
                let _ = app.emit("recording-error", ErrorPayload { message });
                set_tray_tooltip(&app, "Ready");
                return;
            }
            Ok(captured) => {
                let duration_ms = captured.duration.as_millis();
                let stats = analyse(&captured.samples);
                let skipped = if duration_ms < MIN_DURATION_MS {
                    Some("too-short")
                } else if stats.is_silent() {
                    Some("silent")
                } else {
                    None
                };
                if skipped.is_none() {
                    let mono16k = resample_linear(
                        &captured.samples,
                        captured.sample_rate,
                        TARGET_SAMPLE_RATE,
                    );
                    match encode_wav(&mono16k, TARGET_SAMPLE_RATE) {
                        Ok(wav) => {
                            let state = app.state::<AppState>();
                            if let Ok(mut clip) = state.last_clip.lock() {
                                *clip = Some(wav);
                            };
                        }
                        Err(message) => {
                            let _ = app.emit("recording-error", ErrorPayload { message });
                            return;
                        }
                    }
                }
                Finished {
                    source,
                    duration_ms,
                    released_at_ms,
                    encode_ms: released.elapsed().as_millis(),
                    skipped,
                }
            }
        };
        if payload.skipped.is_some() {
            set_tray_tooltip(&app, "Ready");
        }
        let _ = app.emit("recording-finished", payload);
    });
}

pub fn toggle(app: &AppHandle, source: Source) {
    if is_recording(app) {
        stop(app);
    } else {
        start(app, source);
    }
}

pub fn set_tray_tooltip(app: &AppHandle, status: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("voice-app — {status}")));
    }
}
