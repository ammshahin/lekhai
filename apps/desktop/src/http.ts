import { invoke } from "@tauri-apps/api/core";
import type { FetchLike } from "@voice-app/core";

interface FetchResult {
  status: number;
  headers: [string, string][];
  body: string;
}

const NULL_BODY_STATUS = [101, 204, 205, 304];

/**
 * `fetch` for providers, backed by one shared Rust HTTP client that keeps connections alive
 * (see src-tauri/src/http.rs). The request is sent as one binary frame:
 * u32 LE meta length, JSON meta (url, method, headers), body bytes.
 */
export const httpFetch: FetchLike = async (input, init) => {
  const req = new Request(input, init);
  const headers: Record<string, string> = {};
  req.headers.forEach((value, name) => (headers[name] = value));
  const meta = new TextEncoder().encode(JSON.stringify({ url: req.url, method: req.method, headers }));
  const body = new Uint8Array(await req.arrayBuffer());

  const frame = new Uint8Array(4 + meta.length + body.length);
  new DataView(frame.buffer).setUint32(0, meta.length, true);
  frame.set(meta, 4);
  frame.set(body, 4 + meta.length);

  const res = await invoke<FetchResult>("http_fetch", frame);
  return new Response(NULL_BODY_STATUS.includes(res.status) ? null : res.body, {
    status: res.status,
    headers: res.headers,
  });
};

/** Opens connections to these hosts in the background so the next request starts faster. */
export function warmUp(urls: string[]): void {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin + "/");
    } catch {
      // ignore malformed URLs from settings
    }
  }
  void invoke("http_warm", { urls: [...origins] }).catch(() => {});
}
