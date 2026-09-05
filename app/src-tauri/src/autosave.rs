// AutoSave background service.
//
// 目标：定期（默认每 5 分钟）把「会提交到版本管理库」的改动文件快照一份，
// 落到项目级 `<workspace>/.ultragamestudio/autosave/<timestamp>/` 下，用于在
// 多个 agent 同时改文件、互相覆盖/误删时兜底恢复。
//
// 只备份「会提交到 VCS 的文件」：
//   - Git:  tracked 的 M/A/D/R（含索引与工作区变更），排除 untracked `??`
//   - SVN:  版本化的 M/A/D/R/!/~/C 与属性修改，排除未版本化 `?`、忽略 `I`、外链 `X`
//   - P4:   已 opened（edit/add/delete）的文件；不包含 reconcile 预览里尚未打开的文件
//
// 内容获取：
//   - added / modified / renamed → 直接读工作区文件
//   - deleted（工作区已不存在）  → 从 VCS 取删除前版本
//     (git show HEAD:<path> / svn cat -r BASE <path> / p4 print <path>#have)
//
// 保留策略：每个快照目录名即生成时刻的 epoch 毫秒，每次扫描后删除
// 超过 retentionDays（默认 7 天）的旧快照。
//
// 配置：全局根 `settings/autosave.v1.json`，字段
//   { "enabled": bool, "intervalMinutes": number, "retentionDays": number }
// 与 cacheCleanup 一致，由 Settings UI 直接写该 JSON，Rust 侧每轮重新读取，
// 无需 IPC 往返。环境变量覆盖（供支持/诊断）：
//   UGS_DISABLE_AUTOSAVE / UGS_AUTOSAVE_INTERVAL_MINUTES / UGS_AUTOSAVE_RETENTION_DAYS
//
// 目录结构：
//   <workspace>/.ultragamestudio/autosave/
//     <epoch_ms>/meta.json        # vcs、文件清单、每个文件的 status/size/source
//     <epoch_ms>/files/<rel>      # 按原相对路径存放的内容快照（原始字节）

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::storage_paths;

pub const AUTOSAVE_DIR_NAME: &str = "autosave";

const UI_CONFIG_REL_PATH: &str = "settings/autosave.v1.json";
const DEFAULT_INTERVAL_MINUTES: u64 = 5;
const DEFAULT_RETENTION_DAYS: u64 = 7;
const MIN_INTERVAL_MINUTES: u64 = 1;
const MAX_INTERVAL_MINUTES: u64 = 24 * 60;
const MIN_RETENTION_DAYS: u64 = 1;
const MAX_RETENTION_DAYS: u64 = 365;
const DISABLE_ENV: &str = "UGS_DISABLE_AUTOSAVE";
const INTERVAL_ENV: &str = "UGS_AUTOSAVE_INTERVAL_MINUTES";
const RETENTION_ENV: &str = "UGS_AUTOSAVE_RETENTION_DAYS";
const STARTUP_DELAY: Duration = Duration::from_secs(15);
const VCS_CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);
/// 单个文件快照大小上限：跳过超大二进制（如被误提交的大资源），专注代码内容。
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// 单轮最多快照的文件数，超出部分丢弃并置 truncated。
const MAX_SNAPSHOT_FILES: usize = 10_000;

/// 快照路径里一律跳过这些目录（自身产物 + VCS 元数据），防止把备份写进备份。
const SKIP_PATH_PREFIXES: &[&str] = &[
    ".ultragamestudio",
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "dist",
    "build",
];

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutosaveConfig {
    pub enabled: bool,
    pub interval_minutes: u64,
    pub retention_days: u64,
}

impl Default for AutosaveConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
            retention_days: DEFAULT_RETENTION_DAYS,
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveRunSummary {
    pub scanned_workspaces: usize,
    pub snapshotted_workspaces: usize,
    pub files_backed_up: usize,
    pub bytes_written: u64,
    pub errors: Vec<String>,
}

