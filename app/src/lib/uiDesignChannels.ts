import {
  readSettingsRaw,
  type SettingsProfileOptions,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';

export type UiDesignChannelId =
  | 'figma'
  | 'photoshop'
  | 'pencil'
  | 'penpot'
  | 'gimp-inkscape';

export type UiDesignChannelCategory = 'commercial' | 'free-open';

type UiDesignChannelToolKind =
  | 'cloud-app'
  | 'desktop-tool'
  | 'self-hosted'
  | 'open-source-desktop';

export interface UiDesignChannelDefinition {
  id: UiDesignChannelId;
  label: string;
  category: UiDesignChannelCategory;
  toolKind: UiDesignChannelToolKind;
  supportsBaseUrl: boolean;
  requiresBaseUrl: boolean;
  defaultBaseUrl: string;
  endpointPlaceholder: string;
  supportsKey: boolean;
  needsKey: boolean;
  keyLabel?: string;
  keyPlaceholder?: string;
  supportsCommand: boolean;
  requiresCommand: boolean;
  defaultCommand: string;
  commandPlaceholder: string;
  credentialUrl?: string;
  downloadLinks?: Array<{ label: string; url: string }>;
  defaultExportFormat: string;
  exportFormats: string[];
  note: string;
}

export interface UiDesignChannelSettings {
  enabled: boolean;
  preferredChannelId: UiDesignChannelId;
  channelKeys: Partial<Record<UiDesignChannelId, string>>;
  channelBaseUrls: Partial<Record<UiDesignChannelId, string>>;
  channelCommands: Partial<Record<UiDesignChannelId, string>>;
  channelExportFormats: Partial<Record<UiDesignChannelId, string>>;
}

export const UI_DESIGN_CHANNEL_STORAGE_KEY =
  'ultragamestudio.uiDesignChannels.v1';
const UI_DESIGN_CHANNEL_REL_PATH = 'settings/uiDesignChannels.v1.json';

export const UI_DESIGN_CHANNELS: UiDesignChannelDefinition[] = [
  {
    id: 'figma',
    label: 'Figma',
    category: 'commercial',
    toolKind: 'cloud-app',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultBaseUrl: '',
    endpointPlaceholder: '',
    supportsKey: false,
    needsKey: false,
    keyLabel: undefined,
    keyPlaceholder: undefined,
    supportsCommand: false,
    requiresCommand: false,
    defaultCommand: '',
    commandPlaceholder: '',
    credentialUrl: 'https://www.figma.com/',
    downloadLinks: [{ label: 'Figma 下载', url: 'https://www.figma.com/downloads/' }],
    defaultExportFormat: 'figma',
    exportFormats: ['figma', 'png', 'svg', 'pdf'],
    note: '商用协作设计路线。适合游戏 HUD、菜单、图标规范和设计系统稿；打开官网下载安装到本机或使用网页版。',
  },
  {
    id: 'photoshop',
    label: 'Adobe Photoshop',
    category: 'commercial',
    toolKind: 'desktop-tool',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultBaseUrl: '',
    endpointPlaceholder: '',
    supportsKey: false,
    needsKey: false,
    keyLabel: undefined,
    keyPlaceholder: undefined,
    supportsCommand: false,
    requiresCommand: false,
    defaultCommand: '',
    commandPlaceholder: '',
    credentialUrl: 'https://www.adobe.com/products/photoshop.html',
    downloadLinks: [
      {
        label: 'Photoshop 下载',
        url: 'https://www.adobe.com/products/photoshop/free-trial-download.html',
      },
    ],
    defaultExportFormat: 'psd',
    exportFormats: ['psd', 'png', 'svg', 'pdf'],
    note: '商用视觉资产路线。适合游戏 UI 高保真视觉、图标、按钮状态和宣传级界面素材；打开官网下载安装。',
  },
  {
    id: 'pencil',
    label: 'Pencil',
    category: 'free-open',
    toolKind: 'open-source-desktop',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultBaseUrl: '',
    endpointPlaceholder: '',
    supportsKey: false,
    needsKey: false,
    keyLabel: undefined,
    keyPlaceholder: undefined,
    supportsCommand: false,
    requiresCommand: false,
    defaultCommand: '',
    commandPlaceholder: '',
    credentialUrl: 'https://www.pencil.dev/',
    downloadLinks: [{ label: 'Pencil 下载', url: 'https://www.pencil.dev/downloads' }],
    defaultExportFormat: 'pencil',
    exportFormats: ['pencil', 'png', 'svg', 'pdf'],
    note: 'Pencil 设计工具路线。适合快速画游戏界面线框、流程稿、控件布局和可导出的 UI 说明图。',
  },
  {
    id: 'penpot',
    label: 'Penpot',
    category: 'free-open',
    toolKind: 'self-hosted',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultBaseUrl: '',
    endpointPlaceholder: '',
    supportsKey: false,
    needsKey: false,
    keyLabel: undefined,
    keyPlaceholder: undefined,
    supportsCommand: false,
    requiresCommand: false,
    defaultCommand: '',
    commandPlaceholder: '',
    credentialUrl: 'https://penpot.app/',
    downloadLinks: [
      { label: 'Penpot Web', url: 'https://design.penpot.app/' },
      { label: 'Penpot 自托管', url: 'https://penpot.app/self-host' },
    ],
    defaultExportFormat: 'penpot',
    exportFormats: ['penpot', 'svg', 'png', 'pdf'],
    note: '开源协作设计路线。适合团队化游戏 UI 原型、组件库和设计系统；打开网页后按需使用云端或自托管。',
  },
  {
    id: 'gimp-inkscape',
    label: 'GIMP / Inkscape',
    category: 'free-open',
    toolKind: 'open-source-desktop',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultBaseUrl: '',
    endpointPlaceholder: '',
    supportsKey: false,
    needsKey: false,
    keyLabel: undefined,
    keyPlaceholder: undefined,
    supportsCommand: false,
    requiresCommand: false,
    defaultCommand: '',
    commandPlaceholder: '',
    credentialUrl: 'https://www.gimp.org/',
    downloadLinks: [
      { label: 'GIMP 下载', url: 'https://www.gimp.org/downloads/' },
      { label: 'Inkscape 下载', url: 'https://inkscape.org/release/' },
    ],
    defaultExportFormat: 'png-svg',
    exportFormats: ['png-svg', 'xcf', 'svg', 'pdf'],
    note: '免费开源图形资产路线。适合游戏 UI 图标、矢量控件、位图切图和可脚本化导出。',
  },
];

const UI_DESIGN_CHANNEL_BY_ID = new Map<UiDesignChannelId, UiDesignChannelDefinition>(
  UI_DESIGN_CHANNELS.map((channel) => [channel.id, channel]),
);

export const DEFAULT_UI_DESIGN_CHANNEL_SETTINGS: UiDesignChannelSettings = {
  enabled: true,
  preferredChannelId: 'figma',
  channelKeys: {},
  channelBaseUrls: {},
  channelCommands: {},
  channelExportFormats: {},
};

export function isUiDesignChannelId(value: unknown): value is UiDesignChannelId {
  return (
    typeof value === 'string' &&
    UI_DESIGN_CHANNEL_BY_ID.has(value as UiDesignChannelId)
  );
}

export function isUiDesignChannelCategory(
  value: unknown,
): value is UiDesignChannelCategory {
  return value === 'commercial' || value === 'free-open';
}

export function uiDesignChannelById(
  id: UiDesignChannelId,
): UiDesignChannelDefinition {
  return UI_DESIGN_CHANNEL_BY_ID.get(id) ?? UI_DESIGN_CHANNELS[0];
}

export function defaultUiDesignChannelIdForCategory(
  category: UiDesignChannelCategory,
): UiDesignChannelId {
  return category === 'free-open' ? 'pencil' : 'figma';
}

export function uiDesignChannelCategoryLabel(
  category: UiDesignChannelCategory,
  locale?: string,
): string {
  if (locale && locale !== 'zh-CN') {
    return category === 'free-open' ? 'Free / open source' : 'Commercial';
  }
  return category === 'free-open' ? '免费开源' : '商用';
}

function cleanRecord<T extends string>(
  value: unknown,
  validKey: (key: unknown) => key is T,
): Partial<Record<T, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<T, string>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!validKey(key) || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function normalizeUiDesignChannelSettings(
  value: unknown,
): UiDesignChannelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_UI_DESIGN_CHANNEL_SETTINGS;
  }
  const source = value as Partial<UiDesignChannelSettings>;
  const preferredChannelId = isUiDesignChannelId(source.preferredChannelId)
    ? source.preferredChannelId
    : DEFAULT_UI_DESIGN_CHANNEL_SETTINGS.preferredChannelId;
  return {
    enabled: true,
    preferredChannelId,
    channelKeys: cleanRecord(source.channelKeys, isUiDesignChannelId),
    channelBaseUrls: cleanRecord(source.channelBaseUrls, isUiDesignChannelId),
    channelCommands: cleanRecord(source.channelCommands, isUiDesignChannelId),
    channelExportFormats: cleanRecord(
      source.channelExportFormats,
      isUiDesignChannelId,
    ),
  };
}

