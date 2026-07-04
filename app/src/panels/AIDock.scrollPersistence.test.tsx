import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { resetSecureStorageForTests } from '@/lib/secureStorage';
import { defaultComposer, samplePromptGroups } from '@/store/sampleSessions';
import type { Message } from '@/store/types';
import { useStore } from '@/store/useStore';
import AIDock from './AIDock';

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>();
  return { ...actual, tauriAvailable: () => true };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as typeof ResizeObserver;

function makeMessages(prefix: string, count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `${prefix} message ${i} `.repeat(20),
    createdAt: Date.now() + i,
  }));
}

const sessionAMessages = makeMessages('a', 12);
const sessionBMessages = makeMessages('b', 12);

function resetStore(): void {
  useStore.setState({
    mode: 'design',
    workflow: defaultBlueprint('Scroll persistence'),
    selectedNodeId: null,
    aiStreaming: false,
    aiEditingSessions: [],
    chattingSessions: [],
    locale: 'zh-CN',
    promptGroups: samplePromptGroups,
    composer: { ...defaultComposer, workspace: 'E:\\UltraGameStudio' },
    composerDraft: '',
    composerDrafts: {},
    composerFocusVersion: 0,
    messages: sessionAMessages,
    activeWorkspaceId: null,
    activeSessionId: 'session-a',
    workspaceHistory: [],
    runningSessionProgress: {},
  });
}

async function renderDock(): Promise<{
  container: HTMLDivElement;
  root: Root;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<AIDock />);
  });
  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getStream(container: HTMLDivElement): HTMLDivElement {
  const el = container.querySelector('.ugs-ai-return-stream');
  if (!el) throw new Error('stream element not found');
  return el as HTMLDivElement;
}

// jsdom does not implement real scroll/overflow layout: scrollHeight and
// clientHeight are plain zero-valued properties, scrollTop is not clamped to
// [0, scrollHeight - clientHeight] the way a real browser clamps it, and
// `scrollTo` is a no-op. We stub all of them so the code under test sees
// browser-like scrolling semantics.
interface ScrollStub {
  __setScrollHeight: (v: number) => void;
  __setClientHeight: (v: number) => void;
}

function stubScrollBox(el: HTMLElement): void {
  let scrollHeight = 0;
  let clientHeight = 0;
  let scrollTop = 0;
  const clamp = (v: number) => Math.max(0, Math.min(v, scrollHeight - clientHeight));
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = clamp(v);
    },
  });
  el.scrollTo = ((opts?: ScrollToOptions | number) => {
    const top = typeof opts === 'object' && opts ? (opts.top ?? scrollTop) : scrollTop;
    scrollTop = clamp(top);
  }) as typeof el.scrollTo;
  (el as unknown as ScrollStub).__setScrollHeight = (v) => {
    scrollHeight = v;
  };
  (el as unknown as ScrollStub).__setClientHeight = (v) => {
    clientHeight = v;
  };
}

function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
): void {
  if (!(el as unknown as Partial<ScrollStub>).__setScrollHeight) {
    stubScrollBox(el);
  }
  (el as unknown as ScrollStub).__setScrollHeight(metrics.scrollHeight);
  (el as unknown as ScrollStub).__setClientHeight(metrics.clientHeight);
  el.scrollTop = metrics.scrollTop;
}

async function fireScroll(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new Event('scroll'));
  });
}

function reactProps(node: Element): Record<string, unknown> {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'));
  if (!key) throw new Error('Missing React props on node');
  return (node as unknown as Record<string, Record<string, unknown>>)[key];
}

function textarea(container: HTMLDivElement): HTMLTextAreaElement {
  const input = container.querySelector('textarea');
  if (!input) throw new Error('Missing composer textarea');
  return input;
}

