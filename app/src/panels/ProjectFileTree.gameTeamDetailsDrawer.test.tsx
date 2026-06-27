import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_EXPERT_SETTINGS } from '@/lib/gameExperts';
import { encodeToolPatch } from '@/components/ai/lib/toolEvent';
import { defaultComposer } from '@/store/sampleSessions';
import type { Message } from '@/store/types';
import { useStore } from '@/store/useStore';
import { workspaceFileDiff } from '@/lib/tauri';
import ProjectFileTree from './ProjectFileTree';
import { OPEN_GAME_TEAM_DETAILS_EVENT } from './GameTeamPanel';
import { OPEN_PROJECT_RIGHT_PANEL_FILE_PREVIEW_EVENT } from './projectRightPanelEvents';

// The file-preview drawer reads a local file when previewRef is set. Stub it so
// opening the drawer in this jsdom test resolves to a small text preview instead
// of hitting the (absent) tauri backend.
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>();
  return {
    ...actual,
    listWorkspaceDirectory: vi.fn(async (rootPath: string, relativePath: string) => ({
      rootPath,
      relativePath,
      entries: [],
      truncated: false,
      totalEntries: 0,
    })),
    previewLocalFile: vi.fn(async (path: string) => ({
      path,
      fileName: path.split(/[\\/]/).pop() ?? path,
      kind: 'text' as const,
      text: 'export const x = 1;\n',
      mime: 'text/plain',
      sizeBytes: 20,
      truncated: false,
    })),
    workspaceFileDiff: vi.fn(async () => null),
  };
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as typeof ResizeObserver;

function toolBlock(id: string, name: string, extra: Record<string, unknown>): string {
  return encodeToolPatch({ id, name, status: 'done', ...extra });
}

function resetStore(): void {
  const workspace = {
    id: 'ws_game_team_drawer',
    path: 'E:\\UltraGameStudio',
    name: 'UltraGameStudio',
    updatedAt: 1,
    sessionCount: 1,
    lastActiveSessionId: 's_game_team_drawer',
  };
  const editMessage: Message = {
    id: 'a1',
    role: 'assistant',
    createdAt: 10,
    text: toolBlock('e1', 'Write', { args: { file_path: 'app/src/App.tsx' } }),
  };
  useStore.setState({
    locale: 'zh-CN',
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeSessionId: 's_game_team_drawer',
    composer: { ...defaultComposer, workspace: workspace.path },
    composerDraft: '',
    composerDrafts: {},
    messages: [editMessage],
    gameExpertSettings: {
      ...DEFAULT_GAME_EXPERT_SETTINGS,
      enabled: true,
    },
  });
}

async function renderProjectFileTree(): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<ProjectFileTree />);
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

