import { checkCliUpdates, isTauri, type CliVersionStatus } from '@/lib/tauri';

export type CliUpdateStatusPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface CliUpdateSnapshot {
  status: CliUpdateStatusPhase;
  statuses: CliVersionStatus[];
  checkedAtMs?: number;
  /** True when at least one CLI has an update the user has not yet seen. */
  hasUnseenUpdate: boolean;
  error?: string;
}

const DISMISSED_STORAGE_KEY = 'ugs_cli_update_dismissed_v1';

let snapshot: CliUpdateSnapshot = {
  status: 'idle',
  statuses: [],
  hasUnseenUpdate: false,
};
let runningPromise: Promise<CliUpdateSnapshot> | null = null;
const listeners = new Set<(next: CliUpdateSnapshot) => void>();

export function getCliUpdateSnapshot(): CliUpdateSnapshot {
  return snapshot;
}

export function subscribeCliUpdateStatus(
  listener: (next: CliUpdateSnapshot) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ensures a version check has run at least once (idempotent). Safe to call
 * from multiple mount points (sidebar, settings modal) without triggering
 * duplicate network requests -- the Rust side also applies a 12h TTL cache.
 */
export function primeCliUpdateStatus(): Promise<CliUpdateSnapshot> {
  if (runningPromise) return runningPromise;
  if (snapshot.status === 'ready' || snapshot.status === 'error') {
    return Promise.resolve(snapshot);
  }
  runningPromise = runCheck().finally(() => {
    runningPromise = null;
  });
  return runningPromise;
}

/** Forces a fresh check, bypassing the "already ready" short-circuit. */
export function refreshCliUpdateStatus(): Promise<CliUpdateSnapshot> {
  if (runningPromise) return runningPromise;
  runningPromise = runCheck().finally(() => {
    runningPromise = null;
  });
  return runningPromise;
}

/**
 * Marks the currently known update(s) as seen so the red-dot badge clears,
 * similar to how a game UI dismisses a red dot once the player opens the
 * relevant panel. The badge reappears automatically if a newer version is
 * later detected (a different `latestVersion` than the one dismissed).
 */
export function markCliUpdatesSeen(
  statuses: CliVersionStatus[] = snapshot.statuses,
): void {
  if (statuses.length === 0) return;
  const dismissed = loadDismissed();
  let changed = false;
  for (const status of statuses) {
    if (status.updateAvailable && status.latestVersion) {
      if (dismissed[status.adapter] !== status.latestVersion) {
        dismissed[status.adapter] = status.latestVersion;
        changed = true;
      }
    }
  }
  if (changed) saveDismissed(dismissed);
  const hasUnseenUpdate = computeHasUnseenUpdate(snapshot.statuses);
  if (hasUnseenUpdate !== snapshot.hasUnseenUpdate) {
    snapshot = { ...snapshot, hasUnseenUpdate };
    emit();
  }
}

async function runCheck(): Promise<CliUpdateSnapshot> {
  snapshot = { ...snapshot, status: 'loading', error: undefined };
  emit();

  if (!isTauri()) {
    snapshot = {
      status: 'ready',
      statuses: [],
      checkedAtMs: Date.now(),
      hasUnseenUpdate: false,
    };
    emit();
    return snapshot;
  }

  try {
    const statuses = await checkCliUpdates();
    snapshot = {
      status: 'ready',
      statuses,
      checkedAtMs: Date.now(),
      hasUnseenUpdate: computeHasUnseenUpdate(statuses),
    };
  } catch (err) {
    snapshot = { ...snapshot, status: 'error', error: errorMessage(err) };
  }
  emit();
  return snapshot;
}

function computeHasUnseenUpdate(statuses: CliVersionStatus[]): boolean {
  if (statuses.length === 0) return false;
  const dismissed = loadDismissed();
  return statuses.some(
    (status) =>
      status.updateAvailable &&
      !!status.latestVersion &&
      dismissed[status.adapter] !== status.latestVersion,
  );
}

function loadDismissed(): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function saveDismissed(value: Record<string, string>): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best-effort persistence only; a missed write just means the badge
    // may reappear on next launch, which is an acceptable degradation.
  }
}

function emit(): void {
  for (const listener of listeners) listener(snapshot);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
