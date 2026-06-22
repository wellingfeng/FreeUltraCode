import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WORLD_MODEL_GENERATION_SETTINGS,
  WORLD_MODEL_PROVIDERS,
  loadWorldModelGenerationSettings,
  normalizeWorldModelGenerationSettings,
  parseWorldModelSpec,
  saveWorldModelGenerationSettings,
  generateWorldModel,
  preferredReadyWorldModelProviderId,
  serializeWorldModelSpec,
  stripWorldModelCommand,
  worldModelProviderById,
  worldModelProviderModel,
  worldModelProviderReady,
  worldModelProviders,
  worldModelPromptSystem,
} from './worldModel';
import { resetGenerationSettingsStoreForTests } from './generationSettingsStore';

beforeEach(() => {
  resetGenerationSettingsStoreForTests();
  if (typeof window !== 'undefined') window.localStorage?.clear();
});

afterEach(() => {
  resetGenerationSettingsStoreForTests();
  if (typeof window !== 'undefined') window.localStorage?.clear();
});

describe('world-model provider catalog', () => {
  it('ships interactive playable providers across commercial and free tiers', () => {
    expect(WORLD_MODEL_PROVIDERS.length).toBeGreaterThanOrEqual(8);
    expect(WORLD_MODEL_PROVIDERS.some((p) => p.category === 'commercial')).toBe(true);
    expect(WORLD_MODEL_PROVIDERS.some((p) => p.category === 'free')).toBe(true);
    expect(WORLD_MODEL_PROVIDERS.some((p) => p.interactivity === 'live-session')).toBe(true);
  });

  it('marks research-preview providers as not ready (no public API)', () => {
    expect(worldModelProviderReady('google-genie')).toBe(false);
  });

  it('treats a configured public-API local provider as ready', () => {
    expect(worldModelProviderReady('local-world-server')).toBe(true);
  });

  it('returns a preferred ready provider by default', () => {
    expect(preferredReadyWorldModelProviderId()).toBe('tencent-hunyuan-world');
  });

  it('resolves provider model with override precedence', () => {
    const settings = {
      ...DEFAULT_WORLD_MODEL_GENERATION_SETTINGS,
      providerModels: { 'decart-oasis': 'oasis-custom' as string },
    };
    expect(worldModelProviderModel('decart-oasis', settings)).toBe('oasis-custom');
    expect(worldModelProviderById('decart-oasis').defaultModel).toBe('oasis-2');
  });
});

