import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSelect from '@/components/WorkspaceSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function renderWorkspaceSelect(props: {
  value: string;
  history: string[];
  extraFolders?: string[];
  onSelect?: (path: string) => void;
  onAddFolder?: (path: string) => void;
  onRemoveFolder?: (path: string) => void;
  onRemove?: (path: string) => void;
}): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const { onSelect, onRemove, ...rest } = props;
  await act(async () => {
    root.render(
      <WorkspaceSelect
        {...rest}
        onSelect={onSelect ?? vi.fn()}
        onRemove={onRemove}
      />,
    );
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

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('WorkspaceSelect', () => {
  it('renders normalized duplicate workspace history entries once', async () => {
    const view = await renderWorkspaceSelect({
      value: 'E:\\Game',
      history: [
        'E:\\Game',
        'e:/Game/',
        'E:\\UltraGameStudio',
        'E:\\Game\\',
      ],
    });

    try {
      const trigger = view.container.querySelector('button');
      expect(trigger).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        trigger?.click();
      });

      const options = Array.from(
        view.container.querySelectorAll('[role="option"]'),
      );
      expect(options).toHaveLength(2);
      expect(options.map((item) => item.textContent?.trim())).toEqual([
        '●Game',
        '●UltraGameStudio',
      ]);
    } finally {
      await view.cleanup();
    }
  });

  it('removes a folder via its delete button without selecting it', async () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const view = await renderWorkspaceSelect({
      value: 'E:\\Game',
      history: ['E:\\Game', 'E:\\UltraGameStudio'],
      onSelect,
      onRemove,
    });

    try {
      const trigger = view.container.querySelector('button');
      await act(async () => {
        trigger?.click();
      });

      const removeButtons = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>(
          'li button:not([role="option"])',
        ),
      );
      expect(removeButtons).toHaveLength(2);

      await act(async () => {
        removeButtons[1]?.click();
      });

      expect(onRemove).toHaveBeenCalledWith('E:\\UltraGameStudio');
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      await view.cleanup();
    }
  });

  it('omits delete buttons when onRemove is not provided', async () => {
    const view = await renderWorkspaceSelect({
      value: '',
      history: ['E:\\Game'],
    });

    try {
      const trigger = view.container.querySelector('button');
      await act(async () => {
        trigger?.click();
      });

      const removeButtons = view.container.querySelectorAll(
        'li button:not([role="option"])',
      );
      expect(removeButtons).toHaveLength(0);
    } finally {
      await view.cleanup();
    }
  });

  it('shows session-added folders and removes them without deleting history', async () => {
    const onRemoveFolder = vi.fn();
    const onRemove = vi.fn();
    const view = await renderWorkspaceSelect({
      value: 'E:\\MoonEngine',
      extraFolders: ['E:\\Game'],
      history: ['E:\\MoonEngine', 'E:\\Game'],
      onRemoveFolder,
      onRemove,
    });

    try {
      const trigger = view.container.querySelector('button');
      expect(trigger?.textContent).toContain('MoonEngine +1');

      await act(async () => {
        trigger?.click();
      });

      expect(view.container.textContent).toMatch(/当前会话|Current session/);
      expect(view.container.textContent).toMatch(/附加|Extra/);

      const removeButtons = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="从本会话移除"], button[aria-label="Remove from this session"]',
        ),
      );
      expect(removeButtons).toHaveLength(1);

      await act(async () => {
        removeButtons[0]?.click();
      });

      expect(onRemoveFolder).toHaveBeenCalledWith('E:\\Game');
      expect(onRemove).not.toHaveBeenCalled();
    } finally {
      await view.cleanup();
    }
  });
});
