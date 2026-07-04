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

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::storage_paths;

const DEFAULT_RETENTION_DAYS: u64 = 30;
const RETENTION_DAYS_ENV: &str = "UGS_CACHE_RETENTION_DAYS";
const DISABLE_ENV: &str = "UGS_DISABLE_STARTUP_CACHE_CLEANUP";
const STARTUP_DELAY: Duration = Duration::from_secs(20);
const STEP_PAUSE: Duration = Duration::from_millis(15);
const UI_CONFIG_REL_PATH: &str = "settings/cacheCleanup.v1.json";

const GLOBAL_CACHE_SUBDIRS: &[&str] = &["trash", "backups", "quarantine", "tmp", "deleted"];

/// The `settings/cacheCleanup.v1.json` blob the Settings UI writes:
/// `{ "enabled": bool, "retentionDays": number }`. Missing/corrupt file or
/// fields fall back to defaults rather than failing the sweep.
fn read_ui_config() -> Option<(bool, u64)> {
    let root = storage_paths::global_root().ok()?;
    let path = root.join(UI_CONFIG_REL_PATH.replace('/', std::path::MAIN_SEPARATOR_STR));
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let enabled = value.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let days = value
        .get("retentionDays")
        .and_then(|v| v.as_u64())
        .filter(|&d| d > 0)
        .unwrap_or(DEFAULT_RETENTION_DAYS);
    Some((enabled, days))
}

/// Whether the sweep should run at all: the disable env var always wins, then
/// the UI toggle (default enabled), then on by default.
fn cleanup_enabled() -> bool {
    if std::env::var(DISABLE_ENV).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true")) {
        return false;
    }
    read_ui_config().map(|(enabled, _)| enabled).unwrap_or(true)
}

fn retention_secs() -> u64 {
    let days = std::env::var(RETENTION_DAYS_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&d| d > 0)
        .or_else(|| read_ui_config().map(|(_, days)| days))
        .unwrap_or(DEFAULT_RETENTION_DAYS);
    days.saturating_mul(24 * 60 * 60)
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

/// Recursively delete stale files under `dir`, then remove any directories
/// left empty by the sweep (best-effort; failures are ignored since the
/// directory may still hold fresh files or be racing a concurrent writer).
fn sweep_cache_dir(dir: &Path, now: u64, max_age: u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            sweep_cache_dir(&path, now, max_age);
            let _ = fs::remove_dir(&path);
            continue;
        }
        if !file_type.is_file() || !is_stale(&path, now, max_age) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            std::thread::sleep(STEP_PAUSE);
        }
    }
}

/// Same as `sweep_cache_dir`, but for a workspace `sessions/` directory: skips
/// `index.json` (live state, self-healing on mismatch) and keeps favorited
/// session records regardless of age.
fn sweep_sessions_dir(dir: &Path, now: u64, max_age: u64) {
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
        if fs::remove_file(&path).is_ok() {
            std::thread::sleep(STEP_PAUSE);
        }
    }
}

fn sweep_global_root(now: u64, max_age: u64) {
    let Ok(root) = storage_paths::global_root() else {
        return;
    };

    for name in GLOBAL_CACHE_SUBDIRS {
        sweep_cache_dir(&root.join(name), now, max_age);
    }

    let workspaces_root = root.join("workspaces");
    let Ok(workspace_entries) = fs::read_dir(&workspaces_root) else {
        return;
    };
    for entry in workspace_entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            sweep_sessions_dir(&entry.path().join("sessions"), now, max_age);
        }
    }
}

fn sweep_project_caches(now: u64, max_age: u64) {
    for workspace_root in storage_paths::known_workspace_roots() {
        let cache_root = workspace_root.join(storage_paths::PROJECT_ROOT_DIR_NAME);
        sweep_cache_dir(&cache_root, now, max_age);
    }
}

fn run_cleanup_pass() {
    if !cleanup_enabled() {
        return;
    }
    let max_age = retention_secs();
    let now = now_secs();
    sweep_global_root(now, max_age);
    sweep_project_caches(now, max_age);
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

        sweep_cache_dir(&root, now_secs(), max_age);

        assert!(!stale.exists(), "stale file should be removed");
        assert!(!root.join("nested").exists(), "emptied dir should be pruned");
        assert!(fresh.exists(), "fresh file should survive");

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

        sweep_sessions_dir(&root, now_secs(), max_age);

        assert!(index.exists(), "sessions index.json must never be swept");
        assert!(favorited.exists(), "favorited session must be kept");
        assert!(
            !stale_plain.exists(),
            "stale unfavorited session should be removed"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
