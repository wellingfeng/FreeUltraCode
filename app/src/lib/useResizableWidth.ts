import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { loadPaneWidth, savePaneWidth } from './composerStorage';

/**
 * Drag-to-resize width for a side panel, mirroring AIDock's vertical resize.
 *
 *   edge: 'right' → handle on the element's RIGHT edge (left Sidebar): dragging
 *                   right grows it.
 *   edge: 'left'  → handle on the LEFT edge (right PromptPanel): dragging left
 *                   grows it.
 *
 * Width is clamped to [min, max], restored from / persisted to localStorage.
 */
export interface ResizableWidth {
  width: number;
  onResizeStart: (e: ReactMouseEvent) => void;
}

export function useResizableWidth(opts: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  edge: 'left' | 'right';
}): ResizableWidth {
  const { storageKey, defaultWidth, min, max, edge } = opts;
  const clamp = useCallback(
    (w: number) => Math.min(Math.max(w, min), max),
    [min, max],
  );
  const [width, setWidth] = useState<number>(
    () => clamp(loadPaneWidth(storageKey) ?? defaultWidth),
  );

  useEffect(() => {
    setWidth((w) => clamp(w));
  }, [clamp]);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setWidth(clamp(edge === 'right' ? startWidth + delta : startWidth - delta));
      };
      // Always clear the overrides outright rather than restoring a saved
      // value: a saved value can itself be a stale 'col-resize' from a drag
      // that never received its mouseup (e.g. released over a webview/iframe),
      // which would otherwise leave the resize cursor stuck permanently.
      const cleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
      };
      const onUp = () => {
        cleanup();
        setWidth((w) => {
          savePaneWidth(storageKey, w);
          return w;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
    },
    [width, edge, clamp, storageKey],
  );

  return { width, onResizeStart };
}
