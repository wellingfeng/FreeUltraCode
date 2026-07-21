//! Generic desktop-side HTTP proxy for the Tauri WebView.
//!
//! The WebView's native `fetch()` is subject to browser CORS: cross-origin
//! upstreams that omit `Access-Control-Allow-Origin` (many model / image
//! gateways) make the request fail with an opaque `Failed to fetch`, even
//! though the same key/endpoint works from a normal web page (same-origin) or
//! from a server. Routing the request through Rust (`ureq`) sidesteps CORS
//! entirely because it is not a browser context.
//!
//! This is a *generic* forwarder: it takes an arbitrary method/url/headers/body
//! and returns the upstream status + headers + body verbatim. It performs no
//! provider-specific translation. Binary payloads (PNG/JPEG/…) are carried as
//! Base64 in and out so bytes survive the IPC boundary intact (a UTF-8 string
//! round-trip would corrupt non-text bytes).
//!
//! Non-2xx upstream responses are returned as a normal `ProxyHttpResponse` (not
//! an `Err`), mirroring the browser `fetch()` contract where a 4xx/5xx still
//! resolves and the caller inspects `response.ok` / `response.status`.

use std::io::Read;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

/// One header as a name/value pair (preserves order + duplicates). Used for
/// both the request (deserialized) and the response (serialized).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProxyHttpHeader {
    pub name: String,
    pub value: String,
}

/// Request payload sent from the JS `tauriFetch()` wrapper.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHttpRequest {
    /// HTTP method, e.g. "GET" / "POST". Defaults to GET when empty.
    #[serde(default)]
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<ProxyHttpHeader>,
    /// Base64-encoded request body. `None`/empty means no body.
    #[serde(default)]
    pub body_base64: Option<String>,
    /// Per-call timeout in milliseconds. Falls back to a default when absent.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// Response returned to JS; rebuilt into a standard `Response` there.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<ProxyHttpHeader>,
    /// Base64-encoded response body.
    pub body_base64: String,
    /// Final URL after any redirects ureq followed (best-effort).
    pub url: String,
}

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_TIMEOUT: Duration = Duration::from_secs(1800);

fn status_text_for(code: u16) -> &'static str {
    match code {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        402 => "Payment Required",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "",
    }
}

fn collect_response(response: ureq::Response, final_url: String) -> Result<ProxyHttpResponse, String> {
    let status = response.status();
    let status_text = {
        let native = response.status_text().trim().to_string();
        if native.is_empty() {
            status_text_for(status).to_string()
        } else {
            native
        }
    };
    let mut headers = Vec::new();
    for name in response.headers_names() {
        if let Some(value) = response.header(&name) {
            headers.push(ProxyHttpHeader {
                name,
                value: value.to_string(),
            });
        }
    }

    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|err| format!("proxy_http: failed to read upstream body: {err}"))?;

    Ok(ProxyHttpResponse {
        status,
        status_text,
        headers,
        body_base64: STANDARD.encode(&bytes),
        url: final_url,
    })
}

fn proxy_http_blocking(request: ProxyHttpRequest) -> Result<ProxyHttpResponse, String> {
    let url = request.url.trim();
    if url.is_empty() {
        return Err("proxy_http: url is empty".to_string());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("proxy_http: unsupported url scheme: {url}"));
    }

    let method = {
        let m = request.method.trim();
        if m.is_empty() {
            "GET".to_string()
        } else {
            m.to_ascii_uppercase()
        }
    };

    let timeout = request
        .timeout_ms
        .map(Duration::from_millis)
        .map(|d| d.clamp(Duration::from_millis(1), MAX_TIMEOUT))
        .unwrap_or(DEFAULT_TIMEOUT);

    let agent = ureq::AgentBuilder::new()
        .timeout(timeout)
        .build();

    let mut req = agent.request(&method, url);
    for header in &request.headers {
        let name = header.name.trim();
        if name.is_empty() {
            continue;
        }
        // ureq sets these itself; forwarding a stale/duplicate value can corrupt
        // the transfer framing.
        let lname = name.to_ascii_lowercase();
        if lname == "host" || lname == "content-length" || lname == "connection" {
            continue;
        }
        req = req.set(name, &header.value);
    }

    let body_bytes = match request.body_base64.as_deref() {
        Some(b64) if !b64.is_empty() => Some(
            STANDARD
                .decode(b64)
                .map_err(|err| format!("proxy_http: invalid base64 body: {err}"))?,
        ),
        _ => None,
    };

    let final_url = url.to_string();
    let result = match body_bytes {
        Some(bytes) => req.send_bytes(&bytes),
        None => req.call(),
    };

    match result {
        Ok(response) => collect_response(response, final_url),
        // A non-2xx status is a normal HTTP response for our purposes: mirror
        // browser fetch() semantics and return it instead of erroring.
        Err(ureq::Error::Status(_, response)) => collect_response(response, final_url),
        Err(err) => Err(format!("proxy_http: request failed: {err}")),
    }
}

/// Tauri command: forward one HTTP request from the WebView through Rust to
/// bypass CORS. Runs on the blocking pool since `ureq` is synchronous.
#[tauri::command]
pub async fn proxy_http(request: ProxyHttpRequest) -> Result<ProxyHttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || proxy_http_blocking(request))
        .await
        .map_err(|err| format!("proxy_http: task join error: {err}"))?
}
