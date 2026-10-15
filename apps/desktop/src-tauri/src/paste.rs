//! Pastes text into whichever app has focus: save clipboard → set text → Ctrl/Cmd+V → restore.

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread::sleep;
use std::time::Duration;

pub fn paste_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    let mut clipboard = Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?;
    let previous = clipboard.get_text().ok();

    clipboard
        .set_text(text.to_owned())
        .map_err(|e| format!("Could not set clipboard: {e}"))?;
    // Give the OS a moment to publish the new clipboard contents.
    sleep(Duration::from_millis(40));

    send_paste_shortcut()?;

    // Let the target app read the clipboard before restoring the old contents. Done in the
    // background so the caller isn't held up after the text is already in place.
    if let Some(prev) = previous {
        std::thread::spawn(move || {
            sleep(Duration::from_millis(200));
            let _ = clipboard.set_text(prev);
        });
    }
    Ok(())
}

fn send_paste_shortcut() -> Result<(), String> {
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Keyboard unavailable: {e}"))?;

    // The dictation hotkey uses Shift/Alt; if the user is still holding one, Ctrl+V would become
    // Ctrl+Shift+V. Release them first (harmless if they're already up).
    for key in [Key::Shift, Key::Alt] {
        let _ = enigo.key(key, Direction::Release);
    }

    #[cfg(target_os = "macos")]
    let (modifier, v) = (Key::Meta, Key::Unicode('v'));
    #[cfg(target_os = "windows")]
    let (modifier, v) = (Key::Control, Key::V);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (modifier, v) = (Key::Control, Key::Unicode('v'));

    let result = enigo
        .key(modifier, Direction::Press)
        .and_then(|_| enigo.key(v, Direction::Click));
    // Always release the modifier, even if the click failed.
    let release = enigo.key(modifier, Direction::Release);
    result
        .and(release)
        .map_err(|e| format!("Could not send paste keys: {e}"))
}
