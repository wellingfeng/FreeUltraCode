import { GAME_SKILLS } from '@/lib/gameSkillRegistry';
import type { AssetChannelAvailability } from '@/lib/anthropic';
import type { Locale } from '@/lib/i18n';

export type GameAssetCapabilityId =
  | 'image'
  | 'sprite'
  | 'mesh'
  | 'ui'
  | 'music'
  | 'speech'
  | 'video';

export interface GameAssetCapability {
  id: GameAssetCapabilityId;
  label: string;
  assetType: GameAssetCapabilityId;
  command: string;
  modeCommand?: string;
  gameSkillNames: string[];
  intentKeywords: string[];
  useWhen: string;
  inputRequirements: string[];
  outputArtifacts: string[];
  acceptanceCriteria: string[];
}

export interface AssetRequestRoute {
  capability: GameAssetCapability;
  commandText: string;
  assetRequest: string;
  reason: string;
}

const GAME_SKILL_NAME_SET = new Set(GAME_SKILLS.map((skill) => skill.name));

export const GAME_ASSET_CAPABILITIES: GameAssetCapability[] = [
  {
    id: 'image',
    label: '生图',
    assetType: 'image',
    command: '/image',
    modeCommand: '/image-mode-start',
    gameSkillNames: ['/image-mode-start'],
    intentKeywords: [
      '图片',
      '图像',
      '概念图',
      '原画',
      '插画',
      '图标',
      '头像',
      '贴图',
      'texture',
      'concept art',
      'icon',
    ],
    useWhen: '需要概念图、原画、图标、贴图、UI 草图、宣传图等 2D 静态视觉资产。',
    inputRequirements: ['用途', '风格', '画面主体', '尺寸/比例', '透明背景要求', '引擎导入要求'],
    outputArtifacts: ['图片文件', '提示词', 'Provider/模型信息', '资产元数据'],
    acceptanceCriteria: ['主体清晰', '风格一致', '尺寸和背景符合用途', '可进入资产中心复用'],
  },
  {
    id: 'sprite',
    label: 'Sprite',
    assetType: 'sprite',
    command: '/sprite',
    modeCommand: '/sprite-mode-start',
    gameSkillNames: ['/sprite', '/sprite-mode-start'],
    intentKeywords: [
      'sprite',
      'spritesheet',
      'sprite sheet',
      '精灵',
      '精灵图',
      '序列帧',
      '动作帧',
      '帧动画',
      '2d 动画',
    ],
    useWhen: '需要游戏精灵、角色动作、序列帧、spritesheet 或可切分 2D 动画资产。',
    inputRequirements: ['动作列表', '帧数', '朝向', '网格规格', '透明背景', '单帧尺寸', '循环方式'],
    outputArtifacts: ['raw spritesheet', '切分/帧信息', '可选 GIF/帧序列', '验收结果'],
    acceptanceCriteria: ['帧数和朝向符合合约', '透明边缘干净', '可被目标引擎切分导入'],
  },
  {
    id: 'mesh',
    label: 'Mesh',
    assetType: 'mesh',
    command: '/mesh-mode-start',
    modeCommand: '/mesh-mode-start',
    gameSkillNames: ['/mesh-mode-start'],
    intentKeywords: [
      '3d',
      '3D',
      '三维',
      '模型',
      '建模',
      'mesh',
      'glb',
      'gltf',
      'fbx',
      '道具',
      '角色模型',
      '场景网格',
      'blockout',
    ],
    useWhen: '需要 3D 道具、角色、场景网格、blockout、可导入模型或自动绑定前的模型资产。',
    inputRequirements: ['模型用途', '风格', '比例/尺寸', '面数预算', '材质需求', '是否需要绑定', '目标格式'],
    outputArtifacts: ['3D 模型文件', '预览图', '格式/Provider 信息', '导入建议'],
    acceptanceCriteria: ['模型格式可导入', '比例和轮廓符合玩法镜头', '性能预算可接受'],
  },
  {
    id: 'ui',
    label: 'UI',
    assetType: 'ui',
    command: '/ui-mode-start',
    modeCommand: '/ui-mode-start',
    gameSkillNames: ['/ui-mode-start'],
    intentKeywords: [
      'ui',
      'UI',
      'hud',
      'HUD',
      '界面',
      '菜单',
      '按钮',
      '控件',
      '背包',
      '弹窗',
      '设计稿',
    ],
    useWhen: '需要游戏 HUD、菜单、界面流程、控件状态、UI 设计稿或可交付 UI 规格。',
    inputRequirements: ['屏幕/流程', '玩家状态', '控件列表', '输入设备', '分辨率', '主题风格', '导出格式'],
    outputArtifacts: ['UI 设计说明', '布局/状态规格', '可交付资产清单', '导出建议'],
    acceptanceCriteria: ['状态完整', '层级清楚', '可访问性和输入适配明确', '可交给程序绑定数据'],
  },
  {
    id: 'music',
    label: '音乐',
    assetType: 'music',
    command: '/music',
    modeCommand: '/music-mode-start',
    gameSkillNames: ['/music', '/music-mode-start'],
    intentKeywords: ['音乐', 'BGM', 'bgm', '配乐', '主题曲', '战斗音乐', '环境音乐', 'music'],
    useWhen: '需要 BGM、配乐、主题音乐、循环音乐或场景情绪音乐。',
    inputRequirements: ['场景用途', '情绪', '风格', '时长', '循环要求', '乐器/节奏', '禁用元素'],
    outputArtifacts: ['音频文件', '时长/风格说明', 'Provider/模型信息', '资产元数据'],
    acceptanceCriteria: ['可播放', '情绪和场景匹配', '时长/循环点满足接入需求'],
  },
  {
    id: 'speech',
    label: '语音',
    assetType: 'speech',
    command: '/tts',
    modeCommand: '/speech-mode-start',
    gameSkillNames: ['/tts', '/speech-mode-start'],
    intentKeywords: ['语音', '配音', '旁白', '朗读', 'voice', 'speech', 'tts', '台词音频'],
    useWhen: '需要角色台词配音、旁白朗读、教程语音或文本转语音资产。',
    inputRequirements: ['朗读文本', '语言', '角色/音色', '语气', '语速', '输出格式'],
    outputArtifacts: ['语音音频文件', '文本/音色说明', 'Provider/模型信息'],
    acceptanceCriteria: ['内容和文本一致', '音色/语气符合角色', '可播放且无明显截断'],
  },
  {
    id: 'video',
    label: '视频',
    assetType: 'video',
    command: '/video',
    modeCommand: '/video-mode-start',
    gameSkillNames: ['/video', '/video-mode-start'],
    intentKeywords: ['视频', '短片', '过场', '动画片段', '宣传片', 'video', 'clip'],
    useWhen: '需要短视频、动态片段、过场概念或宣传素材。',
    inputRequirements: ['镜头内容', '时长', '分辨率', '运动方式', '风格', '参考图/角色一致性要求'],
    outputArtifacts: ['视频文件', '时长/分辨率说明', 'Provider/模型信息'],
    acceptanceCriteria: ['可播放', '时长和画面运动符合需求', '没有明显断裂或错误元素'],
  },
];

