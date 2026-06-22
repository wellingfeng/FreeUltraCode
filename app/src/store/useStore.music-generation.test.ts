import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import type { IRGraph } from '@/core/ir';
import {
  DEFAULT_MUSIC_GENERATION_SETTINGS,
  type MusicGenerationSettings,
} from '@/lib/musicGeneration';
import { useStore } from './useStore';

const MUSIC_SETTINGS_KEY = 'ultragamestudio.musicGeneration.v1';

function cloneGraph(graph: IRGraph): IRGraph {
  return JSON.parse(JSON.stringify(graph)) as IRGraph;
}

function writeMusicSettings(partial: Partial<MusicGenerationSettings>): void {
  window.localStorage.setItem(
    MUSIC_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_MUSIC_GENERATION_SETTINGS, ...partial }),
  );
}

function resetStore(): void {
  useStore.setState({
    workflow: cloneGraph(defaultBlueprint('Music workflow')),
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

describe('music generation chat flow', () => {
  it('routes /music through the provider and renders the returned audio', async () => {
    writeMusicSettings({
      enabled: true,
      preferredProviderId: 'elevenlabs-music',
      providerKeys: { 'elevenlabs-music': 'test-key' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          audio_url: 'https://example.com/generated.mp3',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    useStore.getState().generateMusicPrompt('/music 一段赛博朋克配乐');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('音乐生成完成');
    }, 'music generation to finish');

    const messages = useStore.getState().messages;
    const user = messages.find((message) => message.role === 'user');
    const assistant = messages.find((message) => message.role === 'assistant');

    expect(user?.text).toBe('/music 一段赛博朋克配乐');
    expect(assistant?.text).toContain('ElevenLabs Music');
    expect(assistant?.text).toContain('一段赛博朋克配乐');
    expect(assistant?.text).toContain(
      '[播放音频 1](https://example.com/generated.mp3)',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/music',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('merges sticky music-mode prompts since mode start', async () => {
    writeMusicSettings({
      enabled: true,
      preferredProviderId: 'elevenlabs-music',
      providerKeys: { 'elevenlabs-music': 'test-key' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          audio_url: 'https://example.com/night.mp3',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    useStore.setState((state) => ({
      composer: {
        ...state.composer,
        musicMode: true,
        musicModeStartedAt: 100,
      },
      messages: [
        {
          id: 'm_first',
          role: 'user',
          text: '一段轻快片头曲',
          createdAt: 110,
        },
      ],
    }));

    useStore.getState().generateMusicPrompt('改成更年轻的电子风');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('音乐生成完成');
    }, 'sticky music generation to finish');

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    ) as { prompt?: string };
    expect(body.prompt).toContain('一段轻快片头曲');
    expect(body.prompt).toContain('改成更年轻的电子风');
  });

  it('surfaces a friendly failure when the provider errors', async () => {
    writeMusicSettings({
      enabled: true,
      preferredProviderId: 'elevenlabs-music',
      providerKeys: { 'elevenlabs-music': 'test-key' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        statusText: 'Too Many Requests',
      }),
    );

    useStore.getState().generateMusicPrompt('/music 一段片头曲');

    await waitFor(() => {
      const assistant = useStore
        .getState()
        .messages.find((message) => message.role === 'assistant');
      return !!assistant && assistant.text.includes('音乐生成失败');
    }, 'music generation failure message');

    const assistant = useStore
      .getState()
      .messages.find((message) => message.role === 'assistant');
    expect(assistant?.text).toContain('请在设置 > 音乐渠道中配置可用的商用或免费 Provider');
  });
});
