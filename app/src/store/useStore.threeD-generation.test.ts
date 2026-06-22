import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import type { IRGraph } from '@/core/ir';
import {
  DEFAULT_THREE_D_GENERATION_SETTINGS,
  type ThreeDGenerationSettings,
} from '@/lib/threeDGeneration';

const tauriMocks = vi.hoisted(() => ({
  downloadModelAsset: vi.fn(),
}));

vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>(
    '@/lib/tauri',
  );
  return {
    ...actual,
    downloadModelAsset: tauriMocks.downloadModelAsset,
  };
});

import { useStore } from './useStore';

const THREE_D_SETTINGS_KEY = 'ultragamestudio.threeDGeneration.v1';

type ThreeDSettingsTestOverride = Partial<Omit<ThreeDGenerationSettings, 'rigging'>> & {
  rigging?: Partial<ThreeDGenerationSettings['rigging']>;
};

function cloneGraph(graph: IRGraph): IRGraph {
  return JSON.parse(JSON.stringify(graph)) as IRGraph;
}

function writeThreeDSettings(partial: ThreeDSettingsTestOverride): void {
  const { rigging, ...rest } = partial;
  window.localStorage.setItem(
    THREE_D_SETTINGS_KEY,
    JSON.stringify({
      ...DEFAULT_THREE_D_GENERATION_SETTINGS,
      ...rest,
      rigging: {
        ...DEFAULT_THREE_D_GENERATION_SETTINGS.rigging,
        ...rigging,
      },
    }),
  );
}

function resetStore(): void {
  useStore.setState({
    workflow: cloneGraph(defaultBlueprint('3D workflow')),
    selectedNodeId: null,
    mode: 'design',
    aiStreaming: false,
    aiEditingSessions: [],
    dirty: false,
    currentFilePath: null,
    messages: [],
    composerDraft: '',
    composerDrafts: {},
    composer: {
      ...useStore.getState().composer,
      workspace: 'E:\\UltraGameStudio',
    },
    activeSessionId: null,
    activeWorkspaceId: null,
    historyReady: false,
    sessions: [],
    sessionTree: {},
    runState: {},
    runOutputs: {},
    lastRunFailedNodeId: null,
  });
}

async function waitFor(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${description}\n` +
          `messages=${JSON.stringify(useStore.getState().messages, null, 2)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  tauriMocks.downloadModelAsset.mockReset();
  window.localStorage.clear();
  resetStore();
});

