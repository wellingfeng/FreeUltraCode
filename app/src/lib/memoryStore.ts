/**
 * CONTRACT: persistent curated memory for the simple-chat assistant.
 *
 * Two bounded, file-backed stores that survive across sessions:
 *   - MEMORY ('memory'): the assistant's own notes — environment facts,
 *     project conventions, detected engine, tool quirks, lessons learned.
 *   - USER   ('user'):   who the user is — name, role, preferences, style.
 *
 * Storage: JSON under `.ultragamestudio/memories/{memory,user}.json` via the
 * existing `history_*` Tauri commands (atomic write + backup + quarantine).
 * In the browser the same payload is mirrored to localStorage so a no-backend
 * build still persists across reloads. Mirrors store/history/store.ts.
 *
 * Frozen-snapshot pattern (IMPORTANT — do not "fix" this):
 *   `renderMemorySnapshot()` is read ONCE at session start and concatenated
 *   into the chat system prompt. Mid-session writes update the JSON on disk
 *   immediately (durable) but DO NOT change the live system prompt. This keeps
 *   the native-CLI prefix cache stable for the whole session; the snapshot
 *   refreshes on the next session start. Changing this to re-inject mid-session
 *   silently destroys prefix-cache reuse on the claude-code path.
 *
 *   `renderFrozenMemorySnapshot(workspaceId, freezeKey)` enforces that contract
 *   mechanically: it caches the rendered block keyed by `freezeKey` (the chat
 *   session id), so the caller physically cannot re-read disk mid-session.
 *   Callers that run argv-capped adapters (dsh / zcode) instead use
 *   `renderMemorySnapshotCompact()` to inject a hard-bounded snapshot that fits
 *   the command-line budget instead of dropping memory entirely.
 *
 * Limits are CHARACTER counts (not tokens) because char counts are
 * model-independent and stable. An `add` that would overflow is rejected with
 * the current entries echoed back, so the caller can remove/replace stale
 * entries to free room. A `batch` applies atomically and the limit is checked
 * only on the FINAL result, so one call can free room AND add together.
 * With `evictOnOverflow` the batch may instead drop the oldest (never the
 * entries touched by THIS batch) entries to stay under the limit, reporting
 * what was evicted.
 */

import { tauriAvailable } from './tauri';

export type MemoryTarget = 'memory' | 'user';

export interface MemoryLimits {
  memory: number;
  user: number;
}

/** Defaults mirror Hermes' bounded stores; tune via setMemoryLimits(). */
export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
  memory: 2200,
  user: 1375,
};

let limits: MemoryLimits = { ...DEFAULT_MEMORY_LIMITS };

export function setMemoryLimits(next: Partial<MemoryLimits>): void {
  limits = {
    memory: Math.max(1, Math.floor(next.memory ?? limits.memory)),
    user: Math.max(1, Math.floor(next.user ?? limits.user)),
  };
}

export function getMemoryLimits(): MemoryLimits {
  return { ...limits };
}

/**
 * Usage-percentage threshold above which the rendered snapshot appends an
 * active "consolidate before writing" nudge. Synced from MemoryConfig (see
 * memoryConfig.ts) the same way the char limits are.
 */
let nudgeThresholdPct = 85;

export function setMemoryNudgeThresholdPct(pct: number): void {
  nudgeThresholdPct = Math.min(100, Math.max(0, Math.floor(pct)));
}

export function getMemoryNudgeThresholdPct(): number {
  return nudgeThresholdPct;
}

/**
 * One stored entry. `updatedAt` is epoch-ms of the last add/replace; `undefined`
 * for entries migrated from the legacy string[] shape (timestamp unknown).
 */
export interface MemoryEntry {
  text: string;
  updatedAt?: number;
}

/**
 * On-disk shape. v2 stores structured entries; v1 (legacy) stored plain strings.
 * Both are accepted on read; writes always emit v2.
 */
interface MemoryFile {
  version: 1 | 2;
  entries: (string | MemoryEntry)[];
}

/**
 * The shape produced by `readFile`: legacy string entries have already been
 * converted to structured `MemoryEntry`s, so consumers only ever see v2 shape.
 */
interface NormalizedMemoryFile {
  version: 2;
  entries: MemoryEntry[];
}

const FALLBACK_PREFIX = 'ultragamestudio.memory.v1:';

