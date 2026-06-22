import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { simpleBlueprint } from '@/core/defaultBlueprint';
import { DEFAULT_GAME_EXPERT_SETTINGS } from '@/lib/gameExperts';
import { defaultComposer, samplePromptGroups } from '@/store/sampleSessions';
import { useStore } from '@/store/useStore';
import AIDock from './AIDock';
import ProjectFileTree from './ProjectFileTree';

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
    listWorkspaceVcsStatus: vi.fn(async (rootPath: string) => ({
      rootPath,
      generatedAtMs: 1,
      source: 'git',
      files: [],
      truncated: false,
      scanScope: 'full',
    })),
    listWorkspaceVcsStatusShallow: vi.fn(async (rootPath: string) => ({
      rootPath,
      generatedAtMs: 1,
      source: 'git',
      files: [],
      truncated: false,
      scanScope: 'root',
    })),
    slashCatalog: async () => ({
      scannedAtMs: 1,
      ready: true,
      entries: [],
    }),
    onSlashCatalogUpdated: async () => () => {},
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
    id: 'ws_game_team_app_details',
    path: 'E:\\UltraGameStudio',
    name: 'UltraGameStudio',
    updatedAt: 1,
    sessionCount: 1,
    lastActiveSessionId: 's_game_team_app_details',
  };
  useStore.setState({
    mode: 'design',
    workflow: simpleBlueprint('Game team details'),
    selectedNodeId: null,
    aiStreaming: false,
    aiEditingSessions: [],
    chattingSessions: [],
    locale: 'zh-CN',
    promptAutoTranslate: false,
    promptGroups: samplePromptGroups,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeSessionId: 's_game_team_app_details',
    composer: { ...defaultComposer, workspace: workspace.path },
    composerDraft: '',
    composerDrafts: {},
    composerFocusVersion: 0,
    messages: [],
    workspaceHistory: [],
    runningSessionProgress: {},
    gameExpertSettings: {
      ...DEFAULT_GAME_EXPERT_SETTINGS,
      enabled: true,
    },
  });
}

async function renderHarness(): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <>
        <AIDock layout="chat" />
        <ProjectFileTree />
      </>,
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
  vi.clearAllMocks();
});

describe('game team details app wiring', () => {
  it('opens the right panel role details from an organization node click', async () => {
    resetStore();
    const view = await renderHarness();

    try {
      const organizationTab = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>(
          'button[data-org-panel-trigger]',
        ),
      ).find((button) => button.textContent?.includes('组织架构'));
      expect(organizationTab).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        organizationTab?.click();
      });

      const producerNode = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.includes('制作人'));
      expect(producerNode).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        producerNode?.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });

      expect(view.container.textContent).toContain('岗位视角和 Skill');
      expect(view.container.textContent).toContain('制作人');
      expect(view.container.textContent).toContain('发起新游戏项目');
      expect(view.container.textContent).toContain('修改项目目标');
    } finally {
      await view.cleanup();
    }
  });
});
