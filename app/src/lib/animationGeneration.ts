import { tauriFetch } from '@/lib/tauri';
import {
  readSettingsRaw,
  type SettingsProfileOptions,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';

export type BuiltInAnimationProviderId =
  | 'mixamo'
  | 'kimodo-local'
  | 'meshy-animation-api'
  | 'fal-meshy-animation'
  | 'deepmotion-saymotion'
  | 'anything-world'
  | 'actorcore'
  | 'rokoko-free-mocap'
  | 'rokoko-motion-library'
  | 'cmu-mocap-database'
  | 'mocap-online'
  | 'cmu-asf-amc-converter'
  | 'local-animation-server';

export type AnimationProviderId = BuiltInAnimationProviderId;

export type AnimationProviderCategory = 'library' | 'ai' | 'local';
export type AnimationProviderCapability =
  | 'search'
  | 'generate'
  | 'retarget'
  | 'mocap';
export type AnimationGenerationMode = 'search' | 'generate';

type AnimationProviderApiKind =
  | 'library-link'
  | 'fal-animation'
  | 'generic-online-animation'
  | 'generic-local-animation';

export interface AnimationProviderDefinition {
  id: AnimationProviderId;
  label: string;
  category: AnimationProviderCategory;
  apiKind: AnimationProviderApiKind;
  capabilities: AnimationProviderCapability[];
  defaultModel: string;
  models: string[];
  needsKey: boolean;
  local: boolean;
  defaultBaseUrl: string;
  supportsBaseUrl: boolean;
  endpointPlaceholder: string;
  credentialUrl?: string;
  keyLabel?: string;
  keyPlaceholder?: string;
  note: string;
  searchUrlTemplate?: string;
  targets: string[];
  outputFormats: string[];
}

export interface AnimationGenerationSettings {
  enabled: boolean;
  preferredProviderId: AnimationProviderId;
  providerKeys: Partial<Record<AnimationProviderId, string>>;
  providerBaseUrls: Partial<Record<AnimationProviderId, string>>;
  providerModels: Partial<Record<AnimationProviderId, string>>;
  providerModelLists: Partial<Record<AnimationProviderId, string[]>>;
  defaultSearchCount: number;
}

export interface AnimationSearchItem {
  providerId: AnimationProviderId;
  providerLabel: string;
  title: string;
  url: string;
  use: string;
  targets: string[];
  formats: string[];
}

export interface AnimationGenerationResult {
  providerId: AnimationProviderId;
  providerLabel: string;
  model: string;
  prompt: string;
  mode: AnimationGenerationMode;
  fallbackReason?: string;
  videos: string[];
  models: string[];
  clips: string[];
  metadata: string[];
  searchResults: AnimationSearchItem[];
}

export interface AnimationGenerationRequest {
  prompt: string;
  providerId?: AnimationProviderId;
  model?: string;
  mode?: AnimationGenerationMode;
  signal?: AbortSignal;
}

const STORAGE_KEY = 'ultragamestudio.animationGeneration.v1';
const SETTINGS_REL_PATH = 'settings/animationGeneration.v1.json';
const DEFAULT_SEARCH_COUNT = 8;
const MIN_SEARCH_COUNT = 1;
const MAX_SEARCH_COUNT = 20;

export const ANIMATION_PROVIDERS: AnimationProviderDefinition[] = [
  {
    id: 'mixamo',
    label: 'Mixamo',
    category: 'library',
    apiKind: 'library-link',
    capabilities: ['search', 'retarget'],
    defaultModel: 'mixamo-library',
    models: ['mixamo-library'],
    needsKey: false,
    local: false,
    defaultBaseUrl: 'https://www.mixamo.com',
    supportsBaseUrl: false,
    endpointPlaceholder: 'https://www.mixamo.com',
    credentialUrl: 'https://www.mixamo.com/',
    note: '人形动作库和自动套动作路线。无稳定公开 API；应用提供可点击检索入口，下载/导入仍走网页或人工缓存。',
    searchUrlTemplate: 'https://www.mixamo.com/#/?query={query}&type=Motion%2CMotionPack',
    targets: ['humanoid', 'mixamo-compatible'],
    outputFormats: ['fbx'],
  },
  {
    id: 'kimodo-local',
    label: 'KIMODO / nv-tlabs',
    category: 'local',
    apiKind: 'generic-local-animation',
    capabilities: ['generate', 'retarget'],
    defaultModel: 'kimodo',
    models: ['kimodo', 'kimodo-humanoid', 'kimodo-human-object'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8094/generate-animation',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8094/generate-animation',
    credentialUrl: 'https://github.com/nv-tlabs/kimodo',
    note: '本地研究模型路线。适合把 KIMODO 或同类 text-to-motion / interaction-motion 服务包装成 HTTP endpoint 后接入。',
    targets: ['humanoid', 'human-object-interaction'],
    outputFormats: ['bvh', 'fbx', 'glb', 'mp4'],
  },
  {
    id: 'meshy-animation-api',
    label: 'Meshy Animation API',
    category: 'ai',
    apiKind: 'generic-online-animation',
    capabilities: ['generate', 'retarget'],
    defaultModel: 'meshy-animation',
    models: ['meshy-animation', 'meshy-animation-library'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.meshy.ai/openapi/v1/animations',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://api.meshy.ai/openapi/v1/animations',
    credentialUrl: 'https://docs.meshy.ai/en/api/animation',
    keyLabel: 'Meshy API Key',
    keyPlaceholder: 'msy-...',
    note: '在线角色动画和动作库 API。适合已绑骨的人形模型，返回动画资产、预览或异步任务状态。',
    targets: ['rigged-humanoid'],
    outputFormats: ['fbx', 'glb', 'mp4'],
  },
  {
    id: 'fal-meshy-animation',
    label: 'fal.ai Meshy Animation',
    category: 'ai',
    apiKind: 'fal-animation',
    capabilities: ['generate', 'retarget'],
    defaultModel: 'fal-ai/meshy/rigging/multi-animation',
    models: ['fal-ai/meshy/rigging/multi-animation', 'fal-ai/meshy/rigging'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://queue.fal.run',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://queue.fal.run',
    credentialUrl: 'https://fal.ai/models',
    keyLabel: 'fal API Key',
    keyPlaceholder: 'fal-...',
    note: 'fal 队列托管的 Meshy 动画/绑骨路线。适合把动画需求发给在线队列，返回预览或资产链接。',
    targets: ['humanoid'],
    outputFormats: ['glb', 'fbx', 'mp4'],
  },
  {
    id: 'deepmotion-saymotion',
    label: 'DeepMotion SayMotion / Animate 3D',
    category: 'ai',
    apiKind: 'generic-online-animation',
    capabilities: ['generate', 'mocap', 'retarget'],
    defaultModel: 'saymotion',
    models: ['saymotion', 'animate-3d', 'motion-brain'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.deepmotion.com',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://api.deepmotion.com',
    credentialUrl: 'https://www.deepmotion.com/',
    keyLabel: 'DeepMotion API Key',
    keyPlaceholder: 'API Key',
    note: 'AI 动作生成与视频动捕候选。具体 endpoint 随账号方案变化，可填官方或自建代理 endpoint。',
    targets: ['humanoid', 'mocap'],
    outputFormats: ['fbx', 'bvh', 'mp4'],
  },
  {
    id: 'anything-world',
    label: 'Anything World Animate',
    category: 'ai',
    apiKind: 'generic-online-animation',
    capabilities: ['generate', 'retarget'],
    defaultModel: 'auto',
    models: ['auto', 'humanoid', 'animal', 'creature'],
    needsKey: true,
    local: false,
    defaultBaseUrl: '',
    supportsBaseUrl: true,
    endpointPlaceholder: '粘贴 Anything World animate API endpoint',
    credentialUrl: 'https://everythinguniver.se/anything-world-apis',
    keyLabel: 'Anything World API Key',
    keyPlaceholder: 'API Key',
    note: '覆盖动物和非标准生物更合适；需要把账号可用的 animate endpoint 填入 Base URL。',
    targets: ['humanoid', 'animal', 'creature'],
    outputFormats: ['glb', 'fbx', 'mp4'],
  },
  {
    id: 'actorcore',
    label: 'ActorCore',
    category: 'library',
    apiKind: 'library-link',
    capabilities: ['search'],
    defaultModel: 'actorcore-library',
    models: ['actorcore-library'],
    needsKey: false,
    local: false,
    defaultBaseUrl: 'https://actorcore.reallusion.com/3d-motion',
    supportsBaseUrl: false,
    endpointPlaceholder: 'https://actorcore.reallusion.com/3d-motion',
    credentialUrl: 'https://actorcore.reallusion.com/3d-motion',
    note: '商业角色动作库。适合人形 FBX/BVH 动作检索和授权采购。',
    searchUrlTemplate: 'https://actorcore.reallusion.com/3d-motion?keyword={query}',
    targets: ['humanoid'],
    outputFormats: ['fbx', 'bvh'],
  },
  {
    id: 'rokoko-free-mocap',
    label: 'Rokoko Free Mocap',
    category: 'library',
    apiKind: 'library-link',
    capabilities: ['search'],
    defaultModel: 'rokoko-free-263',
    models: ['rokoko-free-263'],
    needsKey: false,
    local: false,
    defaultBaseUrl: 'https://www.rokoko.com/resources/download-263-rokoko-motion-capture-assets',
    supportsBaseUrl: false,
    endpointPlaceholder: 'https://www.rokoko.com/resources/download-263-rokoko-motion-capture-assets',
    credentialUrl: 'https://www.rokoko.com/resources/download-263-rokoko-motion-capture-assets',
    note: '免费动作资产包入口。FBX 输出，面向 Mixamo、UE4/UE5、HumanIK 等人形骨架路线；适合先拿可用游戏动作。',
    searchUrlTemplate: 'https://www.rokoko.com/resources/download-263-rokoko-motion-capture-assets',
    targets: ['humanoid', 'mixamo-compatible', 'ue4', 'ue5', 'humanik'],
    outputFormats: ['fbx'],
  },
  {
    id: 'rokoko-motion-library',
    label: 'Rokoko Motion Library',
    category: 'library',
    apiKind: 'library-link',
    capabilities: ['search'],
    defaultModel: 'rokoko-library',
    models: ['rokoko-library'],
    needsKey: false,
    local: false,
    defaultBaseUrl: 'https://www.rokoko.com/products/motion-library',
    supportsBaseUrl: false,
    endpointPlaceholder: 'https://www.rokoko.com/products/motion-library',
    credentialUrl: 'https://www.rokoko.com/products/motion-library',
    note: '动作库和动捕生态入口。适合搜索人形动作，再下载到 DCC/引擎工作流。',
    searchUrlTemplate: 'https://www.rokoko.com/products/motion-library?search={query}',
    targets: ['humanoid'],
    outputFormats: ['fbx', 'bvh'],
  },
  {
    id: 'cmu-mocap-database',
    label: 'CMU Mocap Database',
    category: 'library',
    apiKind: 'library-link',
    capabilities: ['search'],
    defaultModel: 'cmu-asf-amc-library',
    models: ['cmu-asf-amc-library'],
    needsKey: false,
    local: false,
    defaultBaseUrl: 'https://mocap.cs.cmu.edu/',
    supportsBaseUrl: false,
    endpointPlaceholder: 'https://mocap.cs.cmu.edu/',
    credentialUrl: 'https://mocap.cs.cmu.edu/',
    note: '研究型动作库入口。原始 ASF/AMC 不直接预览；需要转 BVH/FBX/GLB 后再进信息流播放。应用只给检索入口，不自动批量抓库。',
    searchUrlTemplate: 'https://mocap.cs.cmu.edu/search.php?subject=&motion={query}',
    targets: ['humanoid', 'research-mocap'],
    outputFormats: ['asf', 'amc', 'asf/amc -> bvh', 'asf/amc -> fbx', 'asf/amc -> glb'],
  },
  {
    id: 'mocap-online',
    label: 'MoCap Online',
    category: 'library',
    apiKind: 'library-link',
    capabilities: ['search'],
    defaultModel: 'mocap-online-library',
    models: ['mocap-online-library'],
    needsKey: false,
    local: false,
    defaultBaseUrl: 'https://mocaponline.com/',
    supportsBaseUrl: false,
    endpointPlaceholder: 'https://mocaponline.com/',
    credentialUrl: 'https://mocaponline.com/',
    note: '游戏常用动作包库。适合按 locomotion、combat、weapon 等关键词找成套动作。',
    searchUrlTemplate: 'https://mocaponline.com/search?q={query}',
    targets: ['humanoid', 'game-character'],
    outputFormats: ['fbx', 'unitypackage', 'unreal'],
  },
  {
    id: 'cmu-asf-amc-converter',
    label: 'CMU ASF/AMC 转换器',
    category: 'local',
    apiKind: 'generic-local-animation',
    capabilities: ['generate', 'mocap'],
    defaultModel: 'asf-amc-to-bvh',
    models: ['asf-amc-to-bvh', 'asf-amc-to-fbx', 'asf-amc-to-glb'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8096/convert/cmu-asf-amc',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8096/convert/cmu-asf-amc',
    credentialUrl: 'https://mocap.cs.cmu.edu/',
    note: '本地 CMU 转换服务入口。服务接收 ASF/AMC 文件或 URL，返回 BVH/FBX/GLB/JSON；未启动服务时只作为配置项。',
    targets: ['cmu-mocap', 'humanoid', 'research-mocap'],
    outputFormats: ['bvh', 'fbx', 'glb', 'json'],
  },
  {
    id: 'local-animation-server',
    label: '本地/自定义动画 HTTP',
    category: 'local',
    apiKind: 'generic-local-animation',
    capabilities: ['search', 'generate', 'retarget', 'mocap'],
    defaultModel: 'custom-animation-model',
    models: ['custom-animation-model', 'text-to-motion', 'motion-transfer', 'video-mocap'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8095/generate',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8095/generate',
    note: '本地统一入口。服务只需接受 prompt/model/mode JSON，并返回 video_url、glb/fbx/bvh、metadata 或 task status。',
    targets: ['humanoid', 'animal', 'creature', 'custom'],
    outputFormats: ['bvh', 'fbx', 'glb', 'mp4', 'json'],
  },
];

const ANIMATION_PROVIDER_BY_ID = new Map<AnimationProviderId, AnimationProviderDefinition>(
  ANIMATION_PROVIDERS.map((provider) => [provider.id, provider]),
);

export const DEFAULT_ANIMATION_GENERATION_SETTINGS: AnimationGenerationSettings = {
  enabled: true,
  preferredProviderId: 'mixamo',
  providerKeys: {},
  providerBaseUrls: {},
  providerModels: {},
  providerModelLists: {},
  defaultSearchCount: DEFAULT_SEARCH_COUNT,
};

function isAnimationProviderId(value: unknown): value is AnimationProviderId {
  return typeof value === 'string' && ANIMATION_PROVIDER_BY_ID.has(value as AnimationProviderId);
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

function cleanModelListRecord<T extends string>(
  value: unknown,
  validKey: (key: unknown) => key is T,
): Partial<Record<T, string[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<T, string[]>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!validKey(key) || !Array.isArray(raw)) continue;
    const models = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    if (models.length > 0) out[key] = Array.from(new Set(models));
  }
  return out;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function normalizeAnimationGenerationSettings(
  value: unknown,
): AnimationGenerationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_ANIMATION_GENERATION_SETTINGS;
  }
  const source = value as Partial<AnimationGenerationSettings>;
  const preferredProviderId = isAnimationProviderId(source.preferredProviderId)
    ? source.preferredProviderId
    : DEFAULT_ANIMATION_GENERATION_SETTINGS.preferredProviderId;
  return {
    enabled: true,
    preferredProviderId,
    providerKeys: cleanRecord(source.providerKeys, isAnimationProviderId),
    providerBaseUrls: cleanRecord(source.providerBaseUrls, isAnimationProviderId),
    providerModels: cleanRecord(source.providerModels, isAnimationProviderId),
    providerModelLists: cleanModelListRecord(source.providerModelLists, isAnimationProviderId),
    defaultSearchCount: clampInteger(
      source.defaultSearchCount,
      MIN_SEARCH_COUNT,
      MAX_SEARCH_COUNT,
      DEFAULT_SEARCH_COUNT,
    ),
  };
}

export function loadAnimationGenerationSettings(
  options: SettingsProfileOptions = {},
): AnimationGenerationSettings {
  try {
    const raw = readSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, options);
    return normalizeAnimationGenerationSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_ANIMATION_GENERATION_SETTINGS;
  }
}

export function saveAnimationGenerationSettings(
  settings: AnimationGenerationSettings,
  options: SettingsProfileOptions = {},
): boolean {
  const payload = JSON.stringify(normalizeAnimationGenerationSettings(settings));
  const ok = writeSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, payload, options);
  if (!ok) {
    console.error('[animationGeneration] failed to persist settings');
    return false;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ugs:animation-generation-settings-changed'));
  }
  return true;
}

export function animationProviders(): AnimationProviderDefinition[] {
  return ANIMATION_PROVIDERS;
}

export function animationProviderById(
  id: AnimationProviderId,
): AnimationProviderDefinition {
  return ANIMATION_PROVIDER_BY_ID.get(id) ?? ANIMATION_PROVIDERS[0];
}

export function animationProviderModel(
  providerId: AnimationProviderId,
  settings = loadAnimationGenerationSettings(),
): string {
  const provider = animationProviderById(providerId);
  return settings.providerModels[providerId]?.trim() || provider.defaultModel;
}

export function animationProviderBaseUrl(
  providerId: AnimationProviderId,
  settings = loadAnimationGenerationSettings(),
): string {
  const custom = settings.providerBaseUrls[providerId]?.trim();
  if (custom) return custom.replace(/\/+$/, '');
  return animationProviderById(providerId).defaultBaseUrl.replace(/\/+$/, '');
}

function animationProviderKey(
  providerId: AnimationProviderId,
  settings = loadAnimationGenerationSettings(),
): string {
  return settings.providerKeys[providerId]?.trim() ?? '';
}

export function animationProviderReady(
  providerId: AnimationProviderId,
  settings = loadAnimationGenerationSettings(),
): boolean {
  const provider = animationProviderById(providerId);
  if (provider.apiKind === 'library-link') return provider.capabilities.includes('search');
  if (provider.needsKey && !animationProviderKey(providerId, settings)) return false;
  if (provider.local && !settings.providerBaseUrls[providerId]?.trim()) return false;
  return !!animationProviderBaseUrl(providerId, settings);
}

export function configuredAnimationProviderIds(
  settings = loadAnimationGenerationSettings(),
): AnimationProviderId[] {
  return ANIMATION_PROVIDERS.filter((provider) =>
    animationProviderReady(provider.id, settings),
  ).map((provider) => provider.id);
}

export function preferredReadyAnimationProviderId(
  settings = loadAnimationGenerationSettings(),
): AnimationProviderId | null {
  if (animationProviderReady(settings.preferredProviderId, settings)) {
    return settings.preferredProviderId;
  }
  return configuredAnimationProviderIds(settings)[0] ?? null;
}

export function preferredReadyAnimationGenerationProviderId(
  settings = loadAnimationGenerationSettings(),
): AnimationProviderId | null {
  if (
    animationProviderReady(settings.preferredProviderId, settings) &&
    animationProviderById(settings.preferredProviderId).capabilities.includes('generate')
  ) {
    return settings.preferredProviderId;
  }
  return (
    ANIMATION_PROVIDERS.find(
      (provider) =>
        provider.capabilities.includes('generate') &&
        animationProviderReady(provider.id, settings),
    )?.id ?? null
  );
}

export function looksLikeAnimationGenerationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /^\/(?:anim|animation|motion|mocap|anim-mode-start|动画|动作|动作库)(?:\s|$)/iu.test(
      normalized,
    )
  ) {
    return true;
  }
  const zhIntent =
    /(搜索|查找|寻找|找|生成|创建|制作|做|取|套用)[\s\S]{0,24}(动画|动作|动捕|mocap|motion|bvh|fbx)/iu.test(text) ||
    /(动画|动作|动捕|mocap|motion|bvh|fbx)[\s\S]{0,24}(搜索|查找|寻找|找|生成|创建|制作|做|取|套用)/iu.test(text);
  if (zhIntent) return true;
  return /\b(search|find|get|generate|create|make|retarget|mocap)\b[\s\S]{0,64}\b(animation|motion|mocap|bvh|fbx|humanoid action)\b/i.test(
    normalized,
  );
}

export function stripAnimationCommand(text: string): string {
  return text
    .trim()
    .replace(/^\/(?:anim|animation|motion|mocap|anim-mode-start|anim-mode-end|动画|动作|动作库)\s*/iu, '')
    .replace(
      /^请?(?:帮我)?(?:搜索|查找|寻找|找|生成|创建|制作|做|取|套用)(?:一个|一段|一套|一些)?(?:动画|动作|动捕|mocap|motion|bvh|fbx)?/iu,
      '',
    )
    .trim();
}

export function inferAnimationMode(prompt: string): AnimationGenerationMode {
  const raw = prompt.trim();
  if (
    /(?:搜索|查找|寻找|找|检索|动作库|mixamo|actorcore|rokoko|mocap online|\bsearch\b|\bfind\b|\blibrary\b)/iu.test(
      raw,
    )
  ) {
    return 'search';
  }
  if (
    /(?:生成|创建|制作|做|动捕生成|重定向|retarget|generate|create|make|mocap from video)/iu.test(
      raw,
    )
  ) {
    return 'generate';
  }
  if (/^\/(?:anim|animation|motion|mocap|动画|动作|动作库)(?:\s|$)/iu.test(raw)) {
    return 'search';
  }
  const text = stripAnimationCommand(prompt).toLowerCase();
  if (
    /(?:搜索|查找|寻找|找|检索|动作库|mixamo|actorcore|rokoko|mocap online|\bsearch\b|\bfind\b|\blibrary\b)/iu.test(
      text,
    )
  ) {
    return 'search';
  }
  if (
    /(?:生成|创建|制作|做|动捕生成|重定向|retarget|generate|create|make|mocap from video)/iu.test(
      text,
    )
  ) {
    return 'generate';
  }
  return 'generate';
}

function cleanAnimationSearchQuery(prompt: string): string {
  return stripAnimationCommand(prompt)
    .replace(/^(?:search|find|get)\s+(?:an?\s+)?(?:animation|motion|mocap)\s*/iu, '')
    .replace(/^(?:for|by name)\s*/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchUrlForProvider(provider: AnimationProviderDefinition, query: string): string {
  const encoded = encodeURIComponent(query);
  if (provider.searchUrlTemplate) {
    return provider.searchUrlTemplate.replace('{query}', encoded);
  }
  return provider.defaultBaseUrl;
}

export function searchAnimationLibraries(
  query: string,
  settings = loadAnimationGenerationSettings(),
): AnimationSearchItem[] {
  const cleanQuery = cleanAnimationSearchQuery(query) || 'idle walk run';
  return ANIMATION_PROVIDERS.filter(
    (provider) =>
      provider.capabilities.includes('search') &&
      animationProviderReady(provider.id, settings),
  )
    .slice(0, settings.defaultSearchCount)
    .map((provider) => ({
      providerId: provider.id,
      providerLabel: provider.label,
      title: `${provider.label}: ${cleanQuery}`,
      url: searchUrlForProvider(provider, cleanQuery),
      use: provider.note,
      targets: provider.targets,
      formats: provider.outputFormats,
    }));
}

export async function generateAnimation(
  request: AnimationGenerationRequest,
  settings = loadAnimationGenerationSettings(),
): Promise<AnimationGenerationResult> {
  const prompt = stripAnimationCommand(request.prompt);
  const requestedMode = request.mode ?? inferAnimationMode(request.prompt);
  if (requestedMode === 'search') {
    const providerId = request.providerId ?? preferredReadyAnimationProviderId(settings) ?? 'mixamo';
    const provider = animationProviderById(providerId);
    return {
      providerId,
      providerLabel: provider.label,
      model: animationProviderModel(providerId, settings),
      prompt,
      mode: 'search',
      videos: [],
      models: [],
      clips: [],
      metadata: [],
      searchResults: searchAnimationLibraries(prompt, settings),
    };
  }

  const providerId =
    request.providerId && animationProviderById(request.providerId).capabilities.includes('generate')
      ? request.providerId
      : preferredReadyAnimationGenerationProviderId(settings);
  if (!providerId) {
    return searchFallbackResult(
      prompt,
      settings,
      '未配置可直接生成动画的 Provider，已改为按名称搜索动作库。',
    );
  }
  if (!animationProviderReady(providerId, settings)) {
    return searchFallbackResult(
      prompt,
      settings,
      `${animationProviderById(providerId).label} 未配置完成，已改为按名称搜索动作库。`,
    );
  }

  const provider = animationProviderById(providerId);
  const model = request.model?.trim() || animationProviderModel(providerId, settings);
  const generated = await generateWithProvider(
    providerId,
    prompt,
    model,
    settings,
    request.signal,
  );
  return {
    providerId,
    providerLabel: provider.label,
    model,
    prompt,
    mode: 'generate',
    videos: generated.videos,
    models: generated.models,
    clips: generated.clips,
    metadata: generated.metadata,
    searchResults: [],
  };
}

function searchFallbackResult(
  prompt: string,
  settings: AnimationGenerationSettings,
  fallbackReason: string,
): AnimationGenerationResult {
  const providerId = preferredReadyAnimationProviderId(settings) ?? 'mixamo';
  const provider = animationProviderById(providerId);
  return {
    providerId,
    providerLabel: provider.label,
    model: animationProviderModel(providerId, settings),
    prompt,
    mode: 'search',
    fallbackReason,
    videos: [],
    models: [],
    clips: [],
    metadata: [],
    searchResults: searchAnimationLibraries(prompt, settings),
  };
}

async function generateWithProvider(
  providerId: AnimationProviderId,
  prompt: string,
  model: string,
  settings: AnimationGenerationSettings,
  signal?: AbortSignal,
): Promise<Pick<AnimationGenerationResult, 'videos' | 'models' | 'clips' | 'metadata'>> {
  const provider = animationProviderById(providerId);
  if (provider.apiKind === 'fal-animation') {
    return generateFalAnimation(providerId, prompt, model, settings, signal);
  }
  if (
    provider.apiKind === 'generic-online-animation' ||
    provider.apiKind === 'generic-local-animation'
  ) {
    return generateGenericAnimation(providerId, prompt, model, settings, signal);
  }
  throw new Error(`${provider.label} is a search-only animation library.`);
}

function animationRequestBody(
  prompt: string,
  model: string,
  providerId?: AnimationProviderId,
): Record<string, unknown> {
  const outputFormat =
    providerId === 'cmu-asf-amc-converter' || /\bbvh\b/i.test(model) ? 'bvh' : 'glb';
  return {
    prompt,
    query: prompt,
    model,
    mode: inferAnimationMode(prompt),
    output_format: outputFormat,
    output_formats: ['glb', 'fbx', 'bvh', 'mp4', 'json'],
    formats: ['glb', 'fbx', 'bvh', 'mp4', 'json'],
    source_formats: ['asf', 'amc', 'bvh', 'fbx', 'glb', 'mp4'],
    target: 'game-ready humanoid animation',
    retarget: true,
    preview: true,
  };
}

async function generateGenericAnimation(
  providerId: AnimationProviderId,
  prompt: string,
  model: string,
  settings: AnimationGenerationSettings,
  signal?: AbortSignal,
): Promise<Pick<AnimationGenerationResult, 'videos' | 'models' | 'clips' | 'metadata'>> {
  const provider = animationProviderById(providerId);
  const apiKey = animationProviderKey(providerId, settings);
  if (provider.needsKey && !apiKey) throw new Error(`${provider.label} API key is missing.`);
  const baseUrl = animationProviderBaseUrl(providerId, settings);
  const headers: Record<string, string> = {
    Accept: 'application/json, video/*, model/*, application/octet-stream',
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await tauriFetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(animationRequestBody(prompt, model, providerId)),
    signal,
  });
  return readAndMaybePollAnimation(response, provider.label, headers, baseUrl, signal);
}

async function generateFalAnimation(
  providerId: AnimationProviderId,
  prompt: string,
  model: string,
  settings: AnimationGenerationSettings,
  signal?: AbortSignal,
): Promise<Pick<AnimationGenerationResult, 'videos' | 'models' | 'clips' | 'metadata'>> {
  const apiKey = animationProviderKey(providerId, settings);
  if (!apiKey) throw new Error('fal API key is missing.');
  const baseUrl = animationProviderBaseUrl(providerId, settings);
  const modelPath = model.replace(/^\/+/, '');
  const headers = {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const response = await tauriFetch(`${baseUrl}/${modelPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: animationRequestBody(prompt, model, providerId) }),
    signal,
  });
  return readAndMaybePollAnimation(
    response,
    'fal.ai',
    headers,
    `${baseUrl}/${modelPath}`,
    signal,
  );
}

async function readAndMaybePollAnimation(
  response: Response,
  providerLabel: string,
  headers: Record<string, string>,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<Pick<AnimationGenerationResult, 'videos' | 'models' | 'clips' | 'metadata'>> {
  const started = await readResponseJsonOrAssets(response, providerLabel);
  const immediate = animationAssetsFromJson(started);
  if (hasAnyAsset(immediate) && isTerminalSuccess(started)) return immediate;
  const statusUrl = statusUrlFromUnknown(started);
  const taskId = taskIdFromUnknown(started);
  const responseUrl = responseUrlFromUnknown(started);
  if (!statusUrl && !taskId) {
    if (hasAnyAsset(immediate)) return immediate;
    throw new Error(`${providerLabel} returned no animation assets.`);
  }
  for (let i = 0; i < 160; i += 1) {
    await delay(3000, signal);
    const url =
      statusUrl ||
      `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(taskId ?? '')}/status`;
    const statusResponse = await tauriFetch(url, { headers, signal });
    const status = await readJsonResponse(statusResponse);
    const state = jsonState(status);
    if (isFailedState(state)) {
      throw new Error(providerErrorMessage(status) || `${providerLabel} generation failed.`);
    }
    const statusAssets = animationAssetsFromJson(status);
    if (hasAnyAsset(statusAssets) && isTerminalSuccess(status)) return statusAssets;
    if (isSuccessState(state, status)) {
      const finalUrl =
        responseUrl ||
        `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(taskId ?? '')}`;
      const finalResponse = await tauriFetch(finalUrl, { headers, signal });
      const finalJson = await readJsonResponse(finalResponse);
      const assets = animationAssetsFromJson(finalJson);
      if (hasAnyAsset(assets)) return assets;
      throw new Error(`${providerLabel} returned no animation assets.`);
    }
  }
  throw new Error(`${providerLabel} job timed out before animation assets were ready.`);
}

function hasAnyAsset(
  value: Pick<AnimationGenerationResult, 'videos' | 'models' | 'clips' | 'metadata'>,
): boolean {
  return (
    value.videos.length > 0 ||
    value.models.length > 0 ||
    value.clips.length > 0 ||
    value.metadata.length > 0
  );
}

async function readResponseJsonOrAssets(
  response: Response,
  providerLabel: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${providerLabel} ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (isVideoMime(contentType)) {
    const bytes = arrayBufferToBase64(await response.arrayBuffer());
    return { video_url: dataUrl(bytes, contentType.split(';')[0] || 'video/mp4'), status: 'succeeded' };
  }
  if (isAssetMime(contentType)) {
    const bytes = arrayBufferToBase64(await response.arrayBuffer());
    return { output: dataUrl(bytes, contentType.split(';')[0] || 'model/gltf-binary'), status: 'succeeded' };
  }
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    throw new Error(`${providerLabel} returned a non-JSON response.`);
  }
  return json as Record<string, unknown>;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') throw new Error('Provider returned a non-JSON response.');
  return json as Record<string, unknown>;
}

function animationAssetsFromJson(
  json: Record<string, unknown>,
): Pick<AnimationGenerationResult, 'videos' | 'models' | 'clips' | 'metadata'> {
  const out = { videos: [] as string[], models: [] as string[], clips: [] as string[], metadata: [] as string[] };
  const push = (kind: keyof typeof out, src: string) => {
    const value = src.trim();
    if (value && !out[kind].includes(value)) out[kind].push(value);
  };
  for (const key of [
    'video',
    'video_url',
    'videoUrl',
    'preview',
    'preview_url',
    'previewUrl',
    'mp4',
    'media',
  ]) {
    for (const src of stringsFromUnknown(json[key], key)) {
      const normalized = normalizeVideoSource(src);
      if (normalized) push('videos', normalized);
    }
  }
  for (const key of [
    'model',
    'models',
    'mesh',
    'glb',
    'gltf',
    'model_url',
    'modelUrl',
    'rigged_model',
    'riggedModel',
  ]) {
    for (const src of stringsFromUnknown(json[key], key)) {
      const normalized = normalizeModelSource(src, key);
      if (normalized) push('models', normalized);
    }
  }
  for (const key of [
    'animation',
    'animations',
    'clip',
    'clips',
    'motion',
    'motions',
    'fbx',
    'bvh',
    'asset',
    'assets',
    'output',
    'outputs',
    'result',
    'results',
    'data',
    'files',
  ]) {
    for (const src of stringsFromUnknown(json[key], key)) {
      const video = normalizeVideoSource(src);
      if (video) {
        push('videos', video);
        continue;
      }
      const model = normalizeModelSource(src, key);
      if (model) {
        push(modelClipKey(model) ? 'clips' : 'models', model);
        continue;
      }
      const meta = normalizeMetadataSource(src, key);
      if (meta) push('metadata', meta);
    }
  }
  for (const src of stringsFromUnknown(json, 'root')) {
    const video = normalizeVideoSource(src);
    if (video) push('videos', video);
    const model = normalizeModelSource(src, 'root');
    if (model) push(modelClipKey(model) ? 'clips' : 'models', model);
  }
  return out;
}

function stringsFromUnknown(value: unknown, keyHint = ''): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [sourceFromString(value, keyHint)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((item) => stringsFromUnknown(item, keyHint));
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const direct: string[] = [];
  for (const key of [
    'url',
    'uri',
    'download_url',
    'downloadUrl',
    'file_url',
    'fileUrl',
    'asset_url',
    'assetUrl',
    'video_url',
    'videoUrl',
    'model_url',
    'modelUrl',
    'animation_url',
    'animationUrl',
    'bvh_url',
    'bvhUrl',
    'fbx_url',
    'fbxUrl',
    'glb_url',
    'glbUrl',
    'output_url',
    'outputUrl',
    'data',
    'base64',
    'b64',
    'bytesBase64Encoded',
  ]) {
    direct.push(...stringsFromUnknown(record[key], key));
  }
  const inlineData = objectValue(record.inlineData) ?? objectValue(record.inline_data);
  if (inlineData) {
    const data = stringValue(inlineData.data);
    const mimeType = stringValue(inlineData.mimeType) || stringValue(inlineData.mime_type);
    if (data && mimeType) direct.push(dataUrl(data, mimeType));
  }
  for (const key of [
    'video',
    'videos',
    'model',
    'models',
    'mesh',
    'animation',
    'animations',
    'clip',
    'clips',
    'motion',
    'motions',
    'asset',
    'assets',
    'output',
    'outputs',
    'result',
    'results',
    'data',
    'files',
    'response',
  ]) {
    direct.push(...stringsFromUnknown(record[key], key));
  }
  return Array.from(new Set(direct.filter(Boolean)));
}

function sourceFromString(value: string, keyHint: string): string {
  const src = value.trim();
  if (!src) return '';
  if (/^(?:https?:|file:|data:)/i.test(src)) return src;
  if (/^[A-Za-z0-9+/]+={0,2}$/u.test(src) && src.length > 80) {
    if (videoishKey(keyHint)) return dataUrl(src, 'video/mp4');
    if (metadataKey(keyHint)) return dataUrl(src, 'application/json');
    return dataUrl(src, 'model/gltf-binary');
  }
  return src;
}

function normalizeVideoSource(value: string): string {
  const src = value.trim();
  if (/^data:video\//i.test(src)) return src;
  if (/^(?:https?:|file:)\/\//i.test(src) && VIDEO_EXT_RE.test(src)) return src;
  return '';
}

function normalizeModelSource(value: string, keyHint: string): string {
  const src = value.trim();
  if (/^data:(?:model\/|application\/octet-stream|application\/x-fbx|application\/zip)/i.test(src)) return src;
  if (/^(?:https?:|file:)\/\//i.test(src) && MODEL_OR_CLIP_EXT_RE.test(src)) return src;
  if (/^data:text\/plain/i.test(src) && clipLikeKey(keyHint)) return src;
  if (/^data:application\/json/i.test(src) && metadataKey(keyHint)) return '';
  return '';
}

function normalizeMetadataSource(value: string, keyHint: string): string {
  const src = value.trim();
  if (/^data:application\/json/i.test(src)) return src;
  if (/^(?:https?:|file:)\/\//i.test(src) && METADATA_EXT_RE.test(src)) return src;
  if (metadataKey(keyHint) && /^https?:\/\//i.test(src)) return src;
  return '';
}

function modelClipKey(src: string): boolean {
  return /\.(?:fbx|bvh|anim|dae|zip|asf|amc)(?:[?#]|$)/iu.test(src);
}

const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v|avi|mkv)(?:[?#]|$)/iu;
const MODEL_OR_CLIP_EXT_RE = /\.(?:glb|gltf|fbx|bvh|anim|dae|zip|usdz|asf|amc)(?:[?#]|$)/iu;
const METADATA_EXT_RE = /\.(?:json|txt)(?:[?#]|$)/iu;

function videoishKey(key: string): boolean {
  return /video|preview|mp4|movie|clip|media/i.test(key);
}

function metadataKey(key: string): boolean {
  return /metadata|meta|manifest|json/i.test(key);
}

function clipLikeKey(key: string): boolean {
  return /animation|animations|clip|clips|motion|motions|asset|assets|output|outputs|result|results|file|files|bvh|fbx|asf|amc/i.test(
    key,
  );
}

function isVideoMime(value: string): boolean {
  return /^video\//i.test(value.split(';')[0]?.trim() ?? '');
}

function isAssetMime(value: string): boolean {
  const mime = value.split(';')[0]?.trim() ?? '';
  return /^(?:model\/|application\/(?:octet-stream|zip|x-fbx)|text\/plain|application\/json)/iu.test(mime);
}

function dataUrl(base64: string, mimeType: string): string {
  const clean = base64.trim().replace(/^data:[^,]+,/i, '');
  return `data:${mimeType || 'application/octet-stream'};base64,${clean}`;
}

function taskIdFromUnknown(value: unknown): string {
  const record = objectValue(value);
  if (!record) return '';
  return (
    stringValue(record.id) ||
    stringValue(record.task_id) ||
    stringValue(record.taskId) ||
    stringValue(record.request_id) ||
    stringValue(record.requestId) ||
    stringValue(record.job_id) ||
    stringValue(record.jobId) ||
    stringValue(record.prediction_id) ||
    stringValue(record.predictionId) ||
    firstNestedString(record, ['data', 'result', 'output', 'task', 'request'], [
      'id',
      'task_id',
      'taskId',
      'request_id',
      'requestId',
    ])
  );
}

function statusUrlFromUnknown(value: unknown): string {
  const record = objectValue(value);
  if (!record) return '';
  return (
    stringValue(record.status_url) ||
    stringValue(record.statusUrl) ||
    stringValue(record.poll_url) ||
    stringValue(record.pollUrl) ||
    stringValue(record.polling_url) ||
    stringValue(record.pollingUrl) ||
    stringValue(objectValue(record.urls)?.get) ||
    stringValue(objectValue(record.urls)?.status) ||
    firstNestedString(record, ['data', 'result', 'output', 'task', 'request'], [
      'status_url',
      'statusUrl',
      'poll_url',
      'pollUrl',
      'polling_url',
      'pollingUrl',
    ])
  );
}

function responseUrlFromUnknown(value: unknown): string {
  const record = objectValue(value);
  if (!record) return '';
  return (
    stringValue(record.response_url) ||
    stringValue(record.responseUrl) ||
    stringValue(record.result_url) ||
    stringValue(record.resultUrl) ||
    stringValue(objectValue(record.urls)?.result) ||
    stringValue(objectValue(record.urls)?.response)
  );
}

function firstNestedString(
  record: Record<string, unknown>,
  containers: string[],
  keys: string[],
): string {
  for (const containerKey of containers) {
    const nested = objectValue(record[containerKey]);
    if (!nested) continue;
    for (const key of keys) {
      const value = stringValue(nested[key]);
      if (value) return value;
    }
  }
  return '';
}

function jsonState(value: Record<string, unknown>): string {
  return (
    stringValue(value.status) ||
    stringValue(value.state) ||
    stringValue(value.task_status) ||
    stringValue(value.taskStatus) ||
    stringValue(value.phase) ||
    stringValue(objectValue(value.data)?.status) ||
    stringValue(objectValue(value.output)?.status) ||
    ''
  ).toLowerCase();
}

function isSuccessState(state: string, json: Record<string, unknown>): boolean {
  return (
    json.done === true ||
    json.completed === true ||
    [
      'succeeded',
      'success',
      'completed',
      'complete',
      'done',
      'ready',
      'finished',
    ].includes(state.toLowerCase())
  );
}

function isTerminalSuccess(json: Record<string, unknown>): boolean {
  const state = jsonState(json);
  return !state || isSuccessState(state, json);
}

function isFailedState(state: string): boolean {
  return [
    'failed',
    'failure',
    'error',
    'errored',
    'canceled',
    'cancelled',
    'rejected',
    'blocked',
  ].includes(state.toLowerCase());
}

function providerErrorMessage(json: Record<string, unknown>): string {
  return (
    stringValue(json.error) ||
    stringValue(json.message) ||
    stringValue(json.msg) ||
    stringValue(json.detail) ||
    stringValue(json.reason) ||
    stringValue(objectValue(json.error)?.message) ||
    stringValue(objectValue(json.data)?.error) ||
    stringValue(objectValue(json.data)?.message) ||
    ''
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  throw new Error('Base64 encoder is unavailable in this runtime.');
}