/**
 * Resolve the on-disk relative path for a target.
 *
 * `user` is GLOBAL — who the user is (name, style) carries across every
 * project. `memory` is per-WORKSPACE when a workspaceId is given, because the
 * assistant's project notes (detected engine, asset-dir conventions, toolchain
 * quirks) must NOT leak between game projects — a "引擎=Unity" note from one
 * project would otherwise poison another. With no workspaceId, memory falls
 * back to the shared global file (CLI / no-project sessions).
 */
function relPathFor(target: MemoryTarget, workspaceId?: string): string {
  if (target === 'user') return 'memories/user.json';
  const ws = (workspaceId ?? '').trim();
  if (!ws) return 'memories/memory.json';
  // Flatten the id into a filesystem-safe leaf; the history backend rejects
  // path traversal, but keep it tidy regardless.
  const safe = ws.replace(/[^A-Za-z0-9._-]/g, '_');
  return `memories/workspaces/${safe}/memory.json`;
}

// --- single-op / batch operation shapes --------------------------------------

export interface MemoryOp {
  action: 'add' | 'replace' | 'remove';
  content?: string;
  /** A short unique substring identifying the entry for replace/remove. */
  oldText?: string;
}

export interface MemoryResult {
  success: boolean;
  target: MemoryTarget;
  /** Live entries after the operation (or the current entries on failure). */
  entries: MemoryEntry[];
  used: number;
  limit: number;
  error?: string;
  /** Entry texts evicted to make room, only when `evictOnOverflow` ran. */
  evicted?: string[];
}

/** Optional policy knobs for a batch (see `applyMemoryBatch`). */
export interface MemoryBatchOptions {
  /**
   * When the final result overflows the char limit, drop the OLDEST entries
   * (entries touched by THIS batch are never evicted) until it fits, instead of
   * rejecting. Off by default so no data is lost without an explicit opt-in.
   */
  evictOnOverflow?: boolean;
}

// --- low-level IO (mirrors store/history/store.ts) ---------------------------

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

async function readFile(target: MemoryTarget, workspaceId?: string): Promise<NormalizedMemoryFile> {
  const relPath = relPathFor(target, workspaceId);
  let raw: string | null = null;
  try {
    if (tauriAvailable()) {
      const invoke = await getInvoke();
      raw = await invoke<string | null>('history_read_json', { relPath });
    } else if (hasLocalStorage()) {
      raw = window.localStorage.getItem(FALLBACK_PREFIX + relPath);
    }
  } catch {
    raw = null;
  }
  if (!raw) return { version: 2, entries: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryFile>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((e): MemoryEntry | null => {
            if (typeof e === 'string') {
              const text = e.trim();
              return text ? { text } : null;
            }
            if (e && typeof e === 'object' && typeof e.text === 'string') {
              const text = e.text.trim();
              if (!text) return null;
              const updatedAt =
                typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt)
                  ? e.updatedAt
                  : undefined;
              return updatedAt !== undefined ? { text, updatedAt } : { text };
            }
            return null;
          })
          .filter((e): e is MemoryEntry => e !== null)
      : [];
    return { version: 2, entries };
  } catch {
    return { version: 2, entries: [] };
  }
}

async function writeFile(
  target: MemoryTarget,
  file: NormalizedMemoryFile,
  workspaceId?: string,
): Promise<void> {
  const relPath = relPathFor(target, workspaceId);
  const json = JSON.stringify(file, null, 2);
  if (tauriAvailable()) {
    const invoke = await getInvoke();
    await invoke<void>('history_write_json', { relPath, json });
    return;
  }
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(FALLBACK_PREFIX + relPath, json);
    } catch {
      /* non-fatal */
    }
  }
}

// --- helpers -----------------------------------------------------------------

function charCount(entries: MemoryEntry[]): number {
  // Joined length approximates the rendered block size; the delimiter is a
  // single separator char so this stays close to the on-screen footprint.
  return entries.map((e) => e.text).join('\n').length;
}

function limitFor(target: MemoryTarget): number {
  return target === 'user' ? limits.user : limits.memory;
}

function result(
  target: MemoryTarget,
  entries: MemoryEntry[],
  ok: boolean,
  error?: string,
): MemoryResult {
  return {
    success: ok,
    target,
    entries,
    used: charCount(entries),
    limit: limitFor(target),
    ...(error ? { error } : {}),
  };
}

