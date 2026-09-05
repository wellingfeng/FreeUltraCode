use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliPlatform {
    Windows,
    Macos,
    Linux,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliScanCandidate {
    pub adapter: String,
    pub command: String,
    pub path: Option<String>,
    pub source: String,
    pub available: bool,
    pub status: String,
    pub hint: Option<String>,
    pub error: Option<String>,
    pub platform: CliPlatform,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliScanResult {
    pub scanned_at_ms: u64,
    pub platform: CliPlatform,
    pub candidates: Vec<CliScanCandidate>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathValidation {
    pub path: String,
    pub normalized_path: String,
    pub platform: CliPlatform,
    pub file_name: String,
}

#[derive(Clone, Copy)]
struct CliSpec {
    adapter: &'static str,
    label: &'static str,
    commands: &'static [&'static str],
}

const CLI_SPECS: &[CliSpec] = &[
    CliSpec {
        adapter: "claude-code",
        label: "Claude Code",
        commands: &["claude", "claude-code"],
    },
    CliSpec {
        adapter: "codex",
        label: "Codex",
        commands: &["codex"],
    },
    CliSpec {
        adapter: "gemini",
        label: "Gemini",
        commands: &["gemini"],
    },
    CliSpec {
        adapter: "kimi",
        label: "Kimi Code",
        commands: &["kimi", "kimi-code"],
    },
    CliSpec {
        adapter: "deepseek-harness",
        label: "DeepSeek Harness",
        commands: &["dsh"],
    },
    CliSpec {
        adapter: "zcode",
        label: "ZCode / GLM",
        commands: &["zcode"],
    },
    CliSpec {
        adapter: "grok",
        label: "Grok",
        commands: &["grok"],
    },
];

pub fn adapter_binary(adapter: &str) -> &str {
    match adapter {
        "claude-code" | "claude" => "claude",
        "codex" => "codex",
        "gemini" => "gemini",
        "kimi" => "kimi",
        "deepseek-harness" => "dsh",
        "zcode" => "zcode",
        "grok" => "grok",
        other => other,
    }
}

pub fn adapter_protocol(adapter: &str) -> &str {
    match adapter {
        "claude-code" | "claude" => "claude",
        "codex" => "codex",
        "gemini" => "gemini",
        "kimi" => "kimi",
        "deepseek-harness" => "deepseek-harness",
        "zcode" => "zcode",
        "grok" => "grok",
        other => other,
    }
}

pub fn should_pass_model(adapter: &str, model: &str) -> bool {
    let m = model.trim();
    if m.is_empty() {
        return false;
    }
    let lower = m.to_ascii_lowercase();
    let protocol = adapter_protocol(adapter);
    if matches!(protocol, "codex" | "gemini" | "kimi" | "grok") {
        return !matches!(lower.as_str(), "haiku" | "sonnet" | "opus")
            && !lower.starts_with("claude-");
    }
    if protocol == "deepseek-harness" {
        // dsh resolves its model from `$DSH_HOME/settings.yaml`, never a flag.
        return false;
    }
    if protocol == "zcode" {
        // ZCode resolves its model from `~/.zcode/cli/config.json`
        // (provider.zai.models / model.main), never a `--model` flag.
        return false;
    }
    // claude-code: only forward genuine Claude model ids or the bare tier
    // aliases the CLI maps. A relay route label (e.g. a cc-switch id like
    // "kimi-for-coding") may still be present in ANTHROPIC_MODEL, but must not
    // be passed as a `--model` flag to the claude CLI.
    matches!(lower.as_str(), "haiku" | "sonnet" | "opus") || lower.starts_with("claude")
}

pub fn platform() -> CliPlatform {
    if cfg!(windows) {
        CliPlatform::Windows
    } else if cfg!(target_os = "macos") {
        CliPlatform::Macos
    } else {
        CliPlatform::Linux
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn push_path_dir(out: &mut Vec<PathBuf>, seen: &mut Vec<String>, path: PathBuf) {
    let key = path.to_string_lossy().to_string();
    if key.trim().is_empty() || seen.iter().any(|existing| existing == &key) {
        return;
    }
    seen.push(key);
    out.push(path);
}

fn common_path_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = Vec::new();

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            push_path_dir(&mut out, &mut seen, dir);
        }
    }

    if let Some(home) = home_dir() {
        #[cfg(windows)]
        {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                push_path_dir(&mut out, &mut seen, PathBuf::from(appdata).join("npm"));
            }
            if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
                push_path_dir(
                    &mut out,
                    &mut seen,
                    PathBuf::from(local_appdata)
                        .join("Programs")
                        .join("LLVM")
                        .join("bin"),
                );
            }
            push_path_dir(&mut out, &mut seen, home.join(".cargo").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join(".bun").join("bin"));
        }

        #[cfg(not(windows))]
        {
            push_path_dir(&mut out, &mut seen, home.join(".cargo").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join(".bun").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join(".deno").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join(".local").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join(".npm-global").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join(".volta").join("bin"));
            push_path_dir(&mut out, &mut seen, home.join("Library").join("pnpm"));
        }
    }

    #[cfg(windows)]
    {
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(var) {
                push_path_dir(
                    &mut out,
                    &mut seen,
                    PathBuf::from(root).join("LLVM").join("bin"),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for dir in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            push_path_dir(&mut out, &mut seen, PathBuf::from(dir));
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for dir in [
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/snap/bin",
        ] {
            push_path_dir(&mut out, &mut seen, PathBuf::from(dir));
        }
    }

    out
}

pub fn augmented_path_var() -> Option<OsString> {
    std::env::join_paths(common_path_dirs()).ok()
}

pub fn scan_model_clis() -> CliScanResult {
    let platform = platform();
    let scanned_at_ms = now_ms();
    let mut candidates = Vec::new();

    for spec in CLI_SPECS {
        match resolve_spec_candidate(spec, platform) {
            Ok(candidate) => candidates.push(candidate),
            Err(err) => candidates.push(CliScanCandidate {
                adapter: spec.adapter.to_string(),
                command: spec.commands[0].to_string(),
                path: None,
                source: "scan".to_string(),
                available: false,
                status: "missing".to_string(),
                hint: Some(spec.label.to_string()),
                error: Some(err),
                platform,
            }),
        }
    }

    CliScanResult {
        scanned_at_ms,
        platform,
        candidates,
        error: None,
    }
}

pub fn validate_cli_path(raw: &str) -> Result<CliPathValidation, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("INVALID_CLI_PATH: 请选择可执行文件。".to_string());
    }
    validate_candidate_path(Path::new(trimmed))
}

