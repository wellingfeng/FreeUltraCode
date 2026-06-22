import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import type { IRGraph } from '@/core/ir';
import {
  DEFAULT_WORLD_MODEL_GENERATION_SETTINGS,
  type WorldModelGenerationSettings,
} from '@/lib/worldModel';
import { useStore } from './useStore';

const WORLD_MODEL_SETTINGS_KEY = 'ultragamestudio.worldModelGeneration.v1';

function cloneGraph(graph: IRGraph): IRGraph {
  return JSON.parse(JSON.stringify(graph)) as IRGraph;
}

function writeWorldModelSettings(
  partial: Partial<WorldModelGenerationSettings>,
): void {
  window.localStorage.setItem(
    WORLD_MODEL_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_WORLD_MODEL_GENERATION_SETTINGS, ...partial }),
  );
}

function resetStore(): void {
  useStore.setState({
    workflow: cloneGraph(defaultBlueprint('World model workflow')),
    selectedNodeId: null,
    mode: 'design',
    aiStreaming: false,
    aiEditingSessions: [],
    dirty: false,
    currentFilePath: null,
    messages: [],
    composerDraft: '',
    composerDrafts: {},
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
  window.localStorage.clear();
  resetStore();
});

describe('world-model generation chat flow', () => {
  it('routes /worldmodel through the configured provider and renders a worldmodel block', async () => {
    writeWorldModelSettings({
      enabled: true,
      preferredProviderId: 'local-world-server',
      providerBaseUrls: {
        'local-world-server': 'http://127.0.0.1:8210/session',
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionUrl: 'https://world.example.com/session/1',
          title: '宇宙飞船舷窗',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    useStore.getState().generateWorldPrompt('/worldmodel 站在宇宙飞船里看地球');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('世界模型生成完成');
    }, 'world model generation to finish');

    const assistant = useStore
      .getState()
      .messages.find((message) => message.role === 'assistant');
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    ) as { prompt?: string };

    expect(body.prompt).toBe('站在宇宙飞船里看地球');
    expect(assistant?.text).toContain('```worldmodel');
    expect(assistant?.text).toContain('"sessionUrl": "https://world.example.com/session/1"');
    expect(assistant?.text).not.toContain('你是交互式可玩世界模型');
  });

  it('merges sticky world-model prompts since mode start', async () => {
    writeWorldModelSettings({
      enabled: true,
      preferredProviderId: 'local-world-server',
      providerBaseUrls: {
        'local-world-server': 'http://127.0.0.1:8210/session',
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionUrl: 'https://world.example.com/session/2',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    useStore.setState((state) => ({
      composer: {
        ...state.composer,
        worldMode: true,
        worldModeStartedAt: 100,
      },
      messages: [
        {
          id: 'm_first',
          role: 'user',
          text: '站在宇宙飞船里看地球',
          createdAt: 110,
        },
      ],
    }));

    useStore.getState().generateWorldPrompt('窗外有月球');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('世界模型生成完成');
    }, 'sticky world model generation to finish');

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    ) as { prompt?: string };
    expect(body.prompt).toContain('站在宇宙飞船里看地球');
    expect(body.prompt).toContain('窗外有月球');
  });
});
