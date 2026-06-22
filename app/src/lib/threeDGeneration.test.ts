import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THREE_D_GENERATION_SETTINGS,
  DEFAULT_THREE_D_PREVIEW_ANIMATIONS,
  COMMON_THREE_D_ANIMATIONS,
  THREE_D_PROVIDERS,
  THREE_D_RIGGING_PROVIDERS,
  THREE_D_ANIMATION_LIBRARY_LINKS,
  THREE_D_RIGGING_LIBRARY_LINKS,
  assessThreeDRigging,
  createCustomThreeDProviderId,
  generateThreeD,
  looksLikeThreeDGenerationRequest,
  matchThreeDCommonAnimation,
  normalizeThreeDAutoRiggingSettings,
  normalizeThreeDGenerationSettings,
  preferredReadyThreeDProviderId,
  stripThreeDCommand,
  threeDRiggingPromptGuidance,
  threeDRiggingProviderBaseUrl,
  threeDRiggingProviderReady,
  threeDProviderBaseUrl,
  threeDProviderById,
  threeDProviderReady,
  threeDProviders,
} from './threeDGeneration';

afterEach(() => {
  vi.restoreAllMocks();
});

type ThreeDSettingsOverrides = Partial<
  Omit<typeof DEFAULT_THREE_D_GENERATION_SETTINGS, 'rigging'>
> & {
  rigging?: Partial<typeof DEFAULT_THREE_D_GENERATION_SETTINGS.rigging>;
};

function enabledThreeDSettings(
  overrides: ThreeDSettingsOverrides = {},
): typeof DEFAULT_THREE_D_GENERATION_SETTINGS {
  const { rigging, ...rest } = overrides;
  return {
    ...DEFAULT_THREE_D_GENERATION_SETTINGS,
    enabled: true,
    ...rest,
    rigging: {
      ...DEFAULT_THREE_D_GENERATION_SETTINGS.rigging,
      enabled: true,
      ...rigging,
    },
  };
}

