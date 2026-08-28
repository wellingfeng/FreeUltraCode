//! dsh（`@deepseek-ai/dsh`）headless 实时进度尾随器。
//!
//! dsh headless 的 stdout 只在任务结束时打印最终答案，运行期间没有任何
//! 中间输出，导致 UGS 信息流在长任务期间只有 12 秒一次的心跳，观感像
//! “卡住不刷新”。但 dsh 会把每一步事件实时落盘到持久化会话日志——网页端
//! （`dsh web`）看到的实时刷新，正是读的这份日志。
//!
//! 本模块通过 `--patch` 让 headless 把会话日志写到 UGS 专属目录（纯 JSONL：
//! 关闭 zstd 压缩与 chunk 打包，见 [`ugs_patch_yaml`]），再由
//! [`run_tracer`] 轮询尾随该文件，把 `assistant/chunk` 文本增量、
//! `tool/call` / `tool/result` 工具卡片、`step/start` 步骤提示实时转发到
//! 前端的 `ai-cli-progress` 通道（复用 `<<UGS_TOOL>>` 哨兵协议与
//! [`crate::AiCliProgressBatcher`]，前端零改动即可显示）。
//!
//! 设计约束：
//! - 不引入新 crate（纯标准库 + serde_json）：crates.io 在本机不可达，
//!   且 zstd 解码完全没有必要——dsh 的 patch 机制能直接产出纯 JSONL。
//! - 独立会话根目录，与 web/tui profile 共享的 `$DSH_HOME/sessions`
//!   完全隔离，不会触发 dsh 的“一个根只属于一种编码”检查，也不影响网页端。
//! - stdout 的最终答案仍是权威结果；本模块只增强运行期间的可见性，
//!   且任何失败（目录找不到、JSON 解析错、解码错）都静默降级回
//!   “stdout 逐行转发”的旧行为，不会让现有功能更糟。

use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

/// 单次 dsh 调用可推送的一则进度。
#[derive(Debug)]
pub enum DshProgressItem {
    /// 追加式文本（流式打字 / 状态行）。
    Text(String),
    /// 结构化工具哨兵补丁（`<<UGS_TOOL>>…<<UGS_TOOL_END>>`）。
    Patch(serde_json::Value),
}

/// 尾随器配置：由 `ai_cli` 的 is_dsh 分支在 spawn 前后组装。
pub struct DshTracerConfig {
    pub app: tauri::AppHandle,
    pub run_id: String,
    /// UGS 专属会话根目录（与注入 dsh 的 `UGS_DSH_SESSIONS` 一致）。
    pub sessions_root: PathBuf,
    /// spawn 前快照的既有会话目录（用于发现本次运行新建的目录）。
    pub known: HashSet<PathBuf>,
    /// spawn 时刻（用于过滤“本次运行新建”的会话目录）。
    pub spawned_at: SystemTime,
    /// 空转/心跳看门狗共享的活动时间戳。
    pub activity: Arc<Mutex<Instant>>,
    /// “产生了真实内容”标志（供静默失败判定复用）。
    pub received: Arc<AtomicBool>,
    /// “日志尾随已成功工作”标志（stdout 分支据此跳过重复转发）。
    pub active: Arc<AtomicBool>,
    /// 停止信号（主线程 join 时置位）。
    pub cancel: Arc<AtomicBool>,
}

/// dsh 会话日志的 UGS 专属根目录：`<UGS 全局根>/dsh-sessions`。
/// 通过 `UGS_DSH_SESSIONS` 环境变量注入 dsh（见 [`ugs_patch_yaml`]），
/// 与 web/tui 共享的 `$DSH_HOME/sessions` 完全隔离。
pub fn ugs_dsh_sessions_root() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let global = std::env::var_os("UGS_HOME")
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|trimmed| !trimmed.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| PathBuf::from(home).join(".ultragamestudio")))
        .unwrap_or_else(|| std::env::temp_dir().join("ultragamestudio"));
    global.join("dsh-sessions")
}