pub fn normalize_cli_command_override(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("INVALID_CLI_PATH: 请选择可执行文件。".to_string());
    }

    if looks_like_path(trimmed) {
        return validate_cli_path(trimmed).map(|v| v.normalized_path);
    }

    if is_disallowed_launcher(trimmed) {
        return Err("UNSUPPORTED_CLI_TYPE: 请选择模型 CLI，不要使用 shell 程序。".to_string());
    }

    Ok(trimmed.to_string())
}

fn resolve_spec_candidate(
    spec: &CliSpec,
    platform: CliPlatform,
) -> Result<CliScanCandidate, String> {
    for command in spec.commands {
        if let Some(path) = resolve_command_path(command)
            .and_then(|candidate| validate_candidate_path(&candidate).ok())
        {
            let resolved_path = path.normalized_path.clone();
            return Ok(CliScanCandidate {
                adapter: spec.adapter.to_string(),
                command: (*command).to_string(),
                path: Some(resolved_path.clone()),
                source: "scan".to_string(),
                available: true,
                status: "available".to_string(),
                hint: Some(resolved_path),
                error: None,
                platform,
            });
        }
    }

    Err(format!("未找到 {} CLI", spec.label))
}

pub fn resolve_command_path(command: &str) -> Option<PathBuf> {
    let raw = Path::new(command);
    if looks_like_path(command) {
        return raw.exists().then(|| raw.to_path_buf());
    }

    #[cfg(windows)]
    {
        let mut variants = vec![command.to_string()];
        if raw.extension().is_none() {
            variants.extend(pathext_variants(command));
        }
        if let Some(found) = search_path(&variants) {
            return Some(found);
        }
        None
    }

    #[cfg(not(windows))]
    {
        search_path(&[command.to_string()])
    }
}