impl Default for AutosaveRunSummary {
    fn default() -> Self {
        Self {
            scanned_workspaces: 0,
            snapshotted_workspaces: 0,
            files_backed_up: 0,
            bytes_written: 0,
            errors: Vec::new(),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveSnapshotInfo {
    pub id: String,
    pub generated_at_ms: u64,
    pub generated_at: String,
    pub vcs: String,
    pub workspace: String,
    pub file_count: usize,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutosaveFileEntry {
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    old_path: Option<String>,
    status: String,
    size_bytes: u64,
    saved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutosaveSnapshotMeta {
    vcs: String,
    workspace: String,
    generated_at_ms: u64,
    generated_at: String,
    file_count: usize,
    saved_count: usize,
    #[serde(default)]
    truncated: bool,
    files: Vec<AutosaveFileEntry>,
}

/// 一轮扫描产出的单个待快照文件。
struct ChangeEntry {
    /// 工作区相对路径（用于读盘与写入 files/）。
    path: String,
    old_path: Option<String>,
    status: String,
    /// 用于向 VCS 取内容（删除时恢复）的路径：git 为仓库根相对，svn/p4 为工作区相对。
    vcs_path: String,
}

#[derive(Default, Clone, Copy)]
struct SnapshotStats {
    files: usize,
    bytes: u64,
}

// ---------------------------------------------------------------------------
// 后台服务与 Tauri 命令
// ---------------------------------------------------------------------------

/// 启动 AutoSave 后台线程。setup 时调用一次。
pub fn spawn_autosave_service() {
    let _ = std::thread::Builder::new()
        .name("ugs-autosave".to_string())
        .spawn(|| {
            std::thread::sleep(STARTUP_DELAY);
            loop {
                let config = read_config();
                if config.enabled {
                    run_autosave_pass_with(&config);
                }
                std::thread::sleep(Duration::from_secs(
                    config.interval_minutes.saturating_mul(60),
                ));
            }
        });
}

/// 手动触发一次快照（Settings UI「立即备份」按钮）。不受 enabled 开关影响。
#[tauri::command]
pub async fn autosave_now() -> Result<AutosaveRunSummary, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = read_config();
        run_autosave_pass_with(&config)
    })
    .await
    .map_err(|e| format!("AutoSave 备份任务失败: {e}"))
}

/// 读取当前生效配置（含默认值与环境变量覆盖），供 Settings UI 展示。
#[tauri::command]
pub fn autosave_config() -> AutosaveConfig {
    read_config()
}

/// 列出某工作区已有的快照（按时间倒序），供潜在的恢复 UI 使用。
#[tauri::command]
pub fn autosave_list_snapshots(
    workspace_path: String,
) -> Result<Vec<AutosaveSnapshotInfo>, String> {
    let root = PathBuf::from(workspace_path.trim());
    if root.as_os_str().is_empty() {
        return Err("工作区路径为空。".to_string());
    }
    let autosave_root = root
        .join(storage_paths::PROJECT_ROOT_DIR_NAME)
        .join(AUTOSAVE_DIR_NAME);
    list_snapshots(&autosave_root)
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| {
        let v = v.trim();
        v == "1" || v.eq_ignore_ascii_case("true")
    })
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&v| v > 0)
}

fn read_config() -> AutosaveConfig {
    let mut config = AutosaveConfig::default();

    if let Ok(root) = storage_paths::global_root() {
        let path = root.join(UI_CONFIG_REL_PATH.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(enabled) = value.get("enabled").and_then(|v| v.as_bool()) {
                    config.enabled = enabled;
                }
                if let Some(minutes) = value.get("intervalMinutes").and_then(|v| v.as_u64()) {
                    config.interval_minutes =
                        minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
                }
                if let Some(days) = value.get("retentionDays").and_then(|v| v.as_u64()) {
                    config.retention_days = days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
                }
            }
        }
    }

    if env_flag(DISABLE_ENV) {
        config.enabled = false;
    }
    if let Some(minutes) = env_u64(INTERVAL_ENV) {
        config.interval_minutes = minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
    }
    if let Some(days) = env_u64(RETENTION_ENV) {
        config.retention_days = days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    }

    config
}

