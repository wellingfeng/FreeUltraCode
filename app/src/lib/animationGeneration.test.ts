import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANIMATION_GENERATION_SETTINGS,
  animationProviderReady,
  animationProviders,
  generateAnimation,
  inferAnimationMode,
  normalizeAnimationGenerationSettings,
  searchAnimationLibraries,
} from '@/lib/animationGeneration';

describe('animationGeneration', () => {
  it('ships library, ai, and local providers', () => {
    const categories = new Set(animationProviders().map((provider) => provider.category));
    expect(categories.has('library')).toBe(true);
    expect(categories.has('ai')).toBe(true);
    expect(categories.has('local')).toBe(true);
  });

  it('normalizes invalid settings to safe defaults', () => {
    const settings = normalizeAnimationGenerationSettings({
      preferredProviderId: 'missing',
      defaultSearchCount: 999,
    });
    expect(settings.preferredProviderId).toBe('mixamo');
    expect(settings.defaultSearchCount).toBe(20);
  });

  it('treats Mixamo as ready for library search without a key', () => {
    expect(animationProviderReady('mixamo', DEFAULT_ANIMATION_GENERATION_SETTINGS)).toBe(true);
    const results = searchAnimationLibraries('walk cycle', DEFAULT_ANIMATION_GENERATION_SETTINGS);
    expect(results[0]?.providerId).toBe('mixamo');
    expect(results[0]?.url).toContain('walk%20cycle');
  });

  it('includes Rokoko Free and CMU as explicit animation library entries', () => {
    const providers = animationProviders();
    expect(providers.find((provider) => provider.id === 'rokoko-free-mocap')).toMatchObject({
      category: 'library',
      outputFormats: ['fbx'],
    });
    expect(providers.find((provider) => provider.id === 'cmu-mocap-database')).toMatchObject({
      category: 'library',
      outputFormats: expect.arrayContaining(['asf', 'amc', 'asf/amc -> bvh']),
    });

    const results = searchAnimationLibraries('jump turn', {
      ...DEFAULT_ANIMATION_GENERATION_SETTINGS,
      defaultSearchCount: 20,
    });
    expect(results.map((item) => item.providerId)).toContain('rokoko-free-mocap');
    const cmu = results.find((item) => item.providerId === 'cmu-mocap-database');
    expect(cmu?.formats).toContain('asf/amc -> bvh');
    expect(cmu?.use).toContain('不直接预览');
  });

  it('ships a local CMU ASF/AMC conversion endpoint for BVH playback workflows', () => {
    const converter = animationProviders().find(
      (provider) => provider.id === 'cmu-asf-amc-converter',
    );
    expect(converter).toMatchObject({
      category: 'local',
      capabilities: expect.arrayContaining(['generate', 'mocap']),
      defaultModel: 'asf-amc-to-bvh',
      outputFormats: expect.arrayContaining(['bvh', 'fbx', 'glb']),
    });
    expect(animationProviderReady('cmu-asf-amc-converter', DEFAULT_ANIMATION_GENERATION_SETTINGS)).toBe(false);
  });

  it('infers explicit search requests', () => {
    expect(inferAnimationMode('/anim 搜索 walk')).toBe('search');
    expect(inferAnimationMode('/anim walk cycle')).toBe('search');
    expect(inferAnimationMode('/anim 生成一个持剑攻击动作')).toBe('generate');
  });

  it('falls back to library search when no generation provider is configured', async () => {
    const result = await generateAnimation(
      { prompt: '/anim 生成一个翻滚闪避动作', mode: 'generate' },
      DEFAULT_ANIMATION_GENERATION_SETTINGS,
    );
    expect(result.mode).toBe('search');
    expect(result.fallbackReason).toContain('未配置');
    expect(result.searchResults.length).toBeGreaterThan(0);
  });
});
