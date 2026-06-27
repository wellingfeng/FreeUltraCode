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
 * Limits are CHARACTER counts (not tokens) because char counts are
 * model-independent and stable. An `add` that would overflow is rejected with
 * the current entries echoed back, so the caller can remove/replace stale
 * entries to free room. A `batch` applies atomically and the limit is checked
 * only on the FINAL result, so one call can free room AND add together.
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

/** On-disk shape. `entries` are trimmed, non-empty strings. */
interface MemoryFile {
  version: 1;
  entries: string[];
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
  entries: string[];
  used: number;
  limit: number;
  error?: string;
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

async function readFile(target: MemoryTarget, workspaceId?: string): Promise<MemoryFile> {
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
  if (!raw) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryFile>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.map((e) => String(e).trim()).filter(Boolean)
      : [];
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeFile(
  target: MemoryTarget,
  file: MemoryFile,
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

function charCount(entries: string[]): number {
  // Joined length approximates the rendered block size; the delimiter is a
  // single separator char so this stays close to the on-screen footprint.
  return entries.join('\n').length;
}

function limitFor(target: MemoryTarget): number {
  return target === 'user' ? limits.user : limits.memory;
}

function result(
  target: MemoryTarget,
  entries: string[],
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
function applyOp(entries: string[], op: MemoryOp): string[] {
  if (op.action === 'add') {
    const content = (op.content ?? '').trim();
    if (!content) throw new Error("'add' needs non-empty content.");
    return [...entries, content];
  }
  const needle = (op.oldText ?? '').trim();
  if (!needle) {
    throw new Error(
      `'${op.action}' needs oldText — a short unique substring of the entry to ${op.action}.`,
    );
  }
  const matches = entries.filter((e) => e.includes(needle));
  if (matches.length === 0) {
    throw new Error(`No entry matches "${needle}".`);
  }
  if (matches.length > 1) {
    throw new Error(`"${needle}" matches ${matches.length} entries — use a more specific substring.`);
  }
  if (op.action === 'remove') {
    return entries.filter((e) => !e.includes(needle));
  }
  // replace
  const content = (op.content ?? '').trim();
  if (!content) throw new Error("'replace' needs non-empty content.");
  return entries.map((e) => (e.includes(needle) ? content : e));
}

// --- public API --------------------------------------------------------------

/**
 * Load all entries for a target (used by UI/inspection and tests).
 * `workspaceId` scopes the `memory` store; ignored for `user` (always global).
 */
export async function loadMemory(
  target: MemoryTarget,
  workspaceId?: string,
): Promise<string[]> {
  const file = await readFile(target, workspaceId);
  return file.entries;
}

/**
 * Apply a batch of operations atomically. The char limit is checked only on
 * the FINAL result, so a single call can remove/replace stale entries to free
 * room AND add new ones. On overflow or a bad op NOTHING is written and the
 * current entries are echoed back with an error.
 * `workspaceId` scopes the `memory` store; ignored for `user`.
 */
export async function applyMemoryBatch(
  target: MemoryTarget,
  ops: MemoryOp[],
  workspaceId?: string,
): Promise<MemoryResult> {
  const file = await readFile(target, workspaceId);
  if (!ops.length) return result(target, file.entries, true);

  let working = file.entries;
  try {
    for (const op of ops) working = applyOp(working, op);
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
    return result(
      target,
      file.entries,
      false,
      `Result would be ${used}/${limit} chars — over the limit. Remove or shorten entries in the same batch.`,
    );
  }

  await writeFile(target, { version: 1, entries: working }, workspaceId);
  return result(target, working, true);
}

/** Convenience single-op wrapper. */
export function applyMemoryOp(
  target: MemoryTarget,
  op: MemoryOp,
  workspaceId?: string,
): Promise<MemoryResult> {
  return applyMemoryBatch(target, [op], workspaceId);
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
  if (!userEntries.length && !memEntries.length) return '';

  const lines: string[] = ['\n\n【长期记忆（会话开始时的快照，仅供参考）】'];
  if (userEntries.length) {
    lines.push('用户画像（关于用户是谁、其偏好与风格）：');
    userEntries.forEach((e) => lines.push(`- ${e}`));
  }
  if (memEntries.length) {
    lines.push('助手笔记（环境、引擎、约定、工具怪癖、经验）：');
    memEntries.forEach((e) => lines.push(`- ${e}`));
  }
  lines.push(
    '以上为持久记忆快照；若与本回合用户的最新指令冲突，以用户最新指令为准。',
  );
  return lines.join('\n');
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
): Promise<MemoryResult[]> {
  const results: MemoryResult[] = [];
  for (const req of requests) {
    try {
      results.push(await applyMemoryBatch(req.target, req.operations, workspaceId));
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
