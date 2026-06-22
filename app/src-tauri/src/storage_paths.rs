use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const GLOBAL_ROOT_ENV: &str = "UGS_HOME";
pub const GLOBAL_ROOT_DIR_NAME: &str = ".ultragamestudio";
pub const PROJECT_ROOT_DIR_NAME: &str = ".ultragamestudio";
pub const GLOBAL_TMP_DIR_NAME: &str = "tmp";

const LEGACY_ROOT_DIR_NAME: &str = ".freeultracode";
const LEGACY_ARCHIVE_DIR_NAME: &str = ".freeultracode_old";
const LEGACY_BRAND_MIGRATION_SENTINEL: &str = "freeultracode-dir-migration-v1.done";
const LEGACY_BRAND_MIGRATION_EMIT_INTERVAL_MS: u128 = 80;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyBrandMigrationProgress {
    pub phase: String,
    pub roots_total: usize,
    pub roots_done: usize,
    pub files_total: usize,
    pub files_done: usize,
    pub dirs_total: usize,
    pub dirs_done: usize,
    pub copied_files: usize,
    pub skipped_files: usize,
    pub archived_roots: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Default for LegacyBrandMigrationProgress {
    fn default() -> Self {
        Self {
            phase: "checking".to_string(),
            roots_total: 0,
            roots_done: 0,
            files_total: 0,
            files_done: 0,
            dirs_total: 0,
            dirs_done: 0,
            copied_files: 0,
            skipped_files: 0,
            archived_roots: 0,
            current_path: None,
            message: None,
        }
    }
}

struct LegacyBrandMigrationReporter<'a> {
    progress: LegacyBrandMigrationProgress,
    on_progress: Option<&'a mut dyn FnMut(LegacyBrandMigrationProgress)>,
    last_emit: Instant,
}

impl<'a> LegacyBrandMigrationReporter<'a> {
    fn new(on_progress: Option<&'a mut dyn FnMut(LegacyBrandMigrationProgress)>) -> Self {
        Self {
            progress: LegacyBrandMigrationProgress::default(),
            on_progress,
            last_emit: Instant::now(),
        }
    }

    fn set_phase(&mut self, phase: &str, message: impl Into<Option<String>>) {
        self.progress.phase = phase.to_string();
        self.progress.message = message.into();
        self.emit(true);
    }

    fn set_current_path(&mut self, path: &Path) {
        self.progress.current_path = Some(path.display().to_string());
    }

    fn emit(&mut self, force: bool) {
        if !force && self.last_emit.elapsed().as_millis() < LEGACY_BRAND_MIGRATION_EMIT_INTERVAL_MS
        {
            return;
        }
        self.last_emit = Instant::now();
        if let Some(on_progress) = self.on_progress.as_deref_mut() {
            on_progress(self.progress.clone());
        }
    }
}

pub fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn ensure_dir(path: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建 {label} 失败: {e}"))
}

fn configured_global_root() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(GLOBAL_ROOT_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    Ok(user_home_dir()
        .ok_or("无法定位用户目录")?
        .join(GLOBAL_ROOT_DIR_NAME))
}

pub fn global_root() -> Result<PathBuf, String> {
    configured_global_root()
}

pub fn ensure_global_root_with_dirs(dirs: &[&str]) -> Result<PathBuf, String> {
    let root = global_root()?;
    ensure_dir(&root, "全局根目录")?;
    for dir in dirs {
        ensure_dir(&root.join(dir), &format!("全局目录 {dir}"))?;
    }
    Ok(root)
}

fn workspace_root(cwd: Option<&str>) -> Option<PathBuf> {
    let cwd = cwd.unwrap_or_default().trim();
    if cwd.is_empty() {
        return None;
    }

    let root = PathBuf::from(cwd);
    root.is_dir().then_some(root)
}

fn sibling_named(path: &Path, name: &str) -> PathBuf {
    path.parent()
        .map(|parent| parent.join(name))
        .unwrap_or_else(|| PathBuf::from(name))
}

