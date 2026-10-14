//! Global hotkeys: one held for push-to-talk, one pressed to toggle hands-free recording.

use crate::recording::{self, Source};
use crate::AppState;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

pub const DEFAULT_HOLD: &str = "CommandOrControl+Shift+Space";
pub const DEFAULT_TOGGLE: &str = "CommandOrControl+Shift+D";

#[derive(Default)]
pub struct Hotkeys {
    pub hold: Option<Shortcut>,
    pub toggle: Option<Shortcut>,
}

/// Called by the global-shortcut plugin for every registered shortcut.
pub fn handle(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let (is_hold, is_toggle) = {
        let state = app.state::<AppState>();
        let Ok(keys) = state.hotkeys.lock() else {
            return;
        };
        (
            keys.hold.as_ref() == Some(shortcut),
            keys.toggle.as_ref() == Some(shortcut),
        )
    };

    match (event.state(), is_hold, is_toggle) {
        // Key repeat sends extra Pressed events; `start` ignores them while recording.
        (ShortcutState::Pressed, true, _) => recording::start(app, Source::Hotkey),
        (ShortcutState::Released, true, _) => recording::stop(app),
        (ShortcutState::Pressed, _, true) => recording::toggle(app, Source::Hotkey),
        _ => {}
    }
}

/// Replaces the registered hotkeys. Empty string disables that hotkey.
pub fn apply(app: &AppHandle, hold: &str, toggle: &str) -> Result<(), String> {
    let parse = |s: &str| -> Result<Option<Shortcut>, String> {
        let s = s.trim();
        if s.is_empty() {
            return Ok(None);
        }
        s.parse::<Shortcut>()
            .map(Some)
            .map_err(|e| format!("Invalid shortcut \"{s}\": {e}"))
    };
    let new_hold = parse(hold)?;
    let new_toggle = parse(toggle)?;
    if new_hold.is_some() && new_hold == new_toggle {
        return Err("The two hotkeys must be different".into());
    }

    let gs = app.global_shortcut();
    let state = app.state::<AppState>();
    let mut keys = state.hotkeys.lock().map_err(|_| "Hotkey state poisoned")?;

    for old in [keys.hold.take(), keys.toggle.take()].into_iter().flatten() {
        let _ = gs.unregister(old);
    }
    for new in [new_hold, new_toggle].into_iter().flatten() {
        gs.register(new).map_err(|e| {
            format!("Could not register {new}: {e}. Another app may already use it.")
        })?;
    }
    keys.hold = new_hold;
    keys.toggle = new_toggle;
    Ok(())
}
