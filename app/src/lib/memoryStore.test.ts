import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MEMORY_LIMITS,
  applyMemoryBatch,
  applyMemoryOp,
  getMemoryLimits,
  loadMemory,
  renderMemorySnapshot,
  setMemoryLimits,
} from './memoryStore';

// In the test env tauriAvailable() is false, so memoryStore falls back to
// localStorage. jsdom provides window.localStorage. Clear it each test.
beforeEach(() => {
  window.localStorage.clear();
  setMemoryLimits(DEFAULT_MEMORY_LIMITS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memoryStore add/persist', () => {
  it('adds an entry and reloads it across "sessions"', async () => {
    const r = await applyMemoryOp('user', { action: 'add', content: '用户偏好 Unity 引擎' });
    expect(r.success).toBe(true);
    expect(r.entries).toEqual(['用户偏好 Unity 引擎']);

    // simulate a fresh load
    expect(await loadMemory('user')).toEqual(['用户偏好 Unity 引擎']);
  });

  it('keeps memory and user stores separate', async () => {
    await applyMemoryOp('user', { action: 'add', content: '叫他小王' });
    await applyMemoryOp('memory', { action: 'add', content: '项目用 Godot 4' });
    expect(await loadMemory('user')).toEqual(['叫他小王']);
    expect(await loadMemory('memory')).toEqual(['项目用 Godot 4']);
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
    expect(r.entries).toEqual(['引擎是 Unity']);
  });

  it('removes a uniquely-matched entry', async () => {
    await applyMemoryBatch('memory', [
      { action: 'add', content: 'a-fact' },
      { action: 'add', content: 'b-fact' },
    ]);
    const r = await applyMemoryOp('memory', { action: 'remove', oldText: 'a-fact' });
    expect(r.success).toBe(true);
    expect(r.entries).toEqual(['b-fact']);
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
    expect(r.entries).toEqual(['new-entry-9']);
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
    expect(await loadMemory('memory', 'ws-a')).toEqual(['引擎=Unity']);
    expect(await loadMemory('memory', 'ws-b')).toEqual(['引擎=Godot']);
  });

  it('keeps the user profile global across workspaces', async () => {
    await applyMemoryOp('user', { action: 'add', content: '称呼小王' }, 'ws-a');
    // user store ignores workspaceId — visible from any workspace
    expect(await loadMemory('user', 'ws-b')).toEqual(['称呼小王']);
    expect(await loadMemory('user')).toEqual(['称呼小王']);
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
    expect(await loadMemory('memory')).toEqual(['全局笔记']);
    // a scoped workspace does not see the global note
    expect(await loadMemory('memory', 'ws-a')).toEqual([]);
  });
});
