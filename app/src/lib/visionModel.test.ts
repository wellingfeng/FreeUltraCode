import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VISION_MODEL_SETTINGS,
  VISION_PROVIDERS,
  loadVisionModelSettings,
  normalizeVisionModelSettings,
  preferredReadyVisionProviderId,
  resolveVisionModelRoute,
  saveVisionModelSettings,
  visionProviderBaseUrl,
  visionProviderReady,
  visionProviders,
} from './visionModel';

afterEach(() => {
  window.localStorage.clear();
});

describe('Vision/VLM settings and routing', () => {
  it('covers paid/free and domestic/global/local providers', () => {
    expect(new Set(VISION_PROVIDERS.map((provider) => provider.category))).toEqual(
      new Set(['commercial', 'free-credit']),
    );
    expect(new Set(VISION_PROVIDERS.map((provider) => provider.region))).toEqual(
      new Set(['china', 'global', 'local']),
    );
    expect(VISION_PROVIDERS.map((provider) => provider.id)).toEqual(
      expect.arrayContaining([
        'google-ai-studio',
        'openai',
        'anthropic',
        'dashscope',
        'zhipu',
        'ollama-local',
      ]),
    );
  });

  it('normalizes custom providers and removes unknown credential records', () => {
    const settings = normalizeVisionModelSettings({
      preferredProviderId: 'custom:router',
      customProviders: [
        {
          id: 'custom:router',
          label: '视觉聚合',
          category: 'commercial',
          region: 'china',
          apiKind: 'openai-compatible',
          defaultModel: 'vlm-pro',
          models: ['vlm-pro', 'vlm-fast', 'VLM-FAST'],
          needsKey: true,
          local: false,
          defaultBaseUrl: 'https://vlm.example.com/v1/',
          note: 'test',
        },
      ],
      providerKeys: { 'custom:router': ' key ', unknown: 'drop' },
      providerModels: { 'custom:router': ' vlm-fast ' },
    });

    expect(settings.preferredProviderId).toBe('custom:router');
    expect(settings.customProviders[0]?.models).toEqual(['vlm-pro', 'vlm-fast']);
    expect(settings.providerKeys).toEqual({ 'custom:router': 'key' });
    expect(settings.providerModels['custom:router']).toBe('vlm-fast');
    expect(visionProviders(settings).some((provider) => provider.id === 'custom:router')).toBe(true);
    expect(visionProviderBaseUrl('custom:router', settings)).toBe(
      'https://vlm.example.com/v1',
    );
  });

  it('builds an OpenAI-compatible route for a configured VLM', () => {
    expect(resolveVisionModelRoute({}, DEFAULT_VISION_MODEL_SETTINGS)).toBeNull();

    const settings = normalizeVisionModelSettings({
      ...DEFAULT_VISION_MODEL_SETTINGS,
      preferredProviderId: 'google-ai-studio',
      providerKeys: { 'google-ai-studio': 'google-key' },
    });

    expect(visionProviderReady('google-ai-studio', settings)).toBe(true);
    expect(preferredReadyVisionProviderId(settings)).toBe('google-ai-studio');
    expect(resolveVisionModelRoute({}, settings)).toMatchObject({
      adapter: 'codex',
      transport: 'openai-compatible',
      mode: 'direct',
      model: 'gemini-2.5-flash',
      apiKey: 'google-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      channelName: 'Vision/VLM',
    });
  });

  it('builds an Anthropic route and excludes local providers from remote profiles', () => {
    const anthropic = normalizeVisionModelSettings({
      preferredProviderId: 'anthropic',
      providerKeys: { anthropic: 'anthropic-key' },
    });
    expect(resolveVisionModelRoute({}, anthropic)).toMatchObject({
      adapter: 'claude-code',
      transport: 'anthropic',
      model: 'claude-sonnet-4-6',
    });

    const local = normalizeVisionModelSettings({
      preferredProviderId: 'ollama-local',
    });
    expect(resolveVisionModelRoute({}, local)?.providerName).toContain('Ollama');
    expect(resolveVisionModelRoute({ profileId: 'remote:workspace' }, local)).toBeNull();
  });

  it('persists settings through the shared settings store', () => {
    const next = normalizeVisionModelSettings({
      preferredProviderId: 'openai',
      providerKeys: { openai: 'sk-test' },
      providerModels: { openai: 'gpt-4.1' },
    });
    expect(saveVisionModelSettings(next)).toBe(true);
    expect(loadVisionModelSettings()).toMatchObject({
      preferredProviderId: 'openai',
      providerKeys: { openai: 'sk-test' },
      providerModels: { openai: 'gpt-4.1' },
    });
  });
});