/// `--patch` 覆盖：让 headless 把会话日志写到 UGS 专属根目录，
/// 以纯 JSONL（`compression: none`）且每事件一行（`packChunks: false`）
/// 落盘。整行替换 `session-persistence-jsonl` 的 config（dsh 的 patch
/// 语义是替换而非合并，故必须同时给出 root）。`!!js` 表达式在运行时求值。
///
/// 另外按 UGS 渠道注入模型与端点配置。dsh 内置**两条** DeepSeek 路径：
///
/// 1. **native**（`dsh-llm-deepseek`，路由名 `deepseek-official`）：按
///    DeepSeek 私有 wire 发请求——带 `thinking:{type}`、`reasoning_effort`，
///    历史里回传 `reasoning_content`。**官方 `api.deepseek.com` 专用**。
/// 2. **pi-ai 通用兼容**（`dsh-llm-pi-ai`，OpenAI 兼容多 provider 适配器）：
///    默认 dormant，一旦 config 给出 provider profiles 就注册路由。
///    hand-declared route + `api: openai-completions` 只发**标准 OpenAI
///    字段**，不带任何 DeepSeek 私有字段。
///
/// 判定：baseURL 为空或指向官方 `api.deepseek.com` → 走 native，保留完整
/// 思考能力；baseURL 是第三方兼容网关（OpenRouter / SiliconFlow / 自建 /
/// 中转）→ 走 pi-ai `openai-completions`。此前所有渠道一律套 native
/// `deepseek-official`，第三方网关收到私有 `thinking`/`reasoning_effort`
/// 字段直接 `HTTP 400 INVALID_REQUEST`——这正是第三方 DSH 一直不可用的根因。
///
/// pi-ai hand-declared route 必须显式列出 model catalog（否则请求前就
/// `UNKNOWN_MODEL`），故第三方分支要求同时有 model 与 baseURL；缺 model
/// 时退回 native（保持旧行为，不至于 UNKNOWN_MODEL 崩）。API key 均通过
/// `apiKeyEnv: DEEPSEEK_API_KEY` 从 credential seam / 环境变量解析，UGS
/// 已在 spawn 时注入 `DEEPSEEK_API_KEY`，不写进 config。
///
/// 两个字段都来自 `env_vars`（`UGS_DSH_MODEL` / `DEEPSEEK_BASE_URL`）。
pub fn ugs_patch_yaml(model: Option<&str>, base_url: Option<&str>) -> String {
    let mut out = String::from(
        "- id: session-persistence-jsonl\n  config:\n    root: !!js process.env.UGS_DSH_SESSIONS\n    packChunks: false\n    compression: none\n",
    );
    let model = model.map(str::trim).filter(|m| !m.is_empty());
    let base_url = base_url.map(str::trim).filter(|b| !b.is_empty());

    let third_party = base_url.is_some_and(|b| !is_official_deepseek(b));

    if third_party && model.is_some() {
        // 第三方兼容网关：走 pi-ai `openai-completions`。声明一条 UGS 专属
        // 路由 `deepseek-compat`（pi-ai 不 ship 这个 key，属 hand-declared
        // route），把 agent 默认模型指向它。不给 `compat` 段——pi-ai 对无法
        // 识别的端点默认按纯 OpenAI 处理，正好只发标准字段、不带 DeepSeek
        // 私有的 thinking/reasoning。
        let model = model.unwrap();
        let base_url = base_url.unwrap();
        out.push_str(&format!(
            "- id: agent-default-model\n  config:\n    provider: deepseek-compat\n    model: {model}\n",
            model = yaml_scalar(model)
        ));
        out.push_str(&format!(
            concat!(
                "- id: llm-pi-ai\n  config:\n    providers:\n",
                "      deepseek-compat:\n",
                "        apiKeyEnv: DEEPSEEK_API_KEY\n",
                "        api: openai-completions\n",
                "        baseURL: {base_url}\n",
                "        models:\n",
                "          - id: {model}\n",
                "            name: {model}\n",
                "            contextWindow: 131072\n",
                "            maxTokens: 8192\n",
            ),
            base_url = yaml_scalar(base_url),
            model = yaml_scalar(model),
        ));
        return out;
    }

    // 官方直连（或缺 model 无法安全声明 pi-ai 路由时的兜底）：保持 native
    // `deepseek-official`。
    if let Some(model) = model {
        // `agent-default-model` 的 plugin config 是 `{provider, model}`
        // 必填整行替换；provider 固定 `deepseek-official`（dsh-llm-deepseek
        // 注册的路由名），model 用渠道透传的 id。
        out.push_str(&format!(
            "- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: {}\n",
            yaml_scalar(model)
        ));
    }
    if let Some(base_url) = base_url {
        // `llm-deepseek` 默认条目无 config（全靠 settings.yaml 的
        // `llm-deepseek:` 段）。整行替换为 `{baseURL}`，让 headless 在
        // 不读 settings.yaml 的场景下也能命中官方端点覆盖。`apiKeyEnv`
        // 用默认值 `DEEPSEEK_API_KEY`，与 UGS 注入的环境变量对齐。
        out.push_str(&format!(
            "- id: llm-deepseek\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n    baseURL: {}\n",
            yaml_scalar(base_url)
        ));
    }
    out
}

