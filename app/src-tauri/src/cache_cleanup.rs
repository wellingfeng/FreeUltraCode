// Startup cache retention: deletes stale session files and cache/tmp/backup
// artifacts older than a configurable retention window (default 30 days).
//
// The sweep runs on its own background thread, kicked off a short delay after
// launch so it never competes with startup I/O, and it sleeps briefly between
// deletions so a large backlog never saturates disk I/O or steals cycles from
// the UI. It only touches directories that are documented as pure caches:
//   - global root: trash/, backups/, quarantine/, tmp/, deleted/
//   - global root: workspaces/*/sessions/*.json (favorited sessions are kept)
//   - each known project's `.ultragamestudio` cache tree
//
// It never touches config.json, index.json, meta.json/workspace.json,
// sessions/index.json, or migrations/ - those are live state, not cache.
//
// The Settings UI (设置 > 通用) edits `settings/cacheCleanup.v1.json` under the
// global root (same disk-backed settings store every other settings blob
// uses); `UGS_CACHE_RETENTION_DAYS` / `UGS_DISABLE_STARTUP_CACHE_CLEANUP` env
// vars take precedence over that file when set, for support/diagnostics use.
//
// The same sweep powers a manual "clean now" button: `manual_cache_cleanup`
// runs a pass with an explicit retention window chosen in the UI (default 10
// days) and reports how many files/bytes it removed. Manual cleanup is never
// gated by the startup toggle or its disable env var - it is a user-initiated
// action and must always be available.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::storage_paths;

const DEFAULT_RETENTION_DAYS: u64 = 30;
const MIN_RETENTION_DAYS: u64 = 1;
const MAX_RETENTION_DAYS: u64 = 365;
const RETENTION_DAYS_ENV: &str = "UGS_CACHE_RETENTION_DAYS";
const DISABLE_ENV: &str = "UGS_DISABLE_STARTUP_CACHE_CLEANUP";
const STARTUP_DELAY: Duration = Duration::from_secs(20);
const STEP_PAUSE: Duration = Duration::from_millis(15);
const UI_CONFIG_REL_PATH: &str = "settings/cacheCleanup.v1.json";

const GLOBAL_CACHE_SUBDIRS: &[&str] = &["trash", "backups", "quarantine", "tmp", "deleted"];

/// Serializable result of a manual cleanup pass, shown in the Settings UI.
#[derive(Debug, Default, serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleanupSummary {
    pub files_removed: u64,
    pub bytes_freed: u64,
}

/// Internal running tally for a single cleanup pass.
#[derive(Default, Clone, Copy)]
struct CleanupStats {
    files: u64,
    bytes: u64,
}

impl CleanupStats {
    fn into_summary(self) -> CacheCleanupSummary {
        CacheCleanupSummary {
            files_removed: self.files,
            bytes_freed: self.bytes,
        }
    }
}

/// The `settings/cacheCleanup.v1.json` blob the Settings UI writes:
/// `{ "enabled": bool, "retentionDays": number }`. Missing/corrupt file or
/// fields fall back to defaults rather than failing the sweep.
fn read_ui_config() -> Option<(bool, u64)> {
    let root = storage_paths::global_root().ok()?;
    let path = root.join(UI_CONFIG_REL_PATH.replace('/', std::path::MAIN_SEPARATOR_STR));
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let enabled = value
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let days = value
        .get("retentionDays")
        .and_then(|v| v.as_u64())
        .filter(|&d| d > 0)
        .unwrap_or(DEFAULT_RETENTION_DAYS);
    Some((enabled, days))
}

/// Whether the startup sweep should run at all: the disable env var always
/// wins, then the UI toggle (default enabled), then on by default.
fn cleanup_enabled() -> bool {
    if std::env::var(DISABLE_ENV).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true")) {
        return false;
    }
    read_ui_config().map(|(enabled, _)| enabled).unwrap_or(true)
}

/// Retention window in days: env var wins, then the UI config, then default.
fn retention_days() -> u64 {
    std::env::var(RETENTION_DAYS_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&d| d > 0)
        .or_else(|| read_ui_config().map(|(_, days)| days))
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn age_secs(path: &Path, now: u64) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let modified_secs = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(now.saturating_sub(modified_secs))
}

fn is_stale(path: &Path, now: u64, max_age: u64) -> bool {
    age_secs(path, now).is_some_and(|age| age > max_age)
}