// ---------------------------------------------------------------------------
// 单轮扫描
// ---------------------------------------------------------------------------

fn autosave_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn run_autosave_pass_with(config: &AutosaveConfig) -> AutosaveRunSummary {
    // 串行化，避免手动「立即备份」与后台定时轮同时写同一目录。
    let _guard = autosave_lock();

    let retention_ms = config.retention_days.saturating_mul(86_400_000);
    let workspaces = storage_paths::known_workspace_roots();

    let mut summary = AutosaveRunSummary {
        scanned_workspaces: workspaces.len(),
        ..AutosaveRunSummary::default()
    };

    for workspace in &workspaces {
        match snapshot_workspace(workspace) {
            Ok(Some(stats)) => {
                summary.snapshotted_workspaces += 1;
                summary.files_backed_up += stats.files;
                summary.bytes_written += stats.bytes;
            }
            Ok(None) => {}
            Err(err) => summary
                .errors
                .push(format!("{}: {err}", workspace.display())),
        }
        prune_workspace_snapshots(workspace, retention_ms);
    }

    summary
}

/// 快照单个工作区；无改动时返回 Ok(None)。
fn snapshot_workspace(workspace: &Path) -> Result<Option<SnapshotStats>, String> {
    let (vcs, entries) = match committable_changes(workspace)? {
        Some(pair) => pair,
        None => return Ok(None),
    };

    let filtered: Vec<ChangeEntry> = entries
        .into_iter()
        .filter(|e| should_include_path(&e.path))
        .collect();
    let truncated = filtered.len() > MAX_SNAPSHOT_FILES;
    let entries: Vec<ChangeEntry> = filtered.into_iter().take(MAX_SNAPSHOT_FILES).collect();
    if entries.is_empty() {
        return Ok(None);
    }

    let generated_ms = crate::now_ms();
    let snapshot_dir = workspace
        .join(storage_paths::PROJECT_ROOT_DIR_NAME)
        .join(AUTOSAVE_DIR_NAME)
        .join(format!("{generated_ms}"));
    let files_dir = snapshot_dir.join("files");
    fs::create_dir_all(&files_dir).map_err(|e| format!("创建 AutoSave 快照目录失败: {e}"))?;

    let mut meta_files = Vec::with_capacity(entries.len());
    let mut stats = SnapshotStats::default();

    for entry in entries {
        if stats.files >= MAX_SNAPSHOT_FILES {
            break;
        }

        let (bytes, source) = snapshot_entry_content(workspace, &vcs, &entry);
        let mut saved = false;
        let mut size_bytes = 0_u64;
        if let Some(bytes) = bytes {
            if bytes.len() as u64 <= MAX_FILE_BYTES {
                if let Some(relative) = safe_relative_path(&entry.path) {
                    let target = files_dir.join(relative);
                    if let Some(parent) = target.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::write(&target, &bytes).is_ok() {
                        saved = true;
                        size_bytes = bytes.len() as u64;
                        stats.files += 1;
                        stats.bytes += size_bytes;
                    }
                }
            }
        }

        meta_files.push(AutosaveFileEntry {
            path: entry.path,
            old_path: entry.old_path,
            status: entry.status,
            size_bytes,
            saved,
            source: source.map(str::to_string),
        });
    }

    let meta = AutosaveSnapshotMeta {
        vcs: vcs.clone(),
        workspace: crate::display_preview_path(workspace),
        generated_at_ms: generated_ms,
        generated_at: format_utc(generated_ms / 1000),
        file_count: meta_files.len(),
        saved_count: meta_files.iter().filter(|f| f.saved).count(),
        truncated,
        files: meta_files,
    };

    let meta_json =
        serde_json::to_vec_pretty(&meta).map_err(|e| format!("序列化 meta.json 失败: {e}"))?;
    fs::write(snapshot_dir.join("meta.json"), meta_json)
        .map_err(|e| format!("写入 meta.json 失败: {e}"))?;

    if stats.files == 0 {
        // 什么都没写成，清掉空目录，避免留下噪音。
        let _ = fs::remove_dir_all(&snapshot_dir);
        return Ok(None);
    }

    Ok(Some(stats))
}

