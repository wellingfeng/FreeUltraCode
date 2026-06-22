/**
 * CONTRACT: local preference for the optional *launch shell* that wraps AI CLI
 * invocations.
 *
 * This is distinct from the model-CLI selection (`cliConfig.ts`), which picks
 * WHICH AI CLI binary (claude/codex/gemini) runs. The launch shell picks HOW
 * that binary is spawned: directly (default) or wrapped in a shell so the
 * user's environment / PATH / profile applies (e.g. `/bin/zsh -lc 'exec "$@"'`).
 *
 * Stored only in this device's localStorage. The resolved spec is threaded into
 * each run via the Tauri `ai_cli` / `run_workflow` commands (see `tauri.ts`);
 * the Rust backend reads `kind`/`path` to build the wrapped command.
 */

export type RunShellKind = 'direct' | 'cmd' | 'powershell' | 'custom';

export interface RunShellConfig {
  kind: RunShellKind;
  /** Absolute path to the shell executable (only for `custom`). */
  path?: string;
}

/** Payload shape sent to the backend (`null` = direct, no wrapping). */
export interface RunShellPayload {
  kind: RunShellKind;
  path?: string;
}

export const RUN_SHELL_STORAGE = 'ugs_run_shell_v1';

const DEFAULT_CONFIG: RunShellConfig = { kind: 'direct' };

const hasWindow = (): boolean => typeof window !== 'undefined';

function rawGet(key: string): string | null {
  try {
    if (!hasWindow()) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key: string, value: string): void {
  try {
    if (!hasWindow()) return;
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event('ugs:gateway-config-changed'));
  } catch {
    /* ignore */
  }
}

function normalizeKind(value: unknown): RunShellKind {
  if (
    value === 'cmd' ||
    value === 'powershell' ||
    value === 'custom' ||
    value === 'direct'
  ) {
    return value;
  }
  return 'direct';
}

/** Read the configured launch shell (defaults to `direct`). */
export function getRunShell(): RunShellConfig {
  const stored = rawGet(RUN_SHELL_STORAGE);
  if (!stored) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_CONFIG };
    const raw = parsed as Record<string, unknown>;
    const kind = normalizeKind(raw.kind);
    const path =
      typeof raw.path === 'string' && raw.path.trim() ? raw.path : undefined;
    // A custom shell without a path is meaningless — fall back to direct.
    if (kind === 'custom' && !path) return { ...DEFAULT_CONFIG };
    return { kind, path };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist the launch shell and notify listeners (settings panel / dock). */
export function setRunShell(config: RunShellConfig): void {
  const kind = normalizeKind(config.kind);
  const path =
    kind === 'custom' && config.path?.trim() ? config.path.trim() : undefined;
  rawSet(RUN_SHELL_STORAGE, JSON.stringify({ kind, path }));
}

/**
 * Resolve the backend payload. Returns `null` for `direct` (no wrapping) and
 * for an incomplete `custom` config, so the run path stays unchanged.
 */
export function runShellPayload(): RunShellPayload | null {
  const config = getRunShell();
  if (config.kind === 'direct') return null;
  if (config.kind === 'custom' && !config.path) return null;
  return { kind: config.kind, ...(config.path ? { path: config.path } : {}) };
}