const CAPABILITY_BY_ID = new Map(
  GAME_ASSET_CAPABILITIES.map((capability) => [capability.id, capability]),
);

const ALIASES: Record<string, GameAssetCapabilityId> = {
  '2d': 'image',
  art: 'image',
  concept: 'image',
  conceptart: 'image',
  img: 'image',
  picture: 'image',
  texture: 'image',
  textures: 'image',
  spritesheet: 'sprite',
  sprites: 'sprite',
  threed: 'mesh',
  '3d': 'mesh',
  model: 'mesh',
  model3d: 'mesh',
  geometry: 'mesh',
  hud: 'ui',
  interface: 'ui',
  ux: 'ui',
  audio: 'music',
  bgm: 'music',
  sfx: 'music',
  sound: 'music',
  sounds: 'music',
  tts: 'speech',
  voice: 'speech',
  narration: 'speech',
  movie: 'video',
  clip: 'video',
};

const ROLE_DEFAULT_CAPABILITIES: Array<{
  ids: readonly string[];
  capabilities: readonly GameAssetCapabilityId[];
}> = [
  { ids: ['art-director'], capabilities: ['image', 'sprite', 'mesh', 'ui'] },
  { ids: ['concept-art'], capabilities: ['image'] },
  { ids: ['character-art'], capabilities: ['image', 'sprite', 'mesh'] },
  { ids: ['environment-art'], capabilities: ['image', 'mesh'] },
  { ids: ['ui-design'], capabilities: ['ui', 'image'] },
  { ids: ['vfx-shader'], capabilities: ['image', 'sprite'] },
  { ids: ['technical-artist'], capabilities: ['mesh', 'sprite', 'image'] },
  { ids: ['audio-director'], capabilities: ['music', 'speech'] },
  { ids: ['sound-designer', 'audio-designer'], capabilities: ['music', 'speech'] },
  { ids: ['creative-director'], capabilities: ['image', 'music'] },
  { ids: ['level-designer'], capabilities: ['mesh', 'image'] },
  { ids: ['world-builder'], capabilities: ['image', 'mesh'] },
  { ids: ['writer', 'narrative-director'], capabilities: ['speech'] },
  { ids: ['ui-programmer', 'ux-designer', 'unity-ui-specialist', 'ue-umg-specialist'], capabilities: ['ui', 'image'] },
  { ids: ['visual-effects-artist'], capabilities: ['image', 'sprite'] },
  { ids: ['engine-programmer', 'unity-specialist', 'unreal-specialist', 'godot-specialist'], capabilities: ['mesh'] },
  { ids: ['community-manager'], capabilities: ['image', 'video'] },
];

