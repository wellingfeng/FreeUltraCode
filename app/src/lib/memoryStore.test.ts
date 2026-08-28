import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MEMORY_LIMITS,
  applyMemoryBatch,
  applyMemoryOp,
  backfillMemoryTimestamps,
  getMemoryLimits,
  getMemoryUsage,
  loadMemory,
  renderFrozenMemorySnapshot,
  renderMemorySnapshot,
  renderMemorySnapshotCompact,
  resetFrozenMemorySnapshot,
  setMemoryLimits,
  setMemoryNudgeThresholdPct,
} from './memoryStore';

/** Convenience for asserting on stored text, ignoring timestamps. */
const texts = (entries: { text: string }[]): string[] => entries.map((e) => e.text);

// In the test env tauriAvailable() is false, so memoryStore falls back to
// localStorage. jsdom provides window.localStorage. Clear it each test.
beforeEach(() => {
  window.localStorage.clear();
  setMemoryLimits(DEFAULT_MEMORY_LIMITS);
  setMemoryNudgeThresholdPct(85);
  resetFrozenMemorySnapshot();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memoryStore add/persist', () => {
  it('adds an entry and reloads it across "sessions"', async () => {
    const r = await applyMemoryOp('user', { action: 'add', content: '用户偏好 Unity 引擎' });
    expect(r.success).toBe(true);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].text).toBe('用户偏好 Unity 引擎');
    expect(r.entries[0].updatedAt).toEqual(expect.any(Number));

    // simulate a fresh load
    expect(texts(await loadMemory('user'))).toEqual(['用户偏好 Unity 引擎']);
  });

  it('keeps memory and user stores separate', async () => {
    await applyMemoryOp('user', { action: 'add', content: '叫他小王' });
    await applyMemoryOp('memory', { action: 'add', content: '项目用 Godot 4' });
    expect(texts(await loadMemory('user'))).toEqual(['叫他小王']);
    expect(texts(await loadMemory('memory'))).toEqual(['项目用 Godot 4']);
  });

  it('rejects empty add content', async () => {
    const r = await applyMemoryOp('memory', { action: 'add', content: '   ' });
    expect(r.success).toBe(false);
    expect(r.entries).toEqual([]);
  });
});

describe('memoryStore replace/remove by substring', () => {
  it('replaces a uniquely-matched entry', async () => {
    await applyMemoryOp('memory', { action: 'add', content: '引擎是 Godot' });
    const r = await applyMemoryOp('memory', {
      action: 'replace',
      oldText: 'Godot',
      content: '引擎是 Unity',
    });
    expect(r.success).toBe(true);
    expect(texts(r.entries)).toEqual(['引擎是 Unity']);
    expect(r.entries[0].updatedAt).toEqual(expect.any(Number));
  });

  it('removes a uniquely-matched entry', async () => {
    await applyMemoryBatch('memory', [
      { action: 'add', content: 'a-fact' },
      { action: 'add', content: 'b-fact' },
    ]);
    const r = await applyMemoryOp('memory', { action: 'remove', oldText: 'a-fact' });
    expect(r.success).toBe(true);
    expect(texts(r.entries)).toEqual(['b-fact']);
  });

  it('fails on ambiguous substring without writing', async () => {
    await applyMemoryBatch('memory', [
      { action: 'add', content: 'fact one' },
      { action: 'add', content: 'fact two' },
    ]);
    const r = await applyMemoryOp('memory', { action: 'remove', oldText: 'fact' });
    expect(r.success).toBe(false);
    expect(await loadMemory('memory')).toHaveLength(2);
  });

  it('requires oldText for replace/remove', async () => {
    const r = await applyMemoryOp('memory', { action: 'remove' });
    expect(r.success).toBe(false);
  });
});

describe('memoryStore char-limit (atomic batch)', () => {
  it('rejects an add that overflows the limit, writing nothing', async () => {
    setMemoryLimits({ memory: 10 });
    const r = await applyMemoryOp('memory', { action: 'add', content: 'way-too-long-entry' });
    expect(r.success).toBe(false);
    expect(r.limit).toBe(10);
    expect(await loadMemory('memory')).toEqual([]);
  });

  it('allows a batch that frees room then adds, checking only the final size', async () => {
    setMemoryLimits({ memory: 12 });
    await applyMemoryOp('memory', { action: 'add', content: 'old-entry-9' }); // 11 chars, fits
    const r = await applyMemoryBatch('memory', [
      { action: 'remove', oldText: 'old-entry-9' },
      { action: 'add', content: 'new-entry-9' },
    ]);
    expect(r.success).toBe(true);
    expect(texts(r.entries)).toEqual(['new-entry-9']);
  });

  it('exposes configured limits', () => {
    setMemoryLimits({ user: 999 });
    expect(getMemoryLimits().user).toBe(999);
  });
});

