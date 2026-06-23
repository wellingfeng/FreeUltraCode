import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_EXPERT_SETTINGS } from '@/lib/gameExperts';
import { defaultComposer } from '@/store/sampleSessions';
import { useStore } from '@/store/useStore';
import ProjectFileTree from './ProjectFileTree';
import { OPEN_GAME_TEAM_DETAILS_EVENT } from './GameTeamPanel';

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
  };
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as typeof ResizeObserver;

function resetStore(): void {
  const workspace = {
    id: 'ws_game_team_details',
    path: 'E:\\UltraGameStudio',
    name: 'UltraGameStudio',
    updatedAt: 1,
    sessionCount: 1,
    lastActiveSessionId: 's_game_team_details',
  };
  useStore.setState({
    locale: 'zh-CN',
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeSessionId: 's_game_team_details',
    composer: { ...defaultComposer, workspace: workspace.path },
    composerDraft: '',
    composerDrafts: {},
    messages: [],
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
});

describe('ProjectFileTree game team details', () => {
  it('opens role properties and skills in the same right panel slot', async () => {
    resetStore();
    const view = await renderProjectFileTree();

    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(OPEN_GAME_TEAM_DETAILS_EVENT, {
            detail: { nodeId: 'technical-director' },
          }),
        );
      });

      const asides = view.container.querySelectorAll('aside');
      const rightPanel = asides[0];

      expect(asides).toHaveLength(1);
      expect(view.container.querySelector('.fixed.inset-0')).toBeNull();
      expect(rightPanel?.textContent).toContain('岗位视角和 Skill');
      expect(rightPanel?.textContent).toContain('专家视角库 / 岗位视角与 Skill');
      expect(rightPanel?.textContent).toContain('技术总监');
      expect(rightPanel?.textContent).toContain('职责');
      expect(rightPanel?.textContent).toContain('发起功能开发');
    } finally {
      await view.cleanup();
    }
  });
});
