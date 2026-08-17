import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import type { IRGraph } from '@/core/ir';
import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  type ImageGenerationSettings,
} from '@/lib/imageGeneration';
import { useStore } from './useStore';
import { historyStore } from './history/store';

const IMAGE_SETTINGS_KEY = 'ultragamestudio.imageGeneration.v1';

function cloneGraph(graph: IRGraph): IRGraph {
  return JSON.parse(JSON.stringify(graph)) as IRGraph;
}

function writeImageSettings(partial: Partial<ImageGenerationSettings>): void {
  window.localStorage.setItem(
    IMAGE_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_IMAGE_GENERATION_SETTINGS, ...partial }),
  );
}

function resetStore(): void {
  useStore.setState({
    workflow: cloneGraph(defaultBlueprint('Image workflow')),
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

describe('image generation chat flow', () => {
  it('routes /image through the provider and renders the returned image', async () => {
    writeImageSettings({
      enabled: true,
      preferredProviderId: 'minimax',
      providerKeys: { minimax: 'test-key' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: ['https://example.com/generated.png'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    useStore.getState().generateImagePrompt('/image 一张赛博朋克海报');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('图片生成完成');
    }, 'image generation to finish');

    const messages = useStore.getState().messages;
    const user = messages.find((message) => message.role === 'user');
    const assistant = messages.find((message) => message.role === 'assistant');

    expect(user?.text).toBe('/image 一张赛博朋克海报');
    expect(assistant?.text).toContain('MiniMax 海螺');
    expect(assistant?.text).toContain('一张赛博朋克海报');
    expect(assistant?.text).toContain(
      '![生成图片 1](https://example.com/generated.png)',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/image_generation',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('merges sticky image-mode prompts since mode start', async () => {
    writeImageSettings({
      enabled: true,
      preferredProviderId: 'minimax',
      providerKeys: { minimax: 'test-key' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: ['https://example.com/night.png'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    useStore.setState((state) => ({
      composer: {
        ...state.composer,
        imageMode: true,
        imageModeStartedAt: 100,
      },
      messages: [
        {
          id: 'm_first',
          role: 'user',
          text: '一张山水画',
          createdAt: 110,
        },
      ],
    }));

    useStore.getState().generateImagePrompt('改成夜景');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('图片生成完成');
    }, 'sticky image generation to finish');

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    ) as { prompt?: string };
    expect(body.prompt).toContain('一张山水画');
    expect(body.prompt).toContain('改成夜景');
  });

  it('surfaces a friendly failure when the provider errors', async () => {
    writeImageSettings({
      enabled: true,
      preferredProviderId: 'minimax',
      providerKeys: { minimax: 'test-key' },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('rate limited', {
          status: 429,
          statusText: 'Too Many Requests',
        }),
      );

    useStore.getState().generateImagePrompt('/image 一只柴犬');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('图片生成失败');
    }, 'image generation failure message');

    const assistant = useStore
      .getState()
      .messages.find((message) => message.role === 'assistant');
    expect(assistant?.text).toContain('请在设置 > 生图中配置可用的图片 Provider');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not auto-route natural-language image intent through sendPrompt', async () => {
    // Image generation is now explicit-only (the /image-mode-start sticky mode). A
    // natural-language message that merely mentions generating an image must
    // NOT be hijacked into the image provider — it stays an AI-editing prompt.
    writeImageSettings({
      enabled: true,
      preferredProviderId: 'minimax',
      providerKeys: { minimax: 'test-key' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: ['https://example.com/poster.png'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    useStore.getState().sendPrompt('帮我生成一张山水画海报');

    // Give any mistaken async image turn a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://api.minimax.io/v1/image_generation',
      expect.objectContaining({ method: 'POST' }),
    );
    const assistant = useStore
      .getState()
      .messages.find((message) => message.role === 'assistant');
    expect(assistant?.text ?? '').not.toContain('图片生成完成');
  });

  it('reports the settled result (locations) to onSettled on success', async () => {
    writeImageSettings({
      enabled: true,
      preferredProviderId: 'minimax',
      providerKeys: { minimax: 'test-key' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: ['https://example.com/from-model.png'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const settled: Array<{ ok: boolean; locations?: unknown }> = [];
    useStore.getState().generateImagePrompt('/image a lone hero', {
      onSettled: (result) => settled.push(result),
    });

    await waitFor(() => settled.length > 0, 'onSettled to fire');
    expect(settled[0].ok).toBe(true);
    // Remote URL sources round-trip through capture as remoteUrl locations.
    expect(JSON.stringify(settled[0].locations)).toContain(
      'https://example.com/from-model.png',
    );
  });

  it('binds background generation to an explicit sessionKey and baseMessages', async () => {
    writeImageSettings({
      enabled: true,
      preferredProviderId: 'minimax',
      providerKeys: { minimax: 'test-key' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: ['https://example.com/remote-bound.png'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const updateSpy = vi
      .spyOn(historyStore, 'updateSession')
      .mockResolvedValue({
        id: 'session-target',
        workspaceId: 'ws-target',
        title: 'Target',
        isWorkflow: false,
        createdAt: 1,
        updatedAt: Date.now(),
        messages: [],
      } as never);

    useStore.setState({
      activeWorkspaceId: 'ws-active',
      activeSessionId: 'session-active',
      workspaces: [
        {
          id: 'ws-target',
          path: '/target',
          name: 'Target workspace',
          updatedAt: 1,
          sessionCount: 1,
        },
      ],
      sessions: [
        {
          id: 'session-target',
          workspaceId: 'ws-target',
          title: 'Target session',
          isWorkflow: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sessionTree: {
        'ws-target': [
          {
            id: 'session-target',
            workspaceId: 'ws-target',
            title: 'Target session',
            isWorkflow: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      messages: [
        {
          id: 'm-active',
          role: 'assistant',
          text: 'current active session message',
          createdAt: 1,
        },
      ],
      historyReady: true,
    });

    let settled = false;
    useStore.getState().generateImagePrompt('/image a cat', {
      background: true,
      sessionKey: { workspaceId: 'ws-target', sessionId: 'session-target' },
      baseMessages: [
        {
          id: 'm-target-user',
          role: 'user',
          text: 'target request',
          createdAt: 1,
        },
      ],
      onSettled: () => {
        settled = true;
      },
    });

    await waitFor(() => settled, 'background generation to settle');

    // The active view must stay untouched — the background turn belongs to
    // session-target, not the currently active session-active.
    const messages = useStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m-active');

    // Persistence must target the specified session, never the active one.
    const targetCalls = updateSpy.mock.calls.filter(
      ([workspaceId, sessionId]) =>
        workspaceId === 'ws-target' && sessionId === 'session-target',
    );
    expect(targetCalls.length).toBeGreaterThan(0);
  });
});
