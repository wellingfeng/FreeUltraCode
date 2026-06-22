//! Read-only import of model providers from the local cc-switch database.
//!
//! cc-switch stores its providers in a SQLite database at
//! `~/.cc-switch/cc-switch.db` (overridable via the `CC_SWITCH_DB` env var).
//! The actual secret lives inside the JSON `settings_config` column on each
//! `providers` row. The shape differs per `app_type`:
//!   - `claude` : `settings_config.env.ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`),
//!                `.env.ANTHROPIC_BASE_URL`, `.env.ANTHROPIC_MODEL`.
//!   - `codex`  : `settings_config.auth.OPENAI_API_KEY` and `settings_config.config`
//!                — a TOML string carrying top-level `model` / `model_provider`
//!                and a `[model_providers.<id>]` table with `base_url`.
//!   - `gemini` : best-effort `settings_config.env.{GEMINI_API_KEY|GOOGLE_API_KEY}`.
//! The active provider per app is recorded in `~/.cc-switch/settings.json` under
//! `currentProviderClaude` / `currentProviderCodex` / `currentProviderGemini`.
//!
//! We open the database READ-ONLY so we never contend with the cc-switch GUI's
//! writer, and only read the three app types we understand.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Serialize)]
struct ImportedProvider {
    /// Provider runtime family, mapped to UltraGameStudio's `ProviderKind`.
    kind: String,
    name: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    /// The cc-switch row id, so the frontend can match the active provider.
    #[serde(rename = "ccId")]
    cc_id: String,
}

#[derive(Serialize, Default)]
struct ActivePointers {
    #[serde(skip_serializing_if = "Option::is_none")]
    anthropic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    codex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gemini: Option<String>,
}

#[derive(Serialize)]
struct ImportResult {
    providers: Vec<ImportedProvider>,
    active: ActivePointers,
}

/// Locate the user's home directory (mirrors `history::home_dir`).
fn home_dir() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("USERPROFILE") {
        if !h.is_empty() {
            return Some(PathBuf::from(h));
        }
    }
    if let Ok(h) = std::env::var("HOME") {
        if !h.is_empty() {
            return Some(PathBuf::from(h));
        }
    }
    None
}

/// Resolve the cc-switch database path (`CC_SWITCH_DB` env override wins).
fn db_path() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("CC_SWITCH_DB") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    let home = home_dir().ok_or_else(|| "未找到用户目录".to_string())?;
    Ok(home.join(".cc-switch").join("cc-switch.db"))
}

/// Best-effort read of the active provider ids from cc-switch settings.json.
fn read_active_pointers() -> ActivePointers {
    let mut active = ActivePointers::default();
    let Some(home) = home_dir() else {
        return active;
    };
    let path = home.join(".cc-switch").join("settings.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return active;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return active;
    };
    let read = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    active.anthropic = read("currentProviderClaude");
    active.codex = read("currentProviderCodex");
    active.gemini = read("currentProviderGemini");
    active
}

