mod audio;
mod hotkey;
mod http;
mod paste;
mod recording;
mod secrets;

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Process-wide state shared by hotkeys, commands and the audio thread.
pub struct AppState {
    pub recorder: Mutex<audio::Recorder>,
    pub last_clip: Mutex<Option<Vec<u8>>>,
    pub source: Mutex<recording::Source>,
    pub hotkeys: Mutex<hotkey::Hotkeys>,
}

// ---------- commands (called from the UI with `invoke`) ----------

#[tauri::command]
fn start_recording(app: AppHandle) {
    recording::start(&app, recording::Source::Ui);
}

#[tauri::command]
fn stop_recording(app: AppHandle) {
    recording::stop(&app);
}

/// Returns the last finished clip (16 kHz mono WAV) as raw bytes, once.
#[tauri::command]
fn take_clip(state: tauri::State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    let clip = state
        .last_clip
        .lock()
        .map_err(|_| "Clip state poisoned")?
        .take()
        .ok_or("No clip available")?;
    Ok(tauri::ipc::Response::new(clip))
}

#[tauri::command]
async fn paste_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || paste::paste_text(&text))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_status(app: AppHandle, status: String) {
    recording::set_tray_tooltip(&app, &status);
}

#[tauri::command]
fn set_hotkeys(app: AppHandle, hold: String, toggle: String) -> Result<(), String> {
    hotkey::apply(&app, &hold, &toggle)
}

#[tauri::command]
fn set_secret(name: String, value: String) -> Result<(), String> {
    secrets::set(&name, &value)
}

#[tauri::command]
fn get_secret(name: String) -> Result<Option<String>, String> {
    secrets::get(&name)
}

#[tauri::command]
fn has_secret(name: String) -> Result<bool, String> {
    secrets::get(&name).map(|v| v.is_some())
}

// ---------- setup ----------

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create dictations",
            sql: "CREATE TABLE IF NOT EXISTS dictations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                duration_ms INTEGER NOT NULL,
                language TEXT,
                raw_text TEXT NOT NULL,
                clean_text TEXT NOT NULL,
                stt_provider TEXT NOT NULL,
                llm_model TEXT,
                stt_ms INTEGER,
                llm_ms INTEGER,
                total_ms INTEGER,
                error TEXT
              );
              CREATE INDEX IF NOT EXISTS idx_dictations_created ON dictations(created_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "end-to-end latency columns",
            sql: "ALTER TABLE dictations ADD COLUMN encode_ms INTEGER;
              ALTER TABLE dictations ADD COLUMN paste_ms INTEGER;
              ALTER TABLE dictations ADD COLUMN e2e_ms INTEGER;",
            kind: MigrationKind::Up,
        },
    ]
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("voice-app — Ready")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just focuses the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkey::handle)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:voice-app.db", migrations())
                .build(),
        )
        .manage(AppState {
            recorder: Mutex::new(audio::Recorder::default()),
            last_clip: Mutex::new(None),
            source: Mutex::new(recording::Source::Ui),
            hotkeys: Mutex::new(hotkey::Hotkeys::default()),
        })
        .setup(|app| {
            setup_tray(app)?;
            // Defaults; the UI re-applies the user's saved hotkeys on start.
            if let Err(e) =
                hotkey::apply(app.handle(), hotkey::DEFAULT_HOLD, hotkey::DEFAULT_TOGGLE)
            {
                log::warn!("default hotkeys not registered: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app running in the tray so hotkeys keep working.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            take_clip,
            paste_text,
            set_status,
            set_hotkeys,
            set_secret,
            get_secret,
            has_secret,
            http::http_fetch,
            http::http_warm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