/// baseURL 是否指向 DeepSeek 官方端点。官方（或其区域别名）才使用 native
/// 适配器的私有 wire；其余一律视为第三方兼容网关。仅比对 host，忽略协议、
/// 端口与路径（官方文档端点为 `https://api.deepseek.com`）。
fn is_official_deepseek(base_url: &str) -> bool {
    let after_scheme = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url);
    let host = after_scheme
        .split(['/', ':'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    host == "api.deepseek.com" || host.ends_with(".deepseek.com") || host == "deepseek.com"
}

/// 把任意字符串编为 YAML 双引号标量，转义反斜杠与双引号。
/// dsh 的 patch 文件按 YAML 解析，URL/model id 含 `:`、`/` 等字符时
/// 必须引用，避免被误读为 map/anchor。
fn yaml_scalar(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// 快照一个会话根目录下的全部会话目录（两层：项目目录 → 会话目录）。
pub fn snapshot_session_dirs(root: &Path) -> HashSet<PathBuf> {
    let mut set = HashSet::new();
    let Ok(projects) = std::fs::read_dir(root) else {
        return set;
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
    set
}

/// 长任务期间文本/工具补丁的批量推送器（独立于 lib.rs 的
/// `AiCliProgressBatcher`，拥有 AppHandle 避免借用问题；语义一致）。
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

/// 轮询尾随器。
struct DshLogTracer {
    sessions_root: PathBuf,
    known: HashSet<PathBuf>,
    spawned_at: SystemTime,
    activity: Arc<Mutex<Instant>>,
    received: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    /// 已锁定的本次运行会话目录。
    target: Option<PathBuf>,
    /// 已处理到的文件字节偏移（只推进到最后一个完整行的行尾）。
    committed: u64,
    /// 跨轮次残留的半行。
    line_buf: String,
    /// 已提示过“思考中”的 (turn, step)，避免思考增量刷屏。
    thinking_announced: HashSet<(i64, i64)>,
    progress: ProgressBatcher,
}

impl DshLogTracer {
    fn new(cfg: DshTracerConfig) -> Self {
        let progress = ProgressBatcher::new(cfg.app, cfg.run_id);
        Self {
            sessions_root: cfg.sessions_root,
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
        }
    }

    /// 一轮轮询：发现会话目录（若尚未锁定），然后尾随其日志。
    fn poll_once(&mut self) {
        if self.target.is_none() {
            self.discover();
        }
        if let Some(dir) = self.target.clone() {
            self.poll_log(&dir);
        }
    }

    /// 在 spawn 后新建（创建时间晚于 spawn 时刻，宽容 2 秒）的会话目录中
    /// 选择最新一个作为本次运行的日志。取到后立即锁定，不再更换。
    fn discover(&mut self) {
        let cutoff = self
            .spawned_at
            .checked_sub(Duration::from_secs(2))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let mut candidates: Vec<(SystemTime, PathBuf)> = Vec::new();
        if let Ok(projects) = std::fs::read_dir(&self.sessions_root) {
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

    /// 增量读取 `session.jsonl`，只处理新增的完整行。
    fn poll_log(&mut self, dir: &Path) {
        let path = dir.join("session.jsonl");
        let Ok(meta) = std::fs::metadata(&path) else {
            return;
        };
        let len = meta.len();
        if len < self.committed {
            // 文件被重建/截断：从头重读。
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
            return; // 尚无完整行（半帧/半行跨轮次）
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
        if event_sets_received(&event) {
            self.received.store(true, Ordering::Relaxed);
            crate::touch_activity(&self.activity);
        }
        if let Some(item) = event_to_progress(&event, &mut self.thinking_announced) {
            match item {
                DshProgressItem::Text(text) => self.progress.push(&text),
                DshProgressItem::Patch(patch) => {
                    self.progress.emit_now(&crate::encode_tool_patch(&patch));
                }
            }
            self.active.store(true, Ordering::Relaxed);
            crate::touch_activity(&self.activity);
        }
    }
}

/// 启动尾随器线程的主体循环：每 500ms 轮询一次，直到收到取消信号。
pub fn run_tracer(cfg: DshTracerConfig) {
    let mut tracer = DshLogTracer::new(cfg);
    while !tracer.cancel.load(Ordering::Relaxed) {
        tracer.poll_once();
        std::thread::sleep(Duration::from_millis(500));
    }
    // 退出前补一轮，尽量收走进程退出前最后一批事件。
    tracer.poll_once();
    tracer.progress.flush();
}

/// 该事件是否算“产生了真实内容”（用于静默失败判定）。
fn event_sets_received(event: &serde_json::Value) -> bool {
    match event.get("type").and_then(|value| value.as_str()) {
        Some("assistant/chunk") => match chunk_kind(event) {
            Some("text-delta") | Some("reasoning-delta") => true,
            _ => false,
        },
        Some("tool/call") | Some("tool/result") => true,
        _ => false,
    }
}

/// 取出 `data.chunk.type`（仅 assistant/chunk 有效）。
fn chunk_kind(event: &serde_json::Value) -> Option<&str> {
    event
        .pointer("/data/chunk/type")
        .and_then(|value| value.as_str())
}

/// 把一个会话事件映射为一则进度（文本或工具补丁）。`thinking_announced`
/// 用于抑制同一 (turn, step) 内重复的“思考中”提示。
pub fn event_to_progress(
    event: &serde_json::Value,
    thinking_announced: &mut HashSet<(i64, i64)>,
) -> Option<DshProgressItem> {
    let event_type = event.get("type").and_then(|value| value.as_str())?;
    match event_type {
        "assistant/chunk" => match chunk_kind(event) {
            Some("text-delta") => {
                let text = event
                    .pointer("/data/chunk/text")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if text.is_empty() {
                    None
                } else {
                    Some(DshProgressItem::Text(text.to_string()))
                }
            }
            Some("reasoning-delta") => {
                let turn = event.pointer("/data/turn").and_then(|v| v.as_i64()).unwrap_or(0);
                let step = event.pointer("/data/step").and_then(|v| v.as_i64()).unwrap_or(0);
                if thinking_announced.insert((turn, step)) {
                    Some(DshProgressItem::Text("\n💭 正在深入思考…\n".to_string()))
                } else {
                    None
                }
            }
            _ => None,
        },
        "tool/call" => tool_call_patch(event).map(DshProgressItem::Patch),
        "tool/result" => tool_result_patch(event).map(DshProgressItem::Patch),
        "step/start" => {
            let step = event.pointer("/data/step").and_then(|v| v.as_i64()).unwrap_or(0);
            Some(DshProgressItem::Text(format!("\n📋 进入步骤 {step}\n")))
        }
        "turn/start" => {
            let turn = event.pointer("/data/turn").and_then(|v| v.as_i64()).unwrap_or(0);
            Some(DshProgressItem::Text(format!("\n▶ 第 {turn} 回合开始\n")))
        }
        _ => None,
    }
}

/// 从工具参数里挑一个适合做卡片标题的短摘要（单行、≤200 字符）。
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

/// 递归把 JSON 里的长字符串字段截短，避免超大工具参数撑爆 live 消息。
fn clamp_json_strings(value: &serde_json::Value, limit: usize) -> serde_json::Value {
    match value {
        serde_json::Value::String(text) => {
            if text.chars().count() > limit {
                let head: String = text.chars().take(limit).collect();
                serde_json::Value::String(format!("{head}…（已截断）"))
            } else {
                value.clone()
            }
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(|item| clamp_json_strings(item, limit)).collect())
        }
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), clamp_json_strings(item, limit)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// `tool/call` 事件 → running 工具补丁（与前端 `ToolEventPatch` 契约一致，
/// 按 callId 与后续 `tool/result` 补丁原地合并成一张卡片）。
fn tool_call_patch(event: &serde_json::Value) -> Option<serde_json::Value> {
    let name = event.pointer("/data/name")?.as_str()?;
    let call_id = event.pointer("/data/callId")?.as_str()?;
    let args_raw = event
        .pointer("/data/arguments")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let args = serde_json::from_str::<serde_json::Value>(args_raw).ok();
    let subject = tool_subject_from_args(args.as_ref());
    let args = args.map(|value| clamp_json_strings(&value, 600));
    // Moon Add: update_goal 是 dsh harness 内部的目标管理工具，不是面向用户
    // 的调用。标记 ephemeral 让它只在流式期间短暂可见，最终消息持久化时被
    // 前端 isPersistentToolPatch 过滤掉，不再作为「末尾莫名多出的工具卡片」出现。
    let mut patch = serde_json::json!({
        "id": call_id,
        "name": name,
        "subject": subject,
        "status": "running",
        "args": args,
    });
    if name == "update_goal" {
        patch["ephemeral"] = serde_json::Value::Bool(true);
    }
    Some(patch)
}

/// 工具结果文本：`data.message.content[].content[].text`（兼容直接 text 块）。
fn extract_tool_result_text(event: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(blocks) = event.pointer("/data/message/content").and_then(|v| v.as_array()) {
        for block in blocks {
            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                parts.push(text.to_string());
                continue;
            }
            if let Some(inner) = block.get("content").and_then(|v| v.as_array()) {
                for item in inner {
                    if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            parts.push(text.to_string());
                        }
                    }
                }
            }
        }
    }
    if parts.is_empty() {
        if let Some(text) = event.pointer("/data/content").and_then(|v| v.as_str()) {
            return text.to_string();
        }
    }
    parts.join("\n")
}

/// `tool/result` 事件 → done/error 工具补丁。
fn tool_result_patch(event: &serde_json::Value) -> Option<serde_json::Value> {
    let call_id = event
        .pointer("/data/message/source/callId")
        .and_then(|value| value.as_str())
        .or_else(|| event.pointer("/data/callId").and_then(|value| value.as_str()))?;
    let is_error = event
        .pointer("/data/message/content")
        .and_then(|value| value.as_array())
        .map(|blocks| blocks.iter().any(|block| block.get("isError").and_then(|v| v.as_bool()) == Some(true)))
        .unwrap_or(false);
    let result_raw = extract_tool_result_text(event);
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

    fn event(line: &str) -> serde_json::Value {
        serde_json::from_str(line).expect("valid event JSON")
    }

    fn text_delta(turn: i64, step: i64, text: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "assistant/chunk",
            "seq": 1, "time": 1,
            "data": { "turn": turn, "step": step, "chunk": { "type": "text-delta", "index": 0, "text": text } }
        })
    }

    #[test]
    fn text_delta_maps_to_streaming_text() {
        let mut announced = HashSet::new();
        let item = event_to_progress(&text_delta(1, 1, "你好，"), &mut announced);
        match item {
            Some(DshProgressItem::Text(text)) => assert_eq!(text, "你好，"),
            other => panic!("expected Text, got {other:?}"),
        }
        assert!(event_sets_received(&text_delta(1, 1, "x")));
    }

    #[test]
    fn reasoning_delta_announces_once_per_step() {
        let mut announced = HashSet::new();
        let first = event_to_progress(
            &serde_json::json!({
                "type": "assistant/chunk", "seq": 1, "time": 1,
                "data": { "turn": 1, "step": 2, "chunk": { "type": "reasoning-delta", "index": 0, "text": "思考中……" } }
            }),
            &mut announced,
        );
        assert!(matches!(first, Some(DshProgressItem::Text(_))));
        let second = event_to_progress(
            &serde_json::json!({
                "type": "assistant/chunk", "seq": 2, "time": 2,
                "data": { "turn": 1, "step": 2, "chunk": { "type": "reasoning-delta", "index": 0, "text": "继续……" } }
            }),
            &mut announced,
        );
        assert!(second.is_none());
    }

    #[test]
    fn tool_call_produces_running_patch() {
        let ev = event(r#"{"type":"tool/call","seq":10,"time":3,"data":{"turn":1,"step":1,"callId":"call_1","name":"read","arguments":"{\"file_path\": \"E:\\\\src\\\\a.rs\", \"limit\": 80}"}}"#);
        let patch = tool_call_patch(&ev).expect("patch");
        assert_eq!(patch["id"], "call_1");
        assert_eq!(patch["name"], "read");
        assert_eq!(patch["status"], "running");
        assert_eq!(patch["subject"], r"E:\src\a.rs");
        assert_eq!(patch["args"]["file_path"], r"E:\src\a.rs");
        assert!(event_sets_received(&ev));
    }

    #[test]
    fn tool_result_produces_done_patch() {
        let ev = event(r#"{"type":"tool/result","seq":11,"time":4,"data":{"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"call_1"},"content":[{"type":"tool-result","toolCallId":"call_1","content":[{"type":"text","text":"OK 42 lines"}],"isError":false}],"role":"user"}}}"#);
        let patch = tool_result_patch(&ev).expect("patch");
        assert_eq!(patch["id"], "call_1");
        assert_eq!(patch["status"], "done");
        assert_eq!(patch["result"], "OK 42 lines");
        assert_eq!(patch["truncated"], false);
        assert!(event_sets_received(&ev));
    }

    #[test]
    fn tool_result_error_status() {
        let ev = event(r#"{"type":"tool/result","seq":12,"time":5,"data":{"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"call_2"},"content":[{"type":"tool-result","toolCallId":"call_2","content":[{"type":"text","text":"failed"}],"isError":true}],"role":"user"}}}"#);
        let patch = tool_result_patch(&ev).expect("patch");
        assert_eq!(patch["status"], "error");
    }

    #[test]
    fn step_start_produces_status_line() {
        let ev = event(r#"{"type":"step/start","seq":6,"time":6,"data":{"turn":1,"step":3}}"#);
        let mut announced = HashSet::new();
        match event_to_progress(&ev, &mut announced) {
            Some(DshProgressItem::Text(text)) => assert!(text.contains("步骤 3")),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn unrelated_events_are_ignored() {
        let mut announced = HashSet::new();
        for line in [
            r#"{"type":"session","version":0,"id":"s","createdAt":1,"delegationDepth":0}"#,
            r#"{"type":"permission/preset","seq":0,"time":1,"data":{"preset":"workspace-write"}}"#,
            r#"{"type":"user/message","seq":7,"time":1,"data":{"role":"user"}}"#,
            r#"{"type":"assistant/message","seq":8,"time":1,"data":{"role":"assistant"}}"#,
            r#"{"type":"request/header","seq":9,"time":1,"data":{}}"#,
        ] {
            assert!(
                event_to_progress(&event(line), &mut announced).is_none(),
                "should ignore: {line}"
            );
            assert!(!event_sets_received(&event(line)), "should not set received: {line}");
        }
    }

    #[test]
    fn snapshot_finds_session_dirs_two_levels_deep() {
        let tmp = std::env::temp_dir().join(format!("ugs-dsh-test-{}", std::process::id()));
        let session = tmp.join("--Proj--").join("session-abc");
        std::fs::create_dir_all(&session).expect("create tree");
        let set = snapshot_session_dirs(&tmp);
        assert_eq!(set.len(), 1);
        assert!(set.contains(&session));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn clamp_truncates_long_strings() {
        let long = "x".repeat(2000);
        let value = serde_json::json!({ "content": long, "small": "ok" });
        let clamped = clamp_json_strings(&value, 600);
        assert_eq!(clamped["small"], "ok");
        let text = clamped["content"].as_str().expect("string");
        assert!(text.contains("已截断"));
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
    fn ugs_patch_yaml_targets_persistence_row() {
        let yaml = ugs_patch_yaml(None, None);
        assert!(yaml.contains("session-persistence-jsonl"));
        assert!(yaml.contains("compression: none"));
        assert!(yaml.contains("packChunks: false"));
        assert!(yaml.contains("UGS_DSH_SESSIONS"));
        // 无 model/baseURL 时不应生成对应 patch 行，保持 dsh 默认行为。
        assert!(!yaml.contains("agent-default-model"));
        assert!(!yaml.contains("llm-deepseek"));
    }

    #[test]
    fn ugs_patch_yaml_overrides_default_model_when_channel_supplies_one() {
        let yaml = ugs_patch_yaml(Some("deepseek-v4-pro"), None);
        assert!(yaml.contains("agent-default-model"));
        assert!(yaml.contains("provider: deepseek-official"));
        assert!(yaml.contains("model: \"deepseek-v4-pro\""));
        // baseURL 缺省时不写 llm-deepseek 行。
        assert!(!yaml.contains("llm-deepseek"));
        // 无第三方 baseURL 不应触碰 pi-ai 路径。
        assert!(!yaml.contains("llm-pi-ai"));
    }

    #[test]
    fn ugs_patch_yaml_keeps_native_for_official_base_url() {
        // 官方端点即便显式给出 baseURL，也走 native deepseek-official，
        // 保留 thinking/reasoning 能力。
        let yaml = ugs_patch_yaml(Some("deepseek-v4-pro"), Some("https://api.deepseek.com"));
        assert!(yaml.contains("provider: deepseek-official"));
        assert!(yaml.contains("id: llm-deepseek"));
        assert!(yaml.contains("baseURL: \"https://api.deepseek.com\""));
        assert!(!yaml.contains("llm-pi-ai"));
        assert!(!yaml.contains("deepseek-compat"));
    }

    #[test]
    fn ugs_patch_yaml_routes_third_party_through_pi_ai() {
        // 第三方兼容网关：必须走 pi-ai openai-completions，绝不带 native
        // deepseek-official（否则私有 thinking 字段触发 HTTP 400）。
        let yaml = ugs_patch_yaml(
            Some("deepseek-v4-pro"),
            Some("https://ai-gateway.kurogames.com/v1"),
        );
        assert!(yaml.contains("id: llm-pi-ai"));
        assert!(yaml.contains("provider: deepseek-compat"));
        assert!(yaml.contains("deepseek-compat:"));
        assert!(yaml.contains("api: openai-completions"));
        assert!(yaml.contains("apiKeyEnv: DEEPSEEK_API_KEY"));
        assert!(yaml.contains("baseURL: \"https://ai-gateway.kurogames.com/v1\""));
        assert!(yaml.contains("id: \"deepseek-v4-pro\""));
        // 关键：不得回落到 native 官方路由。
        assert!(!yaml.contains("provider: deepseek-official"));
        assert!(!yaml.contains("id: llm-deepseek"));
    }

    #[test]
    fn ugs_patch_yaml_third_party_without_model_falls_back_to_native() {
        // 第三方 baseURL 但缺 model：无法安全声明 pi-ai catalog（会
        // UNKNOWN_MODEL），退回 native + baseURL 覆盖，保持旧行为不崩。
        let yaml = ugs_patch_yaml(None, Some("https://ai-gateway.kurogames.com/v1"));
        assert!(!yaml.contains("llm-pi-ai"));
        assert!(yaml.contains("id: llm-deepseek"));
        assert!(yaml.contains("baseURL: \"https://ai-gateway.kurogames.com/v1\""));
        assert!(!yaml.contains("agent-default-model"));
    }

    #[test]
    fn is_official_deepseek_matches_only_official_hosts() {
        assert!(is_official_deepseek("https://api.deepseek.com"));
        assert!(is_official_deepseek("https://api.deepseek.com/v1"));
        assert!(is_official_deepseek("http://api.deepseek.com:443/v1"));
        assert!(is_official_deepseek("https://cn.api.deepseek.com"));
        assert!(!is_official_deepseek("https://ai-gateway.kurogames.com/v1"));
        assert!(!is_official_deepseek("https://openrouter.ai/api/v1"));
        assert!(!is_official_deepseek("https://api.deepseek.com.evil.com/v1"));
    }

    #[test]
    fn progress_items_cover_tool_and_text() {
        // 确保 DshProgressItem 两种变体都可构造（编译期契约）。
        let _text = DshProgressItem::Text("hi".to_string());
        let _patch = DshProgressItem::Patch(serde_json::json!({"id": "x"}));
        // 未使用字段占位，防止编译器告警被误报。
        let _ = std::mem::discriminant(&_text);
        let _ = std::mem::discriminant(&_patch);
        assert_eq!(HashMap::<String, String>::new().len(), 0);
    }
}
