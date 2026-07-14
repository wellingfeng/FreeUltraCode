import type { RuntimeAdapterId } from '@/lib/adapters';
import { canUseProviderDirectTransport } from '@/lib/apiConfig';
import {
  isRemoteSettingsProfile,
  readSettingsRaw,
  type SettingsProfileOptions,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';
import type {
  GatewayTransport,
  ResolvedGatewayRoute,
} from '@/lib/modelGateway/types';

export type BuiltInVisionProviderId =
  | 'google-ai-studio'
  | 'openrouter-free'
  | 'siliconflow'
  | 'ollama-local'
  | 'vllm-local'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'openrouter'
  | 'dashscope'
  | 'zhipu'
  | 'volcengine'
  | 'baidu-qianfan';

export type CustomVisionProviderId = `custom:${string}`;
export type VisionProviderId = BuiltInVisionProviderId | CustomVisionProviderId;
export type VisionProviderCategory = 'commercial' | 'free-credit';
export type VisionProviderRegion = 'china' | 'global' | 'local';
export type VisionProviderApiKind = 'anthropic' | 'openai-compatible';

export interface VisionProviderDefinition {
  id: VisionProviderId;
  label: string;
  category: VisionProviderCategory;
  region: VisionProviderRegion;
  apiKind: VisionProviderApiKind;
  defaultModel: string;
  models: string[];
  needsKey: boolean;
  local: boolean;
  defaultBaseUrl: string;
  credentialUrl?: string;
  keyPlaceholder?: string;
  note: string;
  custom?: boolean;
}

export interface CustomVisionProviderDefinition
  extends Omit<VisionProviderDefinition, 'id' | 'custom'> {
  id: CustomVisionProviderId;
}

export interface VisionModelSettings {
  enabled: boolean;
  preferredProviderId: VisionProviderId;
  customProviders: CustomVisionProviderDefinition[];
  providerKeys: Partial<Record<VisionProviderId, string>>;
  providerBaseUrls: Partial<Record<VisionProviderId, string>>;
  providerModels: Partial<Record<VisionProviderId, string>>;
  providerModelLists: Partial<Record<VisionProviderId, string[]>>;
}

const STORAGE_KEY = 'ultragamestudio.visionModel.v1';
const SETTINGS_REL_PATH = 'settings/visionModel.v1.json';

export const VISION_PROVIDERS: readonly VisionProviderDefinition[] = [
  {
    id: 'google-ai-studio',
    label: 'Google AI Studio · Gemini',
    category: 'free-credit',
    region: 'global',
    apiKind: 'openai-compatible',
    defaultModel: 'gemini-2.5-flash',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    credentialUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'Google AI Studio API key',
    note: '国际免费额度。适合图片理解、截图分析、OCR 与多图对比；额度和地区限制以 Google 控制台为准。',
  },
  {
    id: 'openrouter-free',
    label: 'OpenRouter · 免费 VLM',
    category: 'free-credit',
    region: 'global',
    apiKind: 'openai-compatible',
    defaultModel: 'google/gemma-3-27b-it:free',
    models: [
      'google/gemma-3-27b-it:free',
      'google/gemma-3-12b-it:free',
      'qwen/qwen2.5-vl-32b-instruct:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
    ],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    credentialUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
    note: '国际免费模型聚合。免费模型可能限速、排队或调整；模型名可在下方刷新。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 · 视觉模型',
    category: 'free-credit',
    region: 'china',
    apiKind: 'openai-compatible',
    defaultModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    models: [
      'Qwen/Qwen2.5-VL-72B-Instruct',
      'Qwen/Qwen2.5-VL-32B-Instruct',
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'deepseek-ai/deepseek-vl2',
    ],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    credentialUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyPlaceholder: 'sk-...',
    note: '国内平台，通常提供新用户额度；同时可按量付费。适合 Qwen-VL、DeepSeek-VL 等开源视觉模型。',
  },
  {
    id: 'ollama-local',
    label: 'Ollama · 本地 VLM',
    category: 'free-credit',
    region: 'local',
    apiKind: 'openai-compatible',
    defaultModel: 'qwen3-vl:8b',
    models: ['qwen3-vl:8b', 'gemma3:12b', 'minicpm-v:8b', 'llava:13b'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    credentialUrl: 'https://ollama.com/search?c=vision',
    note: '本地免费，数据不出设备。先在 Ollama 拉取支持视觉的模型，并保持服务运行。',
  },
  {
    id: 'vllm-local',
    label: 'vLLM · 本地 VLM',
    category: 'free-credit',
    region: 'local',
    apiKind: 'openai-compatible',
    defaultModel: 'Qwen/Qwen2.5-VL-7B-Instruct',
    models: [
      'Qwen/Qwen2.5-VL-72B-Instruct',
      'Qwen/Qwen2.5-VL-32B-Instruct',
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'OpenGVLab/InternVL3-8B',
      'openbmb/MiniCPM-V-2_6',
    ],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    credentialUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
    note: '本地 OpenAI-compatible 服务。适合自托管 Qwen-VL、InternVL、MiniCPM-V。',
  },
  {
    id: 'openai',
    label: 'OpenAI · GPT Vision',
    category: 'commercial',
    region: 'global',
    apiKind: 'openai-compatible',
    defaultModel: 'gpt-5.2',
    models: ['gpt-5.4', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    credentialUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    note: '国际商业服务。通用视觉理解、UI 截图、图表、OCR 与多图推理。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic · Claude Vision',
    category: 'commercial',
    region: 'global',
    apiKind: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.anthropic.com',
    credentialUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    note: '国际商业服务。适合复杂界面理解、长文本截图、设计审查与视觉推理。',
  },
  {
    id: 'xai',
    label: 'xAI · Grok Vision',
    category: 'commercial',
    region: 'global',
    apiKind: 'openai-compatible',
    defaultModel: 'grok-2-vision-1212',
    models: ['grok-2-vision-1212'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.x.ai/v1',
    credentialUrl: 'https://console.x.ai',
    keyPlaceholder: 'xai-...',
    note: '国际商业服务。OpenAI-compatible 视觉对话接口。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter · 商用 VLM 聚合',
    category: 'commercial',
    region: 'global',
    apiKind: 'openai-compatible',
    defaultModel: 'anthropic/claude-sonnet-4.6',
    models: [
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-5.2',
      'google/gemini-3.1-pro-preview',
      'qwen/qwen2.5-vl-72b-instruct',
    ],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    credentialUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
    note: '国际商业聚合。一个 Key 切换多家视觉模型；价格和可用模型由 OpenRouter 决定。',
  },
  {
    id: 'dashscope',
    label: '阿里云百炼 · Qwen-VL',
    category: 'commercial',
    region: 'china',
    apiKind: 'openai-compatible',
    defaultModel: 'qwen-vl-max',
    models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    credentialUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key-center',
    keyPlaceholder: 'sk-...',
    note: '国内商业服务。中文 OCR、文档/图表理解、界面截图和通用视觉问答。',
  },
  {
    id: 'zhipu',
    label: '智谱开放平台 · GLM-V',
    category: 'commercial',
    region: 'china',
    apiKind: 'openai-compatible',
    defaultModel: 'glm-4v-plus-0111',
    models: ['glm-4v-plus-0111', 'glm-4v-plus', 'glm-4v-flash'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    credentialUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    keyPlaceholder: '智谱 API Key',
    note: '国内商业服务。中文图片理解、OCR、视频/多图分析；部分模型可能提供免费额度。',
  },
  {
    id: 'volcengine',
    label: '火山方舟 · Doubao Vision',
    category: 'commercial',
    region: 'china',
    apiKind: 'openai-compatible',
    defaultModel: 'doubao-1-5-vision-pro-32k-250115',
    models: [
      'doubao-1-5-vision-pro-32k-250115',
      'doubao-1-5-vision-lite-250315',
    ],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    credentialUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    keyPlaceholder: '火山方舟 API Key',
    note: '国内商业服务。部分账号需把模型名替换为控制台创建的推理接入点 ID。',
  },
  {
    id: 'baidu-qianfan',
    label: '百度千帆 · ERNIE Vision',
    category: 'commercial',
    region: 'china',
    apiKind: 'openai-compatible',
    defaultModel: 'ernie-4.5-turbo-vl',
    models: ['ernie-4.5-turbo-vl', 'ernie-4.5-vl'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    credentialUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    keyPlaceholder: '百度千帆 API Key',
    note: '国内商业服务。适合中文文档、表格、图片内容理解；走 OpenAI-compatible v2 接口。',
  },
];

export const DEFAULT_VISION_MODEL_SETTINGS: VisionModelSettings = {
  enabled: true,
  preferredProviderId: 'google-ai-studio',
  customProviders: [],
  providerKeys: {},
  providerBaseUrls: {},
  providerModels: {},
  providerModelLists: {},
};

function uniqueStrings(values: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(values)) return [...fallback];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.length > 0 ? out : [...fallback];
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || Math.random().toString(36).slice(2, 10);
}

export function createCustomVisionProviderId(name: string): CustomVisionProviderId {
  return `custom:${slugify(name)}`;
}

function normalizeCustomProviders(value: unknown): CustomVisionProviderDefinition[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const out: CustomVisionProviderDefinition[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const source = item as Partial<CustomVisionProviderDefinition>;
    const label = typeof source.label === 'string' && source.label.trim()
      ? source.label.trim()
      : `自定义 VLM ${index + 1}`;
    let id = typeof source.id === 'string' && source.id.startsWith('custom:')
      ? source.id as CustomVisionProviderId
      : createCustomVisionProviderId(label);
    let suffix = 2;
    while (used.has(id)) {
      id = `${createCustomVisionProviderId(label)}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    const defaultModel = typeof source.defaultModel === 'string' && source.defaultModel.trim()
      ? source.defaultModel.trim()
      : 'vision-model';
    const defaultBaseUrl = typeof source.defaultBaseUrl === 'string'
      ? source.defaultBaseUrl.trim().replace(/\/+$/, '')
      : '';
    if (!defaultBaseUrl) continue;
    out.push({
      id,
      label,
      category: source.category === 'free-credit' ? 'free-credit' : 'commercial',
      region:
        source.region === 'china' || source.region === 'local'
          ? source.region
          : 'global',
      apiKind: source.apiKind === 'anthropic' ? 'anthropic' : 'openai-compatible',
      defaultModel,
      models: uniqueStrings(source.models, [defaultModel]),
      needsKey: source.needsKey !== false,
      local: source.region === 'local' || source.local === true,
      defaultBaseUrl,
      credentialUrl:
        typeof source.credentialUrl === 'string' && source.credentialUrl.trim()
          ? source.credentialUrl.trim()
          : undefined,
      keyPlaceholder:
        typeof source.keyPlaceholder === 'string' && source.keyPlaceholder.trim()
          ? source.keyPlaceholder.trim()
          : 'API Key',
      note:
        typeof source.note === 'string' && source.note.trim()
          ? source.note.trim()
          : '自定义视觉模型渠道。',
    });
  }
  return out;
}

export function visionProviders(
  settings = loadVisionModelSettings(),
): VisionProviderDefinition[] {
  return [
    ...VISION_PROVIDERS,
    ...settings.customProviders.map((provider) => ({ ...provider, custom: true })),
  ];
}

export function visionProviderById(
  id: VisionProviderId,
  settings = loadVisionModelSettings(),
): VisionProviderDefinition {
  return (
    visionProviders(settings).find((provider) => provider.id === id) ??
    VISION_PROVIDERS[0]
  );
}

function knownProviderId(
  value: unknown,
  providers: readonly VisionProviderDefinition[],
): value is VisionProviderId {
  return typeof value === 'string' && providers.some((provider) => provider.id === value);
}

function cleanRecord(
  value: unknown,
  valid: (key: unknown) => key is VisionProviderId,
): Partial<Record<VisionProviderId, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<VisionProviderId, string>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!valid(key) || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function cleanModelLists(
  value: unknown,
  valid: (key: unknown) => key is VisionProviderId,
): Partial<Record<VisionProviderId, string[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<VisionProviderId, string[]>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!valid(key)) continue;
    const models = uniqueStrings(raw);
    if (models.length > 0) out[key] = models;
  }
  return out;
}

export function normalizeVisionModelSettings(value: unknown): VisionModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_VISION_MODEL_SETTINGS };
  }
  const source = value as Partial<VisionModelSettings>;
  const customProviders = normalizeCustomProviders(source.customProviders);
  const providers = [
    ...VISION_PROVIDERS,
    ...customProviders.map((provider) => ({ ...provider, custom: true })),
  ];
  const valid = (key: unknown): key is VisionProviderId => knownProviderId(key, providers);
  return {
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_VISION_MODEL_SETTINGS.enabled,
    preferredProviderId: knownProviderId(source.preferredProviderId, providers)
      ? source.preferredProviderId
      : DEFAULT_VISION_MODEL_SETTINGS.preferredProviderId,
    customProviders,
    providerKeys: cleanRecord(source.providerKeys, valid),
    providerBaseUrls: cleanRecord(source.providerBaseUrls, valid),
    providerModels: cleanRecord(source.providerModels, valid),
    providerModelLists: cleanModelLists(source.providerModelLists, valid),
  };
}

export function loadVisionModelSettings(
  options: SettingsProfileOptions = {},
): VisionModelSettings {
  try {
    const raw = readSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, options);
    return normalizeVisionModelSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_VISION_MODEL_SETTINGS };
  }
}

export function saveVisionModelSettings(
  settings: VisionModelSettings,
  options: SettingsProfileOptions = {},
): boolean {
  const ok = writeSettingsRaw(
    SETTINGS_REL_PATH,
    STORAGE_KEY,
    JSON.stringify(normalizeVisionModelSettings(settings)),
    options,
  );
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ugs:vision-model-settings-changed'));
  }
  return ok;
}

export function visionProviderBaseUrl(
  id: VisionProviderId,
  settings = loadVisionModelSettings(),
): string {
  return (
    settings.providerBaseUrls[id]?.trim() ||
    visionProviderById(id, settings).defaultBaseUrl
  ).replace(/\/+$/, '');
}

export function visionProviderModel(
  id: VisionProviderId,
  settings = loadVisionModelSettings(),
): string {
  return settings.providerModels[id]?.trim() || visionProviderById(id, settings).defaultModel;
}

export function visionProviderReady(
  id: VisionProviderId,
  settings = loadVisionModelSettings(),
): boolean {
  const provider = visionProviderById(id, settings);
  const apiKey = settings.providerKeys[id]?.trim();
  const localConfigured =
    !provider.local ||
    settings.preferredProviderId === id ||
    !!settings.providerBaseUrls[id]?.trim() ||
    !!settings.providerModels[id]?.trim();
  if (!localConfigured) return false;
  return canUseProviderDirectTransport(apiKey, visionProviderBaseUrl(id, settings)) &&
    (!provider.needsKey || !!apiKey || provider.local);
}

export function preferredReadyVisionProviderId(
  settings = loadVisionModelSettings(),
  options: SettingsProfileOptions = {},
): VisionProviderId | null {
  if (!settings.enabled) return null;
  const providers = visionProviders(settings).filter(
    (provider) => !isRemoteSettingsProfile(options.profileId) || !provider.local,
  );
  const preferred = providers.find(
    (provider) =>
      provider.id === settings.preferredProviderId &&
      visionProviderReady(provider.id, settings),
  );
  if (preferred) return preferred.id;
  return providers.find((provider) => visionProviderReady(provider.id, settings))?.id ?? null;
}

function routeAdapter(apiKind: VisionProviderApiKind): RuntimeAdapterId {
  return apiKind === 'anthropic' ? 'claude-code' : 'codex';
}

function routeTransport(apiKind: VisionProviderApiKind): GatewayTransport {
  return apiKind === 'anthropic' ? 'anthropic' : 'openai-compatible';
}

export function resolveVisionModelRoute(
  options: SettingsProfileOptions = {},
  settings = loadVisionModelSettings(options),
): ResolvedGatewayRoute | null {
  const providerId = preferredReadyVisionProviderId(settings, options);
  if (!providerId) return null;
  const provider = visionProviderById(providerId, settings);
  const model = visionProviderModel(providerId, settings);
  const adapter = routeAdapter(provider.apiKind);
  return {
    selection: {
      adapter,
      modelClass: model,
      providerId: `vision:${provider.id}`,
      channelId: 'vision',
    },
    adapter,
    modelClass: model,
    model,
    providerId: `vision:${provider.id}`,
    providerName: provider.label,
    channelId: 'vision',
    channelName: 'Vision/VLM',
    transport: routeTransport(provider.apiKind),
    mode: 'direct',
    apiKey: settings.providerKeys[provider.id]?.trim(),
    baseUrl: visionProviderBaseUrl(provider.id, settings),
    label: `${provider.label} · ${model}`,
    source: 'global',
  };
}
