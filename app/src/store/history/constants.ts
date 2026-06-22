/** Display fallback for the UltraGameStudio history root; Tauri resolves the real path. */
export const HISTORY_ROOT_DIR = '~/.ultragamestudio';

/** Alias used by code that talks about the physical global history root. */
export const WORKTREE_ROOT_DIR = HISTORY_ROOT_DIR;

/** Top-level schema version. Bump on a breaking on-disk change + migration. */
export const HISTORY_SCHEMA_VERSION = 1;

/** Canonical workspace bucket for unbound, imported, or unresolved history. */
export const DEFAULT_WORKSPACE_ID = '__default__';

/** Legacy id for the old "no workspace selected" bucket. */
export const UNASSIGNED_WORKSPACE_ID = '__unassigned__';

export const DEFAULT_WORKSPACE_NAME = '默认工作区';
export const UNASSIGNED_WORKSPACE_NAME = '未指定工作区';

export const WORKSPACE_ID_MAX_LENGTH = 80;
export const SESSION_ID_MAX_LENGTH = 120;
export const WORKSPACE_ID_PATTERN = /^(?:__default__|[a-z0-9][a-z0-9_-]{0,79})$/u;
export const LEGACY_WORKSPACE_ID_PATTERN = /^(?:__unassigned__|[a-f0-9]{16})$/u;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
export const LEGACY_SESSION_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|ses_[A-Za-z0-9_-]+|mig_[a-f0-9]{16}(?:_[a-f0-9]+)?)$/iu;

export const SESSION_ID_PREFIX = 'ses_';
export const MIGRATION_SESSION_ID_PREFIX = 'mig_';

export const ROOT_CONFIG_FILE = 'config.json';
export const ROOT_INDEX_FILE = 'index.json';
export const WORKSPACE_FILE = 'workspace.json';
export const SESSIONS_INDEX_FILE = 'index.json';

export const SESSIONS_DIR_NAME = 'sessions';
export const DELETED_DIR_NAME = 'deleted';
export const MIGRATIONS_DIR_NAME = 'migrations';
export const BACKUPS_DIR_NAME = 'backups';
export const QUARANTINE_DIR_NAME = 'quarantine';

/** Timestamp-safe filename format emitted by formatHistoryTimestamp(). */
export const HISTORY_TIMESTAMP_FORMAT = 'yyyyMMddTHHmmssSSSZ';

export const HISTORY_ERROR_CODES = [
  'NOT_INITIALIZED',
  'NOT_FOUND',
  'INVALID_INPUT',
  'INVALID_ID',
  'SCHEMA_MISMATCH',
  'CORRUPT_DATA',
  'IO_ERROR',
  'PERMISSION_DENIED',
  'CONFLICT',
  'MIGRATION_FAILED',
] as const;

// Compatibility aliases for the previous runtime layout.
export const WORKSPACE_DIR_PREFIX = 'ws_';
export const WORKSPACES_INDEX_FILE = ROOT_INDEX_FILE;
export const LEGACY_WORKSPACES_INDEX_FILE = 'workspaces.index.json';
export const LEGACY_SESSIONS_INDEX_FILE = 'sessions.index.json';
export const TRASH_DIR_NAME = DELETED_DIR_NAME;
export const TMP_DIR_NAME = 'tmp';
export const LEGACY_TMP_DIR_NAME = '_tmp';
export const ROOT_BACKUPS_DIR_NAME = 'root';
export const MIGRATION_BACKUPS_DIR_NAME = MIGRATIONS_DIR_NAME;
