import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TerminalLog from './TerminalLog';
import { classifyLogLine, parseLogLines, stripAnsi } from './lib/terminalLog';

describe('TerminalLog line classification', () => {
  it('classifies by content keywords', () => {
    expect(classifyLogLine('edit + error2 - 28')).toBe('error');
    expect(classifyLogLine('TypeError: x is not a function')).toBe('error');
    expect(classifyLogLine('[18 more rows]')).toBe('info');
    expect(classifyLogLine('[peer message from mist-quail]')).toBe('info');
    expect(classifyLogLine('context 8.9% cache 90%')).toBe('info');
    expect(classifyLogLine('read + ok')).toBe('ok');
    expect(classifyLogLine('build success ✓')).toBe('ok');
    expect(classifyLogLine('warning: deprecated api')).toBe('warn');
    expect(classifyLogLine('debug: parsing node graph')).toBe('debug');
    expect(classifyLogLine('plain line here')).toBe('plain');
    expect(classifyLogLine('')).toBe('plain');
  });

  it('strips ANSI escape sequences', () => {
    expect(stripAnsi('\u001b[32mok\u001b[0m')).toBe('ok');
    expect(stripAnsi('a\u001b[1;31mb\u001b[0m c')).toBe('ab c');
  });

  it('splits text into leveled lines, keeping empty lines', () => {
    expect(parseLogLines('one\ntwo - error!\n')).toEqual([
      { level: 'plain', text: 'one' },
      { level: 'error', text: 'two - error!' },
      { level: 'plain', text: '' },
    ]);
  });
});

describe('TerminalLog render', () => {
  async function renderLog(props: Parameters<typeof TerminalLog>[0]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(TerminalLog, props));
    });
    return {
      container,
      cleanup: () => {
        act(() => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it('renders a live log region with per-level semantic colors', async () => {
    const { container, cleanup } = await renderLog({ text: 'start\nread + ok\nerror!' });
    try {
      const log = container.querySelector('[role="log"]');
      expect(log).not.toBeNull();
      const rows = container.querySelectorAll('[role="log"] > div');
      expect(rows.length).toBe(3);
      expect(rows[0].className).toContain('text-fg-dim');
      expect(rows[1].className).toContain('text-status-success');
      expect(rows[2].className).toContain('text-status-error');
    } finally {
      cleanup();
    }
  });

  it('shows a streaming caret and polite live region while streaming', async () => {
    const { container, cleanup } = await renderLog({
      text: 'building…',
      streaming: true,
      'aria-label': '构建日志',
    });
    try {
      const log = container.querySelector('[role="log"]');
      expect(log?.getAttribute('aria-live')).toBe('polite');
      expect(log?.getAttribute('aria-label')).toBe('构建日志');
      expect(container.querySelector('.ai-caret')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('is quiet (no caret) when not streaming', async () => {
    const { container, cleanup } = await renderLog({ text: 'done' });
    try {
      expect(container.querySelector('[role="log"]')?.getAttribute('aria-live')).toBe('off');
      expect(container.querySelector('.ai-caret')).toBeNull();
    } finally {
      cleanup();
    }
  });
});
