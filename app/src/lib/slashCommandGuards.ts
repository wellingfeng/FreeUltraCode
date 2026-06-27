import {
  imageProviderById,
  imageProviderReady,
  loadImageGenerationSettings,
  type ImageGenerationSettings,
} from '@/lib/imageGeneration';
import {
  loadMusicGenerationSettings,
  musicProviderById,
  musicProviderReady,
  type MusicGenerationSettings,
} from '@/lib/musicGeneration';
import {
  loadThreeDGenerationSettings,
  threeDProviderById,
  threeDProviderReady,
  type ThreeDGenerationSettings,
} from '@/lib/threeDGeneration';
import {
  loadVideoGenerationSettings,
  videoProviderById,
  videoProviderReady,
  type VideoGenerationSettings,
} from '@/lib/videoGeneration';
import {
  loadSpeechGenerationSettings,
  speechProviderById,
  speechProviderReady,
  type SpeechGenerationSettings,
} from '@/lib/speechGeneration';
import {
  type SpriteGenerationSettings,
} from '@/lib/spriteGeneration';
import {
  loadUiDesignChannelSettings,
  uiDesignChannelById,
  uiDesignChannelReady,
  type UiDesignChannelSettings,
} from '@/lib/uiDesignChannels';
import {
  loadMeshLibrarySettings,
  meshLibraryById,
  type MeshLibraryAccountSettings,
} from '@/lib/meshLibrary';

export type SlashGuardChannel =
  | 'image'
  | 'music'
  | 'threeD'
  | 'video'
  | 'speech'
  | 'sprite'
  | 'comfyui'
  | 'ui'
  | 'meshSearch';

export interface SlashCommandGuardResult {
  ok: boolean;
  channel: SlashGuardChannel;
  message?: string;
}

export interface SlashCommandGuardSettings {
  image?: ImageGenerationSettings;
  music?: MusicGenerationSettings;
  threeD?: ThreeDGenerationSettings;
  video?: VideoGenerationSettings;
  speech?: SpeechGenerationSettings;
  sprite?: SpriteGenerationSettings;
  ui?: UiDesignChannelSettings;
  meshLibrary?: MeshLibraryAccountSettings;
}

