import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemorySettings from './MemorySettings';
import { applyMemoryOp, loadMemory } from '@/lib/memoryStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await Promise.resolve(); });

describe('MemorySettings', () => {
  it('renders existing user and workspace-scoped memory entries', async () => {
    await applyMemoryOp('user', { action: 'add', content: '称呼小王' });
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Unity' }, 'ws-a');

    await act(async () => {
      root.render(<MemorySettings locale="zh-CN" workspaceId="ws-a" />);
    });
    await flush();

    expect(container.textContent).toContain('长期记忆');
    expect(container.textContent).toContain('称呼小王');
    expect(container.textContent).toContain('引擎=Unity');
  });

  it('does not show another workspace memory', async () => {
    await applyMemoryOp('memory', { action: 'add', content: '引擎=Godot' }, 'ws-b');

    await act(async () => {
      root.render(<MemorySettings locale="zh-CN" workspaceId="ws-a" />);
    });
    await flush();

    expect(container.textContent).not.toContain('引擎=Godot');
  });

  it('adds a user entry through the input', async () => {
    await act(async () => {
      root.render(<MemorySettings locale="zh-CN" workspaceId={null} />);
    });
    await flush();

    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input).toBeTruthy();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      nativeSetter.call(input, '偏好简体中文');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();

    const buttons = Array.from(container.querySelectorAll('button'));
    const addBtn = buttons.find((b) => b.textContent?.includes('添加'));
    expect(addBtn).toBeTruthy();
    await act(async () => {
      addBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(await loadMemory('user')).toContain('偏好简体中文');
  });
});
