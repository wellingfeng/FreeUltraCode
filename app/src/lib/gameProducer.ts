/**
 * CONTRACT: the in-app Game Producer orchestration layer.
 *
 * 制作人(Producer)在这里是一个"制作人视角/计划模板"，不是默认多 agent
 * 执行器。它不参与 `gameExperts.ts` 的 persona 融合，而是负责一个可移植、
 * 纯 TS 的计划与验收循环：
 *
 *   需求 → [视角建议] 选管线模板 + 标主视角 + 依赖/验收
 *        → [排序建议] 按依赖顺序给出工作包建议
 *        → [处理] 当前编程模型自行决定是否拆分并融合对应专家约束
 *        → [验收] QA/Producer 视角对标客观验收标准
 *        → [回退建议] 不过则建议 rework(限次)；过则进入下一阶段
 *        → [汇总] 制作人视角汇总交付
 *
 * 不依赖 OMC、不依赖任何 OS 级 hook。流程里的"hook"是应用内生命周期拦截点
 * (见 ProducerHook)，可移植、随 app 走。
 */
import {
  GAME_EXPERTS,
  type GameAssetChannels,
  type GameExpertDefinition,
  type GameExpertSettings,
} from "./gameExperts";
import {
  availabilityFromGameAssetChannels,
  formatReadyCapabilityGuidance,
  type GameAssetCapabilityId,
} from "./gameAssetCapabilities";

/** 游戏制作管线阶段（与真实团队的预生产→生产→里程碑对齐）。 */
export type ProducerStageId =
  | "concept" // 概念/需求拆解
  | "prototype" // 原型与可玩验证
  | "design" // 设计定稿
  | "art" // 美术（原画→建模→特效）
  | "audio" // 音频（可与美术并行）
  | "engineering" // 程序整合
  | "content" // 关卡/内容填充
  | "qa"; // 验收与测试

export interface ProducerStage {
  id: ProducerStageId;
  label: string;
  /** 该阶段默认归属的专家 id（按现有 GAME_EXPERTS 目录）。 */
  defaultOwners: string[];
  /** 依赖的上游阶段；为空表示可立即开始。 */
  dependsOn: ProducerStageId[];
}

export interface PipelineTemplate {
  id: string;
  label: string;
  summary: string;
  stages: ProducerStage[];
}

/** 单个建议工作包（制作人视角拆解的产物，不代表已启动独立 agent）。 */
export interface ProducerTask {
  id: string;
  stage: ProducerStageId;
  title: string;
  /** 该工作包建议参考的主专家 id（视角池来自 GAME_EXPERTS）。 */
  ownerExpertId: string;
  /** 依赖的上游任务 id；空数组=可立即执行。 */
  dependsOn: string[];
  /** 客观验收标准——没有它验收会变成空话。 */
  acceptance: string[];
  status: "pending" | "running" | "review" | "done" | "failed";
  /** 已重做次数，受 rework 上限约束。 */
  reworkCount: number;
}

export interface ProducerPlan {
  template: PipelineTemplate;
  tasks: ProducerTask[];
}

/**
 * 应用内生命周期 hook（不是 OMC/OS 级 hook）。制作人视角在建议计划的关键节点
 * 触发这些回调，宿主可借此插入规则：人工 checkpoint、素材渠道推荐、日志、
 * 验收加严等。全部纯 TS，随 app 走，换电脑不丢。
 */
export interface ProducerHooks {
  /** 生成建议计划后。可在此校验/改写计划。 */
  onPlanReady?: (plan: ProducerPlan) => ProducerPlan | void;
  /** 某建议工作包即将被当前模型处理。返回 false 可拦截（如等待人工 checkpoint）。 */
  beforeTask?: (task: ProducerTask, plan: ProducerPlan) => boolean | void;
  /** 某建议工作包产出后、验收前。 */
  afterTask?: (task: ProducerTask, output: string) => void;
  /** 验收判定后（pass/fail）。返回 false 可强制打回重做。 */
  onReview?: (task: ProducerTask, passed: boolean) => boolean | void;
  /** 阶段切换。 */
  onStageEnter?: (stage: ProducerStageId, plan: ProducerPlan) => void;
  /** 全部完成、制作人汇总前。 */
  onComplete?: (plan: ProducerPlan) => void;
}

