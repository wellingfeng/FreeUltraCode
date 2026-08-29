//! kimi-code live progress tracer (DSH-style).
//!
//! kimi-code CLI `-p/--prompt` headless mode only prints its final
//! `{"role":"assistant","content":...}` answer to stdout, so UGS shows
//! nothing until the run ends. But kimi-code writes every step event in
//! real time to `~/.kimi-code/sessions/<workspace-hash>/<session-uuid>/
//! wire.jsonl`. Each `ContentPart` (text/think delta), `ToolCall`,
//! `ToolResult` is one JSON line -- closer to a real token stream than
//! DSH's session log.
//!
//! This module reuses dsh_log's snapshot -> tail -> emit architecture,
//! only swapping the event parser for kimi's wire.jsonl format:
//! - each line: `{"timestamp":..., "message":{"type":..., "payload":{...}}}`
//! - `ContentPart` payload.type=="text" -> text delta
//! - `ContentPart` payload.type=="think" -> thinking delta (announce once/step)
//! - `ToolCall` -> running tool patch
//! - `ToolResult` -> done/error tool patch
//! - `TurnBegin` / `StepBegin` -> status line
//!
//! Design constraints:
//! - no new crate (std + serde_json only)
//! - read-only; does not touch the kimi subprocess contract
//! - any failure silently degrades to stdout line-by-line forwarding
//! - the final result still comes from stdout (the `assistant` line)

use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

/// A single progress item pushed during a kimi run.
#[derive(Debug)]
pub enum KimiProgressItem {
    /// Append streaming text (typing / status line).
    Text(String),
    /// Structured tool sentinel patch (`<<UGS_TOOL>>...<<UGS_TOOL_END>>`).
    Patch(serde_json::Value),
}

/// Tracer config assembled by the is_kimi branch of ai_cli.
pub struct KimiTracerConfig {
    pub app: tauri::AppHandle,
    pub run_id: String,
    /// All candidate session roots (`~/.kimi-code/sessions` + `~/.kimi/sessions`).
    pub sessions_roots: Vec<PathBuf>,
    /// Pre-spawn snapshot of existing session dirs (to find the new one).
    pub known: HashSet<PathBuf>,
    /// Spawn time (for filtering "created during this run" dirs).
    pub spawned_at: SystemTime,
    /// Idle/heartbeat watchdog shared activity timestamp.
    pub activity: Arc<Mutex<Instant>>,
    /// "Produced real content" flag (for silent-failure detection).
    pub received: Arc<AtomicBool>,
    /// "Tracer engaged" flag (stdout skips dup forwarding when true).
    pub active: Arc<AtomicBool>,
    /// Stop signal (set when the main thread joins).
    pub cancel: Arc<AtomicBool>,
}

/// kimi-code runtime config file: `$KIMI_CODE_HOME/config.toml` when set,
/// otherwise `~/.kimi-code/config.toml`.
pub fn kimi_config_path() -> Option<PathBuf> {
    if let Some(kch) = std::env::var_os("KIMI_CODE_HOME") {
        let s = kch.to_string_lossy().trim().to_string();
        if !s.is_empty() {
            return Some(PathBuf::from(s).join("config.toml"));
        }
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    home.map(|h| PathBuf::from(h).join(".kimi-code").join("config.toml"))
}

/// Whether kimi-code has a usable model already configured — i.e. it was
/// logged in via `/login` or has a hand-written `default_model` entry. Mirrors
/// the CLI's "No model configured" gate: any non-empty `default_model = "…"`
/// line in config.toml is what unblocks a run. Deliberately loose on purpose —
/// false negatives here would block a working login.
pub fn kimi_has_configured_model() -> bool {
    let Some(path) = kimi_config_path() else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return false;
    };
    text.lines().any(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            return false;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            return false;
        };
        if key.trim() != "default_model" {
            return false;
        }
        let v = value.trim().trim_matches('"').trim_matches('\'').trim();
        !v.is_empty()
    })
}