// Simulates the user hitting the send shortcut (Ctrl+Enter by default) without
// depending on real DOM key-event dispatch/shortcut config plumbing — invokes
// the textarea's onKeyDown handler directly, the same way AIDock.paste.test.tsx
// drives onPaste.
async function pressSendShortcut(el: HTMLTextAreaElement): Promise<void> {
  const props = reactProps(el);
  const onKeyDown = props.onKeyDown as ((event: unknown) => void) | undefined;
  if (!onKeyDown) throw new Error('Missing onKeyDown handler');
  const nativeEvent = { key: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
  await act(async () => {
    onKeyDown({
      ...nativeEvent,
      nativeEvent,
      currentTarget: el,
      preventDefault: () => {},
    });
  });
}

describe('AIDock per-session scroll persistence', () => {
  afterEach(() => {
    resetSecureStorageForTests();
  });

  it('restores each session own scroll position after switching away and back', async () => {
    resetStore();
    const { container, cleanup } = await renderDock();
    try {
      const stream = getStream(container);

      // Session A: user scrolled to top.
      setScrollMetrics(stream, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
      await fireScroll(stream);
      expect(stream.scrollTop).toBe(0);

      // Switch to session B: simulate it landing at the bottom (AI just replied).
      await act(async () => {
        useStore.setState({ activeSessionId: 'session-b', messages: sessionBMessages });
      });
      const streamB = getStream(container);
      setScrollMetrics(streamB, { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 });
      await fireScroll(streamB);
      expect(streamB.scrollTop).toBe(1500);

      // Switch back to session A: should restore near-top position, independent
      // of session B state.
      await act(async () => {
        useStore.setState({ activeSessionId: 'session-a', messages: sessionAMessages });
      });
      const streamA2 = getStream(container);
      expect(streamA2.scrollTop).toBe(0);

      // Switch back to session B: should restore the remembered bottom position,
      // NOT session A's top position.
      await act(async () => {
        useStore.setState({ activeSessionId: 'session-b', messages: sessionBMessages });
      });
      const streamB2 = getStream(container);
      expect(streamB2.scrollTop).toBe(1500);
    } finally {
      await cleanup();
    }
  });

  it('does not clobber another session scroll position with a stale forced-bottom send request', async () => {
    // Regression test for: sending a message pins the CURRENT session to the
    // bottom via a "force next scroll to bottom" flag that only gets consumed
    // once `messages.length` changes. The actual message append happens after
    // a couple of `await`s (ensureSelectedLocalChannelReady /
    // ensureSessionStartupWorkspace), so if the user switches away before
    // that append lands, `messages.length` changes anyway (because the
    // messages array swaps to the other session's) and could incorrectly
    // consume the stale flag against the WRONG session, force-scrolling it to
    // the bottom and destroying its own remembered position.
    resetStore();
    // A and B intentionally have different message counts: the bug hinges on
    // `messages.length` changing across the session switch (the array swaps
    // to the other session's), which is what fires the buggy effect even
    // though no message was actually appended to either session yet.
    const raceSessionAMessages = makeMessages('race-a', 4);
    const raceSessionBMessages = makeMessages('race-b', 7);
    useStore.setState({ activeSessionId: 'session-b', messages: raceSessionBMessages });
    // Stall the async submit pipeline right after the pre-send bottom-pin, so
    // the flag stays pending while we switch sessions underneath it.
    const ensureStartupSpy = vi.fn(() => new Promise<void>(() => {}));
    useStore.setState({
      ensureSessionStartupWorkspace: ensureStartupSpy,
    });
    const { container, cleanup } = await renderDock();
    try {
      // Visit session A first and park it at a non-bottom position.
      await act(async () => {
        useStore.setState({ activeSessionId: 'session-a', messages: raceSessionAMessages });
      });
      const streamA = getStream(container);
      setScrollMetrics(streamA, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
      await fireScroll(streamA);
      expect(streamA.scrollTop).toBe(0);

      // Switch to session B and send a message there — this pins B to the
      // bottom and stalls before the message actually lands in `messages`.
      await act(async () => {
        useStore.setState({ activeSessionId: 'session-b', messages: raceSessionBMessages });
      });
      const streamB = getStream(container);
      setScrollMetrics(streamB, { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 });
      await fireScroll(streamB);

      const input = textarea(container);
      await act(async () => {
        useStore.setState({ composerDraft: 'hello there' });
      });
      await pressSendShortcut(input);
      // Sanity check: the submit pipeline actually reached (and stalled on)
      // the async gate, i.e. pinActiveStreamToBottom really ran for session B.
      expect(ensureStartupSpy).toHaveBeenCalledTimes(1);

      // Switch back to session A BEFORE the stalled send resolves. Session A
      // must keep its own remembered (non-bottom) position — the pending
      // "force bottom" intent belongs to session B alone.
      await act(async () => {
        useStore.setState({ activeSessionId: 'session-a', messages: raceSessionAMessages });
      });
      const streamA2 = getStream(container);
      expect(streamA2.scrollTop).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