/** 默认 rework 上限，超过则任务判 failed（对应 OMC 的 fix-loop bound）。 */
export const PRODUCER_MAX_REWORK = 2;

/**
 * 固化的游戏管线模板。这是稳定性的关键：不指望模型即兴发散，而是给制作人
 * 几套现实团队验证过的流程剧本，它据此给出主视角/验收建议。
 */
export const PRODUCER_PIPELINES: PipelineTemplate[] = [
  {
    id: "full-game",
    label: "完整游戏开发",
    summary: "从概念到可发布的全流程，含预生产、生产、里程碑验收。",
    stages: [
      {
        id: "concept",
        label: "概念与需求拆解",
        defaultOwners: ["producer", "creative-director"],
        dependsOn: [],
      },
      {
        id: "prototype",
        label: "原型与可玩验证",
        defaultOwners: ["prototyper", "game-designer"],
        dependsOn: ["concept"],
      },
      {
        id: "design",
        label: "设计定稿",
        defaultOwners: ["game-designer", "systems-designer", "level-designer"],
        dependsOn: ["prototype"],
      },
      {
        id: "art",
        label: "美术（原画→建模→特效）",
        defaultOwners: [
          "art-director",
          "technical-artist",
          "visual-effects-artist",
        ],
        dependsOn: ["design"],
      },
      {
        id: "audio",
        label: "音频（与美术并行）",
        defaultOwners: ["audio-director", "sound-designer"],
        dependsOn: ["design"],
      },
      {
        id: "engineering",
        label: "程序整合",
        defaultOwners: ["lead-programmer", "gameplay-programmer"],
        dependsOn: ["art", "audio"],
      },
      {
        id: "content",
        label: "关卡与内容填充",
        defaultOwners: ["level-designer", "world-builder"],
        dependsOn: ["engineering"],
      },
      {
        id: "qa",
        label: "验收与测试",
        defaultOwners: ["qa-lead", "qa-tester"],
        dependsOn: ["content"],
      },
    ],
  },
  {
    id: "prototype-only",
    label: "新玩法原型",
    summary: "只验证一个核心玩法假设是否有趣，快速垂直切片。",
    stages: [
      {
        id: "concept",
        label: "玩法假设拆解",
        defaultOwners: ["game-designer"],
        dependsOn: [],
      },
      {
        id: "prototype",
        label: "可玩原型",
        defaultOwners: ["prototyper", "gameplay-programmer"],
        dependsOn: ["concept"],
      },
      {
        id: "qa",
        label: "手感验证",
        defaultOwners: ["qa-tester", "game-designer"],
        dependsOn: ["prototype"],
      },
    ],
  },
  {
    id: "asset-pipeline",
    label: "美术资产管线",
    summary: "从设定到原画到 3D 模型到音频的资产产出流程。",
    stages: [
      {
        id: "design",
        label: "资产设定",
        defaultOwners: ["art-director", "game-designer"],
        dependsOn: [],
      },
      {
        id: "art",
        label: "原画与建模",
        defaultOwners: ["art-director", "technical-artist"],
        dependsOn: ["design"],
      },
      {
        id: "audio",
        label: "配套音频",
        defaultOwners: ["audio-director", "sound-designer"],
        dependsOn: ["design"],
      },
      {
        id: "qa",
        label: "资产验收",
        defaultOwners: ["qa-lead"],
        dependsOn: ["art", "audio"],
      },
    ],
  },
];

const EXPERT_BY_ID = new Map<string, GameExpertDefinition>(
  GAME_EXPERTS.map((expert) => [expert.id, expert]),
);