fn legacy_archive_root_for(legacy_root: &Path) -> Result<PathBuf, String> {
    let preferred = sibling_named(legacy_root, LEGACY_ARCHIVE_DIR_NAME);
    if !preferred.exists() {
        return Ok(preferred);
    }

    let parent = legacy_root.parent().unwrap_or_else(|| Path::new(""));
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for attempt in 1..1000 {
        let candidate = parent.join(format!("{LEGACY_ARCHIVE_DIR_NAME}-{stamp}-{attempt}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "无法为旧目录生成归档目标: {}",
        legacy_root.display()
    ))
}

fn count_dir_entries(src: &Path, files: &mut usize, dirs: &mut usize) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }

    *dirs += 1;
    let entries =
        fs::read_dir(src).map_err(|e| format!("读取旧目录失败 {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取旧目录项失败 {}: {e}", src.display()))?;
        let source_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败 {}: {e}", source_path.display()))?;

        if file_type.is_dir() {
            count_dir_entries(&source_path, files, dirs)?;
        } else if file_type.is_file() {
            *files += 1;
        }
    }

    Ok(())
}

#[cfg(test)]
fn copy_dir_contents(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }

    ensure_dir(dest, &format!("迁移目标目录 {}", dest.display()))?;

    let entries =
        fs::read_dir(src).map_err(|e| format!("读取旧目录失败 {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取旧目录项失败 {}: {e}", src.display()))?;
        let source_path = entry.path();
        let target_path = dest.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败 {}: {e}", source_path.display()))?;

        if file_type.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if file_type.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                ensure_dir(parent, &format!("迁移目标父目录 {}", parent.display()))?;
            }
            fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "迁移文件失败 {} -> {}: {e}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }

    Ok(())
}

fn copy_dir_contents_with_progress(
    src: &Path,
    dest: &Path,
    reporter: &mut LegacyBrandMigrationReporter<'_>,
) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }

    reporter.progress.dirs_done += 1;
    reporter.set_current_path(src);
    reporter.emit(false);

    ensure_dir(dest, &format!("迁移目标目录 {}", dest.display()))?;

    let entries =
        fs::read_dir(src).map_err(|e| format!("读取旧目录失败 {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取旧目录项失败 {}: {e}", src.display()))?;
        let source_path = entry.path();
        let target_path = dest.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败 {}: {e}", source_path.display()))?;

        if file_type.is_dir() {
            copy_dir_contents_with_progress(&source_path, &target_path, reporter)?;
        } else if file_type.is_file() {
            reporter.set_current_path(&source_path);
            if target_path.exists() {
                reporter.progress.skipped_files += 1;
            } else {
                if let Some(parent) = target_path.parent() {
                    ensure_dir(parent, &format!("迁移目标父目录 {}", parent.display()))?;
                }
                fs::copy(&source_path, &target_path).map_err(|e| {
                    format!(
                        "迁移文件失败 {} -> {}: {e}",
                        source_path.display(),
                        target_path.display()
                    )
                })?;
                reporter.progress.copied_files += 1;
            }
            reporter.progress.files_done += 1;
            reporter.emit(false);
        }
    }

    Ok(())
}

#[cfg(test)]
fn migrate_legacy_root_pair(legacy_root: &Path, new_root: &Path) -> Result<bool, String> {
    if legacy_root == new_root {
        return Ok(false);
    }
    if !legacy_root.is_dir() {
        return Ok(false);
    }

    copy_dir_contents(legacy_root, new_root)?;

    let archive_root = legacy_archive_root_for(legacy_root)?;
    fs::rename(legacy_root, &archive_root).map_err(|e| {
        format!(
            "归档旧目录失败 {} -> {}: {e}",
            legacy_root.display(),
            archive_root.display()
        )
    })?;

    Ok(true)
}

fn migrate_legacy_root_pair_with_progress(
    legacy_root: &Path,
    new_root: &Path,
    reporter: &mut LegacyBrandMigrationReporter<'_>,
) -> Result<bool, String> {
    if legacy_root == new_root {
        return Ok(false);
    }
    if !legacy_root.is_dir() {
        return Ok(false);
    }

    reporter.set_phase("copying", Some(format!("复制 {}", legacy_root.display())));
    copy_dir_contents_with_progress(legacy_root, new_root, reporter)?;

    reporter.set_current_path(legacy_root);
    reporter.set_phase("archiving", Some(format!("归档 {}", legacy_root.display())));
    let archive_root = legacy_archive_root_for(legacy_root)?;
    fs::rename(legacy_root, &archive_root).map_err(|e| {
        format!(
            "归档旧目录失败 {} -> {}: {e}",
            legacy_root.display(),
            archive_root.display()
        )
    })?;

    reporter.progress.archived_roots += 1;
    reporter.progress.roots_done += 1;
    reporter.set_current_path(&archive_root);
    reporter.emit(true);

    Ok(true)
}