/// Resolve a bare command name to a concrete executable path using a LIVE
/// filesystem search (process PATH plus well-known dirs such as
/// `%APPDATA%\npm` on Windows). This is the self-heal seam for CLIs installed
/// AFTER the app process started: the process PATH is frozen at startup, but
/// the scan still covers `%APPDATA%\npm`, so a fresh lookup finds a newly
/// installed CLI that a direct `Command::new(name)` spawn would miss.
/// Path-like inputs are already concrete and return `None` so callers keep
/// them untouched.
pub fn resolve_launch_binary(command: &str) -> Option<String> {
    if looks_like_path(command) {
        return None;
    }
    resolve_command_path(command).map(|path| path.to_string_lossy().to_string())
}

/// dsh (`@deepseek-ai/dsh`) ships as an npm `.cmd`/shell shim that ultimately
/// runs `node <pkg>/lib/bin.js`. Its headless task is a single argv positional,
/// and launching via `cmd /C dsh.cmd "<task>"` caps the whole command line at
/// cmd.exe's ~8191-char limit — long enough that a chat prompt (system prefix +
/// history + task) overflows and the task, sitting at the TAIL, gets truncated.
/// dsh then sees only the lead-in and replies with a generic greeting.
///
/// Spawning the underlying `bin.js` directly with `node` bypasses cmd.exe and
/// raises the ceiling to the Windows CreateProcess limit (~32767 chars, ~4x),
/// which comfortably fits a chat turn. Given the resolved dsh launcher path,
/// locate the sibling `node_modules/@deepseek-ai/dsh/lib/bin.js`. Returns
/// `None` if the package layout isn't the expected npm shim so the caller can
/// fall back to the historical `cmd /C` path.
pub fn resolve_dsh_node_entry(dsh_binary: &str) -> Option<PathBuf> {
    // Resolve the launcher to a concrete file (bare "dsh" -> full shim path).
    let launcher = if looks_like_path(dsh_binary) {
        let p = Path::new(dsh_binary);
        p.exists().then(|| p.to_path_buf())?
    } else {
        resolve_command_path(dsh_binary)?
    };
    let dir = launcher.parent()?;
    // Standard npm global/local layout: the shim sits next to `node_modules`.
    let entry = dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    entry.is_file().then_some(entry)
}

/// zcode (`zcode-app-cli`) ships as an npm `.cmd`/shell shim that runs
/// `node <pkg>/bin/zcode.js` (the launcher), which in turn spawns the bundled
/// `vendor/zcode.cjs` runtime with the same argv. The headless turn prompt is a
/// single `--prompt` argv value, so launching via `cmd /C zcode.cmd` caps the
/// whole command line at cmd.exe's ~8191-char limit — exactly the same trap as
/// dsh. Spawning the launcher's `bin/zcode.js` directly with `node` bypasses
/// cmd.exe and raises the ceiling to the Windows CreateProcess limit
/// (~32767 chars, ~4x), which comfortably fits a chat turn. Returns `None` if
/// the package layout isn't the expected npm shim so the caller can fall back
/// to the historical `cmd /C` path.
pub fn resolve_zcode_node_entry(zcode_binary: &str) -> Option<PathBuf> {
    // Resolve the launcher to a concrete file (bare "zcode" -> full shim path).
    let launcher = if looks_like_path(zcode_binary) {
        let p = Path::new(zcode_binary);
        p.exists().then(|| p.to_path_buf())?
    } else {
        resolve_command_path(zcode_binary)?
    };
    let dir = launcher.parent()?;
    // Standard npm global/local layout: the shim sits next to `node_modules`.
    let entry = dir
        .join("node_modules")
        .join("zcode-app-cli")
        .join("bin")
        .join("zcode.js");
    entry.is_file().then_some(entry)
}