describe('3D generation chat flow', () => {
  it('downloads remote model assets and renders local model links in the stream', async () => {
    writeThreeDSettings({
      enabled: true,
      preferredProviderId: 'local-3d-server',
      providerBaseUrls: {
        'local-3d-server': 'http://127.0.0.1:8080/generate',
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'https://assets.meshy.ai/tasks/refined/model.glb',
            zip: 'https://assets.meshy.ai/tasks/refined/model.zip',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    tauriMocks.downloadModelAsset.mockImplementation(async (url: string) => ({
      path: url.endsWith('.zip')
        ? 'E:\\UltraGameStudio\\.ultragamestudio\\model-assets\\model.zip'
        : 'E:\\UltraGameStudio\\.ultragamestudio\\model-assets\\model.glb',
      mime: url.endsWith('.zip') ? 'application/zip' : 'model/gltf-binary',
      sizeBytes: 4,
    }));

    useStore.getState().generateThreeDPrompt('/3d 一个卡通娃娃');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('3D 模型生成完成');
    }, '3D generation to finish');

    const assistant = useStore
      .getState()
      .messages.find((message) => message.role === 'assistant');

    expect(tauriMocks.downloadModelAsset).toHaveBeenCalledWith(
      'https://assets.meshy.ai/tasks/refined/model.glb',
      expect.objectContaining({
        cwd: 'E:\\UltraGameStudio',
        fileName: '3d-model-1.glb',
      }),
    );
    expect(tauriMocks.downloadModelAsset).toHaveBeenCalledWith(
      'https://assets.meshy.ai/tasks/refined/model.zip',
      expect.objectContaining({
        cwd: 'E:\\UltraGameStudio',
        fileName: '3d-model-2.zip',
      }),
    );
    expect(assistant?.text).toContain('已下载到本地');
    expect(assistant?.text).toContain(
      '[预览 3D 模型 1](file:///E:/UltraGameStudio/.ultragamestudio/model-assets/model.glb)',
    );
    expect(assistant?.text).not.toContain(
      '[预览 3D 模型 1](https://assets.meshy.ai/tasks/refined/model.glb)',
    );
  });

  it('renders the auto-rigged model in the stream when fal rigging succeeds', async () => {
    writeThreeDSettings({
      enabled: true,
      preferredProviderId: 'local-3d-server',
      providerKeys: { 'fal-tripo-h31': 'fal_key' },
      providerBaseUrls: {
        'local-3d-server': 'http://127.0.0.1:8080/generate',
        'fal-meshy-v6': 'https://queue.test',
      },
      rigging: { enabled: true },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model_urls: {
              glb: 'https://assets.example.com/out/character.glb',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            glb_url: 'https://assets.example.com/out/character-rigged.glb',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    tauriMocks.downloadModelAsset.mockResolvedValue({
      path: 'E:\\UltraGameStudio\\.ultragamestudio\\model-assets\\character-rigged.glb',
      mime: 'model/gltf-binary',
      sizeBytes: 4,
    });

    useStore.getState().generateThreeDPrompt('/3d 人形机器人角色');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('自动绑骨完成');
    }, 'auto-rigged 3D generation to finish');

    const assistant = useStore
      .getState()
      .messages.find((message) => message.role === 'assistant');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://queue.test/fal-ai/meshy/rigging',
      expect.objectContaining({
        body: JSON.stringify({
          input: { model_url: 'https://assets.example.com/out/character.glb' },
        }),
      }),
    );
    expect(tauriMocks.downloadModelAsset).toHaveBeenCalledWith(
      'https://assets.example.com/out/character-rigged.glb',
      expect.objectContaining({
        cwd: 'E:\\UltraGameStudio',
        fileName: '3d-model-1.glb',
      }),
    );
    expect(assistant?.text).toContain('fal.ai Meshy Rigging 自动绑骨完成');
    expect(assistant?.text).toContain(
      '[预览 3D 模型 1](file:///E:/UltraGameStudio/.ultragamestudio/model-assets/character-rigged.glb)',
    );
    expect(assistant?.text).not.toContain('character.glb)');
  });

  it('merges sticky mesh-mode prompts since mode start', async () => {
    writeThreeDSettings({
      enabled: true,
      preferredProviderId: 'local-3d-server',
      providerBaseUrls: {
        'local-3d-server': 'http://127.0.0.1:8080/generate',
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'https://assets.meshy.ai/tasks/refined/young-doll.glb',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    tauriMocks.downloadModelAsset.mockResolvedValue({
      path: 'E:\\UltraGameStudio\\.ultragamestudio\\model-assets\\young-doll.glb',
      mime: 'model/gltf-binary',
      sizeBytes: 4,
    });
    useStore.setState((state) => ({
      composer: {
        ...state.composer,
        threeDMode: true,
        threeDModeStartedAt: 100,
      },
      messages: [
        {
          id: 'm_first',
          role: 'user',
          text: '帮我生成卡通芭比娃娃',
          createdAt: 110,
        },
      ],
    }));

    useStore.getState().generateThreeDPrompt('要更年轻些');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('3D 模型生成完成');
    }, 'sticky mesh generation to finish');

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    ) as { prompt?: string };
    expect(body.prompt).toContain('卡通芭比娃娃');
    expect(body.prompt).toContain('要更年轻些');
  });
});