/// A JSON session record is considered pinned if either the legacy
/// `meta.favorite` or canonical `metadata.favorite` field is `true`. Pinned
/// sessions are kept regardless of age; everything else follows the sweep.
fn is_favorited_session(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    ["meta", "metadata"].iter().any(|key| {
        value
            .get(key)
            .and_then(|section| section.get("favorite"))
            .and_then(|flag| flag.as_bool())
            .unwrap_or(false)
    })
}

pub type CacheCleanupReport = CacheCleanupSummary;

/// Recursively delete stale files under `dir`, then remove any directories
/// left empty by the sweep (best-effort; failures are ignored since the
/// directory may still hold fresh files or be racing a concurrent writer).
fn sweep_cache_dir(dir: &Path, now: u64, max_age: u64, stats: &mut CleanupStats) {
    sweep_cache_dir_excluding(dir, now, max_age, stats, &[]);
}

/// `sweep_cache_dir` 的带排除变体：递归清理时跳过 `excluded_names` 命中的一级子目录。
/// 用于让 AutoSave 快照目录（`<workspace>/.ultragamestudio/autosave`）免受缓存清理
/// 的 30 天淘汰影响——AutoSave 自行按 retentionDays（默认 7 天）滚动清理。
fn sweep_cache_dir_excluding(
    dir: &Path,
    now: u64,
    max_age: u64,
    stats: &mut CleanupStats,
    excluded_names: &[&str],
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if excluded_names
                .iter()
                .any(|name| entry.file_name() == std::ffi::OsStr::new(name))
            {
                continue;
            }
            sweep_cache_dir_excluding(&path, now, max_age, stats, excluded_names);
            let _ = fs::remove_dir(&path);
            continue;
        }
        if !file_type.is_file() || !is_stale(&path, now, max_age) {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if fs::remove_file(&path).is_ok() {
            stats.files += 1;
            stats.bytes = stats.bytes.saturating_add(size);
            std::thread::sleep(STEP_PAUSE);
        }
    }
}

/// Same as `sweep_cache_dir`, but for a workspace `sessions/` directory: skips
/// `index.json` (live state, self-healing on mismatch) and keeps favorited
/// session records regardless of age.
fn sweep_sessions_dir(dir: &Path, now: u64, max_age: u64, stats: &mut CleanupStats) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("index.json") {
            continue;
        }
        if !is_stale(&path, now, max_age) {
            continue;
        }
        if is_favorited_session(&path) {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if fs::remove_file(&path).is_ok() {
            stats.files += 1;
            stats.bytes = stats.bytes.saturating_add(size);
            std::thread::sleep(STEP_PAUSE);
        }
    }
}

fn sweep_global_root(now: u64, max_age: u64, stats: &mut CleanupStats) {
    let Ok(root) = storage_paths::global_root() else {
        return;
    };

    for name in GLOBAL_CACHE_SUBDIRS {
        sweep_cache_dir(&root.join(name), now, max_age, stats);
    }

    let workspaces_root = root.join("workspaces");
    let Ok(workspace_entries) = fs::read_dir(&workspaces_root) else {
        return;
    };
    for entry in workspace_entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            sweep_sessions_dir(&entry.path().join("sessions"), now, max_age, stats);
        }
    }
}

fn sweep_project_caches(now: u64, max_age: u64, stats: &mut CleanupStats) {
    for workspace_root in storage_paths::known_workspace_roots() {
        let cache_root = workspace_root.join(storage_paths::PROJECT_ROOT_DIR_NAME);
        sweep_cache_dir_excluding(&cache_root, now, max_age, stats, &["autosave"]);
    }
}

/// Manual sweep requested from the Settings UI (设置 > 通用). Unlike the
/// startup pass it runs even when the startup toggle is off -- the user asked
/// for it explicitly -- and `retention_days_override` (the UI stepper value)
/// wins over the env/UI retention so the sweep matches what the settings row
/// shows. Favorited sessions and live state are never touched.
pub fn run_cleanup_now(retention_days_override: Option<u64>) -> CacheCleanupReport {
    run_cleanup_pass_with_retention_days(
        retention_days_override
            .filter(|&d| d > 0)
            .unwrap_or_else(retention_days),
    )
    .into_summary()
}