describe('renderMemorySnapshot', () => {
  it('returns empty string when both stores are empty', async () => {
    expect(await renderMemorySnapshot()).toBe('');
  });

  it('renders user and memory entries under labeled sections', async () => {
    await applyMemoryOp('user', { action: 'add', content: '偏好简体中文' });
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Unity' });
    const snap = await renderMemorySnapshot();
    expect(snap).toContain('长期记忆');
    expect(snap).toContain('偏好简体中文');
    expect(snap).toContain('引擎=Unity');
    // frozen-snapshot block begins with a blank-line separator for concatenation
    expect(snap.startsWith('\n\n')).toBe(true);
  });
});

describe('memoryStore workspace scoping', () => {
  it('isolates memory notes between workspaces', async () => {
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Unity' }, 'ws-a');
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Godot' }, 'ws-b');
    expect(texts(await loadMemory('memory', 'ws-a'))).toEqual(['引擎=Unity']);
    expect(texts(await loadMemory('memory', 'ws-b'))).toEqual(['引擎=Godot']);
  });

  it('keeps the user profile global across workspaces', async () => {
    await applyMemoryOp('user', { action: 'add', content: '称呼小王' }, 'ws-a');
    // user store ignores workspaceId — visible from any workspace
    expect(texts(await loadMemory('user', 'ws-b'))).toEqual(['称呼小王']);
    expect(texts(await loadMemory('user'))).toEqual(['称呼小王']);
  });

  it('renders only the active workspace memory in the snapshot', async () => {
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Unity' }, 'ws-a');
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Godot' }, 'ws-b');
    const snap = await renderMemorySnapshot('ws-a');
    expect(snap).toContain('引擎=Unity');
    expect(snap).not.toContain('引擎=Godot');
  });

  it('falls back to the global memory file with no workspaceId', async () => {
    await applyMemoryOp('memory', { action: 'add', content: '全局笔记' });
    expect(texts(await loadMemory('memory'))).toEqual(['全局笔记']);
    // a scoped workspace does not see the global note
    expect(await loadMemory('memory', 'ws-a')).toEqual([]);
  });
});

describe('memoryStore updatedAt timestamps', () => {
  it('sets a timestamp on add', async () => {
    const r = await applyMemoryOp('user', { action: 'add', content: '一条新记忆' });
    expect(r.entries[0].updatedAt).toEqual(expect.any(Number));
  });

  it('bumps the timestamp on replace', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Godot' });
    now.mockReturnValue(2_000_000);
    const r = await applyMemoryOp('memory', {
      action: 'replace',
      oldText: 'Godot',
      content: '引擎=Unity',
    });
    expect(r.entries[0].updatedAt).toBe(2_000_000);
    expect(r.entries[0].text).toBe('引擎=Unity');
  });

  it('loads legacy string[] entries with no timestamp', async () => {
    window.localStorage.setItem(
      'ultragamestudio.memory.v1:memories/user.json',
      JSON.stringify({ version: 1, entries: ['旧格式记忆'] }),
    );
    const entries = await loadMemory('user');
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('旧格式记忆');
    expect(entries[0].updatedAt).toBeUndefined();
  });

  it('backfills a concrete timestamp onto legacy entries and persists it', async () => {
    window.localStorage.setItem(
      'ultragamestudio.memory.v1:memories/user.json',
      JSON.stringify({ version: 1, entries: ['旧格式记忆'] }),
    );
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    const entries = await backfillMemoryTimestamps('user');
    expect(entries[0].updatedAt).toBe(5_000_000);
    // persisted: a fresh load no longer sees undefined
    expect((await loadMemory('user'))[0].updatedAt).toBe(5_000_000);
    // second call is a no-op — timestamp stays put
    now.mockReturnValue(9_000_000);
    await backfillMemoryTimestamps('user');
    expect((await loadMemory('user'))[0].updatedAt).toBe(5_000_000);
  });
});

