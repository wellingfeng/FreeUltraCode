/**
 * CONTRACT: user-tunable startup cache retention configuration.
 *
 * Backs the Rust `cache_cleanup` background sweep (trash/backups/quarantine/tmp,
 * per-project `.ultragamestudio` caches, and stale unfavorited session files)
 * that runs a short delay after launch. Persisted disk-backed via
 * generationSettingsStore under `settings/cacheCleanup.v1.json` so the Rust
 * side can read the same JSON file at startup without an IPC round trip.
 *
 * `UGS_CACHE_RETENTION_DAYS` / `UGS_DISABLE_STARTUP_CACHE_CLEANUP` env vars
 * still take precedence on the Rust side (support/diagnostics override); this
 * config is what the Settings UI edits.
 */

import { readSettingsRaw, writeSettingsRaw } from '@/lib/generationSettingsStore';

const REL_PATH = 'settings/cacheCleanup.v1.json';
const LEGACY_KEY = 'ultragamestudio.cacheCleanup.v1';

export interface CacheCleanupConfig {
  /** Run the startup retention sweep at all. */
  enabled: boolean;
  /** Cache files and unfavorited sessions untouched for this many days are deleted. */
  retentionDays: number;
}

export const DEFAULT_CACHE_CLEANUP_CONFIG: CacheCleanupConfig = {
  enabled: true,
  retentionDays: 30,
};

function clampDays(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_CACHE_CLEANUP_CONFIG.retentionDays;
  return Math.min(365, Math.max(1, n));
}

function coerce(raw: Partial<CacheCleanupConfig> | null | undefined): CacheCleanupConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CACHE_CLEANUP_CONFIG };
  return {
    enabled: raw.enabled ?? DEFAULT_CACHE_CLEANUP_CONFIG.enabled,
    retentionDays: clampDays(raw.retentionDays),
  };
}

/** Synchronous read; safe to call from a `useState(() => load())` initializer. */
export function loadCacheCleanupConfig(): CacheCleanupConfig {
  try {
    const raw = readSettingsRaw(REL_PATH, LEGACY_KEY);
    return coerce(raw ? (JSON.parse(raw) as Partial<CacheCleanupConfig>) : null);
  } catch {
    return { ...DEFAULT_CACHE_CLEANUP_CONFIG };
  }
}

/** Synchronous write-behind. Merges `patch` onto the current disk value. */
export function saveCacheCleanupConfig(
  patch: Partial<CacheCleanupConfig>,
): CacheCleanupConfig {
  const next = coerce({ ...loadCacheCleanupConfig(), ...patch });
  writeSettingsRaw(REL_PATH, LEGACY_KEY, JSON.stringify(next));
  return next;
}
