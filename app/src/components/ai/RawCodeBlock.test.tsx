import { describe, expect, it, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import RawCodeBlock from './RawCodeBlock';
import { useStore } from '@/store/useStore';

/**
 * A diff code block must default to fully folded (its body hidden behind a
 * toggle) so a patch never dominates the chat stream, and expand on click.
 */
describe('RawCodeBlock diff folding', () => {
  beforeEach(() => {
    useStore.setState({ locale: 'zh-CN' });
  });

  const patch = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1 +1 @@',
    '-const x = 1;',
    '+const x = 2;',
  ].join('\n');

  it('hides the diff body until expanded, then reveals it', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(RawCodeBlock, { raw: patch, language: 'diff' }));
      });

      // Folded: body hidden, fold toggle shown, content not present.
      expect(container.querySelector('.ai-code__folded')).not.toBeNull();
      expect(container.querySelector('.ai-code__scroll')).toBeNull();
      expect(container.textContent).not.toContain('const x = 2;');

      // Click the fold button to expand.
      await act(async () => {
        container.querySelector<HTMLButtonElement>('.ai-code__folded')?.click();
      });

      expect(container.querySelector('.ai-code__folded')).toBeNull();
      expect(container.querySelector('.ai-code__scroll')).not.toBeNull();
      expect(container.textContent).toContain('const x = 2;');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('keeps a short non-diff block fully visible without a toggle', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(createElement(RawCodeBlock, { raw: 'const a = 1;', language: 'ts' }));
      });
      expect(container.querySelector('.ai-code__folded')).toBeNull();
      expect(container.querySelector('.ai-code__scroll')).not.toBeNull();
      act(() => root.unmount());
    } finally {
      container.remove();
    }
  });

  it('hides a short text block until expanded, then reveals it', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(RawCodeBlock, {
            raw: 'npm test -- --run src/panels/AIDock.fileMention.test.tsx',
            language: 'text',
          }),
        );
      });

      expect(container.querySelector('.ai-code__folded')).not.toBeNull();
      expect(container.querySelector('.ai-code__scroll')).toBeNull();
      expect(container.textContent).not.toContain('AIDock.fileMention');

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.ai-code__folded')?.click();
      });

      expect(container.querySelector('.ai-code__folded')).toBeNull();
      expect(container.querySelector('.ai-code__scroll')).not.toBeNull();
      expect(container.textContent).toContain('AIDock.fileMention');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