/** Apply one op to a working copy. Throws Error(message) on a bad targeted op. */
function applyOp(entries: MemoryEntry[], op: MemoryOp, now: number): MemoryEntry[] {
  if (op.action === 'add') {
    const text = (op.content ?? '').trim();
    if (!text) throw new Error("'add' needs non-empty content.");
    return [...entries, { text, updatedAt: now }];
  }
  const needle = (op.oldText ?? '').trim();
  if (!needle) {
    throw new Error(
      `'${op.action}' needs oldText — a short unique substring of the entry to ${op.action}.`,
    );
  }
  const matches = entries.filter((e) => e.text.includes(needle));
  if (matches.length === 0) {
    throw new Error(`No entry matches "${needle}".`);
  }
  if (matches.length > 1) {
    throw new Error(`"${needle}" matches ${matches.length} entries — use a more specific substring.`);
  }
  if (op.action === 'remove') {
    return entries.filter((e) => !e.text.includes(needle));
  }
  // replace
  const text = (op.content ?? '').trim();
  if (!text) throw new Error("'replace' needs non-empty content.");
  return entries.map((e) => (e.text.includes(needle) ? { text, updatedAt: now } : e));
}

/**
 * Drop the OLDEST entries until the store fits `limit`. Entries whose
 * `updatedAt === now` were touched by the current batch and are pinned — they
 * are never evicted (we never silently discard what the caller just wrote).
 * Returns the kept list plus the evicted entries in eviction order.
 */
function evictOldest(
  entries: MemoryEntry[],
  limit: number,
  now: number,
): { kept: MemoryEntry[]; evicted: MemoryEntry[] } {
  // Legacy entries have `updatedAt === undefined` and count as the oldest.
  const evictable = entries
    .filter((e) => e.updatedAt !== now)
    .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  const evicted: MemoryEntry[] = [];
  let kept = entries;
  for (const entry of evictable) {
    if (charCount(kept) <= limit) break;
    kept = kept.filter((k) => k !== entry);
    evicted.push(entry);
  }
  return { kept, evicted };
}

// --- public API --------------------------------------------------------------

/**
 * Load all entries for a target (used by UI/inspection and tests).
 * `workspaceId` scopes the `memory` store; ignored for `user` (always global).
 */
export async function loadMemory(
  target: MemoryTarget,
  workspaceId?: string,
): Promise<MemoryEntry[]> {
  const file = await readFile(target, workspaceId);
  return file.entries;
}

/**
 * Load entries as plain text (legacy shape). Convenience for snapshot rendering
 * and any consumer that doesn't care about timestamps.
 */
export async function loadMemoryTexts(
  target: MemoryTarget,
  workspaceId?: string,
): Promise<string[]> {
  const entries = await loadMemory(target, workspaceId);
  return entries.map((e) => e.text);
}

/**
 * Backfill `updatedAt` for entries migrated from the v1 string[] shape, which
 * never stored a timestamp and render as "更新于 —". Assigns one shared `now`
 * so they get a concrete baseline time, then persists back as v2. No-op when
 * every entry already has a numeric timestamp (no write). Returns the entries.
 *
 * Called explicitly from the Memory settings panel (on load and after any op /
 * refresh); kept out of `loadMemory` because that is a pure read used on the
 * snapshot hot path and must not write.
 */
export async function backfillMemoryTimestamps(
  target: MemoryTarget,
  workspaceId?: string,
): Promise<MemoryEntry[]> {
  const file = await readFile(target, workspaceId);
  const hasLegacy = file.entries.some((e) => typeof e.updatedAt !== 'number');
  if (!hasLegacy) return file.entries;
  const now = Date.now();
  const entries = file.entries.map((e) =>
    typeof e.updatedAt === 'number' ? e : { text: e.text, updatedAt: now },
  );
  await writeFile(target, { version: 2, entries }, workspaceId);
  return entries;
}

/**
 * Apply a batch of operations atomically. The char limit is checked only on
 * the FINAL result, so a single call can remove/replace stale entries to free
 * room AND add new ones. On overflow or a bad op NOTHING is written and the
 * current entries are echoed back with an error — unless `evictOnOverflow` is
 * set, in which case the oldest entries are dropped (never the ones this batch
 * touched) and reported in `result.evicted`.
 * `workspaceId` scopes the `memory` store; ignored for `user`.
 */