/// kimi-code candidate session root directories.
/// Prefers `$KIMI_CODE_HOME/sessions`, then `~/.kimi-code/sessions`,
/// then `~/.kimi/sessions` (legacy kimi CLI, pre-migration).
pub fn kimi_sessions_roots() -> Vec<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let global = std::env::var_os("UGS_HOME")
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|trimmed| !trimmed.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            home.as_ref()
                .map(|home| PathBuf::from(home).join(".ultragamestudio"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("ultragamestudio"));

    let mut roots = Vec::new();
    if let Some(kch) = std::env::var_os("KIMI_CODE_HOME") {
        let s = kch.to_string_lossy().trim().to_string();
        if !s.is_empty() {
            roots.push(PathBuf::from(s).join("sessions"));
        }
    }
    let user_home = home.map(|h| PathBuf::from(h));
    if let Some(uh) = &user_home {
        roots.push(uh.join(".kimi-code").join("sessions"));
        roots.push(uh.join(".kimi").join("sessions"));
    }
    if roots.is_empty() {
        roots.push(global.join("kimi-sessions"));
    }
    roots
}

/// Snapshot all session dirs across multiple roots (two levels deep).
pub fn snapshot_session_dirs(roots: &[PathBuf]) -> HashSet<PathBuf> {
    let mut set = HashSet::new();
    for root in roots {
        let Ok(projects) = std::fs::read_dir(root) else {
            continue;
        };
        for project in projects.flatten() {
            let project_path = project.path();
            if !project_path.is_dir() {
                continue;
            }
            let Ok(sessions) = std::fs::read_dir(&project_path) else {
                continue;
            };
            for session in sessions.flatten() {
                let path = session.path();
                if path.is_dir() {
                    set.insert(path);
                }
            }
        }
    }
    set
}

/// Progress batcher (mirrors AiCliProgressBatcher in lib.rs).
struct ProgressBatcher {
    app: tauri::AppHandle,
    run_id: String,
    pending: String,
    last_flush: Instant,
}

impl ProgressBatcher {
    fn new(app: tauri::AppHandle, run_id: String) -> Self {
        Self {
            app,
            run_id,
            pending: String::new(),
            last_flush: Instant::now(),
        }
    }

    fn push(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.pending.push_str(text);
        if self.pending.len() >= crate::AI_CLI_PROGRESS_BATCH_MAX_BYTES
            || self.last_flush.elapsed()
                >= Duration::from_millis(crate::AI_CLI_PROGRESS_BATCH_INTERVAL_MS)
        {
            self.flush();
        }
    }

    fn emit_now(&mut self, text: &str) {
        self.flush();
        crate::emit_progress(&self.app, &self.run_id, text);
        self.last_flush = Instant::now();
    }

    fn flush(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        crate::emit_progress(&self.app, &self.run_id, &self.pending);
        self.pending.clear();
        self.last_flush = Instant::now();
    }
}

/// Polling tail tracer.
struct KimiLogTracer {
    sessions_roots: Vec<PathBuf>,
    known: HashSet<PathBuf>,
    spawned_at: SystemTime,
    activity: Arc<Mutex<Instant>>,
    received: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    target: Option<PathBuf>,
    committed: u64,
    line_buf: String,
    thinking_announced: HashSet<i64>,
    progress: ProgressBatcher,
    current_step: i64,
}

impl KimiLogTracer {
    fn new(cfg: KimiTracerConfig) -> Self {
        let progress = ProgressBatcher::new(cfg.app, cfg.run_id);
        Self {
            sessions_roots: cfg.sessions_roots,
            known: cfg.known,
            spawned_at: cfg.spawned_at,
            activity: cfg.activity,
            received: cfg.received,
            active: cfg.active,
            cancel: cfg.cancel,
            target: None,
            committed: 0,
            line_buf: String::new(),
            thinking_announced: HashSet::new(),
            progress,
            current_step: 0,
        }
    }

    fn poll_once(&mut self) {
        if self.target.is_none() {
            self.discover();
        }
        if let Some(dir) = self.target.clone() {
            self.poll_log(&dir);
        }
    }