/** 按需求关键词选最合适的管线模板（兜底用 full-game）。 */
export function selectPipeline(input: string): PipelineTemplate {
  const text = input.toLowerCase();
  const wantsPrototype = /原型|prototype|手感|poc|垂直切片|可玩验证/.test(text);
  const wantsAsset = /美术|原画|建模|贴图|资产|asset|texture|音效|配套音/.test(
    text,
  );
  const wantsFullExplicit = /完整|上线|发布|完整的|whole|full game/.test(text);
  const wantsGame = /游戏|game|开发一(个|款)|做(一)?(个|款)/.test(text);

  // 显式"完整/发布"最强；其次原型、资产这类窄意图优先于泛化的"做个游戏"。
  if (wantsFullExplicit) return PRODUCER_PIPELINES[0];
  if (wantsPrototype)
    return (
      PRODUCER_PIPELINES.find((p) => p.id === "prototype-only") ??
      PRODUCER_PIPELINES[0]
    );
  if (wantsAsset)
    return (
      PRODUCER_PIPELINES.find((p) => p.id === "asset-pipeline") ??
      PRODUCER_PIPELINES[0]
    );
  if (wantsGame) return PRODUCER_PIPELINES[0];
  return PRODUCER_PIPELINES[0];
}

/**
 * 把模板展开成建议工作包 DAG：每个阶段为每个默认 owner 生成一个工作包，
 * 依赖映射自上游阶段的全部工作包。验收标准由 owner 专家的 boundaries/guidance 派生，
 * 保证"验收标准来自该角色的真实关注点"。
 */
export function buildPlan(
  input: string,
  template?: PipelineTemplate,
): ProducerPlan {
  const tpl = template ?? selectPipeline(input);
  const stageTaskIds = new Map<ProducerStageId, string[]>();
  const tasks: ProducerTask[] = [];

  for (const stage of tpl.stages) {
    const owners = stage.defaultOwners.filter((id) => EXPERT_BY_ID.has(id));
    const upstreamTaskIds = stage.dependsOn.flatMap(
      (dep) => stageTaskIds.get(dep) ?? [],
    );
    const idsForStage: string[] = [];

    owners.forEach((ownerId, idx) => {
      const expert = EXPERT_BY_ID.get(ownerId)!;
      const taskId = `${stage.id}-${idx + 1}`;
      idsForStage.push(taskId);
      tasks.push({
        id: taskId,
        stage: stage.id,
        title: `${stage.label} · ${expert.name}`,
        ownerExpertId: ownerId,
        dependsOn: upstreamTaskIds,
        acceptance: deriveAcceptance(expert),
        status: "pending",
        reworkCount: 0,
      });
    });
    stageTaskIds.set(stage.id, idsForStage);
  }

  return { template: tpl, tasks };
}

/** 验收标准取自专家的 guidance（要做到的）+ boundaries（不能越界的）。 */
function deriveAcceptance(expert: GameExpertDefinition): string[] {
  const out = [...expert.guidance.slice(0, 2)];
  if (expert.boundaries[0]) out.push(`守住边界：${expert.boundaries[0]}`);
  return out;
}

/**
 * 返回当前可处理的建议工作包（依赖全部 done）。默认用于单模型计划；
 * 是否进一步拆分执行由当前编程模型或显式高级功能自行决定。
 */
export function readyTasks(plan: ProducerPlan): ProducerTask[] {
  const done = new Set(
    plan.tasks.filter((t) => t.status === "done").map((t) => t.id),
  );
  return plan.tasks.filter(
    (t) => t.status === "pending" && t.dependsOn.every((dep) => done.has(dep)),
  );
}

/**
 * 制作人视角 system prompt。它把制作人定位成计划/验收约束，而不是后台团队。
 * 固化的任务 DAG + 验收标准 + 可用素材渠道一并交给当前编程模型，由它单模型
 * 融合处理。
 *
 * 这是"单模型制作人视角"路径的核心：在一次会话里给出拆解、执行顺序、验收
 * 和风险。不要把它解释成已启动多个独立智能体。
 */