/// zcode (`zcode-app-cli`) exposes a real-time token stream through the bundled
/// runtime's `app-server` subcommand (`node <pkg>/vendor/zcode.cjs app-server`),
/// a newline-delimited JSON-RPC 2.0 stdio server (`session/create` →
/// `session/subscribe` → `session/send` → `session/event` deltas). The npm
/// launcher (`bin/zcode.js`) would only re-spawn that same runtime with one
/// extra process layer (and its own TUI/config setup), so the protocol agent
/// points `node` straight at the vendor bundle. Returns `None` when the
/// expected npm layout is missing so the caller can fall back to the
/// historical `--prompt --json` one-shot path.
pub fn resolve_zcode_runtime_entry(zcode_binary: &str) -> Option<PathBuf> {
    let launcher = if looks_like_path(zcode_binary) {
        let p = Path::new(zcode_binary);
        p.exists().then(|| p.to_path_buf())?
    } else {
        resolve_command_path(zcode_binary)?
    };
    let dir = launcher.parent()?;
    let entry = dir
        .join("node_modules")
        .join("zcode-app-cli")
        .join("vendor")
        .join("zcode.cjs");
    entry.is_file().then_some(entry)
}

/// kimi-code (`@moonshot-ai/kimi-code`) ships as an npm `.cmd`/shell shim that
/// runs `node <pkg>/dist/main.mjs`. Its headless prompt (`-p/--prompt`) is a
/// single argv value, so launching via `cmd /C kimi.cmd -p "<task>"` caps the
/// whole command line at cmd.exe's ~8191-char limit — the same trap as dsh and
/// zcode. Spawning `dist/main.mjs` directly with `node` bypasses cmd.exe and
/// raises the ceiling to the Windows CreateProcess limit (~32767 chars, ~4x).
/// Returns `None` if the package layout isn't the expected npm shim so the
/// caller can fall back to the historical `cmd /C` path.
pub fn resolve_kimi_node_entry(kimi_binary: &str) -> Option<PathBuf> {
    // Resolve the launcher to a concrete file (bare "kimi" -> full shim path).
    let launcher = if looks_like_path(kimi_binary) {
        let p = Path::new(kimi_binary);
        p.exists().then(|| p.to_path_buf())?
    } else {
        resolve_command_path(kimi_binary)?
    };
    let dir = launcher.parent()?;
    // Standard npm global/local layout: the shim sits next to `node_modules`.
    let entry = dir
        .join("node_modules")
        .join("@moonshot-ai")
        .join("kimi-code")
        .join("dist")
        .join("main.mjs");
    entry.is_file().then_some(entry)
}

#[cfg(windows)]
fn pathext_variants(command: &str) -> Vec<String> {
    let pathext = std::env::var_os("PATHEXT")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter_map(|ext| {
            let ext = ext.trim();
            if ext.is_empty() {
                None
            } else {
                Some(format!("{command}{ext}"))
            }
        })
        .collect()
}

