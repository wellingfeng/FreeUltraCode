// Interactive playable world-model channel.
//
// CONTRACT: This module owns the *data* layer for the world-model generation
// channel (the analogue of videoGeneration.ts for video and comfyui.ts for
// ComfyUI). It defines the provider catalog for interactive/playable world
// models (Genie-class, Oasis-class, World Labs-class, ...), persists provider
// settings through the shared generation-settings store, and parses/serializes
// the ```worldmodel fenced block that the chat stream renders as an embedded,
// playable live-session preview (WorldModelBlock).
//
// Two realities shape this design:
//   1. Interactive playable world models expose *live sessions* (a streamed,
//      controllable world), not downloadable mesh/video files. So the in-stream
//      preview is a sandboxed live-session iframe, with WASD/pointer controls,
//      rather than a three.js scene like ModelViewer.
//   2. Most of these models do not yet expose a stable public session API. The
//      block therefore degrades gracefully: when a session URL is present it
//      embeds the live world; otherwise it shows a structured "spec card" the
//      user can launch externally once a provider session is available.
import { tauriFetch } from '@/lib/tauri';
import {
  readSettingsRaw,
  type SettingsProfileOptions,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';

const STORAGE_KEY = 'ultragamestudio.worldModelGeneration.v1';
const SETTINGS_REL_PATH = 'settings/worldModelGeneration.v1.json';

export type BuiltInWorldModelProviderId =
  | 'google-genie'
  | 'decart-oasis'
  | 'decart-mirage'
  | 'world-labs-marble'
  | 'odyssey-explorer'
  | 'microsoft-muse'
  | 'tencent-hunyuan-world'
  | 'nvidia-cosmos'
  | 'local-world-server';

export type CustomWorldModelProviderId = `custom:${string}`;
export type WorldModelProviderId =
  | BuiltInWorldModelProviderId
  | CustomWorldModelProviderId;

export type WorldModelProviderCategory = 'commercial' | 'free';

/**
 * How the model surfaces its world to the client. Drives which preview the
 * embedded block renders:
 *  - 'live-session': a streamed, controllable world embedded via iframe.
 *  - 'video-stream': a generated world *video* (weakly/non-interactive), shown
 *    with the standard video player.
 *  - 'export-3d':    a downloadable 3D scene/panorama handed to the 3D viewer.
 */
export type WorldModelInteractivity = 'live-session' | 'video-stream' | 'export-3d';

export interface WorldModelProviderDefinition {
  id: WorldModelProviderId;
  label: string;
  category: WorldModelProviderCategory;
  interactivity: WorldModelInteractivity;
  /** Default backing model/checkpoint name. */
  defaultModel: string;
  models: string[];
  needsKey: boolean;
  local: boolean;
  defaultBaseUrl: string;
  supportsBaseUrl: boolean;
  endpointPlaceholder: string;
  /** Page where the user obtains an API key / joins the preview, if any. */
  credentialUrl?: string;
  keyLabel?: string;
  keyPlaceholder?: string;
  /** Whether the provider currently exposes a public programmatic session API. */
  hasPublicApi: boolean;
  note: string;
  custom?: boolean;
}

// Built-in interactive world-model providers. `hasPublicApi: false` providers
// are research previews with no stable session endpoint yet; we still list them
// so the channel is ready the moment access opens, and the block renders a
// spec/launch card instead of a live embed.
export const WORLD_MODEL_PROVIDERS: WorldModelProviderDefinition[] = [
  {
    id: 'google-genie',
    label: 'Google DeepMind Genie 3',
    category: 'commercial',
    interactivity: 'live-session',
    defaultModel: 'genie-3',
    models: ['genie-3', 'genie-2'],
    needsKey: true,
    local: false,
    defaultBaseUrl: '',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://your-genie-session-endpoint',
    credentialUrl: 'https://deepmind.google/models/genie/',
    keyLabel: 'Genie API Key',
    keyPlaceholder: 'genie-...',
    hasPublicApi: false,
    note: '文本/图片生成可实时交互的 3D 世界，可用 WASD/指针在世界中漫游。目前为研究预览，暂无稳定公开会话 API；接入后填入会话端点即可在信息流内直接试玩。',
  },
  {
    id: 'decart-oasis',
    label: 'Decart Oasis',
    category: 'commercial',
    interactivity: 'live-session',
    defaultModel: 'oasis-2',
    models: ['oasis-2', 'oasis-1'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://oasis.decart.ai',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://oasis.decart.ai/session',
    credentialUrl: 'https://www.decart.ai/',
    keyLabel: 'Decart API Key',
    keyPlaceholder: 'decart-...',
    hasPublicApi: true,
    note: '实时生成可操控的开放世界（Minecraft 类）。支持键鼠输入，逐帧生成世界，可在信息流内直接试玩。',
  },
  {
    id: 'decart-mirage',
    label: 'Decart Mirage',
    category: 'commercial',
    interactivity: 'live-session',
    defaultModel: 'mirage-1',
    models: ['mirage-1'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://mirage.decart.ai',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://mirage.decart.ai/session',
    credentialUrl: 'https://www.decart.ai/',
    keyLabel: 'Decart API Key',
    keyPlaceholder: 'decart-...',
    hasPublicApi: true,
    note: '实时世界改写/重风格化的交互式世界模型，可在直播流上实时改造场景。',
  },
  {
    id: 'world-labs-marble',
    label: 'World Labs Marble',
    category: 'commercial',
    interactivity: 'export-3d',
    defaultModel: 'marble-1.1',
    models: ['marble-1.1', 'marble-1.1-plus', 'marble-1'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://api.worldlabs.ai',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://api.worldlabs.ai',
    credentialUrl: 'https://www.worldlabs.ai/',
    keyLabel: 'World Labs API Key',
    keyPlaceholder: 'wl-...',
    hasPublicApi: true,
    note: '由单图/文本生成可漫游的持久 3D 世界，可导出 3D 场景。导出件交给 3D 预览，亦可在可漫游查看器中浏览。',
  },
  {
    id: 'odyssey-explorer',
    label: 'Odyssey Explorer',
    category: 'commercial',
    interactivity: 'live-session',
    defaultModel: 'explorer-1',
    models: ['explorer-1'],
    needsKey: true,
    local: false,
    defaultBaseUrl: 'https://odyssey.world',
    supportsBaseUrl: true,
    endpointPlaceholder: 'https://odyssey.world/session',
    credentialUrl: 'https://odyssey.world/',
    keyLabel: 'Odyssey API Key',
    keyPlaceholder: 'odyssey-...',
    hasPublicApi: false,
    note: '可实时漫游的生成式交互视频世界。目前为预览，接入后填入会话端点即可内嵌试玩。',
  },
  {
    id: 'microsoft-muse',
    label: 'Microsoft Muse (WHAM)',
    category: 'free',
    interactivity: 'live-session',
    defaultModel: 'wham-1.6b',
    models: ['wham-1.6b'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8200',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8200/session',
    credentialUrl: 'https://huggingface.co/microsoft/wham',
    hasPublicApi: false,
    note: '游戏玩法世界模型（World and Human Action Model），权重在 Hugging Face 开放。需本地起会话服务后填入端点。',
  },
  {
    id: 'tencent-hunyuan-world',
    label: 'Tencent HunyuanWorld',
    category: 'free',
    interactivity: 'export-3d',
    defaultModel: 'hunyuanworld-1.0',
    models: ['hunyuanworld-1.0'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8201',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8201/generate',
    credentialUrl: 'https://github.com/Tencent-Hunyuan/HunyuanWorld-1.0',
    hasPublicApi: true,
    note: '由文本/图片生成可漫游、可导出网格的 3D 世界，权重开源。导出件交给 3D 预览。',
  },
  {
    id: 'nvidia-cosmos',
    label: 'NVIDIA Cosmos',
    category: 'free',
    interactivity: 'video-stream',
    defaultModel: 'cosmos-predict-2',
    models: ['cosmos-predict-2', 'cosmos-predict-1'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8202',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8202/predict',
    credentialUrl: 'https://www.nvidia.com/en-us/ai/cosmos/',
    hasPublicApi: true,
    note: '面向机器人/自动驾驶的世界基础模型，权重开放。以世界视频形式预测未来帧，用视频播放器预览。',
  },
  {
    id: 'local-world-server',
    label: '本地世界模型服务',
    category: 'free',
    interactivity: 'live-session',
    defaultModel: 'default',
    models: ['default'],
    needsKey: false,
    local: true,
    defaultBaseUrl: 'http://127.0.0.1:8210',
    supportsBaseUrl: true,
    endpointPlaceholder: 'http://127.0.0.1:8210/session',
    hasPublicApi: true,
    note: '通用本地世界模型会话服务（OpenAI 风格的兼容端点），返回可嵌入的会话 URL。',
  },
];

export interface CustomWorldModelProviderDefinition {
  id: CustomWorldModelProviderId;
  label: string;
  category: WorldModelProviderCategory;
  interactivity: WorldModelInteractivity;
  defaultModel: string;
  models: string[];
  needsKey: boolean;
  local: boolean;
  defaultBaseUrl: string;
  endpointPlaceholder: string;
  hasPublicApi: boolean;
  note: string;
}

export interface WorldModelGenerationSettings {
  enabled: boolean;
  preferredProviderId: WorldModelProviderId;
  customProviders: CustomWorldModelProviderDefinition[];
  providerKeys: Partial<Record<WorldModelProviderId, string>>;
  providerBaseUrls: Partial<Record<WorldModelProviderId, string>>;
  providerModels: Partial<Record<WorldModelProviderId, string>>;
}

export interface WorldModelGenerationRequest {
  prompt: string;
  providerId?: WorldModelProviderId;
  model?: string;
  signal?: AbortSignal;
}

export interface WorldModelGenerationResult {
  providerId: WorldModelProviderId;
  providerLabel: string;
  model: string;
  prompt: string;
  spec: WorldModelSpec;
  assets: string[];
}

export const DEFAULT_WORLD_MODEL_GENERATION_SETTINGS: WorldModelGenerationSettings = {
  enabled: true,
  preferredProviderId: 'decart-oasis',
  customProviders: [],
  providerKeys: {},
  providerBaseUrls: {},
  providerModels: {},
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanStringRecord<K extends string>(
  value: unknown,
  isKey: (key: string) => key is K,
): Partial<Record<K, string>> {
  if (!isObject(value)) return {};
  const out: Partial<Record<K, string>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isKey(key) && typeof raw === 'string' && raw.trim()) {
      out[key] = raw;
    }
  }
  return out;
}

function normalizeCustomProvider(
  value: unknown,
): CustomWorldModelProviderDefinition | null {
  if (!isObject(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  if (!id.startsWith('custom:')) return null;
  const interactivity: WorldModelInteractivity =
    value.interactivity === 'video-stream' || value.interactivity === 'export-3d'
      ? value.interactivity
      : 'live-session';
  const models = Array.isArray(value.models)
    ? value.models.filter((m): m is string => typeof m === 'string' && !!m.trim())
    : [];
  const defaultModel =
    typeof value.defaultModel === 'string' && value.defaultModel.trim()
      ? value.defaultModel
      : models[0] ?? 'default';
  return {
    id: id as CustomWorldModelProviderId,
    label: typeof value.label === 'string' && value.label.trim() ? value.label : id,
    category: value.category === 'commercial' ? 'commercial' : 'free',
    interactivity,
    defaultModel,
    models: models.length ? models : [defaultModel],
    needsKey: value.needsKey === true,
    local: value.local === true,
    defaultBaseUrl:
      typeof value.defaultBaseUrl === 'string' ? value.defaultBaseUrl : '',
    endpointPlaceholder:
      typeof value.endpointPlaceholder === 'string'
        ? value.endpointPlaceholder
        : 'https://your-world-session-endpoint',
    hasPublicApi: value.hasPublicApi !== false,
    note: typeof value.note === 'string' ? value.note : '',
  };
}

export function worldModelProviders(
  settings = loadWorldModelGenerationSettings(),
): WorldModelProviderDefinition[] {
  return [
    ...WORLD_MODEL_PROVIDERS,
    ...settings.customProviders.map(
      (p): WorldModelProviderDefinition => ({
        ...p,
        supportsBaseUrl: true,
        custom: true,
      }),
    ),
  ];
}

function isKnownWorldModelProviderId(
  value: unknown,
  providers: WorldModelProviderDefinition[],
): value is WorldModelProviderId {
  return (
    typeof value === 'string' && providers.some((provider) => provider.id === value)
  );
}

export function normalizeWorldModelGenerationSettings(
  raw: unknown,
): WorldModelGenerationSettings {
  const source = isObject(raw) ? raw : {};
  const customProviders = Array.isArray(source.customProviders)
    ? source.customProviders
        .map(normalizeCustomProvider)
        .filter((p): p is CustomWorldModelProviderDefinition => p !== null)
    : [];
  const providers = [
    ...WORLD_MODEL_PROVIDERS,
    ...customProviders.map(
      (p): WorldModelProviderDefinition => ({ ...p, supportsBaseUrl: true, custom: true }),
    ),
  ];
  const preferredProviderId = isKnownWorldModelProviderId(
    source.preferredProviderId,
    providers,
  )
    ? source.preferredProviderId
    : DEFAULT_WORLD_MODEL_GENERATION_SETTINGS.preferredProviderId;
  const validKey = (key: string): key is WorldModelProviderId =>
    isKnownWorldModelProviderId(key, providers);
  return {
    enabled: true,
    preferredProviderId,
    customProviders,
    providerKeys: cleanStringRecord(source.providerKeys, validKey),
    providerBaseUrls: cleanStringRecord(source.providerBaseUrls, validKey),
    providerModels: cleanStringRecord(source.providerModels, validKey),
  };
}

export function loadWorldModelGenerationSettings(
  options: SettingsProfileOptions = {},
): WorldModelGenerationSettings {
  try {
    const raw = readSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, options);
    return normalizeWorldModelGenerationSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_WORLD_MODEL_GENERATION_SETTINGS;
  }
}

export function saveWorldModelGenerationSettings(
  settings: WorldModelGenerationSettings,
  options: SettingsProfileOptions = {},
): boolean {
  const payload = JSON.stringify(normalizeWorldModelGenerationSettings(settings));
  const ok = writeSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, payload, options);
  if (!ok) {
    console.error('[worldModel] failed to persist settings');
    return false;
  }
  window.dispatchEvent(new Event('ugs:world-model-generation-settings-changed'));
  return true;
}

export function worldModelProviderById(
  id: WorldModelProviderId,
  settings = loadWorldModelGenerationSettings(),
): WorldModelProviderDefinition {
  return (
    worldModelProviders(settings).find((provider) => provider.id === id) ??
    WORLD_MODEL_PROVIDERS[0]
  );
}

export function worldModelProviderModel(
  providerId: WorldModelProviderId,
  settings = loadWorldModelGenerationSettings(),
): string {
  const provider = worldModelProviderById(providerId, settings);
  return settings.providerModels[providerId]?.trim() || provider.defaultModel;
}

export function worldModelProviderBaseUrl(
  providerId: WorldModelProviderId,
  settings = loadWorldModelGenerationSettings(),
): string {
  const custom = settings.providerBaseUrls[providerId]?.trim();
  if (custom) return custom.replace(/\/+$/, '');
  return worldModelProviderById(providerId, settings).defaultBaseUrl.replace(/\/+$/, '');
}

function worldModelProviderKey(
  providerId: WorldModelProviderId,
  settings = loadWorldModelGenerationSettings(),
): string {
  return settings.providerKeys[providerId]?.trim() || '';
}

export function worldModelProviderReady(
  providerId: WorldModelProviderId,
  settings = loadWorldModelGenerationSettings(),
): boolean {
  const provider = worldModelProviderById(providerId, settings);
  if (!provider.hasPublicApi) return false;
  if (provider.needsKey && !worldModelProviderKey(providerId, settings)) return false;
  return !!worldModelProviderBaseUrl(providerId, settings);
}

export function preferredReadyWorldModelProviderId(
  settings = loadWorldModelGenerationSettings(),
): WorldModelProviderId | null {
  if (worldModelProviderReady(settings.preferredProviderId, settings)) {
    return settings.preferredProviderId;
  }
  return (
    worldModelProviders(settings).find((provider) =>
      worldModelProviderReady(provider.id, settings),
    )?.id ?? null
  );
}

export function defaultWorldModelProvider(
  settings = loadWorldModelGenerationSettings(),
): WorldModelProviderDefinition {
  return worldModelProviderById(settings.preferredProviderId, settings);
}

// ── In-stream ```worldmodel block ───────────────────────────────────────────
//
// The coding model emits a single ```worldmodel fenced block whose body is JSON
// describing the world to instantiate. The chat stream renders it as an
// interactive panel: a sandboxed live-session iframe when `sessionUrl` is
// present, otherwise a spec/launch card. Editing the body re-renders, mirroring
// every other embedded block (single source of truth = the message text).

export interface WorldModelSpec {
  /** Provider id (built-in or custom:*); falls back to the default provider. */
  provider?: WorldModelProviderId;
  /** Backing model/checkpoint name. */
  model?: string;
  /** Short human title for the world. */
  title?: string;
  /** The world-generation prompt. */
  prompt: string;
  /**
   * Live session URL to embed (iframe). When present the block is directly
   * playable in the stream. Provider session APIs populate this.
   */
  sessionUrl?: string;
  /** Exported 3D scene / panorama URL (export-3d providers). */
  assetUrl?: string;
  /** Generated world-video URL (video-stream providers). */
  videoUrl?: string;
  /** Control scheme hint shown to the player. */
  controls?: string;
  /** Free-form notes (style, constraints, seed, ...). */
  notes?: string;
}

/**
 * Parse a ```worldmodel block body into a spec. Tolerant: accepts a bare prompt
 * string as well as JSON, so a model that forgets the JSON envelope still works.
 * Returns null only when there is no usable prompt at all.
 */
export function parseWorldModelSpec(body: string): WorldModelSpec | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON — treat the whole body as the world prompt.
    return { prompt: trimmed };
  }
  if (typeof parsed === 'string') {
    return parsed.trim() ? { prompt: parsed.trim() } : null;
  }
  if (!isObject(parsed)) return null;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const prompt = str(parsed.prompt) ?? str(parsed.description) ?? '';
  const provider =
    typeof parsed.provider === 'string'
      ? (parsed.provider as WorldModelProviderId)
      : undefined;
  const spec: WorldModelSpec = {
    provider,
    model: str(parsed.model),
    title: str(parsed.title) ?? str(parsed.name),
    prompt,
    sessionUrl: str(parsed.sessionUrl) ?? str(parsed.session_url) ?? str(parsed.url),
    assetUrl: str(parsed.assetUrl) ?? str(parsed.asset_url),
    videoUrl: str(parsed.videoUrl) ?? str(parsed.video_url),
    controls: str(parsed.controls),
    notes: str(parsed.notes),
  };
  if (!spec.prompt && !spec.sessionUrl && !spec.assetUrl && !spec.videoUrl) {
    return null;
  }
  return spec;
}

/** Serialize a spec back to a pretty-printed ```worldmodel block body. */
export function serializeWorldModelSpec(spec: WorldModelSpec): string {
  const ordered: Record<string, unknown> = {};
  if (spec.provider) ordered.provider = spec.provider;
  if (spec.model) ordered.model = spec.model;
  if (spec.title) ordered.title = spec.title;
  ordered.prompt = spec.prompt;
  if (spec.sessionUrl) ordered.sessionUrl = spec.sessionUrl;
  if (spec.assetUrl) ordered.assetUrl = spec.assetUrl;
  if (spec.videoUrl) ordered.videoUrl = spec.videoUrl;
  if (spec.controls) ordered.controls = spec.controls;
  if (spec.notes) ordered.notes = spec.notes;
  return JSON.stringify(ordered, null, 2);
}

export async function generateWorldModel(
  request: WorldModelGenerationRequest,
  settings = loadWorldModelGenerationSettings(),
): Promise<WorldModelGenerationResult> {
  const providerId = request.providerId ?? preferredReadyWorldModelProviderId(settings);
  if (!providerId) throw new Error('NO_READY_WORLD_MODEL_PROVIDER');
  if (!worldModelProviderReady(providerId, settings)) {
    throw new Error(`WORLD_MODEL_PROVIDER_NOT_READY:${providerId}`);
  }

  const provider = worldModelProviderById(providerId, settings);
  const model = request.model?.trim() || worldModelProviderModel(providerId, settings);
  const prompt = stripWorldModelCommand(request.prompt);
  if (!prompt) throw new Error('World prompt is empty.');

  const generated =
    providerId === 'world-labs-marble'
      ? await generateWorldLabsMarbleWorld({
          prompt,
          model,
          providerId,
          settings,
          signal: request.signal,
        })
      : await generateGenericWorldModel({
          prompt,
          model,
          provider,
          providerId,
          settings,
          signal: request.signal,
        });

  const spec: WorldModelSpec = {
    provider: providerId,
    model,
    title: generated.title,
    prompt: generated.prompt || prompt,
    sessionUrl: generated.sessionUrl,
    assetUrl: generated.assetUrl,
    videoUrl: generated.videoUrl,
    controls:
      generated.controls || defaultControlsForInteractivity(provider.interactivity),
    notes: generated.notes,
  };

  return {
    providerId,
    providerLabel: provider.label,
    model,
    prompt,
    spec,
    assets: [spec.sessionUrl, spec.assetUrl, spec.videoUrl].filter(
      (value): value is string => !!value,
    ),
  };
}

function defaultControlsForInteractivity(kind: WorldModelInteractivity): string {
  if (kind === 'live-session') return 'WASD 移动，鼠标转视角。';
  if (kind === 'video-stream') return '视频预览，可暂停、拖动进度条。';
  return '拖拽旋转视角，滚轮缩放；如为 Marble 页面链接，请在外部查看器中漫游。';
}

async function generateWorldLabsMarbleWorld({
  prompt,
  model,
  providerId,
  settings,
  signal,
}: {
  prompt: string;
  model: string;
  providerId: WorldModelProviderId;
  settings: WorldModelGenerationSettings;
  signal?: AbortSignal;
}): Promise<WorldModelSpec> {
  const apiKey = worldModelProviderKey(providerId, settings);
  if (!apiKey) throw new Error('World Labs API key is missing.');
  const baseUrl = worldModelProviderBaseUrl(providerId, settings);
  const generateUrl = /\/marble\/v1\/worlds:generate$/iu.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/marble/v1/worlds:generate`;
  const headers = {
    'WLT-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };
  const response = await tauriFetch(generateUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      display_name: prompt.slice(0, 72),
      world_prompt: {
        type: 'text',
        text_prompt: prompt,
      },
      model,
    }),
    signal,
  });
  const started = await readJsonResponse(response);
  const immediate = specFromWorldModelJson(
    started,
    prompt,
    providerId,
    model,
    'export-3d',
  );
  if (isUsableWorldSpec(immediate) && isTerminalSuccess(started)) return immediate;

  const operationId =
    stringValue(started.operation_id) ||
    stringValue(started.operationId) ||
    stringValue(started.id) ||
    stringValue(started.name).split('/').filter(Boolean).pop() ||
    '';
  const operationUrl =
    stringValue(started.operation_url) ||
    stringValue(started.operationUrl) ||
    stringValue(started.status_url) ||
    stringValue(started.statusUrl) ||
    (operationId
      ? `${baseUrl.replace(/\/marble\/v1\/worlds:generate$/iu, '')}/marble/v1/operations/${encodeURIComponent(operationId)}`
      : '');
  if (!operationUrl) {
    if (isUsableWorldSpec(immediate)) return immediate;
    throw new Error('World Labs did not return an operation id.');
  }

  const done = await pollJson(
    () => tauriFetch(operationUrl, { headers, signal }),
    'World Labs Marble',
    signal,
  );
  const spec = specFromWorldModelJson(done, prompt, providerId, model, 'export-3d');
  if (isUsableWorldSpec(spec)) return spec;
  throw new Error('World Labs returned no Marble world URL or exported asset.');
}

async function generateGenericWorldModel({
  prompt,
  model,
  provider,
  providerId,
  settings,
  signal,
}: {
  prompt: string;
  model: string;
  provider: WorldModelProviderDefinition;
  providerId: WorldModelProviderId;
  settings: WorldModelGenerationSettings;
  signal?: AbortSignal;
}): Promise<WorldModelSpec> {
  const apiKey = worldModelProviderKey(providerId, settings);
  if (provider.needsKey && !apiKey) throw new Error(`${provider.label} API key is missing.`);
  const baseUrl = worldModelProviderBaseUrl(providerId, settings);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await tauriFetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      model,
      input: { prompt, model },
      output_format:
        provider.interactivity === 'video-stream'
          ? 'mp4'
          : provider.interactivity === 'export-3d'
            ? 'glb'
            : 'session',
    }),
    signal,
  });
  const started = await readJsonResponse(response);
  const immediate = specFromWorldModelJson(
    started,
    prompt,
    providerId,
    model,
    provider.interactivity,
  );
  if (isUsableWorldSpec(immediate) && isTerminalSuccess(started)) return immediate;

  const statusUrl = statusUrlFromUnknown(started);
  const taskId = taskIdFromUnknown(started);
  if (!statusUrl && !taskId) {
    if (isUsableWorldSpec(immediate)) return immediate;
    throw new Error(`${provider.label} returned no playable world URL.`);
  }
  const done = await pollJson(
    () =>
      tauriFetch(
        statusUrl ||
          `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(taskId)}`,
        { headers, signal },
      ),
    provider.label,
    signal,
  );
  const spec = specFromWorldModelJson(
    done,
    prompt,
    providerId,
    model,
    provider.interactivity,
  );
  if (isUsableWorldSpec(spec)) return spec;
  throw new Error(`${provider.label} returned no playable world URL.`);
}

function specFromWorldModelJson(
  json: Record<string, unknown>,
  prompt: string,
  providerId?: WorldModelProviderId,
  model?: string,
  interactivity?: WorldModelInteractivity,
): WorldModelSpec {
  const nested =
    objectValue(objectValue(json.response)?.world) ||
    objectValue(objectValue(json.result)?.world) ||
    objectValue(objectValue(json.output)?.world) ||
    objectValue(objectValue(json.data)?.world) ||
    objectValue(json.world) ||
    objectValue(json.result) ||
    objectValue(json.output) ||
    objectValue(json.data) ||
    objectValue(json.response);
  const source = nested ? { ...json, ...nested } : json;
  const assets = objectValue(source.assets);
  const splats = objectValue(assets?.splats);
  const spzUrls =
    objectValue(splats?.spz_urls) ||
    objectValue(splats?.spzUrls);
  const mesh = objectValue(assets?.mesh);
  const sessionUrl =
    stringValue(source.sessionUrl) ||
    stringValue(source.session_url) ||
    stringValue(source.playUrl) ||
    stringValue(source.play_url) ||
    stringValue(source.viewerUrl) ||
    stringValue(source.viewer_url) ||
    stringValue(source.world_marble_url) ||
    stringValue(source.worldMarbleUrl) ||
    stringValue(source.marble_url) ||
    stringValue(source.marbleUrl) ||
    (interactivity === 'live-session' ? stringValue(source.url) : '');
  const assetUrl =
    stringValue(spzUrls?.full_res) ||
    stringValue(spzUrls?.['500k']) ||
    stringValue(spzUrls?.['100k']) ||
    stringValue(mesh?.collider_mesh_url) ||
    stringValue(mesh?.colliderMeshUrl) ||
    firstUrl(source, [
      'assetUrl',
      'asset_url',
      'exportUrl',
      'export_url',
      'downloadUrl',
      'download_url',
      'spzUrl',
      'spz_url',
      'glbUrl',
      'glb_url',
      'gltfUrl',
      'gltf_url',
      'modelUrl',
      'model_url',
      'asset',
      'assets',
      'file',
      'files',
    ]);
  const videoUrl =
    stringValue(source.videoUrl) ||
    stringValue(source.video_url) ||
    stringValue(source.mp4) ||
    stringValue(source.video) ||
    (interactivity === 'video-stream' ? stringValue(source.url) : '');
  return {
    provider: providerId,
    model,
    title:
      stringValue(source.title) ||
      stringValue(source.name) ||
      stringValue(source.display_name) ||
      stringValue(source.displayName) ||
      stringValue(source.world_name) ||
      stringValue(source.worldName) ||
      undefined,
    prompt:
      stringValue(source.prompt) ||
      stringValue(source.description) ||
      stringValue(objectValue(source.world_prompt)?.text_prompt) ||
      stringValue(objectValue(source.worldPrompt)?.textPrompt) ||
      prompt,
    sessionUrl: sessionUrl || undefined,
    assetUrl:
      assetUrl ||
      (interactivity === 'export-3d' ? stringValue(source.url) : '') ||
      undefined,
    videoUrl: videoUrl || undefined,
    controls:
      stringValue(source.controls) ||
      stringValue(source.control_scheme) ||
      undefined,
    notes:
      stringValue(source.notes) ||
      stringValue(source.message) ||
      undefined,
  };
}

function isUsableWorldSpec(spec: WorldModelSpec): boolean {
  return !!(spec.sessionUrl || spec.assetUrl || spec.videoUrl);
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('World-model provider returned a non-JSON response.');
  }
  return json as Record<string, unknown>;
}

async function pollJson(
  request: () => Promise<Response>,
  providerLabel: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 180; i += 1) {
    await delay(3000, signal);
    const response = await request();
    const json = await readJsonResponse(response);
    const state = jsonState(json);
    if (isFailedState(state)) {
      throw new Error(providerErrorMessage(json) || `${providerLabel} generation failed.`);
    }
    if (isSuccessState(state, json)) return json;
    const spec = specFromWorldModelJson(json, '');
    if (isUsableWorldSpec(spec) && !state) return json;
  }
  throw new Error(`${providerLabel} job timed out before the world was ready.`);
}

function firstUrl(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    for (const url of urlsFromUnknown(record[key], key)) {
      return url;
    }
  }
  for (const [key, child] of Object.entries(record)) {
    for (const url of urlsFromUnknown(child, key)) {
      return url;
    }
  }
  return '';
}

function urlsFromUnknown(value: unknown, keyHint = ''): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed) && !/^data:/i.test(trimmed)) return [];
    if (/world[_-]?marble|marble[_-]?url/i.test(keyHint)) return [];
    if (/url|uri|asset|file|download|export|spz|glb|gltf|model/i.test(keyHint)) {
      return [trimmed];
    }
    return /\.(?:glb|gltf|obj|fbx|stl|ply|usdz|zip|spz|mp4|webm|mov)(?:[?#]|$)/i.test(trimmed)
      ? [trimmed]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => urlsFromUnknown(item, keyHint));
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const out: string[] = [];
  const push = (url: string) => {
    if (url && !out.includes(url)) out.push(url);
  };
  for (const key of [
    'url',
    'uri',
    'assetUrl',
    'asset_url',
    'downloadUrl',
    'download_url',
    'exportUrl',
    'export_url',
    'spzUrl',
    'spz_url',
    'glbUrl',
    'glb_url',
    'modelUrl',
    'model_url',
    'file',
    'files',
    'assets',
  ]) {
    for (const url of urlsFromUnknown(record[key], key)) push(url);
  }
  for (const [key, child] of Object.entries(record)) {
    for (const url of urlsFromUnknown(child, `${keyHint}.${key}`)) push(url);
  }
  return out;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function taskIdFromUnknown(value: Record<string, unknown>): string {
  return (
    stringValue(value.id) ||
    stringValue(value.task_id) ||
    stringValue(value.taskId) ||
    stringValue(value.request_id) ||
    stringValue(value.requestId) ||
    stringValue(value.operation_id) ||
    stringValue(value.operationId) ||
    stringValue(value.job_id) ||
    stringValue(value.jobId)
  );
}

function statusUrlFromUnknown(value: Record<string, unknown>): string {
  return (
    stringValue(value.status_url) ||
    stringValue(value.statusUrl) ||
    stringValue(value.poll_url) ||
    stringValue(value.pollUrl) ||
    stringValue(value.operation_url) ||
    stringValue(value.operationUrl) ||
    stringValue(objectValue(value.urls)?.get) ||
    stringValue(objectValue(value.urls)?.status)
  );
}

function jsonState(json: Record<string, unknown>): string {
  return (
    stringValue(json.status) ||
    stringValue(json.state) ||
    stringValue(json.phase) ||
    stringValue(json.task_status) ||
    stringValue(json.taskStatus) ||
    stringValue(objectValue(json.output)?.status) ||
    stringValue(objectValue(json.result)?.status) ||
    stringValue(objectValue(json.data)?.status) ||
    ''
  ).toLowerCase();
}

function isSuccessState(state: string, json: Record<string, unknown>): boolean {
  return (
    json.done === true ||
    json.completed === true ||
    [
      'success',
      'succeeded',
      'completed',
      'complete',
      'done',
      'finished',
      'ready',
    ].includes(state)
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
    'timeout',
    'timed_out',
  ].includes(state);
}

function providerErrorMessage(json: Record<string, unknown>): string {
  return (
    stringValue(json.error) ||
    stringValue(json.message) ||
    stringValue(json.detail) ||
    stringValue(json.reason) ||
    stringValue(objectValue(json.error)?.message) ||
    stringValue(objectValue(json.data)?.error) ||
    stringValue(objectValue(json.data)?.message) ||
    ''
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Strip the /worldmodel|/worldmodel-mode-start|/worldmodel-mode-end prefix. */
export function stripWorldModelCommand(text: string): string {
  return text
    .trim()
    .replace(/^\/(?:worldmodel|world-model|世界模型)(?:-mode-(?:start|end))?\s*/iu, '')
    .trim();
}

/**
 * AI authoring instruction for world-model mode. Front-loaded before the
 * coding-model turn so the model emits a single ```worldmodel block (instead of
 * editing the workflow blueprint). The block is rendered as an in-stream,
 * playable world preview.
 */
export function worldModelPromptSystem(
  settings = loadWorldModelGenerationSettings(),
): string {
  const provider = defaultWorldModelProvider(settings);
  const model = worldModelProviderModel(provider.id, settings);
  return `你是交互式可玩世界模型（playable world model）的设计与接入工程师。用户会描述想要的可探索/可操控世界，你要输出一个能在信息流里直接预览试玩的世界定义。
当前默认世界模型渠道：「${provider.label}」（模型 ${model}，交互形态 ${provider.interactivity}）。
严格要求：
- 只输出一个 \`\`\`worldmodel 代码块，块内是合法 JSON；代码块之外不要写任何解释、标题或多余文字。
- JSON 字段：{"provider":"${provider.id}","model":"${model}","title":"世界标题","prompt":"用于生成世界的完整描述","controls":"操作方式（如 WASD 移动、鼠标转视角）","notes":"风格/约束/种子等备注"}。
- 如果你已经从渠道会话 API 拿到可嵌入的会话地址，再加上 "sessionUrl"；导出 3D 场景用 "assetUrl"；世界视频用 "videoUrl"。无法真实获得这些 URL 时不要编造，留空即可，前端会渲染为可外部启动的世界规格卡。
- prompt 要具体可执行：场景主题、视角与比例、可交互元素、光照与氛围、可漫游范围、玩家目标或可做的动作。
- JSON 内文本与用户输入语言保持一致。`;
}
