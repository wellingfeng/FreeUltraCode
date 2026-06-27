import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  type ImageGenerationSettings,
} from '@/lib/imageGeneration';
import {
  DEFAULT_MUSIC_GENERATION_SETTINGS,
  type MusicGenerationSettings,
} from '@/lib/musicGeneration';
import {
  DEFAULT_VIDEO_GENERATION_SETTINGS,
  type VideoGenerationSettings,
} from '@/lib/videoGeneration';
import {
  guardSlashCommandChannel,
  guardSlashCommandText,
  slashGuardChannelForText,
} from '@/lib/slashCommandGuards';

const blankComposer = {
  imageMode: false,
  musicMode: false,
  threeDMode: false,
  videoMode: false,
  speechMode: false,
  spriteMode: false,
  comfyMode: false,
  uiMode: false,
};

describe('slash command guards', () => {
  it('blocks image slash commands when the selected image provider is not configured', () => {
    const image: ImageGenerationSettings = {
      ...DEFAULT_IMAGE_GENERATION_SETTINGS,
      preferredProviderId: 'openai-image',
      providerKeys: {},
    };

    const result = guardSlashCommandText('/image 画一张猫', blankComposer, {
      image,
    });

    expect(result?.ok).toBe(false);
    expect(result?.channel).toBe('image');
    expect(result?.message).toContain('设置 > 生图');
  });

  it('allows image slash commands when a ready provider exists', () => {
    const image: ImageGenerationSettings = {
      ...DEFAULT_IMAGE_GENERATION_SETTINGS,
      preferredProviderId: 'openai-image',
      providerKeys: { 'openai-image': 'sk-test' },
    };

    expect(
      guardSlashCommandText('/image 画一张猫', blankComposer, { image })?.ok,
    ).toBe(true);
  });

  it('guards sticky generation modes for plain text sends', () => {
    const music: MusicGenerationSettings = {
      ...DEFAULT_MUSIC_GENERATION_SETTINGS,
      enabled: false,
    };

    const result = guardSlashCommandText(
      '一段赛博朋克 BGM',
      { ...blankComposer, musicMode: true },
      { music },
    );

    expect(result?.ok).toBe(false);
    expect(result?.channel).toBe('music');
    expect(result?.message).toContain('音乐');
  });

  it('does not guard unrelated slash commands', () => {
    expect(guardSlashCommandText('/plan 修 bug', blankComposer)).toBeNull();
  });

  it('exposes the channel without loading settings', () => {
    expect(slashGuardChannelForText('/image 画一张猫', blankComposer)).toBe(
      'image',
    );
    expect(
      slashGuardChannelForText('一段赛博朋克 BGM', {
        ...blankComposer,
        musicMode: true,
      }),
    ).toBe('music');
    expect(slashGuardChannelForText('/plan 修 bug', blankComposer)).toBeNull();
  });

  it('uses channel guards directly for mode start commands', () => {
    const video: VideoGenerationSettings = {
      ...DEFAULT_VIDEO_GENERATION_SETTINGS,
      enabled: false,
    };

    const result = guardSlashCommandChannel('video', { video });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('视频');
  });
});
