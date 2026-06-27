import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LazyMessageContent from './LazyMessageContent';

vi.mock('./MessageContent', () => ({
  default: ({ text }: { text: string }) => (
    <div data-testid="rich-message">{text}</div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(content: ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(content);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
});

describe('LazyMessageContent', () => {
  it('defers eager rich rendering for historical messages until after first paint', async () => {
    const initialMarkup = renderToStaticMarkup(
      <LazyMessageContent text="rich markdown" fallback="plain text" eager />,
    );
    expect(initialMarkup).toContain('plain text');
    expect(initialMarkup).not.toContain('rich-message');

    const view = mount(
      <LazyMessageContent text="rich markdown" fallback="plain text" eager />,
    );

    await act(async () => {});

    expect(view.querySelector('[data-testid="rich-message"]')?.textContent).toBe(
      'rich markdown',
    );
  });

  it('keeps the live streaming bubble rich on the first paint', () => {
    const initialMarkup = renderToStaticMarkup(
      <LazyMessageContent
        text="streaming markdown"
        fallback="plain text"
        eager
        streaming
      />,
    );

    expect(initialMarkup).toContain('rich-message');
    expect(initialMarkup).toContain('streaming markdown');
  });
});
