//! HTTP for provider calls. One shared client keeps connections to the STT/LLM hosts open between
//! dictations, and `http_warm` opens them while the user is still speaking, so the requests after
//! the hotkey release skip DNS + TCP + TLS setup (several hundred ms per host from Bangladesh).
//! `tauri-plugin-http` builds a new client per request, which is why we don't use it.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;
use tauri::ipc::{InvokeBody, Request};

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .pool_idle_timeout(Duration::from_secs(300))
        .tcp_keepalive(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .expect("HTTP client")
});

/// Provider hosts the app may call. Remote hosts must use HTTPS.
const ALLOWED_HOSTS: &[&str] = &[
    "api.groq.com",
    "openrouter.ai",
    "api.openai.com",
    "api.together.xyz",
    "api.elevenlabs.io",
    "localhost",
    "127.0.0.1",
];

pub fn check_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("Bad URL: {e}"))?;
    let host = url.host_str().unwrap_or_default();
    let local = host == "localhost" || host == "127.0.0.1";
    let scheme_ok = url.scheme() == "https" || (local && url.scheme() == "http");
    if ALLOWED_HOSTS.contains(&host) && scheme_ok {
        Ok(url)
    } else {
        Err(format!("Host not allowed: {}://{host}", url.scheme()))
    }
}

#[derive(Deserialize)]
struct Meta {
    url: String,
    method: String,
    headers: HashMap<String, String>,
}

#[derive(Serialize)]
pub struct FetchResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// Splits the frame sent by `src/http.ts`: u32 LE meta length, JSON meta, request body.
fn parse_frame(frame: &[u8]) -> Result<(Meta, &[u8]), String> {
    let len_bytes: [u8; 4] = frame
        .get(..4)
        .and_then(|b| b.try_into().ok())
        .ok_or("Bad request frame")?;
    let meta_end = 4 + u32::from_le_bytes(len_bytes) as usize;
    let meta = frame.get(4..meta_end).ok_or("Bad request frame")?;
    let meta: Meta = serde_json::from_slice(meta).map_err(|e| format!("Bad request meta: {e}"))?;
    Ok((meta, &frame[meta_end..]))
}

#[tauri::command]
pub async fn http_fetch(request: Request<'_>) -> Result<FetchResponse, String> {
    let InvokeBody::Raw(frame) = request.body() else {
        return Err("Expected a binary request".into());
    };
    let (meta, body) = parse_frame(frame)?;
    let url = check_url(&meta.url)?;
    let method = reqwest::Method::from_bytes(meta.method.as_bytes()).map_err(|e| e.to_string())?;

    let mut req = CLIENT.request(method, url);
    for (name, value) in &meta.headers {
        req = req.header(name, value);
    }
    if !body.is_empty() {
        req = req.body(body.to_vec());
    }

    let res = req.send().await.map_err(describe)?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.to_owned())))
        .collect();
    let body = res.text().await.map_err(describe)?;
    Ok(FetchResponse {
        status,
        headers,
        body,
    })
}

/// Opens connections to the given hosts in the background. Errors are ignored.
#[tauri::command]
pub fn http_warm(urls: Vec<String>) {
    for raw in urls {
        let Ok(url) = check_url(&raw) else { continue };
        tauri::async_runtime::spawn(async move {
            let _ = CLIENT.head(url).send().await;
        });
    }
}

fn describe(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "Request timed out".into()
    } else if err.is_connect() {
        "Could not connect — check your internet connection".into()
    } else {
        format!("Network error: {err}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_provider_hosts() {
        assert!(check_url("https://api.groq.com/openai/v1/chat/completions").is_ok());
        assert!(check_url("http://localhost:11434/v1").is_ok());
        assert!(check_url("http://api.groq.com/openai/v1").is_err());
        assert!(check_url("https://evil.example.com/").is_err());
        assert!(check_url("https://api.groq.com.evil.example/").is_err());
    }

    #[test]
    fn parses_frame() {
        let meta = br#"{"url":"https://api.groq.com/x","method":"POST","headers":{"a":"b"}}"#;
        let mut frame = (meta.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(meta);
        frame.extend_from_slice(b"body");
        let (m, body) = parse_frame(&frame).unwrap();
        assert_eq!(m.method, "POST");
        assert_eq!(m.headers["a"], "b");
        assert_eq!(body, b"body");
        assert!(parse_frame(&[1, 0]).is_err());
        assert!(parse_frame(&[9, 0, 0, 0, b'{']).is_err());
    }
}
