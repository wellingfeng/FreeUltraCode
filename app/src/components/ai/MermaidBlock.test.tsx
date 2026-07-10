import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import MessageContent from './MessageContent';
import { useStore } from '@/store/useStore';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: mermaidMocks,
}));

describe('MermaidBlock', () => {
  beforeEach(() => {
    useStore.setState({ locale: 'zh-CN' });
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockReset();
  });

  it('renders mermaid fenced code as an svg diagram', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg role="img"><text>A to B</text></svg>',
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MessageContent, {
            text: ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n'),
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(container.querySelector('.ai-mermaid')).not.toBeNull();
      expect(container.querySelector('.ai-mermaid svg')).not.toBeNull();
      expect(container.textContent).toContain('A to B');
      expect(mermaidMocks.render).toHaveBeenCalledWith(
        expect.stringMatching(/^ai-mermaid-/),
        'graph TD\nA-->B',
      );
      expect(container.querySelector('.ai-code')).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders a mermaid fence even when the model glues it to preceding prose', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg role="img"><text>GPU path</text></svg>',
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MessageContent, {
            text: [
              'GPU 硬件执行```mermaid',
              'flowchart LR',
              'A-->B',
              '```',
              '后续说明',
            ].join('\n'),
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(container.textContent).toContain('GPU 硬件执行');
      expect(container.textContent).toContain('后续说明');
      expect(container.querySelector('.ai-mermaid')).not.toBeNull();
      expect(container.querySelector('.ai-mermaid svg')).not.toBeNull();
      expect(container.querySelector('.ai-code')).toBeNull();
      expect(mermaidMocks.render).toHaveBeenCalledWith(
        expect.stringMatching(/^ai-mermaid-/),
        'flowchart LR\nA-->B',
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('does not let a mermaid closing fence with a glued comment swallow prose', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg role="img"><text>clean diagram</text></svg>',
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MessageContent, {
            text: [
              '```mermaid',
              'flowchart LR',
              'A-->B',
              '```%% 模型把注释粘到关闭围栏',
              '后续说明',
            ].join('\n'),
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(container.textContent).toContain('clean diagram');
      expect(container.textContent).toContain('后续说明');
      expect(container.textContent).not.toContain('Mermaid 渲染失败');
      expect(mermaidMocks.render).toHaveBeenCalledWith(
        expect.stringMatching(/^ai-mermaid-/),
        'flowchart LR\nA-->B',
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('falls back to the raw code block when mermaid render fails', async () => {
    mermaidMocks.render.mockRejectedValue(new Error('Parse error'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MessageContent, {
            text: ['```mermaid', 'graph TD', 'A---', '```'].join('\n'),
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(container.textContent).toContain('Mermaid 渲染失败');
      expect(container.textContent).toContain('Parse error');
      expect(container.querySelector('.ai-code')).not.toBeNull();
      expect(container.textContent).toContain('A---');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('cleans up mermaid temp DOM when render fails', async () => {
    mermaidMocks.render.mockImplementation(async (id: string) => {
      const leaked = document.createElement('div');
      leaked.id = `d${id}`;
      leaked.textContent = 'Syntax error in text';
      document.body.appendChild(leaked);
      throw new Error('Parse error');
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MessageContent, {
            text: ['```mermaid', 'graph TD', 'A---', '```'].join('\n'),
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(container.textContent).toContain('Mermaid 渲染失败');
      expect([...document.querySelectorAll('[id^="dai-mermaid-"]')]).toHaveLength(0);
      expect(document.body.textContent).not.toContain('Syntax error in text');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