describe('memoryStore eviction', () => {
  it('rejects an overflow when eviction is off (default)', async () => {
    setMemoryLimits({ memory: 10 });
    await applyMemoryOp('memory', { action: 'add', content: 'old note' }); // 8 chars
    const r = await applyMemoryOp('memory', { action: 'add', content: 'another note' });
    expect(r.success).toBe(false);
    expect(r.evicted).toBeUndefined();
    expect(texts(await loadMemory('memory'))).toEqual(['old note']);
  });

  it('evicts the oldest entry to make room when enabled', async () => {
    setMemoryLimits({ memory: 10 });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await applyMemoryOp('memory', { action: 'add', content: 'aaaa' }); // oldest
    now.mockReturnValue(2_000);
    await applyMemoryOp('memory', { action: 'add', content: 'bbbb' });
    now.mockReturnValue(3_000);
    const r = await applyMemoryBatch(
      'memory',
      [{ action: 'add', content: 'cccc' }],
      undefined,
      { evictOnOverflow: true },
    );
    expect(r.success).toBe(true);
    expect(r.evicted).toEqual(['aaaa']);
    expect(texts(r.entries)).toEqual(['bbbb', 'cccc']);
  });

  it('never evicts entries touched by the current batch', async () => {
    setMemoryLimits({ memory: 10 });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await applyMemoryOp('memory', { action: 'add', content: 'aaaa' });
    now.mockReturnValue(2_000);
    // 'toolongnew' (10 chars) + 'aaaa' (4) = 14 > 10. The new entry is pinned
    // (updatedAt === now), so 'aaaa' is evicted and the pinned entry survives.
    const r = await applyMemoryBatch(
      'memory',
      [{ action: 'add', content: 'toolongnew' }],
      undefined,
      { evictOnOverflow: true },
    );
    expect(r.success).toBe(true);
    expect(r.evicted).toEqual(['aaaa']);
    expect(texts(r.entries)).toEqual(['toolongnew']);
  });
});

describe('memoryStore usage + nudge', () => {
  it('reports used/limit/pct', async () => {
    setMemoryLimits({ user: 100 });
    await applyMemoryOp('user', { action: 'add', content: '0123456789' }); // 10 chars
    const usage = await getMemoryUsage('user');
    expect(usage.used).toBe(10);
    expect(usage.limit).toBe(100);
    expect(usage.pct).toBe(10);
  });

  it('appends a nudge when usage crosses the threshold', async () => {
    setMemoryLimits({ memory: 100 });
    setMemoryNudgeThresholdPct(10);
    await applyMemoryOp('memory', { action: 'add', content: '0123456789' }); // 10 chars = 10%
    const snap = await renderMemorySnapshot();
    expect(snap).toContain('接近字数上限');
  });

  it('does not nudge below the threshold', async () => {
    setMemoryLimits({ memory: 100 });
    setMemoryNudgeThresholdPct(50);
    await applyMemoryOp('memory', { action: 'add', content: '0123456789' }); // 10%
    const snap = await renderMemorySnapshot();
    expect(snap).not.toContain('接近字数上限');
  });
});

describe('memoryStore compact snapshot', () => {
  it('returns empty when both stores are empty', async () => {
    expect(await renderMemorySnapshotCompact()).toBe('');
  });

  it('keeps the compact block under the char budget', async () => {
    await applyMemoryOp('user', { action: 'add', content: '偏好简体中文' });
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Unity' });
    const compact = await renderMemorySnapshotCompact(undefined, 40);
    expect(compact.length).toBeLessThanOrEqual(40);
    expect(compact).toContain('长期记忆');
  });
});

describe('memoryStore frozen snapshot', () => {
  it('freezes the snapshot per freeze key across turns', async () => {
    await applyMemoryOp('user', { action: 'add', content: '第一版' });
    const first = await renderFrozenMemorySnapshot(undefined, 'session-1');
    // A mid-session write must NOT change the frozen snapshot.
    await applyMemoryOp('user', { action: 'add', content: '第二版' });
    const again = await renderFrozenMemorySnapshot(undefined, 'session-1');
    expect(again).toBe(first);
    expect(again).toContain('第一版');
    expect(again).not.toContain('第二版');
    // A new session re-reads disk.
    resetFrozenMemorySnapshot();
    const fresh = await renderFrozenMemorySnapshot(undefined, 'session-2');
    expect(fresh).toContain('第二版');
  });
});