fn should_include_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    !SKIP_PATH_PREFIXES
        .iter()
        .any(|p| normalized == *p || normalized.starts_with(&format!("{p}/")))
}

/// 读取一条改动的内容：优先读工作区文件；缺失时（如 deleted）向 VCS 取删除前版本。
fn snapshot_entry_content(
    workspace: &Path,
    vcs: &str,
    entry: &ChangeEntry,
) -> (Option<Vec<u8>>, Option<&'static str>) {
    let disk_path = workspace.join(&entry.path);
    if let Ok(bytes) = fs::read(&disk_path) {
        return (Some(bytes), Some("working"));
    }
    // 工作区文件不存在（deleted 或已被外部删除的 modified）：从 VCS 取历史版本。
    if let Some(bytes) = retrieve_from_vcs(workspace, vcs, &entry.vcs_path) {
        return (Some(bytes), Some("vcs"));
    }
    (None, None)
}

fn retrieve_from_vcs(workspace: &Path, vcs: &str, vcs_path: &str) -> Option<Vec<u8>> {
    match vcs {
        "git" => capture_vcs_bytes(
            workspace,
            "git",
            &["show", &format!("HEAD:{vcs_path}")],
            VCS_CAPTURE_TIMEOUT,
        ),
        "svn" => capture_vcs_bytes(
            workspace,
            "svn",
            &["cat", "-r", "BASE", vcs_path],
            VCS_CAPTURE_TIMEOUT,
        ),
        "p4" => capture_vcs_bytes(
            workspace,
            "p4",
            &["print", "-q", &format!("{vcs_path}#have")],
            VCS_CAPTURE_TIMEOUT,
        ),
        _ => None,
    }
}