fn workspace_paths_from_index(global_root: &Path) -> Vec<PathBuf> {
    let index_path = global_root.join("workspaces").join("index.json");
    let Ok(text) = fs::read_to_string(index_path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let Some(workspaces) = value.as_array() else {
        return Vec::new();
    };

    workspaces
        .iter()
        .filter_map(|workspace| workspace.get("path").and_then(|path| path.as_str()))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .collect()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn push_unique_root_pair(
    pairs: &mut Vec<(PathBuf, PathBuf)>,
    legacy_root: PathBuf,
    new_root: PathBuf,
) {
    if legacy_root == new_root || !legacy_root.is_dir() {
        return;
    }
    if !pairs.iter().any(|(existing_legacy, existing_new)| {
        existing_legacy == &legacy_root && existing_new == &new_root
    }) {
        pairs.push((legacy_root, new_root));
    }
}

fn migration_sentinel_path(global_root: &Path) -> PathBuf {
    global_root
        .join("migrations")
        .join(LEGACY_BRAND_MIGRATION_SENTINEL)
}

fn write_migration_sentinel(global_root: &Path) -> Result<(), String> {
    let migrations_dir = global_root.join("migrations");
    ensure_dir(&migrations_dir, "迁移标记目录")?;
    let sentinel = migration_sentinel_path(global_root);
    let mut file = fs::File::create(&sentinel)
        .map_err(|e| format!("写入迁移标记失败 {}: {e}", sentinel.display()))?;
    file.write_all(b"1\n")
        .map_err(|e| format!("写入迁移标记失败 {}: {e}", sentinel.display()))
}

fn legacy_brand_migration_pairs(
    global_root: &Path,
    legacy_global_root: &Path,
) -> Vec<(PathBuf, PathBuf)> {
    let mut workspace_roots = Vec::new();
    for path in workspace_paths_from_index(global_root) {
        push_unique_path(&mut workspace_roots, path);
    }
    for path in workspace_paths_from_index(legacy_global_root) {
        push_unique_path(&mut workspace_roots, path);
    }

    let mut pairs = Vec::new();
    push_unique_root_pair(
        &mut pairs,
        legacy_global_root.to_path_buf(),
        global_root.to_path_buf(),
    );

    for workspace_root in workspace_roots {
        let legacy_project_root = workspace_root.join(LEGACY_ROOT_DIR_NAME);
        let new_project_root = workspace_root.join(PROJECT_ROOT_DIR_NAME);
        push_unique_root_pair(&mut pairs, legacy_project_root, new_project_root);
    }

    pairs
}

fn migrate_legacy_brand_storage_at_with_progress(
    global_root: &Path,
    legacy_global_root: &Path,
    on_progress: Option<&mut dyn FnMut(LegacyBrandMigrationProgress)>,
) -> Result<LegacyBrandMigrationProgress, String> {
    let mut reporter = LegacyBrandMigrationReporter::new(on_progress);
    reporter.set_phase("checking", Some("检查旧版配置目录".to_string()));

    if migration_sentinel_path(global_root).exists() {
        reporter.set_phase("skipped", Some("旧版配置迁移已完成".to_string()));
        return Ok(reporter.progress.clone());
    }

    let pairs = legacy_brand_migration_pairs(global_root, legacy_global_root);
    reporter.progress.roots_total = pairs.len();
    reporter.set_phase("scanning", Some("扫描旧版配置文件".to_string()));

    let mut files_total = 0;
    let mut dirs_total = 0;
    for (legacy_root, _) in &pairs {
        reporter.set_current_path(legacy_root);
        reporter.emit(true);
        count_dir_entries(legacy_root, &mut files_total, &mut dirs_total)?;
    }

    reporter.progress.files_total = files_total;
    reporter.progress.dirs_total = dirs_total;

    for (legacy_root, new_root) in pairs {
        migrate_legacy_root_pair_with_progress(&legacy_root, &new_root, &mut reporter)?;
    }

    write_migration_sentinel(global_root)?;
    reporter.progress.current_path = None;
    reporter.set_phase("done", Some("旧版配置迁移完成".to_string()));
    Ok(reporter.progress.clone())
}

#[cfg(test)]
fn migrate_legacy_brand_storage_at(
    global_root: &Path,
    legacy_global_root: &Path,
) -> Result<(), String> {
    migrate_legacy_brand_storage_at_with_progress(global_root, legacy_global_root, None).map(|_| ())
}

pub fn migrate_legacy_brand_storage_on_startup_with_progress<F>(
    mut on_progress: F,
) -> Result<LegacyBrandMigrationProgress, String>
where
    F: FnMut(LegacyBrandMigrationProgress),
{
    let global_root = configured_global_root()?;
    let legacy_global_root = sibling_named(&global_root, LEGACY_ROOT_DIR_NAME);
    migrate_legacy_brand_storage_at_with_progress(
        &global_root,
        &legacy_global_root,
        Some(&mut on_progress),
    )
}

pub fn project_artifact_dir(cwd: Option<&str>, name: &str) -> Option<PathBuf> {
    workspace_root(cwd).map(|root| root.join(PROJECT_ROOT_DIR_NAME).join(name))
}

pub fn global_tmp_artifact_dir(name: &str) -> Result<PathBuf, String> {
    let root = ensure_global_root_with_dirs(&[GLOBAL_TMP_DIR_NAME])?;
    let dir = root.join(GLOBAL_TMP_DIR_NAME).join(name);
    ensure_dir(&dir, &format!("全局临时目录 {name}"))?;
    Ok(dir)
}

pub fn managed_artifact_dir(cwd: Option<&str>, name: &str) -> PathBuf {
    let dir = project_artifact_dir(cwd, name)
        .or_else(|| global_tmp_artifact_dir(name).ok())
        .unwrap_or_else(|| std::env::temp_dir().join("ultragamestudio").join(name));
    let _ = fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_artifact_dir_uses_ultragamestudio_under_workspace() {
        let root = std::env::temp_dir().join(format!(
            "ultragamestudio-storage-paths-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();

        let dir = project_artifact_dir(root.to_str(), "previews").unwrap();
        assert_eq!(dir, root.join(PROJECT_ROOT_DIR_NAME).join("previews"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_artifact_dir_ignores_missing_workspace() {
        let missing = std::env::temp_dir().join(format!(
            "ultragamestudio-storage-missing-{}",
            std::process::id()
        ));

        assert!(project_artifact_dir(missing.to_str(), "previews").is_none());
    }

    #[test]
    fn startup_migration_moves_legacy_global_and_project_roots_once() {
        let root = std::env::temp_dir().join(format!(
            "ultragamestudio-legacy-migration-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let global_root = root.join(GLOBAL_ROOT_DIR_NAME);
        let legacy_global_root = root.join(LEGACY_ROOT_DIR_NAME);
        let workspace_root = root.join("workspace");
        let legacy_project_root = workspace_root.join(LEGACY_ROOT_DIR_NAME);

        fs::create_dir_all(legacy_global_root.join("settings")).unwrap();
        fs::write(legacy_global_root.join("settings").join("prefs.json"), "{}").unwrap();
        fs::create_dir_all(legacy_global_root.join("workspaces")).unwrap();
        fs::write(
            legacy_global_root.join("workspaces").join("index.json"),
            format!(
                r#"[{{"id":"main","path":"{}"}}]"#,
                workspace_root.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        fs::create_dir_all(legacy_project_root.join("assets")).unwrap();
        fs::write(legacy_project_root.join("assets").join("asset.txt"), "old").unwrap();

        migrate_legacy_brand_storage_at(&global_root, &legacy_global_root).unwrap();

        assert!(global_root.join("settings").join("prefs.json").is_file());
        assert!(root.join(LEGACY_ARCHIVE_DIR_NAME).is_dir());
        assert!(!legacy_global_root.exists());
        assert!(workspace_root
            .join(PROJECT_ROOT_DIR_NAME)
            .join("assets")
            .join("asset.txt")
            .is_file());
        assert!(workspace_root.join(LEGACY_ARCHIVE_DIR_NAME).is_dir());
        assert!(!legacy_project_root.exists());

        fs::create_dir_all(&legacy_global_root).unwrap();
        fs::write(legacy_global_root.join("after-sentinel.txt"), "skip").unwrap();
        migrate_legacy_brand_storage_at(&global_root, &legacy_global_root).unwrap();

        assert!(legacy_global_root.join("after-sentinel.txt").is_file());
        assert!(!global_root.join("after-sentinel.txt").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_preserves_existing_new_files_and_copies_missing_files() {
        let root = std::env::temp_dir().join(format!(
            "ultragamestudio-legacy-merge-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let legacy_root = root.join(LEGACY_ROOT_DIR_NAME);
        let new_root = root.join(GLOBAL_ROOT_DIR_NAME);

        fs::create_dir_all(&legacy_root).unwrap();
        fs::create_dir_all(&new_root).unwrap();
        fs::write(legacy_root.join("config.json"), r#"{"value":"old"}"#).unwrap();
        fs::write(new_root.join("config.json"), r#"{"value":"new"}"#).unwrap();
        fs::write(legacy_root.join("missing.json"), r#"{"value":"old"}"#).unwrap();

        assert!(migrate_legacy_root_pair(&legacy_root, &new_root).unwrap());

        assert_eq!(
            fs::read_to_string(new_root.join("config.json")).unwrap(),
            r#"{"value":"new"}"#
        );
        assert_eq!(
            fs::read_to_string(new_root.join("missing.json")).unwrap(),
            r#"{"value":"old"}"#
        );
        assert!(root.join(LEGACY_ARCHIVE_DIR_NAME).is_dir());
        assert!(!legacy_root.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_uses_unique_archive_when_old_archive_exists() {
        let root = std::env::temp_dir().join(format!(
            "ultragamestudio-legacy-archive-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let legacy_root = root.join(LEGACY_ROOT_DIR_NAME);
        let new_root = root.join(GLOBAL_ROOT_DIR_NAME);
        let existing_archive = root.join(LEGACY_ARCHIVE_DIR_NAME);

        fs::create_dir_all(&legacy_root).unwrap();
        fs::create_dir_all(&existing_archive).unwrap();
        fs::write(legacy_root.join("config.json"), "{}").unwrap();

        assert!(migrate_legacy_root_pair(&legacy_root, &new_root).unwrap());

        assert!(existing_archive.is_dir());
        assert!(!legacy_root.exists());
        assert!(new_root.join("config.json").is_file());
        let archived_dirs = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&format!("{LEGACY_ARCHIVE_DIR_NAME}-"))
            })
            .count();
        assert_eq!(archived_dirs, 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_skips_when_legacy_and_new_roots_match() {
        let root = std::env::temp_dir().join(format!(
            "ultragamestudio-legacy-same-root-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("config.json"), "{}").unwrap();

        assert!(!migrate_legacy_root_pair(&root, &root).unwrap());
        assert!(root.join("config.json").is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn startup_migration_reports_progress_counts() {
        let root = std::env::temp_dir().join(format!(
            "ultragamestudio-legacy-progress-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let global_root = root.join(GLOBAL_ROOT_DIR_NAME);
        let legacy_global_root = root.join(LEGACY_ROOT_DIR_NAME);

        fs::create_dir_all(legacy_global_root.join("settings")).unwrap();
        fs::write(legacy_global_root.join("settings").join("prefs.json"), "{}").unwrap();
        fs::write(
            legacy_global_root.join("settings").join("channels.json"),
            "{}",
        )
        .unwrap();

        let mut events = Vec::new();
        let final_progress = migrate_legacy_brand_storage_at_with_progress(
            &global_root,
            &legacy_global_root,
            Some(&mut |progress| events.push(progress)),
        )
        .unwrap();

        assert_eq!(final_progress.phase, "done");
        assert_eq!(final_progress.roots_total, 1);
        assert_eq!(final_progress.roots_done, 1);
        assert_eq!(final_progress.files_total, 2);
        assert_eq!(final_progress.files_done, 2);
        assert_eq!(final_progress.copied_files, 2);
        assert_eq!(final_progress.archived_roots, 1);
        assert!(events.iter().any(|event| event.phase == "scanning"));
        assert!(events.iter().any(|event| event.phase == "copying"));
        assert!(events.iter().any(|event| event.phase == "done"));

        let _ = fs::remove_dir_all(root);
    }
}
