/**
 * CONTRACT: pending memory-write approval queue (mirrors Hermes' write_approval
 * staging).
 *
 * Background self-review (core/memoryReview.ts) and the manual history refresh
 * (lib/memoryRefresh.ts) propose writes WITHOUT the user watching the turn that
 * produced them. With `approvalRequired` on, those proposals land here — a
 * small JSON queue at `memories/pending.json` — instead of the live store. The
 * Memory settings panel lists them; approve → the op runs through the normal
 * applyMemoryBatch path (duplicate/safety/limit gates all still apply);
 * reject → dropped. Either way the entry leaves the queue.
 *
 * Foreground <<UGS_MEMORY>> writes NEVER queue: the user was present for the
 * turn that proposed them (same policy as Hermes, where mid-turn tool writes
 * apply directly and only autonomous review writes stage).
 *
 * Storage reuses the same `history_*` Tauri channel (atomic write + backup) as
 * the memory stores themselves, with a localStorage fallback in the browser.
 */

import { tauriAvailable } from './tauri';
import type { MemoryOp, MemoryTarget } from './memoryStore';

const REL_PATH = 'memories/pending.json';
const FALLBACK_PREFIX = 'ultragamestudio.memory.v1:';

export type MemoryWriteSource = 'review' | 'refresh';

export interface PendingMemoryWrite {
  id: string;
  target: MemoryTarget;
  op: MemoryOp;
  source: MemoryWriteSource;
  proposedAt: number;
}

interface PendingFile {
  version: 1;
  writes: PendingMemoryWrite[];
}