    /// Find the newest session dir created after spawn (2s tolerance).
    fn discover(&mut self) {
        let cutoff = self
            .spawned_at
            .checked_sub(Duration::from_secs(2))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let mut candidates: Vec<(SystemTime, PathBuf)> = Vec::new();
        for root in &self.sessions_roots {
            let Ok(projects) = std::fs::read_dir(root) else {
                continue;
            };
            for project in projects.flatten() {
                let project_path = project.path();
                if !project_path.is_dir() {
                    continue;
                }
                if let Ok(sessions) = std::fs::read_dir(&project_path) {
                    for session in sessions.flatten() {
                        let path = session.path();
                        if !path.is_dir() || self.known.contains(&path) {
                            continue;
                        }
                        let created = session
                            .metadata()
                            .ok()
                            .and_then(|meta| meta.created().ok())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        if created >= cutoff {
                            candidates.push((created, path));
                        }
                    }
                }
            }
        }
        if candidates.is_empty() {
            return;
        }
        candidates.sort_by(|a, b| b.0.cmp(&a.0));
        if let Some((_, dir)) = candidates.into_iter().next() {
            self.target = Some(dir);
        }
    }

    /// Incrementally read `wire.jsonl`, processing only new complete lines.
    fn poll_log(&mut self, dir: &Path) {
        let path = dir.join("wire.jsonl");
        let Ok(meta) = std::fs::metadata(&path) else {
            return;
        };
        let len = meta.len();
        if len < self.committed {
            self.committed = 0;
            self.line_buf.clear();
        }
        let mut file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(_) => return,
        };
        if file.seek(SeekFrom::Start(self.committed)).is_err() {
            return;
        }
        let mut new_bytes = Vec::new();
        if file.read_to_end(&mut new_bytes).is_err() || new_bytes.is_empty() {
            return;
        }
        self.line_buf.push_str(&String::from_utf8_lossy(&new_bytes));
        let Some(nl) = self.line_buf.rfind('\n') else {
            return;
        };
        let complete = self.line_buf[..nl].to_string();
        let tail = self.line_buf[nl + 1..].to_string();
        let consumed = new_bytes.len() - tail.len();
        self.line_buf = tail;
        self.committed += consumed as u64;
        for line in complete.split('\n') {
            self.handle_line(line);
        }
    }

    fn handle_line(&mut self, line: &str) {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            return;
        }
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };
        // wire.jsonl events: {"timestamp":..., "message":{"type":..., "payload":{...}}}
        // First line is {"type":"metadata","protocol_version":"1.1"} -- skip.
        let message = match event.get("message") {
            Some(msg) => msg,
            None => return,
        };
        if event_sets_received(message) {
            self.received.store(true, Ordering::Relaxed);
            crate::touch_activity(&self.activity);
        }
        if let Some(item) = event_to_progress(
            message,
            &mut self.thinking_announced,
            &mut self.current_step,
        ) {
            match item {
                KimiProgressItem::Text(text) => self.progress.push(&text),
                KimiProgressItem::Patch(patch) => {
                    self.progress.emit_now(&crate::encode_tool_patch(&patch));
                }
            }
            self.active.store(true, Ordering::Relaxed);
            crate::touch_activity(&self.activity);
        }
    }
}

/// Main loop: poll every 500ms until cancelled.
pub fn run_tracer(cfg: KimiTracerConfig) {
    let mut tracer = KimiLogTracer::new(cfg);
    while !tracer.cancel.load(Ordering::Relaxed) {
        tracer.poll_once();
        std::thread::sleep(Duration::from_millis(500));
    }
    // Drain one last batch before exit.
    tracer.poll_once();
    tracer.progress.flush();
}

/// Whether this event counts as "real content" (for silent-failure detection).
fn event_sets_received(message: &serde_json::Value) -> bool {
    match message.get("type").and_then(|value| value.as_str()) {
        Some("ContentPart") => {
            matches!(
                message.pointer("/payload/type").and_then(|v| v.as_str()),
                Some("text") | Some("think")
            )
        }
        Some("ToolCall") | Some("ToolResult") => true,
        _ => false,
    }
}

