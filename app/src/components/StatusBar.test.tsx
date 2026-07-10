import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { simpleBlueprint } from '@/core/defaultBlueprint';
import { recordModelUsageForRoute } from '@/lib/usageMeter';
import { defaultComposer } from '@/store/sampleSessions';
import type { Message } from '@/store/types';

const storeMock = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock('@/store/useStore', () => ({
  useStore: <T,>(selector: (state: Record<string, unknown>) => T): T =>
    selector(storeMock.state),
}));

import StatusBar from './StatusBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function renderStatusBar(): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<StatusBar />);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function resetStatusState(messages: Message[] = []): void {
  window.localStorage.clear();
  storeMock.state = {
    locale: 'zh-CN',
    workflow: simpleBlueprint('Simple chat'),
    composer: { ...defaultComposer, model: 'sonnet' },
    composerDraft: '',
    messages,
    activeWorkspaceId: 'w_status',
    activeSessionId: 's_status',
  };
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('StatusBar', () => {
  it('does not show zero tokens for historical messages that predate usage stamps', async () => {
    resetStatusState([
      {
        id: 'u1',
        role: 'user',
        text: '请分析底部 usage 显示问题。'.repeat(80),
        createdAt: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        text: '已定位为底栏读取 usage meter 失败，需要从会话消息兜底估算。'.repeat(80),
        createdAt: 2,
      },
    ]);

    const view = await renderStatusBar();
    try {
      const tokenItem = view.container.querySelector(
        '[title="当前会话累计 token 用量"]',
      );
      expect(tokenItem?.textContent).toMatch(/tokens(?!0$)/);
    } finally {
      await view.cleanup();
    }
  });

  it('uses the latest real input tokens for the context percentage when usage is richer than text estimate', async () => {
    resetStatusState([
      {
        id: 'u1',
        role: 'user',
        text: '短问题',
        createdAt: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        text: '短回答',
        createdAt: 2,
      },
    ]);
    recordModelUsageForRoute(
      { providerName: 'KuroAI', model: 'gpt-5.5' },
      {
        inputTokens: 80_000,
        outputTokens: 1_000,
        totalTokens: 81_000,
        cacheReadInputTokens: 40_000,
      },
      {
        estimated: false,
        context: { workspaceId: 'w_status', sessionId: 's_status' },
      },
    );

    const view = await renderStatusBar();
    try {
      expect(view.container.textContent).toContain('缓存50%');
      expect(view.container.textContent).toContain('tokens81k');
      expect(view.container.textContent).toContain('上下文40%');
    } finally {
      await view.cleanup();
    }
  });

  it('does not let over-window measured usage replace the current context estimate', async () => {
    resetStatusState([
      {
        id: 'u1',
        role: 'user',
        text: '短问题',
        createdAt: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        text: '短回答',
        createdAt: 2,
      },
    ]);
    recordModelUsageForRoute(
      { providerName: 'Claude Code', model: 'sonnet' },
      {
        inputTokens: 1_228_000,
        outputTokens: 1_000,
        totalTokens: 1_229_000,
        cacheReadInputTokens: 1_000_000,
      },
      {
        estimated: false,
        context: { workspaceId: 'w_status', sessionId: 's_status' },
      },
    );

    const view = await renderStatusBar();
    try {
      const contextItem = view.container.querySelector(
        '[title^="上下文用量"]',
      );
      expect(contextItem?.textContent).not.toContain('614%');
      expect(contextItem?.textContent).not.toContain('100%+');
      expect(contextItem?.getAttribute('title')).toContain('不扣缓存');
    } finally {
      await view.cleanup();
    }
  });
});