function makeId(): string {
  // Monotonic-ish unique id without pulling crypto: timestamp + random tail.
  return `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readPending(): Promise<PendingFile> {
  let raw: string | null = null;
  try {
    if (tauriAvailable()) {
      const { invoke } = await import('@tauri-apps/api/core');
      raw = await invoke<string | null>('history_read_json', { relPath: REL_PATH });
    } else if (typeof window !== 'undefined' && window.localStorage) {
      raw = window.localStorage.getItem(FALLBACK_PREFIX + REL_PATH);
    }
  } catch {
    raw = null;
  }
  if (!raw) return { version: 1, writes: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<PendingFile>;
    if (parsed && Array.isArray(parsed.writes)) {
      return {
        version: 1,
        writes: parsed.writes.filter(
          (w): w is PendingMemoryWrite =>
            !!w &&
            typeof w === 'object' &&
            typeof w.id === 'string' &&
            typeof w.proposedAt === 'number' &&
            (w.target === 'user' || w.target === 'memory') &&
            !!w.op &&
            typeof w.op === 'object' &&
            typeof w.op.action === 'string' &&
            ['add', 'replace', 'remove'].includes(w.op.action),
        ),
      };
    }
  } catch {
    /* fall through to empty */
  }
  return { version: 1, writes: [] };
}

async function writePending(writes: PendingMemoryWrite[]): Promise<void> {
  const json = JSON.stringify({ version: 1, writes } satisfies PendingFile, null, 2);
  if (tauriAvailable()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke<void>('history_write_json', { relPath: REL_PATH, json });
    return;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(FALLBACK_PREFIX + REL_PATH, json);
    } catch {
      /* non-fatal */
    }
  }
}

/** Snapshot of the queue, oldest first. */
export async function listPendingMemoryWrites(): Promise<PendingMemoryWrite[]> {
  return (await readPending()).writes.sort((a, b) => a.proposedAt - b.proposedAt);
}

export async function countPendingMemoryWrites(): Promise<number> {
  return (await readPending()).writes.length;
}

/**
 * Stage proposed writes. Dedupes against the queue itself: an identical op for
 * the same target/source already pending is not staged twice (repeated review
 * runs otherwise pile up copies of the same proposal while it awaits approval).
 * Returns how many were newly queued.
 */
export async function queuePendingMemoryWrites(
  writes: { target: MemoryTarget; operations: MemoryOp[] }[],
  source: MemoryWriteSource,
  workspaceId?: string,
): Promise<number> {
  void workspaceId; // reserved for per-workspace scoping if stores ever split
  const file = await readPending();
  let added = 0;
  for (const req of writes) {
    for (const op of req.operations) {
      const dup = file.writes.some(
        (w) =>
          w.target === req.target &&
          w.source === source &&
          w.op.action === op.action &&
          (w.op.content ?? '') === (op.content ?? '') &&
          (w.op.oldText ?? '') === (op.oldText ?? ''),
      );
      if (dup) continue;
      file.writes.push({
        id: makeId(),
        target: req.target,
        op,
        source,
        proposedAt: Date.now(),
      });
      added += 1;
    }
  }
  if (added) {
    await writePending(file.writes);
    // Auto pre-screen: the AI pass runs in the background so the user only
    // ever sees what survived it. Debounced — a burst of queued writes from
    // one review turn collapses into a single model call. Skipped in tests
    // (fake-indexeddb/localStorage env has no gateway to call).
    scheduleAutoTriage();
  }
  return added;
}

export interface PendingResolution {
  /** Ids actually resolved (found in the queue). Unknown ids are ignored. */
  resolvedIds: string[];
}

/**
 * Approve or reject pending writes by id. Approved ops apply through
 * `applyMemoryBatch` — the SAME gates (duplicate skip, safety scan, char
 * limit) run as for any other write, so approval can still legitimately
 * reject (e.g. an overflow with eviction off). Each approved op is removed
 * from the queue before the next applies, so a mid-batch failure doesn't
 * retry forever.
 */
export async function resolvePendingMemoryWrites(
  ids: string[],
  action: 'approve' | 'reject',
  workspaceId?: string,
  opts?: { evictOnOverflow?: boolean; safetyScan?: 'reject' | 'skip' | 'off' },
): Promise<PendingResolution> {
  const { applyMemoryOp } = await import('./memoryStore');
  const file = await readPending();
  const byId = new Map(file.writes.map((w) => [w.id, w]));
  const resolved: PendingMemoryWrite[] = [];
  for (const id of ids) {
    const w = byId.get(id);
    if (!w) continue;
    resolved.push(w);
    file.writes = file.writes.filter((x) => x.id !== id);
  }
  if (!resolved.length) return { resolvedIds: [] };
  await writePending(file.writes);

  if (action === 'approve') {
    // Oldest first, sequential, each de-queued before the next applies.
    for (const w of resolved.sort((a, b) => a.proposedAt - b.proposedAt)) {
      await applyMemoryOp(
        w.target,
        w.op,
        w.target === 'memory' ? workspaceId : undefined,
        opts,
      ).catch(() => undefined);
    }
  }
  return { resolvedIds: resolved.map((w) => w.id) };
}

/**
 * Render one queued write as a single review line for the triage model.
 * Kept terse: the model sees many of these and only judges keep/drop.
 */
export function formatPendingForTriage(w: PendingMemoryWrite): string {
  const target = w.target === 'user' ? '用户画像' : '助手笔记';
  const tier = w.op.importance?.trim();
  const tierTag = tier ? `［重要度：${tier}］` : '';
  const body =
    w.op.action === 'remove'
      ? `删除：${w.op.oldText ?? ''}`
      : w.op.action === 'replace'
        ? `改写「${w.op.oldText ?? ''}」为：${w.op.content ?? ''}`
        : `新增：${w.op.content ?? ''}`;
  return `[${w.id}] (${target}) ${tierTag}${body}`;
}

/** System prompt for the AI pre-screen pass over the pending queue. */
export const TRIAGE_SYSTEM =
  '你是长期记忆的「预审批员」，标准严格。下面给你一批待人工审批的记忆写入提案。' +
  '你的任务：替用户先做一轮严格筛查——默认拒绝（drop），只有真正值得跨会话保存的条目才放行（keep），' +
  '让用户终审时看到的每一条都有明确价值。\n\n' +
  '必须拒绝的（drop）：\n' +
  '- 环境型失败（缺二进制、命令找不到、未装依赖、未配置凭据）。\n' +
  '- 对工具/功能的负面断言（"X 坏了""无法 Y"）。\n' +
  '- 会话内已解决的临时错误、一次性任务叙述、过程流水账。\n' +
  '- 琐碎、零碎的片段：单一命令片段、单个参数名、可从代码/git 历史随手重新发现的事实。\n' +
  '- 空泛、无信息量的条目（"用户很忙""项目很重要""要认真"这类）。\n' +
  '- 信息密度低、只值半句话的条目——这类应已在审阅阶段被合并，漏到这里就拒绝。\n\n' +
  '可以保留的（keep），必须同时满足：\n' +
  '- 内容具体、信息密度高，一句话说清一个事实；AND\n' +
  '- 属于：用户的身份/偏好/明确纠正/沟通风格，或项目引擎/约定/资源目录/工具链怪癖/踩过的坑等稳定事实；AND\n' +
  '- 跨会话仍然有用，一个月后看到仍值得执行。\n\n' +
  '拿不准时倾向拒绝——漏掉一条事实的代价远低于让用户审批一堆垃圾的代价。' +
  '只有当某条目明显独特、具体、可执行时才放行。\n\n' +
  '只输出一个 JSON 对象，不要任何解释、不要代码块标记：\n' +
  '{"drop":["要拒绝的提案id",...],"keep":["要保留的提案id",...]}\n' +
  '每个提案 id 必须恰好出现一次（要么在 drop 要么在 keep），不要遗漏、不要新增 id。';

/** Build the triage user prompt from the current queue. */
export function buildTriageUserPrompt(writes: PendingMemoryWrite[]): string {
  const lines = writes.map(formatPendingForTriage);
  return `以下是 ${writes.length} 条待审批记忆写入，请按系统指令筛查：\n\n${lines.join('\n')}`;
}

/** Parse the triage model's JSON verdict; returns null on any malformed output. */
export function parseTriageVerdict(
  raw: string,
  validIds: Set<string>,
): { drop: string[]; keep: string[] } | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const drop = Array.isArray((parsed as { drop?: unknown }).drop)
    ? ((parsed as { drop: unknown[] }).drop.filter((x): x is string => typeof x === 'string'))
    : [];
  const keep = Array.isArray((parsed as { keep?: unknown }).keep)
    ? ((parsed as { keep: unknown[] }).keep.filter((x): x is string => typeof x === 'string'))
    : [];
  const seen = new Set<string>();
  for (const id of [...drop, ...keep]) {
    if (!validIds.has(id) || seen.has(id)) return null; // unknown or duplicated id → distrust
    seen.add(id);
  }
  return { drop, keep };
}

/**
 * Run one AI triage pass over the queue: the model judges every pending write
 * keep/drop, drops are REJECTED (removed, never applied), keeps stay queued for
 * the human's final pass. Conservative by construction — the triage prompt
 * tells the model to keep anything uncertain, and this function rejects the
 * whole verdict (dropping nothing) unless every queued id is accounted for.
 *
 * Returns counts for the settings panel to report.
 */
export async function triagePendingMemoryWrites(
  invokeModel: (system: string, userContent: string) => Promise<string>,
): Promise<{ total: number; dropped: number; kept: number; verdictOk: boolean }> {
  const writes = (await readPending()).writes;
  if (!writes.length) return { total: 0, dropped: 0, kept: 0, verdictOk: true };
  const validIds = new Set(writes.map((w) => w.id));

  let verdict: { drop: string[]; keep: string[] } | null = null;
  try {
    const out = await invokeModel(TRIAGE_SYSTEM, buildTriageUserPrompt(writes));
    verdict = parseTriageVerdict(out, validIds);
  } catch {
    verdict = null;
  }
  // Unparseable / incomplete verdict → drop nothing, keep everything.
  if (!verdict) {
    return { total: writes.length, dropped: 0, kept: writes.length, verdictOk: false };
  }
  if (verdict.drop.length) {
    await resolvePendingMemoryWrites(verdict.drop, 'reject');
  }
  return { total: writes.length, dropped: verdict.drop.length, kept: verdict.keep.length, verdictOk: true };
}

// --- auto-triage -------------------------------------------------------------
// The pending queue is populated by background review (useStore) and manual
// refresh (memoryRefresh) — two separate call sites. Rather than threading a
// triage hook through both, `queuePendingMemoryWrites` schedules a triage pass
// itself (debounced, fire-and-forget) whenever new writes land while the user's
// config opts in. The user then only ever sees what survived the AI pass.

const AUTO_TRIAGE_DEBOUNCE_MS = 2000;
let autoTriageTimer: ReturnType<typeof setTimeout> | null = null;
let autoTriageRunning = false;
let autoTriageAgain = false;

async function runAutoTriage(): Promise<void> {
  if (autoTriageRunning) {
    autoTriageAgain = true;
    return;
  }
  autoTriageRunning = true;
  try {
    do {
      autoTriageAgain = false;
      const { loadMemoryConfig } = await import('./memoryConfig');
      const { makeReviewInvoker, completeReview } = await import('./memoryRefresh');
      const config = loadMemoryConfig();
      if (!config.approvalRequired || !config.triageAutoRun) break;
      await triagePendingMemoryWrites(makeReviewInvoker(config, completeReview)).catch(
        () => undefined,
      );
    } while (autoTriageAgain);
  } finally {
    autoTriageRunning = false;
  }
}

/** Schedule an automatic triage pass (debounced, no-op when disabled in config). */
export function scheduleAutoTriage(): void {
  // Vitest: no gateway is reachable and the debounce timer would outlive the
  // test. queuePendingMemoryWrites callers in tests never expect a triage.
  if (typeof process !== 'undefined' && process.env?.VITEST) return;
  if (autoTriageTimer) clearTimeout(autoTriageTimer);
  autoTriageTimer = setTimeout(() => {
    autoTriageTimer = null;
    void runAutoTriage();
  }, AUTO_TRIAGE_DEBOUNCE_MS);
}
