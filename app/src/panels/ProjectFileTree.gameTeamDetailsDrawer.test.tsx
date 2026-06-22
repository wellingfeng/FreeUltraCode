import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_EXPERT_SETTINGS } from '@/lib/gameExperts';
import { encodeToolPatch } from '@/components/ai/lib/toolEvent';
import { defaultComposer } from '@/store/sampleSessions';
import type { Message } from '@/store/types';
import { useStore } from '@/store/useStore';
import ProjectFileTree from './ProjectFileTree';
import { OPEN_GAME_TEAM_DETAILS_EVENT } from './GameTeamPanel';

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

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ProjectFileTree game team details vs file preview drawer', () => {
  it('shows role details (not the file tree) when an org node is clicked while a file preview is open', async () => {
    resetStore();
    const view = await renderProjectFileTree();

    try {
      // 1) Switch to the session-files tab and open a file preview, which mounts
      //    the FilePreviewDrawer (a fixed inset-0 z-50 overlay over the right column).
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

      const fileButton = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((btn) => (btn.textContent ?? '').includes('App.tsx'));
      expect(fileButton, 'session file row should exist').toBeTruthy();
      await act(async () => {
        fileButton!.click();
      });

      // Drawer is now open (its close affordance / preview header is present).
      expect(document.body.textContent).toContain('App.tsx');

      // 2) Simulate clicking an org node: the real chart fires a pointerdown that
      //    bubbles to document (the drawer's capture-phase outside-click handler),
      //    immediately followed by the OPEN_GAME_TEAM_DETAILS_EVENT dispatched in
      //    the click handler. This is the exact runtime sequence the isolated
      //    details test never exercised.
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