const GENERATION_COMMANDS: Array<{
  channel: SlashGuardChannel;
  pattern: RegExp;
}> = [
  {
    channel: 'image',
    pattern: /^\/(?:image|img|draw|生图|画图|绘图|出图|image-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'music',
    pattern: /^\/(?:music|song|audio|compose|作曲|音乐|生成音乐|music-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'video',
    pattern: /^\/(?:video|movie|film|clip|视频|生成视频|短片|video-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'speech',
    pattern: /^\/(?:tts|speak|speech|say|voice|配音|朗读|语音|念|speech-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'sprite',
    pattern: /^\/(?:sprite|spritesheet|sprite-sheet|精灵|精灵图|序列帧|sprite-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'threeD',
    pattern: /^\/(?:3d|3d-model|model3d|three-d|三维|3d模型|生成3d|mesh-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'comfyui',
    pattern: /^\/(?:comfyui-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'ui',
    pattern: /^\/(?:ui-mode-start)(?:\s|$)/iu,
  },
  {
    channel: 'meshSearch',
    pattern: /^\/(?:mesh-search|model-search|asset-search|搜模型|搜索模型|找模型)(?:\s|$)/iu,
  },
];

function commandChannelFromText(text: string): SlashGuardChannel | null {
  const normalized = text.trim();
  if (!normalized.startsWith('/')) return null;
  return GENERATION_COMMANDS.find((item) => item.pattern.test(normalized))
    ?.channel ?? null;
}

function modeChannelFromComposer(composer: {
  imageMode?: boolean;
  musicMode?: boolean;
  threeDMode?: boolean;
  videoMode?: boolean;
  speechMode?: boolean;
  spriteMode?: boolean;
  comfyMode?: boolean;
  uiMode?: boolean;
}): SlashGuardChannel | null {
  if (composer.imageMode) return 'image';
  if (composer.musicMode) return 'music';
  if (composer.threeDMode) return 'threeD';
  if (composer.videoMode) return 'video';
  if (composer.speechMode) return 'speech';
  if (composer.spriteMode) return 'sprite';
  if (composer.comfyMode) return 'comfyui';
  if (composer.uiMode) return 'ui';
  return null;
}

function readyResult(channel: SlashGuardChannel): SlashCommandGuardResult {
  return { ok: true, channel };
}

function blocked(
  channel: SlashGuardChannel,
  message: string,
): SlashCommandGuardResult {
  return { ok: false, channel, message };
}

function imageGuard(
  channel: SlashGuardChannel,
  settings = loadImageGenerationSettings(),
): SlashCommandGuardResult {
  if (imageProviderReady(settings.preferredProviderId, settings)) {
    return readyResult(channel);
  }
  const provider = imageProviderById(settings.preferredProviderId, settings);
  const label = provider?.label || '当前生图 Provider';
  return blocked(
    channel,
    `当前指令需要生图渠道（${label} 未配置完成），请先到设置 > 生图 配置当前 Provider。`,
  );
}

function musicGuard(
  settings = loadMusicGenerationSettings(),
): SlashCommandGuardResult {
  if (musicProviderReady(settings.preferredProviderId, settings)) {
    return readyResult('music');
  }
  const provider = musicProviderById(settings.preferredProviderId, settings);
  return blocked(
    'music',
    `当前指令需要音乐渠道（${provider.label} 未配置完成），请先到设置 > 音乐渠道 配置可用 Provider。`,
  );
}

function threeDGuard(
  settings = loadThreeDGenerationSettings(),
): SlashCommandGuardResult {
  if (threeDProviderReady(settings.preferredProviderId, settings)) {
    return readyResult('threeD');
  }
  const provider = threeDProviderById(settings.preferredProviderId, settings);
  const label = provider?.label || '当前 3D Provider';
  return blocked(
    'threeD',
    `当前指令需要 3D 生成渠道（${label} 未配置完成），请先到设置 > 3D 渠道 配置当前 Provider。`,
  );
}

function videoGuard(
  settings = loadVideoGenerationSettings(),
): SlashCommandGuardResult {
  if (videoProviderReady(settings.preferredProviderId, settings)) {
    return readyResult('video');
  }
  const provider = videoProviderById(settings.preferredProviderId, settings);
  return blocked(
    'video',
    `当前指令需要视频渠道（${provider.label} 未配置完成），请先到设置 > 视频渠道 配置可用 Provider。`,
  );
}

function speechGuard(
  settings = loadSpeechGenerationSettings(),
): SlashCommandGuardResult {
  if (speechProviderReady(settings.preferredProviderId, settings)) {
    return readyResult('speech');
  }
  const provider = speechProviderById(settings.preferredProviderId, settings);
  return blocked(
    'speech',
    `当前指令需要语音渠道（${provider.label} 未配置完成），请先到设置 > 语音渠道 配置可用 Provider。`,
  );
}

function spriteGuard(
  imageSettings = loadImageGenerationSettings(),
): SlashCommandGuardResult {
  if (imageProviderReady(imageSettings.preferredProviderId, imageSettings)) {
    return readyResult('sprite');
  }
  const provider = imageProviderById(imageSettings.preferredProviderId, imageSettings);
  return blocked(
    'sprite',
    `当前 Sprite 指令会复用生图渠道（${provider.label} 未配置完成），请先到设置 > 生图 配置当前图片 Provider。`,
  );
}

function comfyGuard(
  imageSettings = loadImageGenerationSettings(),
): SlashCommandGuardResult {
  const comfyProviderReady = imageProviderReady('local-comfyui', imageSettings);
  if (comfyProviderReady) return readyResult('comfyui');
  return blocked(
    'comfyui',
    '当前指令需要 ComfyUI 渠道，请先到设置 > 生图 配置 ComfyUI（本地/远程）的地址。通常是 http://127.0.0.1:8188。',
  );
}

function uiGuard(
  settings = loadUiDesignChannelSettings(),
): SlashCommandGuardResult {
  if (uiDesignChannelReady(settings.preferredChannelId, settings)) {
    return readyResult('ui');
  }
  const channel = uiDesignChannelById(settings.preferredChannelId);
  return blocked(
    'ui',
    `当前指令需要 UI 设计渠道（${channel.label} 未配置完成），请先到设置 > UI 渠道 配置默认渠道。`,
  );
}

function meshSearchGuard(
  settings = loadMeshLibrarySettings(),
): SlashCommandGuardResult {
  if (settings.enabledIds.length > 0) return readyResult('meshSearch');
  const fallback = meshLibraryById('polyhaven', settings)?.label ?? 'Poly Haven';
  return blocked(
    'meshSearch',
    `当前指令需要在线模型库，请先到设置 > 在线模型库 启用至少一个库，例如 ${fallback}。`,
  );
}

export function guardSlashCommandChannel(
  channel: SlashGuardChannel,
  settings: SlashCommandGuardSettings = {},
): SlashCommandGuardResult {
  switch (channel) {
    case 'image':
      return imageGuard('image', settings.image);
    case 'music':
      return musicGuard(settings.music);
    case 'threeD':
      return threeDGuard(settings.threeD);
    case 'video':
      return videoGuard(settings.video);
    case 'speech':
      return speechGuard(settings.speech);
    case 'sprite':
      return spriteGuard(settings.image);
    case 'comfyui':
      return comfyGuard(settings.image);
    case 'ui':
      return uiGuard(settings.ui);
    case 'meshSearch':
      return meshSearchGuard(settings.meshLibrary);
    default:
      return readyResult(channel);
  }
}

export function guardSlashCommandText(
  text: string,
  composer: Parameters<typeof modeChannelFromComposer>[0],
  settings: SlashCommandGuardSettings = {},
): SlashCommandGuardResult | null {
  const channel = slashGuardChannelForText(text, composer);
  return channel ? guardSlashCommandChannel(channel, settings) : null;
}

export function slashGuardChannelForText(
  text: string,
  composer: Parameters<typeof modeChannelFromComposer>[0],
): SlashGuardChannel | null {
  const commandChannel = commandChannelFromText(text);
  return commandChannel ?? (text.trim().startsWith('/') ? null : modeChannelFromComposer(composer));
}