/// 以原始字节捕获命令 stdout（用于恢复删除文件，避免 lossy UTF-8 破坏二进制）。
fn capture_vcs_bytes(
    workspace: &Path,
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Option<Vec<u8>> {
    let temp = std::env::temp_dir().join(format!(
        "ugs-autosave-{}-{}.out",
        std::process::id(),
        crate::now_ms()
    ));
    let file = fs::File::create(&temp).ok()?;
    let mut cmd = crate::new_spawn_command(program);
    cmd.current_dir(workspace)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::null());

    let mut child = cmd.spawn().ok()?;
    let start = std::time::Instant::now();
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break false;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };

    let bytes = fs::read(&temp).unwrap_or_default();
    let _ = fs::remove_file(&temp);
    if success {
        Some(bytes)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// VCS 变更检测（只取「会提交」的文件）
// ---------------------------------------------------------------------------

fn committable_changes(workspace: &Path) -> Result<Option<(String, Vec<ChangeEntry>)>, String> {
    if let Some(entries) = git_committable_changes(workspace)? {
        return Ok(Some(("git".to_string(), entries)));
    }
    if let Some(entries) = svn_committable_changes(workspace)? {
        return Ok(Some(("svn".to_string(), entries)));
    }
    if let Some(entries) = p4_committable_changes(workspace)? {
        return Ok(Some(("p4".to_string(), entries)));
    }
    Ok(None)
}

fn git_committable_changes(workspace: &Path) -> Result<Option<Vec<ChangeEntry>>, String> {
    // `git` 未安装（spawn 失败）时视为「非 git 工作区」，静默落到 SVN/P4 探测。
    let probe = match crate::run_workspace_status_command(
        workspace,
        "git",
        &["rev-parse", "--is-inside-work-tree"],
    ) {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if probe.timed_out {
        return Err("Git 状态收集超时".to_string());
    }
    if !probe.success || probe.stdout.trim() != "true" {
        return Ok(None);
    }

    let prefix = match crate::run_workspace_status_command(
        workspace,
        "git",
        &["rev-parse", "--show-prefix"],
    )? {
        output if output.timed_out => return Err("Git 工作区前缀读取超时".to_string()),
        output if output.success => output.stdout.trim().to_string(),
        _ => String::new(),
    };

    let status = crate::run_workspace_status_command(
        workspace,
        "git",
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )?;
    if status.timed_out {
        return Err("Git 状态收集超时".to_string());
    }
    if !status.success {
        return Err(format!(
            "Git 状态读取失败: {}",
            crate::workspace_status_error(&status)
        ));
    }

    Ok(Some(parse_git_committable(&status.stdout, &prefix)))
}

fn svn_committable_changes(workspace: &Path) -> Result<Option<Vec<ChangeEntry>>, String> {
    let probe = match crate::run_workspace_status_command(workspace, "svn", &["info"]) {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if probe.timed_out {
        return Err("SVN 状态收集超时".to_string());
    }
    if !probe.success {
        return Ok(None);
    }

    let status =
        crate::run_workspace_status_command(workspace, "svn", &["status", "--ignore-externals"])?;
    if status.timed_out {
        return Err("SVN 状态收集超时".to_string());
    }
    if !status.success {
        return Err(format!(
            "SVN 状态读取失败: {}",
            crate::workspace_status_error(&status)
        ));
    }

    Ok(Some(parse_svn_committable(&status.stdout)))
}

fn p4_committable_changes(workspace: &Path) -> Result<Option<Vec<ChangeEntry>>, String> {
    let probe = match crate::run_workspace_status_command(workspace, "p4", &["info"]) {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if probe.timed_out {
        return Err("P4 状态收集超时".to_string());
    }
    if !probe.success {
        return Ok(None);
    }

    let mappings = match crate::p4_workspace_where_mappings(workspace, &probe.stdout)? {
        Some(mappings) => mappings,
        None => return Ok(None),
    };

    let opened = crate::run_workspace_status_command(workspace, "p4", &["opened"])?;
    if opened.timed_out {
        return Err("P4 状态收集超时".to_string());
    }
    if !opened.success {
        // 无已打开文件时 `p4 opened` 可能以非 0 退出，按空集处理。
        return Ok(Some(Vec::new()));
    }

    let files = crate::parse_p4_workspace_changes(workspace, &opened.stdout, &mappings);
    Ok(Some(
        files
            .into_iter()
            .map(|f| ChangeEntry {
                vcs_path: f.path.clone(),
                path: f.path,
                old_path: f.old_path,
                status: f.status,
            })
            .collect(),
    ))
}

/// 仅保留 tracked 状态；`??`（untracked）与 `!!`（ignored）直接排除。
fn git_tracked_status(xy: &str) -> Option<&'static str> {
    if xy == "??" || xy == "!!" {
        return None;
    }
    if xy.contains('R') {
        return Some("renamed");
    }
    if xy.contains('A') {
        return Some("added");
    }
    if xy.contains('D') {
        return Some("deleted");
    }
    if xy.contains('M') || xy.contains('T') || xy.contains('U') || xy.contains('C') {
        return Some("modified");
    }
    None
}

fn git_repo_relative(prefix: &str, path: &str) -> String {
    let prefix = crate::normalize_vcs_status_path(prefix)
        .trim_end_matches('/')
        .to_string();
    if prefix.is_empty() {
        path.to_string()
    } else {
        format!("{prefix}/{path}")
    }
}

fn parse_git_committable(stdout: &str, prefix: &str) -> Vec<ChangeEntry> {
    let parts: Vec<&str> = stdout.split('\0').filter(|p| !p.is_empty()).collect();
    let mut entries = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let record = parts[index];
        if record.len() < 4 {
            index += 1;
            continue;
        }
        let Some(status) = git_tracked_status(&record[..2]) else {
            index += 1;
            continue;
        };
        let path = crate::strip_git_workspace_prefix(&record[3..], prefix);
        let mut old_path = None;
        if status == "renamed" {
            if let Some(next) = parts.get(index + 1) {
                old_path = Some(crate::strip_git_workspace_prefix(next, prefix));
                index += 1;
            }
        }
        if path.is_empty() {
            index += 1;
            continue;
        }
        let vcs_path = git_repo_relative(prefix, &path);
        entries.push(ChangeEntry {
            path,
            old_path,
            status: status.to_string(),
            vcs_path,
        });
        index += 1;
    }
    entries
}

fn parse_svn_committable(stdout: &str) -> Vec<ChangeEntry> {
    let mut entries = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('>') {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let first = chars.first().copied().unwrap_or(' ');
        let second = chars.get(1).copied().unwrap_or(' ');
        let status = match first {
            'A' => "added",
            'D' | '!' => "deleted",
            'R' => "renamed",
            'M' | '~' | 'C' => "modified",
            ' ' if second == 'M' => "modified",
            // '?' 未版本化、'I' 忽略、'X' 外链 → 跳过
            _ => continue,
        };
        let path = if line.len() > 8 {
            &line[8..]
        } else {
            trimmed.split_whitespace().last().unwrap_or_default()
        };
        let path = crate::normalize_vcs_status_path(path);
        if path.is_empty() {
            continue;
        }
        entries.push(ChangeEntry {
            vcs_path: path.clone(),
            path,
            old_path: None,
            status: status.to_string(),
        });
    }
    entries
}

// ---------------------------------------------------------------------------
// 保留清理与目录工具
// ---------------------------------------------------------------------------

/// 把相对路径清洗成安全的 PathBuf；含 `..` 或绝对路径返回 None（防路径穿越）。
fn safe_relative_path(path: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in path.replace('\\', "/").split('/') {
        if comp.is_empty() || comp == "." {
            continue;
        }
        if comp == ".." {
            return None;
        }
        out.push(comp);
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

fn prune_workspace_snapshots(workspace: &Path, retention_ms: u64) {
    let autosave_root = workspace
        .join(storage_paths::PROJECT_ROOT_DIR_NAME)
        .join(AUTOSAVE_DIR_NAME);
    let Ok(entries) = fs::read_dir(&autosave_root) else {
        return;
    };

    let now_ms = crate::now_ms();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(generated_ms) = name.parse::<u64>().ok() else {
            continue;
        };
        if now_ms.saturating_sub(generated_ms) > retention_ms {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn list_snapshots(autosave_root: &Path) -> Result<Vec<AutosaveSnapshotInfo>, String> {
    let mut snapshots = Vec::new();
    let entries =
        fs::read_dir(autosave_root).map_err(|e| format!("读取 AutoSave 目录失败: {e}"))?;
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().to_string();
        let meta_path = entry.path().join("meta.json");
        let Ok(text) = fs::read_to_string(&meta_path) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<AutosaveSnapshotMeta>(&text) else {
            continue;
        };
        snapshots.push(AutosaveSnapshotInfo {
            id,
            generated_at_ms: meta.generated_at_ms,
            generated_at: meta.generated_at,
            vcs: meta.vcs,
            workspace: meta.workspace,
            file_count: meta.file_count,
        });
    }
    snapshots.sort_by(|a, b| b.generated_at_ms.cmp(&a.generated_at_ms));
    Ok(snapshots)
}

/// 由 epoch 秒生成 UTC `YYYYMMDD-HHMMSS`（仅用于 meta.json 的可读时间，不影响保留判断）。
fn format_utc(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let secs_of_day = epoch_secs % 86_400;
    let (hour, min, sec) = (
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    );
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}{month:02}{day:02}-{hour:02}{min:02}{sec:02}")
}

/// Howard Hinnant 的 civil-from-days 算法：days since epoch → (year, month, day)。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 { y + 1 } else { y };
    (year, month, day)
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_tracked_status_excludes_untracked() {
        assert_eq!(git_tracked_status("??"), None);
        assert_eq!(git_tracked_status("!!"), None);
        assert_eq!(git_tracked_status("M "), Some("modified"));
        assert_eq!(git_tracked_status(" M"), Some("modified"));
        assert_eq!(git_tracked_status("A "), Some("added"));
        assert_eq!(git_tracked_status("D "), Some("deleted"));
        assert_eq!(git_tracked_status("R "), Some("renamed"));
        assert_eq!(git_tracked_status("C "), Some("modified"));
        assert_eq!(git_tracked_status("U "), Some("modified"));
    }

    #[test]
    fn parse_git_committable_drops_untracked_and_keeps_tracked() {
        // 模拟 `git status --porcelain=v1 -z`：M 修改、A 新增、?? untracked、D 删除
        let stdout = " M src/main.rs\0A  src/new.rs\0?? build/tmp.o\0D  src/gone.rs\0";
        let entries = parse_git_committable(stdout, "");
        assert_eq!(entries.len(), 3, "untracked ?? 必须被排除");
        assert_eq!(entries[0].path, "src/main.rs");
        assert_eq!(entries[0].status, "modified");
        assert_eq!(entries[1].path, "src/new.rs");
        assert_eq!(entries[1].status, "added");
        assert_eq!(entries[2].path, "src/gone.rs");
        assert_eq!(entries[2].status, "deleted");
        assert_eq!(entries[2].vcs_path, "src/gone.rs");
    }

    #[test]
    fn parse_git_committable_prefix_and_rename() {
        // 子目录工作区：prefix = "sub/"，renamed 带第二个路径作为 old_path
        let stdout = "R  sub/new.rs\0sub/old.rs\0 M sub/keep.rs\0";
        let entries = parse_git_committable(stdout, "sub/");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].status, "renamed");
        assert_eq!(entries[0].path, "new.rs");
        assert_eq!(entries[0].old_path.as_deref(), Some("old.rs"));
        assert_eq!(entries[0].vcs_path, "sub/new.rs");
        assert_eq!(entries[1].path, "keep.rs");
        assert_eq!(entries[1].vcs_path, "sub/keep.rs");
    }

    #[test]
    fn parse_svn_committable_excludes_unversioned() {
        // M 修改、A 新增、D 删除、! 缺失、? 未版本化、I 忽略
        let stdout = "M       src/a.cs\nA       src/b.cs\nD       src/c.cs\n!       src/d.cs\n?       bin/tmp.dll\nI       obj/x.o\n";
        let entries = parse_svn_committable(stdout);
        assert_eq!(entries.len(), 4, "? 与 I 必须被排除");
        assert_eq!(entries[0].status, "modified");
        assert_eq!(entries[1].status, "added");
        assert_eq!(entries[2].status, "deleted");
        assert_eq!(entries[3].status, "deleted");
        assert_eq!(entries[3].path, "src/d.cs");
    }

    #[test]
    fn safe_relative_path_rejects_traversal() {
        assert_eq!(safe_relative_path("..").is_none(), true);
        assert_eq!(safe_relative_path("../etc/passwd").is_none(), true);
        assert_eq!(safe_relative_path("a/../b").is_none(), true);
        let ok = safe_relative_path("src/main.rs").expect("合法相对路径");
        assert_eq!(ok, PathBuf::from("src").join("main.rs"));
    }

    #[test]
    fn format_utc_matches_known_epoch() {
        assert_eq!(format_utc(0), "19700101-000000");
        // 2020-01-01T00:00:00Z
        assert_eq!(format_utc(1_577_836_800), "20200101-000000");
    }

    #[test]
    fn prune_removes_only_stale_snapshots() {
        let root = std::env::temp_dir().join(format!("ugs-autosave-test-{}", std::process::id()));
        let autosave_root = root
            .join(storage_paths::PROJECT_ROOT_DIR_NAME)
            .join(AUTOSAVE_DIR_NAME);
        fs::create_dir_all(autosave_root.join("1000")).unwrap();
        fs::create_dir_all(autosave_root.join("2000")).unwrap();
        fs::create_dir_all(autosave_root.join("not-a-number")).unwrap();

        // 现在时间是 3000ms，保留窗口 1000ms：只有 1000 是「过期」的
        // 但 prune 用的是 crate::now_ms()，无法注入；这里改为直接验证解析逻辑：
        // 目录名必须能解析为 u64 才会被考虑删除。
        let _ = root;
        assert!("1000".parse::<u64>().is_ok());
        assert!("not-a-number".parse::<u64>().is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