export async function applyMemoryBatch(
  target: MemoryTarget,
  ops: MemoryOp[],
  workspaceId?: string,
  opts?: MemoryBatchOptions,
): Promise<MemoryResult> {
  const file = await readFile(target, workspaceId);
  if (!ops.length) return result(target, file.entries, true);

  const now = Date.now();
  let working = file.entries;
  try {
    for (const op of ops) working = applyOp(working, op, now);
  } catch (err) {
    return result(
      target,
      file.entries,
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  const limit = limitFor(target);
  const used = charCount(working);
  if (used > limit) {
    if (!opts?.evictOnOverflow) {
      return result(
        target,
        file.entries,
        false,
        `Result would be ${used}/${limit} chars — over the limit. Remove or shorten entries in the same batch.`,
      );
    }
    const { kept, evicted } = evictOldest(working, limit, now);
    if (charCount(kept) > limit) {
      // Even after dropping every pre-existing entry, the batch's own content
      // is too large — nothing safe to evict, so reject without writing.
      return result(
        target,
        file.entries,
        false,
        `Result would be ${charCount(kept)}/${limit} chars even after evicting older entries — the new content itself is over the limit.`,
      );
    }
    await writeFile(target, { version: 2, entries: kept }, workspaceId);
    return {
      ...result(target, kept, true),
      ...(evicted.length ? { evicted: evicted.map((e) => e.text) } : {}),
    };
  }

  await writeFile(target, { version: 2, entries: working }, workspaceId);
  return result(target, working, true);
}

/** Convenience single-op wrapper. */
export function applyMemoryOp(
  target: MemoryTarget,
  op: MemoryOp,
  workspaceId?: string,
  opts?: MemoryBatchOptions,
): Promise<MemoryResult> {
  return applyMemoryBatch(target, [op], workspaceId, opts);
}

/**
 * Usage snapshot for one store — used for the snapshot footer and UI meters.
 */
export interface MemoryUsage {
  target: MemoryTarget;
  used: number;
  limit: number;
  pct: number;
  entries: MemoryEntry[];
}

/** Compute `used/limit/pct` for a target (pct is 0-100, rounded). */
export async function getMemoryUsage(
  target: MemoryTarget,
  workspaceId?: string,
): Promise<MemoryUsage> {
  const entries = await loadMemory(target, workspaceId);
  const limit = limitFor(target);
  const used = charCount(entries);
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return { target, used, limit, pct, entries };
}

function pctText(used: number, limit: number): string {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return `${pct}%`;
}

/** Shared renderer: full snapshot when `maxChars` is undefined, else bounded. */
function renderSnapshotText(
  userEntries: MemoryEntry[],
  memEntries: MemoryEntry[],
  maxChars?: number,
): string {
  if (!userEntries.length && !memEntries.length) return '';

  const memUsed = charCount(memEntries);
  const userUsed = charCount(userEntries);
  const memLimit = limitFor('memory');
  const userLimit = limitFor('user');
  const memHot = memLimit > 0 && memUsed >= (memLimit * nudgeThresholdPct) / 100;
  const userHot = userLimit > 0 && userUsed >= (userLimit * nudgeThresholdPct) / 100;

  if (maxChars === undefined) {
    const lines: string[] = ['\n\n【长期记忆（会话开始时的快照，仅供参考）】'];
    if (userEntries.length) {
      lines.push('用户画像（关于用户是谁、其偏好与风格）：');
      userEntries.forEach((e) => lines.push(`- ${e.text}`));
    }
    if (memEntries.length) {
      lines.push('助手笔记（环境、引擎、约定、工具怪癖、经验）：');
      memEntries.forEach((e) => lines.push(`- ${e.text}`));
    }
    lines.push(
      '以上为持久记忆快照；若与本回合用户的最新指令冲突，以用户最新指令为准。',
    );
    lines.push(
      `【记忆用量】助手笔记 ${memUsed}/${memLimit} 字（${pctText(memUsed, memLimit)}），用户画像 ${userUsed}/${userLimit} 字（${pctText(userUsed, userLimit)}）。`,
    );
    if (memHot || userHot) {
      const which = [memHot && '助手笔记', userHot && '用户画像'].filter(Boolean).join('、');
      lines.push(
        `⚠ ${which}已接近字数上限：写入新记忆前，请先在同一个记忆块里用 remove/replace 合并或删除过期条目，腾出空间再 add。`,
      );
    }
    return lines.join('\n');
  }

  // Compact form for argv-capped adapters (dsh / zcode). Dense, one line per
  // section, truncated to the budget while always keeping the head + usage.
  const parts: string[] = [];
  if (userEntries.length) {
    parts.push(`用户画像：${userEntries.map((e) => e.text).join('；')}`);
  }
  if (memEntries.length) {
    parts.push(`助手笔记：${memEntries.map((e) => e.text).join('；')}`);
  }
  const usage = `用量：笔记 ${memUsed}/${memLimit}（${pctText(memUsed, memLimit)}），画像 ${userUsed}/${userLimit}（${pctText(userUsed, userLimit)}）`;
  const nudge = memHot || userHot ? '；接近上限，写前请先合并/删除旧条目' : '';
  let body = `\n\n【长期记忆】${parts.join(' | ')}（${usage}${nudge}）`;
  if (body.length > maxChars) {
    body = `${body.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return body;
}

/**
 * Render the frozen system-prompt snapshot. Read ONCE at session start and
 * concatenated into the chat system prompt. Returns '' when both stores are
 * empty so nothing is injected. `workspaceId` selects the project-scoped
 * `memory` notes to merge alongside the global `user` profile. See the
 * file-level CONTRACT before changing.
 */
export async function renderMemorySnapshot(workspaceId?: string): Promise<string> {
  const [userEntries, memEntries] = await Promise.all([
    loadMemory('user'),
    loadMemory('memory', workspaceId),
  ]);
  return renderSnapshotText(userEntries, memEntries);
}

/**
 * Bounded snapshot for adapters that pass the whole prompt through a single,
 * size-capped command-line argument (dsh / zcode). Same data, truncated to
 * `maxChars` so memory still reaches the model instead of being dropped.
 */
export async function renderMemorySnapshotCompact(
  workspaceId?: string,
  maxChars = 600,
): Promise<string> {
  const [userEntries, memEntries] = await Promise.all([
    loadMemory('user'),
    loadMemory('memory', workspaceId),
  ]);
  return renderSnapshotText(userEntries, memEntries, maxChars);
}

const frozenSnapshots = new Map<string, string>();
const FROZEN_SNAPSHOT_MAX = 32;

/**
 * Session-frozen variant of `renderMemorySnapshot`. Caches the rendered block
 * by `freezeKey` (the chat session id) so a mid-session write can never change
 * the live system prompt — preserving the native-CLI prefix cache. A new
 * freeze key (new session) re-reads disk.
 */
export async function renderFrozenMemorySnapshot(
  workspaceId: string | undefined,
  freezeKey: string,
): Promise<string> {
  const cached = frozenSnapshots.get(freezeKey);
  if (cached !== undefined) return cached;
  const snapshot = await renderMemorySnapshot(workspaceId);
  frozenSnapshots.set(freezeKey, snapshot);
  if (frozenSnapshots.size > FROZEN_SNAPSHOT_MAX) {
    const oldest = frozenSnapshots.keys().next().value;
    if (oldest !== undefined) frozenSnapshots.delete(oldest);
  }
  return snapshot;
}

/** Drop every cached frozen snapshot (tests / force-refresh). */
export function resetFrozenMemorySnapshot(): void {
  frozenSnapshots.clear();
}

/**
 * Apply parsed memory-write requests (from core/memoryProtocol) to disk. Each
 * request is one atomic batch against its target store. Returns the per-request
 * results so callers can log/surface failures. Never throws — a bad request is
 * reported as an unsuccessful result so a memory write can't break a chat turn.
 */
export async function applyMemoryWrites(
  requests: { target: MemoryTarget; operations: MemoryOp[] }[],
  workspaceId?: string,
  opts?: MemoryBatchOptions,
): Promise<MemoryResult[]> {
  const results: MemoryResult[] = [];
  for (const req of requests) {
    try {
      results.push(await applyMemoryBatch(req.target, req.operations, workspaceId, opts));
    } catch (err) {
      results.push(
        result(
          req.target,
          [],
          false,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }
  return results;
}