export function isGameAssetCapabilityId(
  value: unknown,
): value is GameAssetCapabilityId {
  return typeof value === 'string' && CAPABILITY_BY_ID.has(value as GameAssetCapabilityId);
}

export function normalizeGameAssetCapabilityId(
  value: unknown,
): GameAssetCapabilityId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return null;
  if (isGameAssetCapabilityId(normalized)) return normalized;
  return ALIASES[normalized] ?? null;
}

export function normalizeGameAssetCapabilityIds(value: unknown): GameAssetCapabilityId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<GameAssetCapabilityId>();
  const out: GameAssetCapabilityId[] = [];
  for (const item of value) {
    const id = normalizeGameAssetCapabilityId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function gameAssetCapabilityById(
  id: GameAssetCapabilityId,
): GameAssetCapability {
  return CAPABILITY_BY_ID.get(id) ?? GAME_ASSET_CAPABILITIES[0];
}

export function defaultCapabilityIdsForRole(
  roleId: string,
  expertIds: readonly string[] = [],
): GameAssetCapabilityId[] {
  const keys = new Set([roleId, ...expertIds]);
  const out: GameAssetCapabilityId[] = [];
  const seen = new Set<GameAssetCapabilityId>();
  for (const rule of ROLE_DEFAULT_CAPABILITIES) {
    if (!rule.ids.some((id) => keys.has(id))) continue;
    for (const capability of rule.capabilities) {
      if (seen.has(capability)) continue;
      seen.add(capability);
      out.push(capability);
    }
  }
  return out;
}

export function assertGameAssetCapabilityRegistryValid(): void {
  const missing = GAME_ASSET_CAPABILITIES.flatMap((capability) =>
    capability.gameSkillNames.filter((name) => !GAME_SKILL_NAME_SET.has(name)),
  );
  if (missing.length > 0) {
    throw new Error(`Game asset capabilities reference missing GameSkills: ${missing.join(', ')}`);
  }
}

function localizedCapabilityLabel(
  capability: GameAssetCapability,
  locale: Locale,
): string {
  if (locale === 'zh-CN') return capability.label;
  const labels: Record<GameAssetCapabilityId, string> = {
    image: 'Image',
    sprite: 'Sprite',
    mesh: 'Mesh',
    ui: 'UI',
    music: 'Music',
    speech: 'Speech',
    video: 'Video',
  };
  return labels[capability.id];
}

export function formatCapabilitySummary(
  capabilityIds: readonly GameAssetCapabilityId[],
  locale: Locale,
): string {
  if (capabilityIds.length === 0) return '';
  return capabilityIds
    .map((id) => localizedCapabilityLabel(gameAssetCapabilityById(id), locale))
    .join(locale === 'zh-CN' ? '、' : ', ');
}

export function formatAssetRequestProtocolBlock(
  capabilityIds: readonly GameAssetCapabilityId[],
  locale: Locale,
): string {
  if (capabilityIds.length === 0) return '';

  const capabilities = capabilityIds.map(gameAssetCapabilityById);
  if (locale !== 'zh-CN') {
    return [
      'Asset request routing protocol:',
      'When this role Skill discovers a concrete asset-generation need, do not hand-roll the asset. First emit an Asset Request spec, then route it to the matching GameSkill command.',
      'Asset Request fields: assetType, role, purpose, style, constraints, prompt, acceptanceCriteria.',
      'Available capabilities:',
      ...capabilities.map(
        (capability) =>
          `- ${localizedCapabilityLabel(capability, locale)} (${capability.assetType}): use ${capability.command}; ${capability.useWhen} Inputs: ${capability.inputRequirements.join(', ')}. Outputs: ${capability.outputArtifacts.join(', ')}.`,
      ),
    ].join('\n');
  }

  return [
    '资产请求路由协议：',
    '当本岗位 Skill 判断任务需要生成、制作、编辑或查找具体资产时，不要只停留在建议，也不要手写代码伪造资产；先输出统一 Asset Request 规格，再路由到匹配的游戏 Skill 命令。',
    'Asset Request 字段：assetType、role、purpose、style、constraints、prompt、acceptanceCriteria。',
    '可用能力：',
    ...capabilities.map(
      (capability) =>
        `- ${capability.label}（${capability.assetType}）：使用 ${capability.command}；适用：${capability.useWhen} 输入要素：${capability.inputRequirements.join('、')}。产出：${capability.outputArtifacts.join('、')}。`,
    ),
  ].join('\n');
}

export function availabilityFromGameAssetChannels(channels: {
  image?: boolean;
  sprite?: boolean;
  mesh?: boolean;
  threeD?: boolean;
  ui?: boolean;
  music?: boolean;
  speech?: boolean;
  video?: boolean;
}): Partial<Record<GameAssetCapabilityId, boolean>> {
  return {
    image: channels.image === true,
    sprite: channels.sprite === true,
    mesh: channels.mesh === true || channels.threeD === true,
    ui: channels.ui === true,
    music: channels.music === true,
    speech: channels.speech === true,
    video: channels.video === true,
  };
}

export function availabilityFromAssetChannels(
  channels: AssetChannelAvailability,
  uiReady = false,
): Partial<Record<GameAssetCapabilityId, boolean>> {
  return availabilityFromGameAssetChannels({
    image: channels.image,
    sprite: channels.sprite,
    mesh: channels.threeD,
    ui: uiReady,
    music: channels.music,
    speech: channels.speech,
    video: channels.video,
  });
}

export function selectReadyCapabilities(
  capabilityIds: readonly GameAssetCapabilityId[],
  availability?: Partial<Record<GameAssetCapabilityId, boolean>>,
): GameAssetCapability[] {
  return capabilityIds
    .map(gameAssetCapabilityById)
    .filter((capability) => !availability || availability[capability.id] === true);
}

export function formatReadyCapabilityGuidance(
  capabilityIds: readonly GameAssetCapabilityId[],
  availability: Partial<Record<GameAssetCapabilityId, boolean>>,
  locale: Locale,
): string[] {
  const ready = selectReadyCapabilities(capabilityIds, availability);
  if (ready.length === 0) return [];

  if (locale !== 'zh-CN') {
    return [
      'Available asset-generation GameSkills:',
      ...ready.map(
        (capability) =>
          `- ${localizedCapabilityLabel(capability, locale)}: route concrete ${capability.assetType} requests to ${capability.command} and provide a ready-to-use prompt.`,
      ),
    ];
  }

  return [
    '【可用素材渠道 / 资产生成能力】本岗位发现具体资产需求时，先写 Asset Request，再推荐对应游戏 Skill 命令并附可直接使用的提示词：',
    ...ready.map(
      (capability) =>
        `· ${capability.label}：${capability.useWhen} → ${capability.command}`,
    ),
  ];
}

export function routeAssetRequest(
  request: {
    text: string;
    roleLabel?: string;
    capabilityIds?: readonly GameAssetCapabilityId[];
    availability?: Partial<Record<GameAssetCapabilityId, boolean>>;
  },
): AssetRequestRoute | null {
  const text = request.text.trim();
  if (!text) return null;
  const candidates =
    request.capabilityIds && request.capabilityIds.length > 0
      ? request.capabilityIds.map(gameAssetCapabilityById)
      : GAME_ASSET_CAPABILITIES;
  const lower = text.toLocaleLowerCase();
  const available = candidates.filter(
    (capability) =>
      !request.availability || request.availability[capability.id] === true,
  );

  let best: { capability: GameAssetCapability; score: number; matched: string[] } | null = null;
  for (const capability of available) {
    const matched = capability.intentKeywords.filter((keyword) =>
      lower.includes(keyword.toLocaleLowerCase()),
    );
    const commandMentioned =
      lower.includes(capability.command.toLocaleLowerCase()) ||
      (capability.modeCommand
        ? lower.includes(capability.modeCommand.toLocaleLowerCase())
        : false);
    const score = matched.length * 10 + (commandMentioned ? 100 : 0);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { capability, score, matched };
  }
  if (!best) return null;

  const assetRequest = [
    `assetType: ${best.capability.assetType}`,
    `role: ${request.roleLabel ?? '游戏团队'}`,
    `purpose: ${text}`,
    `style: 按当前项目美术/音频/UI 方向补齐`,
    `constraints: ${best.capability.inputRequirements.join('、')}`,
    `prompt: ${text}`,
    `acceptanceCriteria: ${best.capability.acceptanceCriteria.join('、')}`,
  ].join('\n');

  return {
    capability: best.capability,
    commandText: `${best.capability.command} ${text}`.trim(),
    assetRequest,
    reason: best.matched.length > 0 ? `命中：${best.matched.join('、')}` : '显式命令匹配',
  };
}