fn search_path(variants: &[String]) -> Option<PathBuf> {
    for dir in common_path_dirs() {
        for variant in variants {
            let candidate = dir.join(variant);
            if candidate.exists() && validate_candidate_path(&candidate).is_ok() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Strip the Windows extended-length (`\\?\`) prefix that `fs::canonicalize`
/// always emits. We never store or spawn that verbatim form: `cmd.exe /C`
/// (used to launch `.cmd`/`.bat` shims like `claude.cmd`) cannot resolve a
/// `\\?\C:\...` path and fails with "系统找不到指定的路径" (exit code 1).
/// Drive-letter paths drop the prefix outright; UNC shares (`\\?\UNC\srv\share`)
/// fold back to `\\srv\share`. Non-Windows paths pass through unchanged.
fn simplify_canonical_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn validate_candidate_path(path: &Path) -> Result<CliPathValidation, String> {
    let canonical = fs::canonicalize(path)
        .map(|c| simplify_canonical_path(&c))
        .map_err(|err| classify_path_error(path, err))?;
    let metadata = fs::metadata(&canonical).map_err(|err| classify_path_error(&canonical, err))?;
    if !metadata.is_file() {
        return Err("NOT_FILE: 请选择普通文件，而不是文件夹或特殊路径。".to_string());
    }

    let platform = platform();
    ensure_supported_cli_path(&canonical, platform)?;

    let file_name = canonical
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_string();

    Ok(CliPathValidation {
        path: path.to_string_lossy().to_string(),
        normalized_path: canonical.to_string_lossy().to_string(),
        platform,
        file_name,
    })
}

fn ensure_supported_cli_path(path: &Path, platform: CliPlatform) -> Result<(), String> {
    if is_disallowed_launcher(path.to_string_lossy().as_ref()) {
        return Err("UNSUPPORTED_CLI_TYPE: 请选择模型 CLI，不要使用 shell 程序。".to_string());
    }

    match platform {
        CliPlatform::Windows => ensure_supported_windows_path(path),
        CliPlatform::Macos | CliPlatform::Linux => ensure_supported_unix_path(path),
    }
}

fn ensure_supported_windows_path(path: &Path) -> Result<(), String> {
    let stem = path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        stem.as_str(),
        "powershell" | "pwsh" | "cmd" | "command" | "wscript" | "cscript"
    ) {
        return Err("UNSUPPORTED_CLI_TYPE: 请选择模型 CLI，不要使用 shell 程序。".to_string());
    }

    match path
        .extension()
        .and_then(OsStr::to_str)
        .map(|ext| ext.to_ascii_lowercase())
    {
        Some(ext) if matches!(ext.as_str(), "exe" | "cmd" | "bat") => Ok(()),
        Some(_) => Err(
            "UNSUPPORTED_CLI_TYPE: Windows 仅支持 .exe、.cmd、.bat 或无扩展的可执行文件。"
                .to_string(),
        ),
        None => {
            let mut file = File::open(path).map_err(|err| classify_path_error(path, err))?;
            let mut magic = [0_u8; 2];
            file.read_exact(&mut magic)
                .map_err(|_| "UNSUPPORTED_CLI_TYPE: 请选择 Windows 可执行文件。".to_string())?;
            if magic == [0x4D, 0x5A] {
                Ok(())
            } else {
                Err("UNSUPPORTED_CLI_TYPE: 请选择 Windows 可执行文件。".to_string())
            }
        }
    }
}

fn ensure_supported_unix_path(path: &Path) -> Result<(), String> {
    let stem = path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        stem.as_str(),
        "sh" | "bash" | "zsh" | "fish" | "dash" | "ksh" | "csh" | "tcsh"
    ) {
        return Err("UNSUPPORTED_CLI_TYPE: 请选择模型 CLI，不要使用 shell 程序。".to_string());
    }

    #[cfg(unix)]
    {
        let mode = fs::metadata(path)
            .map_err(|err| classify_path_error(path, err))?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return Err("NOT_EXECUTABLE: 请先为该文件添加执行权限（chmod +x）。".to_string());
        }
    }

    Ok(())
}

fn is_disallowed_launcher(raw: &str) -> bool {
    let lower = raw.trim().to_ascii_lowercase();
    let stem = Path::new(&lower)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or(&lower)
        .to_ascii_lowercase();
    matches!(
        stem.as_str(),
        "powershell"
            | "pwsh"
            | "cmd"
            | "command"
            | "wscript"
            | "cscript"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "dash"
            | "ksh"
            | "csh"
            | "tcsh"
    )
}

fn looks_like_path(raw: &str) -> bool {
    raw.contains('/') || raw.contains('\\') || Path::new(raw).is_absolute()
}

fn classify_path_error(path: &Path, err: std::io::Error) -> String {
    let prefix = if err.kind() == std::io::ErrorKind::PermissionDenied {
        "PERMISSION_DENIED"
    } else if err.kind() == std::io::ErrorKind::NotFound {
        "INVALID_CLI_PATH"
    } else {
        "INVALID_CLI_PATH"
    };
    format!("{prefix}: 无法访问 {} ({err})", path.to_string_lossy())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disallows_shell_launchers() {
        assert!(is_disallowed_launcher("powershell.exe"));
        assert!(is_disallowed_launcher("/bin/sh"));
        assert!(!is_disallowed_launcher("claude"));
    }

    #[test]
    fn claude_code_drops_non_model_labels() {
        // cc-switch route labels are not safe CLI --model values.
        assert!(!should_pass_model("claude-code", "kimi-for-coding"));
        assert!(!should_pass_model("claude", "glm-4.6"));
        assert!(!should_pass_model("claude-code", "   "));
    }

    #[test]
    fn claude_code_passes_real_models_and_tiers() {
        assert!(should_pass_model("claude-code", "claude-opus-4-8"));
        assert!(should_pass_model("claude-code", "claude-sonnet-4-6"));
        assert!(should_pass_model("claude-code", "sonnet"));
        assert!(should_pass_model("claude-code", "opus"));
        assert!(should_pass_model("claude-code", "haiku"));
    }

    #[test]
    fn codex_gemini_behaviour_unchanged() {
        // Real upstream ids pass.
        assert!(should_pass_model("codex", "gpt-5.5"));
        assert!(should_pass_model("gemini", "gemini-2.5-pro"));
        // Claude tiers / ids are filtered out for codex/gemini.
        assert!(!should_pass_model("codex", "sonnet"));
        assert!(!should_pass_model("gemini", "claude-opus-4-8"));
    }

    #[test]
    fn kimi_passes_kimi_models_but_not_claude_tiers() {
        assert!(should_pass_model("kimi", "kimi-k2-0711-preview"));
        assert!(should_pass_model("kimi", "kimi-k2-thinking"));
        // Claude tiers / ids are filtered out for kimi (they must not leak into
        // a `--model` flag of the kimi CLI).
        assert!(!should_pass_model("kimi", "sonnet"));
        assert!(!should_pass_model("kimi", "claude-opus-4-8"));
        assert!(!should_pass_model("kimi", "   "));
    }

    #[test]
    fn grok_passes_grok_models_but_not_claude_tiers() {
        // Real xAI ids pass through as `--model`.
        assert!(should_pass_model("grok", "grok-4.6"));
        assert!(should_pass_model("grok", "grok-4.5"));
        // Claude tiers / ids are filtered out for grok.
        assert!(!should_pass_model("grok", "sonnet"));
        assert!(!should_pass_model("grok", "claude-opus-4-8"));
        assert!(!should_pass_model("grok", "   "));
    }

    #[test]
    fn deepseek_harness_never_passes_model() {
        // dsh reads its model from `$DSH_HOME/settings.yaml`, never `--model`.
        assert!(!should_pass_model("deepseek-harness", "deepseek-v4-pro"));
        assert!(!should_pass_model("deepseek-harness", "sonnet"));
    }

    #[test]
    fn zcode_never_passes_model() {
        // ZCode resolves its model from `~/.zcode/cli/config.json`, never a
        // `--model` flag (its CLI has no such option).
        assert!(!should_pass_model("zcode", "glm-5.2"));
        assert!(!should_pass_model("zcode", "glm-5.3"));
        assert!(!should_pass_model("zcode", "sonnet"));
        assert!(!should_pass_model("zcode", "   "));
    }

    #[test]
    fn zcode_adapter_mapping() {
        assert_eq!(adapter_binary("zcode"), "zcode");
        assert_eq!(adapter_protocol("zcode"), "zcode");
    }

    #[test]
    fn grok_adapter_mapping() {
        assert_eq!(adapter_binary("grok"), "grok");
        assert_eq!(adapter_protocol("grok"), "grok");
    }

    #[test]
    fn zcode_node_entry_found_next_to_launcher() {
        use std::fs;
        // Lay out an npm-style shim dir: <root>/zcode.cmd next to
        // <root>/node_modules/zcode-app-cli/bin/zcode.js.
        let root = std::env::temp_dir().join(format!("ugs-zcode-entry-{}", std::process::id()));
        let bin = root.join("node_modules").join("zcode-app-cli").join("bin");
        fs::create_dir_all(&bin).unwrap();
        let shim = root.join("zcode.cmd");
        fs::write(&shim, b"@echo off").unwrap();
        let entry = bin.join("zcode.js");
        fs::write(&entry, b"// zcode").unwrap();

        // Given the launcher's full path, the sibling bin/zcode.js is located.
        let got = resolve_zcode_node_entry(&shim.to_string_lossy());
        assert_eq!(got.as_deref(), Some(entry.as_path()));

        // Without the package present, it returns None so the caller falls back
        // to the historical `cmd /C` shim path.
        fs::remove_file(&entry).unwrap();
        assert!(resolve_zcode_node_entry(&shim.to_string_lossy()).is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn dsh_node_entry_found_next_to_launcher() {
        use std::fs;
        // Lay out an npm-style shim dir: <root>/dsh.cmd next to
        // <root>/node_modules/@deepseek-ai/dsh/lib/bin.js.
        let root = std::env::temp_dir().join(format!("ugs-dsh-entry-{}", std::process::id()));
        let lib = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib");
        fs::create_dir_all(&lib).unwrap();
        let shim = root.join("dsh.cmd");
        fs::write(&shim, b"@echo off").unwrap();
        let entry = lib.join("bin.js");
        fs::write(&entry, b"// dsh").unwrap();

        // Given the launcher's full path, the sibling bin.js is located.
        let got = resolve_dsh_node_entry(&shim.to_string_lossy());
        assert_eq!(got.as_deref(), Some(entry.as_path()));

        // Without the package present, it returns None so the caller falls back
        // to the historical `cmd /C` shim path.
        fs::remove_file(&entry).unwrap();
        assert!(resolve_dsh_node_entry(&shim.to_string_lossy()).is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_launch_binary_keeps_concrete_paths() {
        // Path-like inputs are already concrete: never rewrite them.
        assert!(resolve_launch_binary(r"C:\Users\me\dsh.cmd").is_none());
        assert!(resolve_launch_binary("/usr/local/bin/dsh").is_none());
        assert!(resolve_launch_binary("").is_none());
    }

    #[test]
    fn resolve_command_path_finds_existing_absolute_file() {
        use std::fs;
        let file = std::env::temp_dir().join(format!("ugs-resolve-{}.cmd", std::process::id()));
        fs::write(&file, b"@echo off").unwrap();

        // Absolute paths resolve against the live filesystem, regardless of a
        // stale process PATH.
        let got = resolve_command_path(&file.to_string_lossy());
        assert_eq!(got.as_deref(), Some(file.as_path()));

        fs::remove_file(&file).unwrap();
        assert!(resolve_command_path(&file.to_string_lossy()).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn simplify_strips_verbatim_prefix() {
        use std::path::Path;
        // Drive-letter verbatim path drops the prefix entirely so `cmd /C` can
        // resolve a `.cmd` shim instead of failing with "系统找不到指定的路径".
        assert_eq!(
            simplify_canonical_path(Path::new(r"\\?\C:\Users\me\claude.cmd")).to_string_lossy(),
            r"C:\Users\me\claude.cmd"
        );
        // UNC verbatim paths fold back to a plain UNC share.
        assert_eq!(
            simplify_canonical_path(Path::new(r"\\?\UNC\srv\share\claude.cmd")).to_string_lossy(),
            r"\\srv\share\claude.cmd"
        );
        // A path without the prefix is untouched.
        assert_eq!(
            simplify_canonical_path(Path::new(r"C:\bin\claude.cmd")).to_string_lossy(),
            r"C:\bin\claude.cmd"
        );
    }
}
