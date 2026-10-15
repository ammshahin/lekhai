//! API keys live in the OS keychain (Windows Credential Manager / macOS Keychain),
//! never in the settings store, logs, or files.

use keyring::Entry;

const SERVICE: &str = "voice-app";
/// Only these names can be read or written from the UI.
const ALLOWED: &[&str] = &["groq", "openai", "elevenlabs", "llm"];

fn entry(name: &str) -> Result<Entry, String> {
    if !ALLOWED.contains(&name) {
        return Err(format!("Unknown secret: {name}"));
    }
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    let entry = entry(name)?;
    if value.trim().is_empty() {
        return delete(name);
    }
    entry.set_password(value.trim()).map_err(|e| e.to_string())
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