/// Pull a non-empty string from `settings.env[key]`.
fn env_str(settings: &serde_json::Value, key: &str) -> Option<String> {
    settings
        .get("env")
        .and_then(|env| env.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Pull a non-empty string from `settings.auth[key]`.
fn auth_str(settings: &serde_json::Value, key: &str) -> Option<String> {
    settings
        .get("auth")
        .and_then(|auth| auth.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Parse a claude-type row into an importable provider (None when no key).
fn parse_claude(
    settings: &serde_json::Value,
    name: String,
    cc_id: String,
) -> Option<ImportedProvider> {
    let api_key = env_str(settings, "ANTHROPIC_AUTH_TOKEN")
        .or_else(|| env_str(settings, "ANTHROPIC_API_KEY"))?;
    Some(ImportedProvider {
        kind: "anthropic".to_string(),
        name: if name.is_empty() {
            "Claude".to_string()
        } else {
            name
        },
        api_key,
        base_url: env_str(settings, "ANTHROPIC_BASE_URL").unwrap_or_default(),
        model: env_str(settings, "ANTHROPIC_MODEL"),
        cc_id,
    })
}

/// Parse a codex-type row. Key lives in `auth.OPENAI_API_KEY`; base_url + model
/// come from the embedded TOML `config` string.
fn parse_codex(
    settings: &serde_json::Value,
    name: String,
    cc_id: String,
) -> Option<ImportedProvider> {
    let api_key =
        auth_str(settings, "OPENAI_API_KEY").or_else(|| env_str(settings, "OPENAI_API_KEY"))?;

    let mut base_url = String::new();
    let mut model: Option<String> = None;
    if let Some(config_str) = settings.get("config").and_then(|v| v.as_str()) {
        if let Ok(cfg) = config_str.parse::<toml::Value>() {
            model = cfg
                .get("model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let provider_id = cfg.get("model_provider").and_then(|v| v.as_str());
            if let Some(pid) = provider_id {
                base_url = cfg
                    .get("model_providers")
                    .and_then(|mp| mp.get(pid))
                    .and_then(|p| p.get("base_url"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
            }
        }
    }

    Some(ImportedProvider {
        kind: "codex".to_string(),
        name: if name.is_empty() {
            "Codex".to_string()
        } else {
            name
        },
        api_key,
        base_url,
        model,
        cc_id,
    })
}

/// Parse a gemini-type row (best-effort; cc-switch usually stores Google OAuth,
/// so an API-key row is the exception). None when no usable key.
fn parse_gemini(
    settings: &serde_json::Value,
    name: String,
    cc_id: String,
) -> Option<ImportedProvider> {
    let api_key = env_str(settings, "GEMINI_API_KEY")
        .or_else(|| env_str(settings, "GOOGLE_API_KEY"))
        .or_else(|| auth_str(settings, "GEMINI_API_KEY"))?;
    Some(ImportedProvider {
        kind: "gemini".to_string(),
        name: if name.is_empty() {
            "Gemini".to_string()
        } else {
            name
        },
        api_key,
        base_url: env_str(settings, "GOOGLE_GEMINI_BASE_URL").unwrap_or_default(),
        model: env_str(settings, "GEMINI_MODEL"),
        cc_id,
    })
}

/// Import all supported providers from the local cc-switch database.
///
/// Returns a JSON string of `{ providers: [...], active: {...} }`. Rows without a
/// usable API key are skipped. Desktop-only.
#[tauri::command]
pub async fn import_cc_switch_claude() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let path = db_path()?;
        if !path.exists() {
            return Err("未找到 cc-switch 数据库，请确认已安装并运行过 cc-switch".to_string());
        }

        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("打开 cc-switch 数据库失败: {e}"))?;
        let _ = conn.busy_timeout(Duration::from_millis(2000));

        let mut stmt = conn
            .prepare(
                "SELECT id, name, settings_config, app_type \
                 FROM providers WHERE app_type IN ('claude', 'codex', 'gemini')",
            )
            .map_err(|e| format!("查询 cc-switch 失败: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
                let settings: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
                let app_type: String = row.get::<_, Option<String>>(3)?.unwrap_or_default();
                Ok((id, name, settings, app_type))
            })
            .map_err(|e| format!("读取 cc-switch 行失败: {e}"))?;

        let mut providers: Vec<ImportedProvider> = Vec::new();

        for row in rows {
            let (cc_id, name, settings_text, app_type) =
                row.map_err(|e| format!("解析 cc-switch 行失败: {e}"))?;

            let settings: serde_json::Value = match serde_json::from_str(&settings_text) {
                Ok(v) => v,
                Err(_) => continue, // malformed settings_config — skip
            };

            let parsed = match app_type.as_str() {
                "claude" => parse_claude(&settings, name, cc_id),
                "codex" => parse_codex(&settings, name, cc_id),
                "gemini" => parse_gemini(&settings, name, cc_id),
                _ => None,
            };
            if let Some(provider) = parsed {
                providers.push(provider);
            }
        }

        // Keep an active pointer only if it actually matches an imported provider.
        let mut active = read_active_pointers();
        let has = |id: &Option<String>| {
            id.as_ref()
                .map(|target| providers.iter().any(|p| &p.cc_id == target))
                .unwrap_or(false)
        };
        if !has(&active.anthropic) {
            active.anthropic = None;
        }
        if !has(&active.codex) {
            active.codex = None;
        }
        if !has(&active.gemini) {
            active.gemini = None;
        }

        let result = ImportResult { providers, active };
        serde_json::to_string(&result).map_err(|e| format!("序列化失败: {e}"))
    })
    .await
    .map_err(|e| format!("import_cc_switch_claude 调度失败: {e}"))?
}