/// Map a wire.jsonl message to a progress item.
pub fn event_to_progress(
    message: &serde_json::Value,
    thinking_announced: &mut HashSet<i64>,
    current_step: &mut i64,
) -> Option<KimiProgressItem> {
    let event_type = message.get("type").and_then(|value| value.as_str())?;
    match event_type {
        "ContentPart" => {
            let part_type = message.pointer("/payload/type").and_then(|v| v.as_str())?;
            match part_type {
                "text" => {
                    let text = message
                        .pointer("/payload/text")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if text.is_empty() {
                        None
                    } else {
                        Some(KimiProgressItem::Text(text.to_string()))
                    }
                }
                "think" => {
                    // Announce thinking once per step to avoid spam.
                    if thinking_announced.insert(*current_step) {
                        Some(KimiProgressItem::Text(
                            "\n\u{1F4AD} \u{6B63}\u{5728}\u{6DF1}\u{5165}\u{601D}\u{8003}\u{2026}\n".to_string(),
                        ))
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }
        "ToolCall" => tool_call_patch(message).map(KimiProgressItem::Patch),
        "ToolResult" => tool_result_patch(message).map(KimiProgressItem::Patch),
        "TurnBegin" => Some(KimiProgressItem::Text(
            "\n\u{25B6} \u{65B0}\u{56DE}\u{5408}\u{5F00}\u{59CB}\n".to_string(),
        )),
        "StepBegin" => {
            let n = message
                .pointer("/payload/n")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            *current_step = n;
            Some(KimiProgressItem::Text(format!(
                "\n\u{1F4CB} \u{8FDB}\u{5165}\u{6B65}\u{9AA4} {n}\n"
            )))
        }
        _ => None,
    }
}

/// Pick a short summary from tool args (single line, <=200 chars).
fn tool_subject_from_args(args: Option<&serde_json::Value>) -> String {
    const PREFERRED: &[&str] = &[
        "file_path",
        "path",
        "command",
        "query",
        "pattern",
        "url",
        "folder",
        "directory",
        "name",
        "message",
        "text",
        "title",
    ];
    let Some(args) = args else {
        return String::new();
    };
    for key in PREFERRED {
        if let Some(value) = args.get(*key).and_then(|value| value.as_str()) {
            let one_line = value.replace(['\n', '\r'], " ");
            let trimmed = one_line.trim();
            if !trimmed.is_empty() {
                return trimmed.chars().take(200).collect();
            }
        }
    }
    String::new()
}

/// Recursively clamp long string fields in JSON.
fn clamp_json_strings(value: &serde_json::Value, limit: usize) -> serde_json::Value {
    match value {
        serde_json::Value::String(text) => {
            if text.chars().count() > limit {
                let head: String = text.chars().take(limit).collect();
                serde_json::Value::String(format!(
                    "{head}\u{2026}\u{FF08}\u{5DF2}\u{622A}\u{65AD}\u{FF09}"
                ))
            } else {
                value.clone()
            }
        }
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items
                .iter()
                .map(|item| clamp_json_strings(item, limit))
                .collect(),
        ),
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), clamp_json_strings(item, limit)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// `ToolCall` event -> running tool patch.
fn tool_call_patch(message: &serde_json::Value) -> Option<serde_json::Value> {
    let name = message.pointer("/payload/function/name")?.as_str()?;
    let call_id = message.pointer("/payload/id")?.as_str()?;
    let args_raw = message
        .pointer("/payload/function/arguments")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let args = serde_json::from_str::<serde_json::Value>(args_raw).ok();
    let subject = tool_subject_from_args(args.as_ref());
    let args = args.map(|value| clamp_json_strings(&value, 600));
    Some(serde_json::json!({
        "id": call_id,
        "name": name,
        "subject": subject,
        "status": "running",
        "args": args,
    }))
}

/// `ToolResult` event -> done/error tool patch.
fn tool_result_patch(message: &serde_json::Value) -> Option<serde_json::Value> {
    let call_id = message
        .pointer("/payload/tool_call_id")
        .and_then(|value| value.as_str())?;
    let return_value = message.pointer("/payload/return_value")?;
    let is_error = return_value
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let result_raw = return_value
        .get("output")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let truncated = result_raw.chars().count() > crate::TOOL_RESULT_CLAMP;
    let result: String = result_raw.chars().take(crate::TOOL_RESULT_CLAMP).collect();
    Some(serde_json::json!({
        "id": call_id,
        "status": if is_error { "error" } else { "done" },
        "result": result,
        "truncated": truncated,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn message(line: &str) -> serde_json::Value {
        let event: serde_json::Value = serde_json::from_str(line).expect("valid event JSON");
        event.get("message").cloned().unwrap_or(event)
    }

    #[test]
    fn content_text_maps_to_streaming_text() {
        let mut announced = HashSet::new();
        let mut step = 0i64;
        let msg = message(
            r#"{"timestamp":1.0,"message":{"type":"ContentPart","payload":{"type":"text","text":"hello,"}}}"#,
        );
        let item = event_to_progress(&msg, &mut announced, &mut step);
        match item {
            Some(KimiProgressItem::Text(text)) => assert_eq!(text, "hello,"),
            other => panic!("expected Text, got {other:?}"),
        }
        assert!(event_sets_received(&msg));
    }

    #[test]
    fn content_think_announces_once_per_step() {
        let mut announced = HashSet::new();
        let mut step = 2i64;

        let think1 = message(
            r#"{"timestamp":1.0,"message":{"type":"ContentPart","payload":{"type":"think","think":"thinking...","encrypted":null}}}"#,
        );
        let first = event_to_progress(&think1, &mut announced, &mut step);
        assert!(matches!(first, Some(KimiProgressItem::Text(_))));

        let think2 = message(
            r#"{"timestamp":2.0,"message":{"type":"ContentPart","payload":{"type":"think","think":"more...","encrypted":null}}}"#,
        );
        let second = event_to_progress(&think2, &mut announced, &mut step);
        assert!(second.is_none());
    }

    #[test]
    fn tool_call_produces_running_patch() {
        let msg = message(
            r#"{"timestamp":3.0,"message":{"type":"ToolCall","payload":{"type":"function","id":"tool_abc","function":{"name":"Shell","arguments":"{\"command\": \"dir /b\"}"}}}}"#,
        );
        let mut announced = HashSet::new();
        let mut step = 0i64;
        let patch = match event_to_progress(&msg, &mut announced, &mut step) {
            Some(KimiProgressItem::Patch(p)) => p,
            other => panic!("expected Patch, got {other:?}"),
        };
        assert_eq!(patch["id"], "tool_abc");
        assert_eq!(patch["name"], "Shell");
        assert_eq!(patch["status"], "running");
        assert_eq!(patch["subject"], "dir /b");
        assert_eq!(patch["args"]["command"], "dir /b");
        assert!(event_sets_received(&msg));
    }

    #[test]
    fn tool_result_produces_done_patch() {
        let msg = message(
            r#"{"timestamp":4.0,"message":{"type":"ToolResult","payload":{"tool_call_id":"tool_abc","return_value":{"is_error":false,"output":"OK 42 lines"}}}}"#,
        );
        let mut announced = HashSet::new();
        let mut step = 0i64;
        let patch = match event_to_progress(&msg, &mut announced, &mut step) {
            Some(KimiProgressItem::Patch(p)) => p,
            other => panic!("expected Patch, got {other:?}"),
        };
        assert_eq!(patch["id"], "tool_abc");
        assert_eq!(patch["status"], "done");
        assert_eq!(patch["result"], "OK 42 lines");
        assert_eq!(patch["truncated"], false);
        assert!(event_sets_received(&msg));
    }

    #[test]
    fn tool_result_error_status() {
        let msg = message(
            r#"{"timestamp":5.0,"message":{"type":"ToolResult","payload":{"tool_call_id":"tool_def","return_value":{"is_error":true,"output":"failed"}}}}"#,
        );
        let mut announced = HashSet::new();
        let mut step = 0i64;
        let patch = match event_to_progress(&msg, &mut announced, &mut step) {
            Some(KimiProgressItem::Patch(p)) => p,
            other => panic!("expected Patch, got {other:?}"),
        };
        assert_eq!(patch["status"], "error");
    }

    #[test]
    fn step_begin_updates_step_and_produces_status() {
        let msg = message(r#"{"timestamp":6.0,"message":{"type":"StepBegin","payload":{"n":3}}}"#);
        let mut announced = HashSet::new();
        let mut step = 0i64;
        match event_to_progress(&msg, &mut announced, &mut step) {
            Some(KimiProgressItem::Text(text)) => assert!(text.contains('3')),
            other => panic!("expected Text, got {other:?}"),
        }
        assert_eq!(step, 3);
    }

    #[test]
    fn turn_begin_produces_status_line() {
        let msg = message(
            r#"{"timestamp":7.0,"message":{"type":"TurnBegin","payload":{"user_input":"hello"}}}"#,
        );
        let mut announced = HashSet::new();
        let mut step = 0i64;
        assert!(event_to_progress(&msg, &mut announced, &mut step).is_some());
    }

    #[test]
    fn metadata_line_is_ignored() {
        let line = r#"{"type":"metadata","protocol_version":"1.1"}"#;
        let event: serde_json::Value = serde_json::from_str(line).expect("valid");
        assert!(event.get("message").is_none());
    }

    #[test]
    fn status_update_is_ignored() {
        let msg = message(
            r#"{"timestamp":8.0,"message":{"type":"StatusUpdate","payload":{"context_usage":0.5,"token_usage":{"input_other":100,"output":50}}}}"#,
        );
        let mut announced = HashSet::new();
        let mut step = 0i64;
        assert!(event_to_progress(&msg, &mut announced, &mut step).is_none());
        assert!(!event_sets_received(&msg));
    }

    #[test]
    fn approval_events_are_ignored() {
        let msg = message(
            r#"{"timestamp":9.0,"message":{"type":"ApprovalRequest","payload":{"id":"req1","tool_call_id":"tool_x","sender":"Shell"}}}"#,
        );
        let mut announced = HashSet::new();
        let mut step = 0i64;
        assert!(event_to_progress(&msg, &mut announced, &mut step).is_none());
        assert!(!event_sets_received(&msg));
    }

    #[test]
    fn snapshot_finds_session_dirs_across_roots() {
        let tmp1 = std::env::temp_dir().join(format!("ugs-kimi-test1-{}", std::process::id()));
        let tmp2 = std::env::temp_dir().join(format!("ugs-kimi-test2-{}", std::process::id()));
        let s1 = tmp1.join("hashA").join("session-1");
        let s2 = tmp2.join("hashB").join("session-2");
        std::fs::create_dir_all(&s1).expect("create tree 1");
        std::fs::create_dir_all(&s2).expect("create tree 2");
        let set = snapshot_session_dirs(&[tmp1.clone(), tmp2.clone()]);
        assert_eq!(set.len(), 2);
        assert!(set.contains(&s1));
        assert!(set.contains(&s2));
        let _ = std::fs::remove_dir_all(&tmp1);
        let _ = std::fs::remove_dir_all(&tmp2);
    }

    #[test]
    fn clamp_truncates_long_strings() {
        let long = "x".repeat(2000);
        let value = serde_json::json!({ "content": long, "small": "ok" });
        let clamped = clamp_json_strings(&value, 600);
        assert_eq!(clamped["small"], "ok");
        let text = clamped["content"].as_str().expect("string");
        assert!(text.contains("\u{5DF2}\u{622A}\u{65AD}"));
        assert!(text.chars().count() < 700);
    }

    #[test]
    fn subject_picks_file_path_over_command() {
        let args = serde_json::json!({ "command": "ls", "file_path": "src/main.rs" });
        assert_eq!(tool_subject_from_args(Some(&args)), "src/main.rs");
        let args = serde_json::json!({ "command": "npm test" });
        assert_eq!(tool_subject_from_args(Some(&args)), "npm test");
    }

    #[test]
    fn progress_items_cover_tool_and_text() {
        let _text = KimiProgressItem::Text("hi".to_string());
        let _patch = KimiProgressItem::Patch(serde_json::json!({"id": "x"}));
        let _ = std::mem::discriminant(&_text);
        let _ = std::mem::discriminant(&_patch);
        assert_eq!(HashMap::<String, String>::new().len(), 0);
    }
}