describe('world-model generation API adapters', () => {
  it('calls World Labs Marble and maps the Marble result to a worldmodel spec', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            operation_id: 'op_1',
            status: 'running',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'succeeded',
            world: {
              display_name: '宇宙飞船',
              world_prompt: { text_prompt: '站在宇宙飞船里看地球' },
              world_marble_url: 'https://marble.worldlabs.ai/world/abc',
              assets: {
                splats: {
                  spz_urls: {
                    full_res: 'https://cdn.worldlabs.ai/world/abc/full.spz',
                  },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const result = await generateWorldModel(
      { prompt: '/worldmodel 站在宇宙飞船里看地球' },
      {
        ...DEFAULT_WORLD_MODEL_GENERATION_SETTINGS,
        enabled: true,
        preferredProviderId: 'world-labs-marble',
        providerKeys: { 'world-labs-marble': 'wl-test' },
        providerModels: { 'world-labs-marble': 'marble-1.1' },
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.worldlabs.ai/marble/v1/worlds:generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'WLT-Api-Key': 'wl-test' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.worldlabs.ai/marble/v1/operations/op_1',
      expect.any(Object),
    );
    expect(result.spec.sessionUrl).toBe('https://marble.worldlabs.ai/world/abc');
    expect(result.spec.assetUrl).toBe('https://cdn.worldlabs.ai/world/abc/full.spz');
  });
});

describe('world-model settings normalization & persistence', () => {
  it('falls back to defaults for garbage input', () => {
    const s = normalizeWorldModelGenerationSettings('nonsense');
    expect(s.preferredProviderId).toBe(
      DEFAULT_WORLD_MODEL_GENERATION_SETTINGS.preferredProviderId,
    );
    expect(s.customProviders).toEqual([]);
  });

  it('keeps a valid custom provider and exposes it via worldModelProviders', () => {
    const s = normalizeWorldModelGenerationSettings({
      preferredProviderId: 'custom:my-world',
      customProviders: [
        {
          id: 'custom:my-world',
          label: 'My World',
          category: 'free',
          interactivity: 'live-session',
          defaultModel: 'm1',
          models: ['m1'],
          needsKey: false,
          local: true,
          defaultBaseUrl: 'http://localhost:9000',
          endpointPlaceholder: 'http://localhost:9000/session',
          hasPublicApi: true,
          note: '',
        },
      ],
    });
    expect(s.preferredProviderId).toBe('custom:my-world');
    expect(worldModelProviders(s).some((p) => p.id === 'custom:my-world')).toBe(true);
  });

  it('drops a custom provider with a non-custom id', () => {
    const s = normalizeWorldModelGenerationSettings({
      customProviders: [{ id: 'decart-oasis', label: 'x' }],
    });
    expect(s.customProviders).toEqual([]);
  });

  it('round-trips through save/load', () => {
    const saved = saveWorldModelGenerationSettings({
      ...DEFAULT_WORLD_MODEL_GENERATION_SETTINGS,
      enabled: true,
      preferredProviderId: 'decart-oasis',
      providerKeys: { 'decart-oasis': 'decart-key' },
    });
    expect(saved).toBe(true);
    const loaded = loadWorldModelGenerationSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.providerKeys['decart-oasis']).toBe('decart-key');
  });
});

describe('worldmodel block parse/serialize', () => {
  it('parses a JSON spec', () => {
    const spec = parseWorldModelSpec(
      '{"provider":"decart-oasis","title":"森林","prompt":"一片可漫游的森林","controls":"WASD"}',
    );
    expect(spec?.provider).toBe('decart-oasis');
    expect(spec?.title).toBe('森林');
    expect(spec?.prompt).toBe('一片可漫游的森林');
  });

  it('tolerates a bare prompt string body', () => {
    const spec = parseWorldModelSpec('一座漂浮在云上的城市');
    expect(spec?.prompt).toBe('一座漂浮在云上的城市');
  });

  it('accepts snake_case session_url alias', () => {
    const spec = parseWorldModelSpec('{"prompt":"x","session_url":"https://s/abc"}');
    expect(spec?.sessionUrl).toBe('https://s/abc');
  });

  it('returns null when nothing usable is present', () => {
    expect(parseWorldModelSpec('   ')).toBeNull();
    expect(parseWorldModelSpec('{}')).toBeNull();
  });

  it('round-trips a spec', () => {
    const body = serializeWorldModelSpec({
      provider: 'decart-oasis',
      prompt: '海底世界',
      sessionUrl: 'https://s/1',
    });
    const spec = parseWorldModelSpec(body);
    expect(spec?.prompt).toBe('海底世界');
    expect(spec?.sessionUrl).toBe('https://s/1');
  });
});

describe('command stripping & authoring prompt', () => {
  it('strips world-model command prefixes', () => {
    expect(stripWorldModelCommand('/worldmodel 一片沙漠')).toBe('一片沙漠');
    expect(stripWorldModelCommand('/worldmodel-mode-start 雪山')).toBe('雪山');
    expect(stripWorldModelCommand('/worldmodel-mode-end')).toBe('');
  });

  it('builds an authoring prompt that demands a single worldmodel block', () => {
    const prompt = worldModelPromptSystem();
    expect(prompt).toContain('```worldmodel');
    expect(prompt).toContain('sessionUrl');
  });
});