describe('3D generation settings and routing', () => {
  it('detects explicit 3D generation requests', () => {
    expect(looksLikeThreeDGenerationRequest('/3d a game-ready sword')).toBe(true);
    expect(looksLikeThreeDGenerationRequest('帮我生成一个 3D 机械臂模型')).toBe(true);
    expect(looksLikeThreeDGenerationRequest('create a GLB asset for a chair')).toBe(true);
    expect(looksLikeThreeDGenerationRequest('修复这个 TypeScript 类型错误')).toBe(false);
  });

  it('strips 3D command prefixes without eating the prompt', () => {
    expect(stripThreeDCommand('/3d a red robot')).toBe('a red robot');
    expect(stripThreeDCommand('请帮我生成一个3D模型低多边形宝箱')).toBe('低多边形宝箱');
  });

  it('classifies riggable characters separately from static props', () => {
    expect(assessThreeDRigging('人形机器人角色，游戏资产').enabled).toBe(true);
    expect(assessThreeDRigging('a quadruped monster with idle walk run clips').enabled).toBe(true);
    expect(assessThreeDRigging('一块苔藓石头').enabled).toBe(false);
    expect(assessThreeDRigging('low poly treasure chest prop').enabled).toBe(false);
    expect(assessThreeDRigging('让一块石头跑步').enabled).toBe(false);
    expect(threeDRiggingPromptGuidance('一块苔藓石头')).toContain('不要加入');
  });

  it('keeps default preview animations small and marks extra actions for library matching', () => {
    const assessment = assessThreeDRigging('人形角色跳舞并挥手');
    expect(DEFAULT_THREE_D_PREVIEW_ANIMATIONS).toEqual(['Idle', 'Walk', 'Run']);
    expect(assessment.enabled).toBe(true);
    expect(assessment.defaultAnimations).toEqual(['Idle', 'Walk', 'Run']);
    expect(assessment.requestedAnimations).toEqual(['Wave', 'Dance']);
    expect(assessment.needsAnimationSearch).toBe(true);
    expect(threeDRiggingPromptGuidance('人形角色跳舞')).toContain('用户额外动作：Dance');
  });

  it('keeps common animation aliases and library addresses for search-on-demand', () => {
    expect(matchThreeDCommonAnimation('让角色跳舞')?.id).toBe('dance');
    expect(matchThreeDCommonAnimation('make the avatar punch')?.id).toBe('punch');
    expect(COMMON_THREE_D_ANIMATIONS.map((animation) => animation.id)).toEqual(
      expect.arrayContaining(['idle', 'walk', 'run', 'jump', 'wave', 'attack', 'dance']),
    );
    expect(THREE_D_ANIMATION_LIBRARY_LINKS.map((library) => library.url)).toEqual(
      expect.arrayContaining([
        'https://quaternius.itch.io/universal-animation-library',
        'https://mesh2motion.org/',
        'https://docs.meshy.ai/en/api/animation',
        'https://www.mixamo.com/',
      ]),
    );
  });

  it('keeps auto-rigging library addresses for rigging-on-demand', () => {
    expect(THREE_D_RIGGING_LIBRARY_LINKS.map((library) => library.url)).toEqual(
      expect.arrayContaining([
        'https://docs.meshy.ai/en/api/rigging',
        'https://fal.ai/models/fal-ai/meshy/rigging/api',
        'https://www.mixamo.com/',
        'https://everythinguniver.se/anything-world-apis',
        'https://autorig.online/',
        'https://docs.blender.org/manual/en/latest/addons/rigging/rigify.html',
      ]),
    );
    expect(
      THREE_D_RIGGING_LIBRARY_LINKS.filter((library) => library.use === 'online-api')
        .map((library) => library.id),
    ).toEqual([
      'meshy-rigging-api',
      'fal-meshy-rigging',
      'anything-world',
      'autorig-online',
    ]);
  });

  it('keeps configurable rigging providers separate from 3D generation providers', () => {
    expect(THREE_D_RIGGING_PROVIDERS.map((provider) => provider.id)).toEqual(
      expect.arrayContaining([
        'fal-meshy-rigging',
        'meshy-rigging-api',
        'anything-world',
        'autorig-online',
        'local-rigging-server',
        'blender-rigify',
        'blender-auto-rig-pro',
        'accurig',
        'mixamo-manual-import',
      ]),
    );
    expect(
      THREE_D_RIGGING_PROVIDERS.filter((provider) => provider.category === 'online').map(
        (provider) => provider.id,
      ),
    ).toEqual(['fal-meshy-rigging', 'meshy-rigging-api', 'anything-world', 'autorig-online']);
    expect(
      THREE_D_RIGGING_PROVIDERS.filter((provider) => provider.apiKind === 'external-tool').map(
        (provider) => provider.id,
      ),
    ).toEqual(['blender-rigify', 'blender-auto-rig-pro']);
  });

  it('normalizes persisted settings conservatively', () => {
    const settings = normalizeThreeDGenerationSettings({
      enabled: false,
      preferredProviderId: 'local-hunyuan3d',
      providerKeys: { meshy: ' token ', unknown: 'x' },
      providerModels: { 'local-hunyuan3d': ' Hunyuan3D-2.5 ' },
      providerBaseUrls: { 'local-hunyuan3d': ' http://127.0.0.1:8083/generate ' },
    });
    expect(settings.enabled).toBe(true);
    expect(settings.preferredProviderId).toBe('local-hunyuan3d');
    expect(settings.providerKeys.meshy).toBe('token');
    expect(settings.providerModels['local-hunyuan3d']).toBe('Hunyuan3D-2.5');
    expect(settings.providerBaseUrls['local-hunyuan3d']).toBe(
      'http://127.0.0.1:8083/generate',
    );
    expect(settings.rigging.preferredProviderId).toBe('fal-meshy-rigging');
  });

  it('normalizes auto-rigging settings and readiness separately', () => {
    const rigging = normalizeThreeDAutoRiggingSettings({
      enabled: true,
      preferredProviderId: 'anything-world',
      fallbackProviderIds: ['meshy-rigging-api', 'unknown', 'local-rigging-server'],
      providerKeys: { 'anything-world': ' aw ', meshy: 'wrong' },
      providerBaseUrls: { 'anything-world': ' https://rig.example.com/jobs ' },
      providerCommands: { 'blender-rigify': ' blender --background --python rig.py ' },
      providerModels: { 'anything-world': ' animal ' },
    });
    const settings = {
      ...DEFAULT_THREE_D_GENERATION_SETTINGS,
      rigging,
    };

    expect(rigging.preferredProviderId).toBe('anything-world');
    expect(rigging.fallbackProviderIds).toEqual(['meshy-rigging-api', 'local-rigging-server']);
    expect(rigging.providerKeys['anything-world']).toBe('aw');
    expect(rigging.providerCommands['blender-rigify']).toBe(
      'blender --background --python rig.py',
    );
    expect(threeDRiggingProviderBaseUrl('anything-world', settings)).toBe(
      'https://rig.example.com/jobs',
    );
    expect(threeDRiggingProviderReady('anything-world', settings)).toBe(true);
    expect(threeDRiggingProviderReady('mixamo-manual-import', settings)).toBe(false);
  });

  it('splits 3D providers into commercial and free/local categories', () => {
    const commercial = THREE_D_PROVIDERS.filter(
      (provider) => provider.category === 'commercial',
    ).map((provider) => provider.id);
    const free = THREE_D_PROVIDERS.filter(
      (provider) => provider.category === 'free',
    ).map((provider) => provider.id);

    expect(commercial).toContain('meshy');
    expect(commercial).toContain('tripo');
    expect(commercial).toContain('fal-tripo-h31');
    expect(free).toContain('huggingface-hunyuan3d');
    expect(free).toContain('local-hunyuan3d');
    expect(free).toContain('local-trellis');
  });

  it('requires local endpoints to be explicitly configured before routing', () => {
    const settings = {
      ...DEFAULT_THREE_D_GENERATION_SETTINGS,
      preferredProviderId: 'local-hunyuan3d' as const,
      providerKeys: {},
      providerBaseUrls: {},
      providerModels: {},
    };
    expect(threeDProviderReady('local-hunyuan3d', settings)).toBe(false);
    expect(preferredReadyThreeDProviderId(settings)).toBeNull();
  });

  it('normalizes and routes custom Mesh generation providers', async () => {
    const id = createCustomThreeDProviderId('My Mesh');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'https://assets.example.com/custom.glb',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const settings = normalizeThreeDGenerationSettings({
      enabled: true,
      preferredProviderId: id,
      customProviders: [
        {
          id,
          label: 'My Mesh',
          category: 'commercial',
          apiKind: 'generic-3d-api',
          defaultModel: 'mesh-model',
          models: ['mesh-model'],
          needsKey: true,
          local: false,
          defaultBaseUrl: 'https://mesh.example.com/v1/generate/',
          supportsBaseUrl: true,
          endpointPlaceholder: 'https://mesh.example.com/v1/generate',
          note: 'Custom Mesh route.',
        },
      ],
      providerKeys: { [id]: 'mesh-key' },
      providerBaseUrls: {},
      providerModels: {},
    });

    expect(settings.preferredProviderId).toBe(id);
    expect(settings.customProviders).toHaveLength(1);
    expect(threeDProviders(settings).some((provider) => provider.id === id)).toBe(true);
    expect(threeDProviderById(id, settings).label).toBe('My Mesh');
    expect(threeDProviderBaseUrl(id, settings)).toBe('https://mesh.example.com/v1/generate');
    expect(threeDProviderReady(id, settings)).toBe(true);

    const result = await generateThreeD({ prompt: '/3d low poly chest' }, settings);
    expect(result.providerId).toBe(id);
    expect(result.assets).toEqual(['https://assets.example.com/custom.glb']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mesh.example.com/v1/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mesh-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('uses direct credential and endpoint links for 3D providers', () => {
    expect(threeDProviderBaseUrl('meshy')).toBe('https://api.meshy.ai');
    expect(threeDProviderBaseUrl('tripo')).toBe('https://api.tripo3d.ai');
    expect(threeDProviderById('meshy').credentialUrl).toBe('https://www.meshy.ai/api');
    expect(threeDProviderById('local-hunyuan3d').credentialUrl).toBe(
      'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1',
    );
  });

  it('parses local 3D server model URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'http://127.0.0.1:8080/out/model.glb',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await generateThreeD(
      {
        prompt: '/3d 一个低多边形宝箱',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: {},
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
        },
        providerModels: {},
      }),
    );

    expect(result.providerId).toBe('local-3d-server');
    expect(result.prompt).toBe('一个低多边形宝箱');
    expect(result.rigging.enabled).toBe(false);
    expect(result.autoRigging).toBeNull();
    expect(result.assets).toEqual(['http://127.0.0.1:8080/out/model.glb']);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.rigging).toMatchObject({
      enabled: false,
      skeleton: false,
      skinning: false,
    });
    expect(body.rigging.default_animations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/generate',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('passes rigging metadata to local 3D servers for riggable targets', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'http://127.0.0.1:8080/out/character.glb',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await generateThreeD(
      {
        prompt: '/3d 人形机器人角色',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: {},
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
        },
        providerModels: {},
      }),
    );

    expect(result.rigging.enabled).toBe(true);
    expect(result.rigging.defaultAnimations).toEqual(['Idle', 'Walk', 'Run']);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.rigging).toMatchObject({
      enabled: true,
      skeleton: true,
      skinning: true,
      default_animations: ['Idle', 'Walk', 'Run'],
      requested_animations: [],
      search_animation_libraries: false,
    });
    expect(body.input.rigging).toEqual(body.rigging);
  });

  it('auto-rigs riggable public GLB assets through fal Meshy Rigging when configured', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model_urls: {
              glb: 'https://assets.example.com/out/character.glb',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: {
              url: 'https://assets.example.com/out/character-rigged.glb',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const result = await generateThreeD(
      {
        prompt: '/3d 人形机器人角色',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: { 'fal-tripo-h31': 'fal_key' },
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
          'fal-meshy-v6': 'https://queue.test',
        },
        providerModels: {},
      }),
    );

    expect(result.sourceAssets).toEqual(['https://assets.example.com/out/character.glb']);
    expect(result.assets).toEqual(['https://assets.example.com/out/character-rigged.glb']);
    expect(result.autoRigging).toMatchObject({
      providerId: 'fal-meshy-rigging',
      providerLabel: 'fal.ai Meshy Rigging',
      status: 'succeeded',
      sourceAsset: 'https://assets.example.com/out/character.glb',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://queue.test/fal-ai/meshy/rigging',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Key fal_key' }),
        body: JSON.stringify({
          input: { model_url: 'https://assets.example.com/out/character.glb' },
        }),
      }),
    );
  });

  it('uses rigging-specific fal credentials when configured in the rigging tab', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model_urls: {
              glb: 'https://assets.example.com/out/character.glb',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: {
              url: 'https://assets.example.com/out/character-rigged.glb',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    await generateThreeD(
      {
        prompt: '/3d 人形机器人角色',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: {},
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
        },
        providerModels: {},
        rigging: {
          providerKeys: { 'fal-meshy-rigging': 'rig_fal_key' },
          providerBaseUrls: { 'fal-meshy-rigging': 'https://rigging-queue.test' },
        },
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://rigging-queue.test/fal-ai/meshy/rigging',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Key rig_fal_key' }),
      }),
    );
  });

  it('keeps the generated mesh when auto-rigging is not configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'https://assets.example.com/out/character.glb',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await generateThreeD(
      {
        prompt: '/3d 人形机器人角色',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: {},
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
        },
        providerModels: {},
      }),
    );

    expect(result.assets).toEqual(['https://assets.example.com/out/character.glb']);
    expect(result.autoRigging).toMatchObject({
      status: 'skipped',
    });
    expect(result.autoRigging?.reason).toContain('未配置');
  });

  it('falls back to Meshy Rigging when fal is not configured', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model_urls: {
              glb: 'https://assets.example.com/out/character.glb',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'rig-task-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'SUCCEEDED',
            model_urls: {
              glb: 'https://assets.example.com/out/character-meshy-rigged.glb',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const result = await generateThreeD(
      {
        prompt: '/3d 人形机器人角色',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: {},
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
        },
        providerModels: {},
        rigging: {
          providerKeys: { 'meshy-rigging-api': 'msy_test' },
        },
      }),
    );

    expect(result.assets).toEqual([
      'https://assets.example.com/out/character-meshy-rigged.glb',
    ]);
    expect(result.autoRigging).toMatchObject({
      providerId: 'meshy-rigging-api',
      status: 'succeeded',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.meshy.ai/openapi/v1/rigging',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer msy_test' }),
        body: JSON.stringify({
          model_url: 'https://assets.example.com/out/character.glb',
          enable_basic_animation: true,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.meshy.ai/openapi/v1/rigging/rig-task-1',
      expect.any(Object),
    );
  });

  it('passes requested non-default animations to local 3D servers for later matching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model_urls: {
            glb: 'http://127.0.0.1:8080/out/dancer.glb',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await generateThreeD(
      {
        prompt: '/3d 人形角色跳舞',
        providerId: 'local-3d-server',
      },
      enabledThreeDSettings({
        preferredProviderId: 'local-3d-server',
        providerKeys: {},
        providerBaseUrls: {
          'local-3d-server': 'http://127.0.0.1:8080/generate',
        },
        providerModels: {},
      }),
    );

    expect(result.rigging.defaultAnimations).toEqual(['Idle', 'Walk', 'Run']);
    expect(result.rigging.requestedAnimations).toEqual(['Dance']);
    expect(result.rigging.needsAnimationSearch).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.rigging).toMatchObject({
      default_animations: ['Idle', 'Walk', 'Run'],
      requested_animations: ['Dance'],
      search_animation_libraries: true,
    });
  });

  it('uses Meshy result response as the task id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'preview-task-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'preview-task-1',
            status: 'SUCCEEDED',
            preview_url: 'https://assets.meshy.ai/tasks/preview/output/preview.png',
            model_urls: { glb: 'https://assets.meshy.ai/tasks/preview/model.glb' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'refine-task-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'refine-task-1',
            status: 'SUCCEEDED',
            output: {
              url: 'https://assets.meshy.ai/tasks/refined/output/preview.png',
            },
            model_urls: { glb: 'https://assets.meshy.ai/tasks/refined/model.glb' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const result = await generateThreeD(
      {
        prompt: '/3d cartoon doll',
        providerId: 'meshy',
      },
      enabledThreeDSettings({
        preferredProviderId: 'meshy',
        providerKeys: { meshy: 'msy_test' },
        providerBaseUrls: {},
        providerModels: { meshy: 'meshy-6' },
      }),
    );

    expect(result.assets).toEqual(['https://assets.meshy.ai/tasks/refined/model.glb']);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.meshy.ai/openapi/v2/text-to-3d/preview-task-1',
      expect.any(Object),
    );
  });
});