/// Run a full sweep with an explicit retention window (in days), returning how
/// much was removed. The window is clamped to the same 1..365 range the UI
/// enforces so a bogus value can never delete everything.
fn run_cleanup_pass_with_retention_days(days: u64) -> CleanupStats {
    let days = days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    let max_age = days.saturating_mul(24 * 60 * 60);
    let now = now_secs();
    let mut stats = CleanupStats::default();
    sweep_global_root(now, max_age, &mut stats);
    sweep_project_caches(now, max_age, &mut stats);
    stats
}

fn run_cleanup_pass() {
    if !cleanup_enabled() {
        return;
    }
    let _ = run_cleanup_pass_with_retention_days(retention_days());
}

/// Kick off the retention sweep on a dedicated background thread. Safe to
/// call once at startup; it is a no-op if disabled via `UGS_DISABLE_STARTUP_CACHE_CLEANUP`
/// or the Settings UI toggle (checked again after the startup delay, so a
/// mid-wait settings change still takes effect).
pub fn spawn_startup_cache_cleanup() {
    if std::env::var(DISABLE_ENV).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true")) {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("ugs-cache-cleanup".into())
        .spawn(|| {
            std::thread::sleep(STARTUP_DELAY);
            run_cleanup_pass();
        });
}

/// Settings UI "clean now" button: run a sweep with the user-chosen retention
/// window (days) and report files/bytes removed. Never gated by the startup
/// toggle or its disable env var - this is an explicit user action.
#[tauri::command]
pub async fn manual_cache_cleanup(retention_days: u64) -> Result<CacheCleanupSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(run_cleanup_pass_with_retention_days(retention_days).into_summary())
    })
    .await
    .map_err(|e| format!("手动清理任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration as StdDuration;

    fn touch_stale(path: &Path, age_secs: u64) {
        fs::write(path, "{}").unwrap();
        let stale_time = SystemTime::now() - StdDuration::from_secs(age_secs);
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(stale_time).unwrap();
    }

    #[test]
    fn sweep_cache_dir_removes_only_stale_files_and_prunes_empty_dirs() {
        let root = std::env::temp_dir().join(format!(
            "ugs-cache-cleanup-sweep-{}-{}",
            std::process::id(),
            now_secs()
        ));
        fs::create_dir_all(root.join("nested")).unwrap();
        let max_age = 30 * 24 * 60 * 60;

        let stale = root.join("nested").join("old.tmp");
        touch_stale(&stale, max_age + 3600);

        let fresh = root.join("fresh.tmp");
        fs::write(&fresh, "{}").unwrap();

        let mut stats = CleanupStats::default();
        sweep_cache_dir(&root, now_secs(), max_age, &mut stats);

        assert!(!stale.exists(), "stale file should be removed");
        assert!(
            !root.join("nested").exists(),
            "emptied dir should be pruned"
        );
        assert!(fresh.exists(), "fresh file should survive");
        assert_eq!(stats.files, 1, "one stale file should be tallied");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sweep_sessions_dir_keeps_index_and_favorited_sessions() {
        let root = std::env::temp_dir().join(format!(
            "ugs-cache-cleanup-sessions-{}-{}",
            std::process::id(),
            now_secs()
        ));
        fs::create_dir_all(&root).unwrap();
        let max_age = 30 * 24 * 60 * 60;
        let stale_age = max_age + 3600;

        let index = root.join("index.json");
        touch_stale(&index, stale_age);

        let favorited = root.join("ses_pinned.json");
        fs::write(&favorited, r#"{"meta":{"favorite":true}}"#).unwrap();
        let file = fs::OpenOptions::new().write(true).open(&favorited).unwrap();
        file.set_modified(SystemTime::now() - StdDuration::from_secs(stale_age))
            .unwrap();

        let stale_plain = root.join("ses_old.json");
        touch_stale(&stale_plain, stale_age);

        let mut stats = CleanupStats::default();
        sweep_sessions_dir(&root, now_secs(), max_age, &mut stats);

        assert!(index.exists(), "sessions index.json must never be swept");
        assert!(favorited.exists(), "favorited session must be kept");
        assert!(
            !stale_plain.exists(),
            "stale unfavorited session should be removed"
        );
        assert_eq!(stats.files, 1, "one stale session should be tallied");

        let _ = fs::remove_dir_all(&root);
    }
}
