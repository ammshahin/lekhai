//! Small always-on-top pill ("Listening…" / "Transcribing…") shown while dictating with the
//! hotkeys. It must never take focus, or the paste would land in the pill instead of the
//! user's app: the window is non-focusable, click-through, and shown without activation.
//! The page (`overlay.html`) follows the recording events and hides itself when done.

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "overlay";
/// Logical size; scaled per monitor.
const WIDTH: f64 = 220.0;
const HEIGHT: f64 = 48.0;
/// Gap above the bottom of the work area (i.e. above the taskbar).
const MARGIN: f64 = 28.0;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("voice-app indicator")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()?;
    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

pub fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    place(app, &window);

    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        // SAFETY: hwnd belongs to our own live window.
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        return;
    }
    let _ = window.show();
}

pub fn hide(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };

    // `show` bypasses Tauri, so Tauri still thinks the window is hidden and its `hide()` is a
    // no-op. Hide it the same way it was shown.
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        // SAFETY: hwnd belongs to our own live window.
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        return;
    }
    let _ = window.hide();
}

/// Called by the overlay page when the dictation is done.
#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    hide(&app);
}

/// Bottom-center of the monitor the mouse is on, above the taskbar.
fn place(app: &AppHandle, window: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let (w, h) = ((WIDTH * scale) as i32, (HEIGHT * scale) as i32);
    let x = area.position.x + (area.size.width as i32 - w) / 2;
    let y = area.position.y + area.size.height as i32 - h - (MARGIN * scale) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
}
