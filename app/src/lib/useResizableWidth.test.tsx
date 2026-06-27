import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useResizableWidth } from './useResizableWidth';

const STORAGE_KEY = 'ultragamestudio.testPaneWidth.v1';

function Probe({
  min = 100,
  max = 240,
  defaultWidth = 160,
}: {
  min?: number;
  max?: number;
  defaultWidth?: number;
}) {
  const { width, onResizeStart } = useResizableWidth({
    storageKey: STORAGE_KEY,
    defaultWidth,
    min,
    max,
    edge: 'left',
  });

  return (
    <button type="button" onMouseDown={onResizeStart}>
      {width}
    </button>
  );
}

async function renderProbe(props: Parameters<typeof Probe>[0] = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe {...props} />);
  });
  return { container, root };
}

async function cleanup(root: Root, container: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe('useResizableWidth', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  });

  it('clamps a persisted width to the current max', async () => {
    window.localStorage.setItem(STORAGE_KEY, '520');
    const { container, root } = await renderProbe({ max: 320 });

    try {
      expect(container.textContent).toBe('320');
    } finally {
      await cleanup(root, container);
    }
  });

  it('clears the resize cursor after a drag, even when it was already stale', async () => {
    // Simulate a previous drag that never cleaned up (e.g. mouseup was lost
    // over a webview), leaving the body stuck on the resize cursor.
    document.body.style.cursor = 'col-resize';
    const { container, root } = await renderProbe();

    try {
      const button = container.querySelector('button')!;
      await act(async () => {
        button.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 200 }),
        );
      });
      expect(document.body.style.cursor).toBe('col-resize');

      await act(async () => {
        window.dispatchEvent(new MouseEvent('mouseup'));
      });
      // Must be cleared outright, not restored to the stale 'col-resize'.
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
    } finally {
      await cleanup(root, container);
    }
  });

  it('clears the resize cursor when the window loses focus mid-drag', async () => {
    const { container, root } = await renderProbe();

    try {
      const button = container.querySelector('button')!;
      await act(async () => {
        button.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 200 }),
        );
      });
      expect(document.body.style.cursor).toBe('col-resize');

      await act(async () => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(document.body.style.cursor).toBe('');
    } finally {
      await cleanup(root, container);
    }
  });
});
