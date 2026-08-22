import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIDock from './AIDock';
import { simpleBlueprint } from '@/core/defaultBlueprint';
import { defaultComposer, samplePromptGroups } from '@/store/sampleSessions';
import type { Message } from '@/store/types';
import { useStore } from '@/store/useStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  ResizeObserverStub.instances = [];
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => {
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    originalResizeObserver;
});

function chatMessages(prefix: string, count = 8): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `${prefix} message ${index}`,
    createdAt: index + 1,
  })) as Message[];
}

function resetChatSession(sessionId: string, messages: Message[]): void {
  useStore.setState({
    mode: 'design',
    workflow: simpleBlueprint('Plain chat'),
    selectedNodeId: null,
    aiStreaming: false,
    aiEditingSessions: [],
    chattingSessions: [],
    blockedSendTip: null,
    locale: 'zh-CN',
    promptAutoTranslate: false,
    promptGroups: samplePromptGroups,
    composer: defaultComposer,
    composerDraft: '',
    composerDrafts: {},
    composerFocusVersion: 0,
    messages,
    activeWorkspaceId: null,
    activeSessionId: sessionId,
    workspaceHistory: [],
    runningSessionProgress: {},
  });
}

async function renderChatDock(): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<AIDock layout="chat" />);
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

function streamElement(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.ugs-ai-return-stream');
  if (!(el instanceof HTMLElement)) throw new Error('Missing AI return stream');
  return el;
}

function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number },
): void {
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
}

async function userScrollTo(el: HTMLElement, top: number): Promise<void> {
  await act(async () => {
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

async function switchSession(
  sessionId: string,
  messages: Message[],
): Promise<void> {
  await act(async () => {
    useStore.setState({ activeSessionId: sessionId, messages });
  });
}

async function appendMessage(message: Message): Promise<void> {
  await act(async () => {
    useStore.setState((state) => ({ messages: [...state.messages, message] }));
  });
}

async function triggerResizeObservers(): Promise<void> {
  await act(async () => {
    for (const instance of ResizeObserverStub.instances) instance.trigger();
  });
}

describe('AIDock scroll when switching to a RUNNING session', () => {
  it('keeps session A pinned at the bottom after session B appends streamed content', async () => {
    resetChatSession('s1', chatMessages('s1'));
    const view = await renderChatDock();

    try {
      const stream = streamElement(view.container);
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });

      // Session A: user drags the scrollbar to the very bottom.
      await userScrollTo(stream, 800);
      expect(stream.scrollTop).toBe(800);

      // Switch to session B, which is RUNNING: it appends streamed messages
      // and its content grows (ResizeObserver fires) while the user is away.
      await switchSession('s2', chatMessages('s2'));
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });
      await userScrollTo(stream, 800);
      for (let i = 0; i < 3; i++) {
        await appendMessage(chatMessages(`s2_stream_${i}`, 1)[0]);
        setScrollMetrics(stream, {
          scrollHeight: 1000 + (i + 1) * 100,
          clientHeight: 200,
        });
        await triggerResizeObservers();
      }

      // Switch back to session A: it must still be at the bottom. The scroll
      // box's scrollHeight reflects A's freshly rendered content again (a real
      // browser recomputes it on every layout), and any residual height change
      // from the previous session is corrected by the ResizeObserver pass.
      await switchSession('s1', chatMessages('s1'));
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });
      await triggerResizeObservers();
      expect(stream.scrollTop).toBe(1000);
    } finally {
      await view.cleanup();
    }
  });

  it('keeps session A pinned at the bottom when session B was scrolled away before streaming', async () => {
    resetChatSession('s1', chatMessages('s1'));
    const view = await renderChatDock();

    try {
      const stream = streamElement(view.container);
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });

      // Session A at the bottom.
      await userScrollTo(stream, 800);

      // Session B: user reads history (scrolled away from the bottom), then
      // the stream appends more content.
      await switchSession('s2', chatMessages('s2'));
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });
      await userScrollTo(stream, 260);
      for (let i = 0; i < 2; i++) {
        await appendMessage(chatMessages(`s2_stream_${i}`, 1)[0]);
        setScrollMetrics(stream, {
          scrollHeight: 1000 + (i + 1) * 100,
          clientHeight: 200,
        });
        await triggerResizeObservers();
      }

      // Back to session A: still at the bottom (its own pinned state must not
      // be affected by session B's streaming).
      await switchSession('s1', chatMessages('s1'));
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });
      await triggerResizeObservers();
      expect(stream.scrollTop).toBe(1000);
    } finally {
      await view.cleanup();
    }
  });

  it('re-pins session A to the bottom when its content grows after restore even if ResizeObserver misses the change', async () => {
    resetChatSession('s1', chatMessages('s1'));
    const view = await renderChatDock();

    try {
      const stream = streamElement(view.container);
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });

      // Session A at the bottom.
      await userScrollTo(stream, 800);

      // Visit session B (running) and come back.
      await switchSession('s2', chatMessages('s2'));
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });
      await userScrollTo(stream, 800);
      await switchSession('s1', chatMessages('s1'));

      // Restore pinned A to the bottom of whatever is rendered right now.
      setScrollMetrics(stream, { scrollHeight: 1000, clientHeight: 200 });
      expect(stream.scrollTop).toBe(1000);

      // The content grows after the restore pass (lazy rich upgrade / message
      // window growth). A real browser fires ResizeObserver here, but the
      // restore must not depend on that asynchronous pass: the next frame
      // should re-align a bottom-pinned session to the new height.
      setScrollMetrics(stream, { scrollHeight: 2000, clientHeight: 200 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(stream.scrollTop).toBe(2000);
    } finally {
      await view.cleanup();
    }
  });
});