export function loadUiDesignChannelSettings(
  options: SettingsProfileOptions = {},
): UiDesignChannelSettings {
  try {
    const raw = readSettingsRaw(
      UI_DESIGN_CHANNEL_REL_PATH,
      UI_DESIGN_CHANNEL_STORAGE_KEY,
      options,
    );
    return normalizeUiDesignChannelSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_UI_DESIGN_CHANNEL_SETTINGS;
  }
}

export function saveUiDesignChannelSettings(
  settings: UiDesignChannelSettings,
  options: SettingsProfileOptions = {},
): void {
  const payload = JSON.stringify(normalizeUiDesignChannelSettings(settings));
  const ok = writeSettingsRaw(
    UI_DESIGN_CHANNEL_REL_PATH,
    UI_DESIGN_CHANNEL_STORAGE_KEY,
    payload,
    options,
  );
  if (!ok) {
    console.error('[uiDesignChannels] failed to persist settings');
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ugs:ui-design-channel-settings-changed'));
  }
}

export function uiDesignChannelBaseUrl(
  channelId: UiDesignChannelId,
  settings = loadUiDesignChannelSettings(),
): string {
  const custom = settings.channelBaseUrls[channelId]?.trim();
  if (custom) return custom.replace(/\/+$/, '');
  return uiDesignChannelById(channelId).defaultBaseUrl.replace(/\/+$/, '');
}

export function uiDesignChannelCommand(
  channelId: UiDesignChannelId,
  settings = loadUiDesignChannelSettings(),
): string {
  return (
    settings.channelCommands[channelId]?.trim() ||
    uiDesignChannelById(channelId).defaultCommand
  );
}

export function uiDesignChannelExportFormat(
  channelId: UiDesignChannelId,
  settings = loadUiDesignChannelSettings(),
): string {
  const channel = uiDesignChannelById(channelId);
  const configured = settings.channelExportFormats[channelId]?.trim();
  return configured && channel.exportFormats.includes(configured)
    ? configured
    : channel.defaultExportFormat;
}

export function uiDesignChannelReady(
  channelId: UiDesignChannelId,
  settings = loadUiDesignChannelSettings(),
): boolean {
  const channel = uiDesignChannelById(channelId);
  if (channel.needsKey && !settings.channelKeys[channelId]?.trim()) return false;
  if (channel.requiresBaseUrl && !uiDesignChannelBaseUrl(channelId, settings)) {
    return false;
  }
  if (channel.requiresCommand && !uiDesignChannelCommand(channelId, settings)) {
    return false;
  }
  return true;
}