async function flushAsyncSessionFiles(): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ProjectFileTree game team details vs file preview drawer', () => {
  it('defers session-file derivation until after the panel can paint', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('ultragamestudio.projectRightPanelTab.v1', 'session');
    resetStore();
    const view = await renderProjectFileTree();

    try {
      expect(view.container.textContent).toContain('读取会话文件');
      expect(view.container.textContent).not.toContain('App.tsx');

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(view.container.textContent).toContain('App.tsx');
    } finally {
      await view.cleanup();
      vi.useRealTimers();
    }
  });

  it('handles global file preview requests inside the existing project panel', async () => {
    resetStore();
    const view = await renderProjectFileTree();

    try {
      const event = new CustomEvent(OPEN_PROJECT_RIGHT_PANEL_FILE_PREVIEW_EVENT, {
        cancelable: true,
        detail: {
          ref: {
            path: 'app/src/config/gameOrgDefaults.json',
            basename: 'gameOrgDefaults.json',
          },
          cwd: 'E:\\UltraGameStudio',
        },
      });

      await act(async () => {
        window.dispatchEvent(event);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(event.defaultPrevented).toBe(true);
      expect(view.container.querySelector('[role="tablist"]')).toBeNull();
      expect(view.container.textContent).toContain('gameOrgDefaults.json');
      expect(view.container.querySelectorAll('aside')).toHaveLength(1);
      expect(view.container.querySelector('.fixed.inset-0')).toBeNull();
      expect(workspaceFileDiff).not.toHaveBeenCalled();
    } finally {
      await view.cleanup();
    }
  });

  it('keeps an embedded session file preview open when resizing the project panel', async () => {
    resetStore();
    const view = await renderProjectFileTree();

    try {
      const tabButtons = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
      );
      const sessionTab = tabButtons.find((btn) =>
        (btn.textContent ?? '').includes('会话文件'),
      );
      expect(sessionTab, 'session-files tab should exist').toBeTruthy();
      await act(async () => {
        sessionTab!.click();
      });
      await flushAsyncSessionFiles();

      const fileButton = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((btn) => (btn.textContent ?? '').includes('App.tsx'));
      expect(fileButton, 'session file row should exist').toBeTruthy();
      await act(async () => {
        fileButton!.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(view.container.querySelector('[role="tablist"]')).toBeNull();
      expect(
        view.container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]'),
      ).not.toBeNull();
      expect(workspaceFileDiff).toHaveBeenCalledWith(
        'E:\\UltraGameStudio',
        'app/src/App.tsx',
      );

      const resizeHandle = view.container.querySelector<HTMLElement>(
        '[title="拖动调整宽度"]',
      );
      expect(resizeHandle, 'project panel resize handle should exist').toBeTruthy();

      await act(async () => {
        resizeHandle!.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
        );
      });

      expect(view.container.querySelector('[role="tablist"]')).toBeNull();
      expect(
        view.container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]'),
      ).not.toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  it('collapses a session file preview on outside click and keeps session files visible', async () => {
    resetStore();
    const view = await renderProjectFileTree();

    try {
      const tabButtons = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
      );
      const sessionTab = tabButtons.find((btn) =>
        (btn.textContent ?? '').includes('会话文件'),
      );
      expect(sessionTab, 'session-files tab should exist').toBeTruthy();
      await act(async () => {
        sessionTab!.click();
      });
      await flushAsyncSessionFiles();

      const fileButton = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((btn) => (btn.textContent ?? '').includes('App.tsx'));
      expect(fileButton, 'session file row should exist').toBeTruthy();
      await act(async () => {
        fileButton!.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(view.container.textContent).toContain('App.tsx');

      await act(async () => {
        document.body.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
        );
      });

      const restoredSessionTab = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
      ).find((btn) => (btn.textContent ?? '').includes('会话文件'));
      expect(restoredSessionTab).toBeTruthy();
      expect(restoredSessionTab?.getAttribute('aria-selected')).toBe('true');
      expect(view.container.textContent).toContain('App.tsx');
    } finally {
      await view.cleanup();
    }
  });

  it('shows role details (not the file tree) when an org node is clicked while a file preview is open', async () => {
    resetStore();
    const view = await renderProjectFileTree();

    try {
      // 1) Switch to the session-files tab and open a file preview, which reuses
      //    the right project panel instead of mounting a second fixed drawer.
      const tabButtons = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
      );
      const sessionTab = tabButtons.find((btn) =>
        (btn.textContent ?? '').includes('会话文件'),
      );
      expect(sessionTab, 'session-files tab should exist').toBeTruthy();
      await act(async () => {
        sessionTab!.click();
      });
      await flushAsyncSessionFiles();

      const fileButton = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((btn) => (btn.textContent ?? '').includes('App.tsx'));
      expect(fileButton, 'session file row should exist').toBeTruthy();
      await act(async () => {
        fileButton!.click();
      });

      // Drawer is now open (its close affordance / preview header is present).
      expect(document.body.textContent).toContain('App.tsx');
      expect(view.container.querySelectorAll('aside')).toHaveLength(1);
      expect(view.container.querySelector('.fixed.inset-0')).toBeNull();

      // 2) Simulate clicking an org node: the real chart fires a pointerdown that
      //    bubbles to document, immediately followed by the
      //    OPEN_GAME_TEAM_DETAILS_EVENT dispatched in the click handler.
      await act(async () => {
        // jsdom has no PointerEvent; the drawer's listener keys off the event
        // type string, so a MouseEvent named 'pointerdown' exercises the same path.
        document.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
        );
        window.dispatchEvent(
          new CustomEvent(OPEN_GAME_TEAM_DETAILS_EVENT, {
            detail: { nodeId: 'technical-director' },
          }),
        );
      });

      // 3) The right panel must show the role lens + skills, and the details
      //    state must NOT have been wiped back to the file tree by the drawer's
      //    outside-click onClose.
      expect(view.container.textContent).toContain('岗位视角和 Skill');
      expect(view.container.textContent).toContain('技术总监');
      expect(view.container.textContent).toContain('发起功能开发');
    } finally {
      await view.cleanup();
    }
  });
});
