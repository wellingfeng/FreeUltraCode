import { describe, expect, it, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import RawCodeBlock from './RawCodeBlock';
import { useStore } from '@/store/useStore';

/**
 * 代码块默认折叠，只露出前 5 行；点击"展开代码"显示全部，展开后可再收起。
 */
describe('RawCodeBlock folding', () => {
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

  it('folds a diff block to its first 5 lines by default and expands on demand', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(RawCodeBlock, { raw: patch, language: 'diff' }));
      });

      // 默认折叠：DOM 保留完整代码，由容器高度裁剪到前 5 行。
      expect(container.querySelector('.ai-code__folded')).toBeNull();
      const scroll = container.querySelector<HTMLElement>('.ai-code__scroll');
      expect(scroll?.style.maxHeight).not.toBe('');

      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="展开代码"]')?.click();
      });

      expect(scroll?.style.maxHeight).toBe('');
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="展开代码"]')).toBeNull();
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

  it('shows a short (1-3 line) text block inline without fold or boxed chrome', async () => {
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

      expect(container.querySelector('.ai-code__folded')).toBeNull();
      expect(container.querySelector('.ai-code--tiny')).not.toBeNull();
      expect(container.textContent).toContain('AIDock.fileMention');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('keeps a long single-line command unwrapped until wrap is enabled', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const command =
      "& { $env:CLAUDE_CODE_SSE_PORT=28537; $env:CLAUDE_CODE_ENTRYPOINT='cli'; claude code cli --dangerously-skip-permissions --model 'kimi-k3' '--output-format' 'stream-json' }";
    try {
      await act(async () => {
        root.render(createElement(RawCodeBlock, { raw: command, language: 'powershell' }));
      });

      expect(container.querySelector('.ai-code--tiny')).not.toBeNull();
      const code = container.querySelector<HTMLElement>('code.language-powershell');
      expect(code?.style.whiteSpace).toBe('pre');
      expect(container.querySelector('.ai-code--wrap')).toBeNull();
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="切换自动换行"]')?.click();
      });
      expect(code?.style.whiteSpace).toBe('pre-wrap');
      expect(container.querySelector('.ai-code--wrap')).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('folds a long text block to its first 5 lines by default and expands on demand', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const longText = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
    try {
      await act(async () => {
        root.render(createElement(RawCodeBlock, { raw: longText, language: 'text' }));
      });

      expect(container.querySelector('.ai-code__folded')).toBeNull();
      const scroll = container.querySelector<HTMLElement>('.ai-code__scroll');
      expect(scroll?.style.maxHeight).not.toBe('');

      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="展开代码"]')?.click();
      });

      expect(scroll?.style.maxHeight).toBe('');
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="展开代码"]')).toBeNull();

      // 展开后可再收起。
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="收起代码"]')?.click();
      });
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="展开代码"]')).not.toBeNull();
      expect(scroll?.style.maxHeight).not.toBe('');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