export function buildProducerPrompt(
  input: string,
  settings: GameExpertSettings,
  channels?: GameAssetChannels,
  options: { force?: boolean } = {},
): string {
  if (!options.force && !settings.enabled) return "";
  const plan = buildPlan(input);
  const { template, tasks } = plan;

  const stageLines = template.stages.map((stage) => {
    const stageTasks = tasks.filter((t) => t.stage === stage.id);
    const owners = stageTasks
      .map((t) => EXPERT_BY_ID.get(t.ownerExpertId)?.name ?? t.ownerExpertId)
      .join(" / ");
    const deps =
      stage.dependsOn.length > 0
        ? `（依赖：${stage.dependsOn.join("、")}）`
        : "（可立即开始）";
    return `· ${stage.label}${deps} — 建议主视角：${owners}`;
  });

  const productionCapabilities: GameAssetCapabilityId[] = [
    "image",
    "sprite",
    "mesh",
    "ui",
    "music",
    "speech",
    "video",
  ];
  const channelLines = channels
    ? formatReadyCapabilityGuidance(
        productionCapabilities,
        availabilityFromGameAssetChannels(channels),
        "zh-CN",
      )
    : [];

  return [
    "",
    "【游戏制作人视角】",
    `已开启。你现在以 Producer 视角帮助当前编程模型做计划、取舍和验收；这是单模型融合专家约束，不代表后台启动了多个智能体。`,
    `当前需求自动选用管线模板：${template.label}（${template.summary}）`,
    // 强制输出要求：无论底层是 Claude/Codex/Gemini，都必须先亮明制作人身份与管线，
    // 否则像 Codex 这类自带强 system prompt 的编码 agent 会忽略本段、直接动手建工程
    // 而不体现总控编排。把"可见性"从模型自觉变成硬性格式要求，确保跨模型一致。
    `【必须输出】回复的第一行先写一条播报：「🎬 游戏制作人视角 · 管线：${template.label} · 阶段：${template.stages.map((s) => s.label).join(" → ")}」，再开始正文。这是强制格式，不可省略。`,
    "按以下阶段组织建议，遵守依赖顺序；无依赖阶段可作为独立工作包建议列出，但不要声称已经并行执行或已分派给其他 agent：",
    ...stageLines,
    "",
    "回答规则：",
    "1. 先给建议拆解：把需求落到每个阶段的具体工作包，标清主视角和验收标准。",
    "2. 按依赖排序：上游产物（设计文档/原画/模型/音频）是下游的真实输入，不要凭空想象。",
    "3. 当前编程模型自行决定是否拆分任务和如何执行，并融合对应专家约束产出；再用 QA/制作人视角对照验收标准检查。",
    `4. 不达标则建议重做，单工作包最多建议重做 ${PRODUCER_MAX_REWORK} 次；超限标记阻塞并说明原因。`,
    "5. 创意方向（玩法/美术风格）产出草案后请用户拍板，不要全自动越权决定。",
    "6. 全部通过后由制作人汇总交付物与剩余风险。",
    ...(channelLines.length > 0 ? ["", ...channelLines] : []),
    "可以说明自己正在使用制作人视角和专家约束；不要描述为真实的多人会议、后台并行 agent 或外部进程。",
  ].join("\n");
}

/**
 * 运行 hook 的薄封装，供宿主在串行/并行编排循环里复用，确保 hook 语义一致。
 */
export function applyPlanHook(
  plan: ProducerPlan,
  hooks?: ProducerHooks,
): ProducerPlan {
  const next = hooks?.onPlanReady?.(plan);
  return next ?? plan;
}

/**
 * 是否启用制作人视角计划（方案 A）。仅当需求像"完整游戏/多阶段编排"时才接管，
 * 其余窄问题仍走 gameExperts 的专家人格融合。判据：出现"做/设计一个游戏"这类
 * 整体建造意图，或显式提到完整/上线/发布，或同时涉及多个制作领域。
 */
export function shouldUseProducer(input: string): boolean {
  const text = input.toLowerCase();
  const buildIntent =
    /(设计|做|开发|搭建|制作|build|make|create).{0,16}(游戏|game)/.test(text);
  const fullIntent = /完整|上线|发布|full game|whole game/.test(text);
  const assetIntent = /原画|建模|资产|asset|texture|音效|配套音/.test(text);
  const prototypeIntent = /原型|prototype|垂直切片|可玩验证/.test(text);

  // 命中多个制作领域（玩法/美术/音频/程序/关卡）也算需要编排。
  const domains = [
    /玩法|gameplay|机制|mechanic/,
    /美术|art|原画|建模|model|贴图/,
    /音频|audio|音效|bgm|music/,
    /程序|代码|client|engine|引擎/,
    /关卡|level|地图|map/,
  ].filter((re) => re.test(text)).length;

  return (
    buildIntent || fullIntent || assetIntent || prototypeIntent || domains >= 2
  );
}
