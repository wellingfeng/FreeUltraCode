/**
 * CONTRACT: user-tunable AutoSave (版本库文件自动备份) configuration.
 *
 * Backs the Rust `autosave` background service that periodically snapshots
 * "files that will be committed" (git tracked M/A/D/R, svn versioned changes,
 * p4 opened files) into `<workspace>/.ultragamestudio/autosave/<timestamp>/`.
 * Persisted disk-backed via generationSettingsStore under
 * `settings/autosave.v1.json` so the Rust side can read the same JSON file at
 * startup without an IPC round trip.
 *
 * `UGS_DISABLE_AUTOSAVE` / `UGS_AUTOSAVE_INTERVAL_MINUTES` /
 * `UGS_AUTOSAVE_RETENTION_DAYS` env vars still take precedence on the Rust side
 * (support/diagnostics override); this config is what the Settings UI edits.
 */

import { readSettingsRaw, writeSettingsRaw } from '@/lib/generationSettingsStore';

const REL_PATH = 'settings/autosave.v1.json';
const LEGACY_KEY = 'ultragamestudio.autosave.v1';

export interface AutosaveConfig {
  /** Run the periodic AutoSave service at all. */
  enabled: boolean;
  /** How often (minutes) to snapshot changed VCS files. */
  intervalMinutes: number;
  /** Snapshots older than this many days are pruned automatically. */
  retentionDays: number;
}

export const DEFAULT_AUTOSAVE_CONFIG: AutosaveConfig = {
  enabled: true,
  intervalMinutes: 5,
  retentionDays: 7,
};

function clampMinutes(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_AUTOSAVE_CONFIG.intervalMinutes;
  return Math.min(1440, Math.max(1, n));
}

function clampDays(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_AUTOSAVE_CONFIG.retentionDays;
  return Math.min(365, Math.max(1, n));
}

function coerce(raw: Partial<AutosaveConfig> | null | undefined): AutosaveConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AUTOSAVE_CONFIG };
  return {
    enabled: raw.enabled ?? DEFAULT_AUTOSAVE_CONFIG.enabled,
    intervalMinutes: clampMinutes(raw.intervalMinutes),
    retentionDays: clampDays(raw.retentionDays),
  };
}

/** Synchronous read; safe to call from a `useState(() => load())` initializer. */
export function loadAutosaveConfig(): AutosaveConfig {
  try {
    const raw = readSettingsRaw(REL_PATH, LEGACY_KEY);
    return coerce(raw ? (JSON.parse(raw) as Partial<AutosaveConfig>) : null);
  } catch {
    return { ...DEFAULT_AUTOSAVE_CONFIG };
  }
}

/** Synchronous write-behind. Merges `patch` onto the current disk value. */
export function saveAutosaveConfig(
  patch: Partial<AutosaveConfig>,
): AutosaveConfig {
  const next = coerce({ ...loadAutosaveConfig(), ...patch });
  writeSettingsRaw(REL_PATH, LEGACY_KEY, JSON.stringify(next));
  return next;
}
