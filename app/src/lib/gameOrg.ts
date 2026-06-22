import defaultGameOrgDefinition from "@/config/gameOrgDefaults.json";
import {
  gameExpertSlashCommand,
  getGameExpertCatalog,
  normalizeGameExpertSettings,
  type GameExpertDefinition,
  type GameExpertSettings,
} from "./gameExperts";
import {
  localizedGameExpertName,
  localizedGameGroupLabel,
} from "./gameExpertI18n";
import {
  localizedGameExpertRootCommand,
  localizeGameOrgNodeText,
  localizeGameOrgSkillText,
} from "./gameOrgI18n";
import {
  defaultCapabilityIdsForRole,
  formatAssetRequestProtocolBlock,
  formatCapabilitySummary,
  gameAssetCapabilityById,
  normalizeGameAssetCapabilityIds,
  routeAssetRequest,
  type AssetRequestRoute,
  type GameAssetCapability,
  type GameAssetCapabilityId,
} from "./gameAssetCapabilities";
import type { Locale } from "./i18n";

export interface GameOrgFunctionalSkill {
  id: string;
  label: string;
  summary: string;
  prompt: string;
  protocol?: GameOrgSkillProtocol;
  collaboratorExpertIds?: string[];
  allowedCapabilities?: GameAssetCapabilityId[];
}

export type GameOrgSkillDefinition = GameOrgFunctionalSkill;

export interface GameOrgSkillProtocol {
  triggerConditions: string;
  inputs: string;
  executionSteps: string[];
  toolsAndResources: string;
  outputs: string;
  acceptanceCriteria: string;
}

export interface GameOrgRoleProfile {
  position: string;
  responsibilities: string[];
  scenarios: string[];
  deliverables: string[];
  collaborators: string[];
}

export interface GameOrgNodeDefinition {
  id: string;
  label: string;
  icon?: GameOrgNodeIcon;
  summary?: string;
  role?: string;
  profile?: GameOrgRoleProfile;
  expertIds?: string[];
  allowedCapabilities?: GameAssetCapabilityId[];
  skills?: GameOrgSkillDefinition[];
  children?: GameOrgNodeDefinition[];
}

export const GAME_ORG_NODE_ICONS = [
  "producer",
  "design",
  "gameplay",
  "systems",
  "economy",
  "level",
  "narrative",
  "writing",
  "world",
  "tech",
  "client",
  "engine",
  "backend",
  "technical-art",
  "tools",
  "data",
  "art",
  "concept",
  "character",
  "environment",
  "ui",
  "vfx",
  "audio",
  "sound",
  "qa",
  "performance",
  "accessibility",
  "release",
  "community",
  "localization",
  "analytics",
  "team",
] as const;

export type GameOrgNodeIcon = (typeof GAME_ORG_NODE_ICONS)[number];

export interface ResolvedGameOrgSkill extends GameOrgSkillDefinition {
  protocol: GameOrgSkillProtocol;
  commandText: string;
  collaboratorLabels: string[];
  allowedCapabilities: GameAssetCapabilityId[];
  capabilityLabels: string[];
  capabilities: GameAssetCapability[];
}

export interface ResolvedGameOrgNode {
  id: string;
  label: string;
  icon: GameOrgNodeIcon;
  summary: string;
  role: string;
  profile: GameOrgRoleProfile;
  path: string[];
  expertIds: string[];
  experts: GameExpertDefinition[];
  groupLabels: string[];
  commandText: string | null;
  allowedCapabilities: GameAssetCapabilityId[];
  capabilityLabels: string[];
  capabilities: GameAssetCapability[];
  skills: ResolvedGameOrgSkill[];
  children: ResolvedGameOrgNode[];
}

export interface GameOrgSkillBinding {
  roleId: string;
  roleLabel: string;
  skillId: string;
  skillLabel: string;
  collaboratorExpertIds: string[];
  collaboratorLabels: string[];
  allowedCapabilities: GameAssetCapabilityId[];
  capabilityLabels: string[];
}

export interface GameOrgSkillBindingOverview {
  own: GameOrgSkillBinding[];
  incoming: GameOrgSkillBinding[];
}

export interface GameOrgSkillRecommendation {
  roleId: string;
  roleLabel: string;
  rolePath: string[];
  skillId: string;
  skillLabel: string;
  skillSummary: string;
  commandText: string;
  collaboratorLabels: string[];
  allowedCapabilities: GameAssetCapabilityId[];
  capabilityLabels: string[];
  score: number;
  matchedTerms: string[];
}

export interface RecommendGameOrgSkillsOptions {
  limit?: number;
}

export interface GameOrgTaskPlanStep {
  order: number;
  roleId: string;
  roleLabel: string;
  rolePath: string[];
  skillId: string;
  skillLabel: string;
  skillSummary: string;
  commandText: string;
  collaboratorLabels: string[];
  allowedCapabilities: GameAssetCapabilityId[];
  capabilityLabels: string[];
  matchedTerms: string[];
  reason: string;
  deliverable: string;
  acceptanceCriteria: string;
  score: number;
}

export interface GameOrgTaskPlan {
  query: string;
  steps: GameOrgTaskPlanStep[];
  commandText: string;
  documentText: string;
  checklistText: string;
}

export interface PlanGameOrgTaskOptions {
  limit?: number;
  locale?: Locale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const trimmed = trimString(value);
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function mergeCapabilityIds(
  first: readonly GameAssetCapabilityId[],
  second: readonly GameAssetCapabilityId[],
): GameAssetCapabilityId[] {
  const seen = new Set<GameAssetCapabilityId>();
  const out: GameAssetCapabilityId[] = [];
  for (const id of [...first, ...second]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function capabilityLabels(
  capabilityIds: readonly GameAssetCapabilityId[],
  locale: Locale,
): string[] {
  const summary = formatCapabilitySummary(capabilityIds, locale);
  return summary ? summary.split(locale === "zh-CN" ? "、" : ", ") : [];
}

function normalizeGameOrgSkillProtocol(
  value: unknown,
): GameOrgSkillProtocol | undefined {
  if (!isRecord(value)) return undefined;

  const triggerConditions =
    trimString(value.triggerConditions) || trimString(value.triggers);
  const inputs = trimString(value.inputs) || trimString(value.input);
  const executionSteps =
    stringList(value.executionSteps).length > 0
      ? stringList(value.executionSteps)
      : stringList(value.steps);
  const toolsAndResources =
    trimString(value.toolsAndResources) ||
    trimString(value.tools) ||
    trimString(value.resources);
  const outputs = trimString(value.outputs) || trimString(value.output);
  const acceptanceCriteria =
    trimString(value.acceptanceCriteria) ||
    trimString(value.acceptance) ||
    trimString(value.verification);

  if (
    !triggerConditions &&
    !inputs &&
    executionSteps.length === 0 &&
    !toolsAndResources &&
    !outputs &&
    !acceptanceCriteria
  ) {
    return undefined;
  }

  return {
    triggerConditions,
    inputs,
    executionSteps,
    toolsAndResources,
    outputs,
    acceptanceCriteria,
  };
}

function mergeGameOrgSkillProtocol(
  protocol: GameOrgSkillProtocol | undefined,
  fallback: GameOrgSkillProtocol,
): GameOrgSkillProtocol {
  if (!protocol) return fallback;
  return {
    triggerConditions: protocol.triggerConditions || fallback.triggerConditions,
    inputs: protocol.inputs || fallback.inputs,
    executionSteps:
      protocol.executionSteps.length > 0
        ? protocol.executionSteps
        : fallback.executionSteps,
    toolsAndResources: protocol.toolsAndResources || fallback.toolsAndResources,
    outputs: protocol.outputs || fallback.outputs,
    acceptanceCriteria:
      protocol.acceptanceCriteria || fallback.acceptanceCriteria,
  };
}

function normalizeGameOrgRoleProfile(
  value: unknown,
): GameOrgRoleProfile | undefined {
  if (!isRecord(value)) return undefined;

  const position = trimString(value.position);
  const responsibilities =
    stringList(value.responsibilities).length > 0
      ? stringList(value.responsibilities)
      : stringList(value.coreResponsibilities);
  const scenarios =
    stringList(value.scenarios).length > 0
      ? stringList(value.scenarios)
      : stringList(value.useCases);
  const deliverables =
    stringList(value.deliverables).length > 0
      ? stringList(value.deliverables)
      : stringList(value.outputs);
  const collaborators =
    stringList(value.collaborators).length > 0
      ? stringList(value.collaborators)
      : stringList(value.collaborationTargets);

  if (
    !position &&
    responsibilities.length === 0 &&
    scenarios.length === 0 &&
    deliverables.length === 0 &&
    collaborators.length === 0
  ) {
    return undefined;
  }

  return {
    position,
    responsibilities,
    scenarios,
    deliverables,
    collaborators,
  };
}

function mergeGameOrgRoleProfile(
  profile: GameOrgRoleProfile | undefined,
  fallback: GameOrgRoleProfile,
): GameOrgRoleProfile {
  if (!profile) return fallback;
  return {
    position: profile.position || fallback.position,
    responsibilities:
      profile.responsibilities.length > 0
        ? profile.responsibilities
        : fallback.responsibilities,
    scenarios:
      profile.scenarios.length > 0 ? profile.scenarios : fallback.scenarios,
    deliverables:
      profile.deliverables.length > 0
        ? profile.deliverables
        : fallback.deliverables,
    collaborators:
      profile.collaborators.length > 0
        ? profile.collaborators
        : fallback.collaborators,
  };
}

export function createDefaultGameOrgRoleProfile(
  role: {
    label: string;
    summary: string;
    role: string;
    collaboratorLabels?: readonly string[];
  },
  locale: Locale,
): GameOrgRoleProfile {
  const collaborators = uniqueStrings(role.collaboratorLabels ?? []);

  if (locale !== "zh-CN") {
    return {
      position: role.summary || `${role.label} in the project organization.`,
      responsibilities: [
        role.role ||
          `Provide the ${role.label} lens so the main model can keep related work scoped, reviewed, and shippable.`,
      ],
      scenarios: [
        `Use this role lens when a task needs ${role.label} judgment, review, constraints, or acceptance criteria.`,
      ],
      deliverables: [
        "Role-scoped recommendations, risk list, handoff notes, and acceptance criteria.",
      ],
      collaborators:
        collaborators.length > 0
          ? collaborators
          : ["Related role lenses and bound Skills."],
    };
  }

  return {
    position: role.summary || `${role.label} 在项目组织中的定位。`,
    responsibilities: [
      role.role || `提供 ${role.label} 范围内的判断、建议、风险和验收约束。`,
    ],
    scenarios: [`当任务需要 ${role.label} 视角判断、评审或验收时使用。`],
    deliverables: [
      "职责范围内的建议、风险列表、交接说明和验收标准。",
    ],
    collaborators:
      collaborators.length > 0 ? collaborators : ["相关岗位视角和绑定 Skill。"],
  };
}

export function createDefaultGameOrgSkillProtocol(
  skill: Pick<GameOrgSkillDefinition, "label" | "summary" | "prompt">,
  locale: Locale,
): GameOrgSkillProtocol {
  if (locale !== "zh-CN") {
    return {
      triggerConditions:
        skill.summary || `A request needs the ${skill.label} capability.`,
      inputs:
        "User request, current project context, relevant code/assets, and role-lens constraints.",
      executionSteps: [
        "Clarify the objective, boundaries, dependencies, and missing context.",
        "Provide role-scoped suggestions and identify related lenses the main model may consider.",
        "Return actionable recommendations, risks, deliverables, and acceptance checks.",
      ],
      toolsAndResources:
        "Current workspace, project files, configured tools, and linked reference lenses.",
      outputs:
        skill.summary ||
        `A deliverable, recommendation set, or implementation checklist for ${skill.label}.`,
      acceptanceCriteria:
        "The result is actionable, scoped to the role lens, includes risks, and has clear verification criteria.",
    };
  }

  return {
    triggerConditions: skill.summary || `需要参考「${skill.label}」视角时。`,
    inputs: "用户需求、当前项目上下文、相关代码/素材、岗位视角约束和关联视角。",
    executionSteps: [
      "确认目标、边界、依赖和缺失信息。",
      "按岗位视角给出建议步骤，并标出主模型可参考的关联视角。",
      "输出可执行建议、风险、产出物和验收口径。",
    ],
    toolsAndResources: "当前工作区、项目文件、已配置工具和绑定的参考 Skill。",
    outputs:
      skill.summary || `「${skill.label}」对应的方案、建议清单或交付产物。`,
    acceptanceCriteria:
      "结果可执行，视角边界清楚，风险明确，并给出可验证的验收标准。",
  };
}

export function formatGameOrgSkillPrompt(
  prompt: string,
  protocol: GameOrgSkillProtocol,
  capabilityIds: readonly GameAssetCapabilityId[],
  locale: Locale,
): string {
  const steps = protocol.executionSteps
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
  const assetProtocol = formatAssetRequestProtocolBlock(capabilityIds, locale);

  if (locale !== "zh-CN") {
    return [
      prompt.trim(),
      "",
      "Skill standard protocol:",
      `- Trigger conditions: ${protocol.triggerConditions}`,
      `- Inputs: ${protocol.inputs}`,
      `- Suggested steps:\n${steps}`,
      `- Tools/resources: ${protocol.toolsAndResources}`,
      `- Outputs: ${protocol.outputs}`,
      `- Acceptance criteria: ${protocol.acceptanceCriteria}`,
      assetProtocol ? `\n${assetProtocol}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    prompt.trim(),
    "",
    "Skill 标准六项：",
    `- 触发条件：${protocol.triggerConditions}`,
    `- 输入：${protocol.inputs}`,
    `- 建议步骤：\n${steps}`,
    `- 工具/资源：${protocol.toolsAndResources}`,
    `- 输出：${protocol.outputs}`,
    `- 验收标准：${protocol.acceptanceCriteria}`,
    assetProtocol ? `\n${assetProtocol}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isGameOrgNodeIcon(value: unknown): value is GameOrgNodeIcon {
  return (
    typeof value === "string" &&
    (GAME_ORG_NODE_ICONS as readonly string[]).includes(value)
  );
}

export function normalizeGameOrgSkillDefinition(
  value: unknown,
  fallbackId: string,
): GameOrgSkillDefinition | null {
  if (!isRecord(value)) return null;

  const id = trimString(value.id) || fallbackId;
  const label = trimString(value.label) || id;
  const prompt =
    trimString(value.prompt) ||
    `请参考${label}相关视角处理以下需求，并给出可执行建议、风险和验收标准。`;
  const summary = trimString(value.summary) || prompt;
  const collaboratorExpertIds = stringList(value.collaboratorExpertIds);
  const protocol = normalizeGameOrgSkillProtocol(value.protocol);
  const allowedCapabilities = normalizeGameAssetCapabilityIds(
    value.allowedCapabilities ?? value.capabilities,
  );

  return {
    id,
    label,
    summary,
    prompt,
    ...(protocol ? { protocol } : {}),
    ...(collaboratorExpertIds.length > 0 ? { collaboratorExpertIds } : {}),
    ...(allowedCapabilities.length > 0 ? { allowedCapabilities } : {}),
  };
}

export function normalizeGameOrgNodeDefinition(
  value: unknown,
  fallbackId = "game-team",
): GameOrgNodeDefinition | null {
  if (!isRecord(value)) return null;

  const id = trimString(value.id) || fallbackId;
  const label = trimString(value.label) || id;
  const expertIds = stringList(value.expertIds);
  const allowedCapabilities = normalizeGameAssetCapabilityIds(
    value.allowedCapabilities ?? value.capabilities,
  );
  const profile = normalizeGameOrgRoleProfile(value.profile);
  const rawChildren = Array.isArray(value.children) ? value.children : [];
  const children = rawChildren
    .map((child, index) =>
      normalizeGameOrgNodeDefinition(child, `${id}-${index + 1}`),
    )
    .filter((child): child is GameOrgNodeDefinition => Boolean(child));

  const hasSkillsProperty = Object.prototype.hasOwnProperty.call(
    value,
    "skills",
  );
  const rawSkills = Array.isArray(value.skills) ? value.skills : [];
  const skills = hasSkillsProperty
    ? rawSkills
        .map((skill, index) =>
          normalizeGameOrgSkillDefinition(skill, `${id}:skill-${index + 1}`),
        )
        .filter((skill): skill is GameOrgSkillDefinition => Boolean(skill))
    : undefined;

  return {
    id,
    label,
    ...(isGameOrgNodeIcon(value.icon) ? { icon: value.icon } : {}),
    ...(optionalString(value.summary)
      ? { summary: optionalString(value.summary) }
      : {}),
    ...(optionalString(value.role) ? { role: optionalString(value.role) } : {}),
    ...(profile ? { profile } : {}),
    ...(expertIds.length > 0 ? { expertIds } : {}),
    ...(allowedCapabilities.length > 0 ? { allowedCapabilities } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function createDefaultGameOrgDefinition(): GameOrgNodeDefinition {
  return {
    id: "game-team",
    label: "游戏专家视角库",
    icon: "team",
    summary: "当前项目的游戏开发专家视角库。",
    role: "按项目需求提供专家约束、风险提醒和验收标准。",
    skills: [],
    children: [],
  };
}

export function cloneGameOrgDefinition(
  definition: GameOrgNodeDefinition,
): GameOrgNodeDefinition {
  return {
    ...definition,
    profile: definition.profile
      ? {
          ...definition.profile,
          responsibilities: [...definition.profile.responsibilities],
          scenarios: [...definition.profile.scenarios],
          deliverables: [...definition.profile.deliverables],
          collaborators: [...definition.profile.collaborators],
        }
      : undefined,
    expertIds: definition.expertIds ? [...definition.expertIds] : undefined,
    allowedCapabilities: definition.allowedCapabilities
      ? [...definition.allowedCapabilities]
      : undefined,
    skills: definition.skills?.map((skill) => ({
      ...skill,
      protocol: skill.protocol
        ? {
            ...skill.protocol,
            executionSteps: [...skill.protocol.executionSteps],
          }
        : undefined,
      collaboratorExpertIds: skill.collaboratorExpertIds
        ? [...skill.collaboratorExpertIds]
        : undefined,
      allowedCapabilities: skill.allowedCapabilities
        ? [...skill.allowedCapabilities]
        : undefined,
    })),
    children: definition.children?.map(cloneGameOrgDefinition),
  };
}

export const DEFAULT_GAME_ORG_DEFINITION: GameOrgNodeDefinition =
  normalizeGameOrgNodeDefinition(defaultGameOrgDefinition, "producer") ??
  createDefaultGameOrgDefinition();

const GAME_ORG_DEFINITION_STORAGE_KEY = "ultragamestudio.gameOrgDefinition.v1";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function loadGameOrgDefinition(): GameOrgNodeDefinition {
  if (!hasStorage()) return cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
  try {
    const raw = window.localStorage.getItem(GAME_ORG_DEFINITION_STORAGE_KEY);
    if (!raw) return cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
    return (
      normalizeGameOrgNodeDefinition(
        JSON.parse(raw),
        DEFAULT_GAME_ORG_DEFINITION.id,
      ) ?? cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION)
    );
  } catch {
    return cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
  }
}

export function saveGameOrgDefinition(definition: GameOrgNodeDefinition): void {
  if (!hasStorage()) return;
  try {
    const normalized =
      normalizeGameOrgNodeDefinition(
        definition,
        DEFAULT_GAME_ORG_DEFINITION.id,
      ) ?? DEFAULT_GAME_ORG_DEFINITION;
    window.localStorage.setItem(
      GAME_ORG_DEFINITION_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // Quota / serialization errors are non-fatal.
  }
}

export function resetGameOrgDefinition(): GameOrgNodeDefinition {
  const next = cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(GAME_ORG_DEFINITION_STORAGE_KEY);
    } catch {
      // non-fatal
    }
  }
  return next;
}

function expertLabel(
  expert: GameExpertDefinition | undefined,
  fallback: string,
  locale: Locale,
): string {
  return expert ? localizedGameExpertName(expert, locale) : fallback;
}

function fallbackSkill(
  node: ResolvedGameOrgNode,
  locale: Locale,
): GameOrgSkillDefinition {
  if (locale !== "zh-CN") {
    return {
      id: `${node.id}:consult`,
      label: `Use ${node.label} Lens`,
      summary: node.summary,
      prompt: `Use the ${node.label} lens for the following request, and provide actionable recommendations, risks, and acceptance criteria within that role's scope. Do not imply a separate agent is running.`,
      collaboratorExpertIds: node.expertIds,
    };
  }
  return {
    id: `${node.id}:consult`,
    label: `参考${node.label}视角`,
    summary: node.summary,
    prompt: `请参考${node.label}视角处理以下需求，并给出职责内的可执行建议、风险和验收标准。不要暗示已启动独立 agent。`,
    collaboratorExpertIds: node.expertIds,
  };
}

function buildCommandText(
  expert: GameExpertDefinition | undefined,
  prompt: string,
): string {
  return `${expert ? gameExpertSlashCommand(expert) : "/游戏专家"} ${prompt}`.trim();
}

function resolveSkill(
  skill: GameOrgSkillDefinition,
  nodeId: string,
  roleCapabilityIds: readonly GameAssetCapabilityId[],
  primaryExpert: GameExpertDefinition | undefined,
  expertById: Map<string, GameExpertDefinition>,
  locale: Locale,
): ResolvedGameOrgSkill {
  const localized = localizeGameOrgSkillText(nodeId, skill.id, locale, skill);
  const allowedCapabilities = mergeCapabilityIds(
    roleCapabilityIds,
    skill.allowedCapabilities ?? [],
  );
  const capabilities = allowedCapabilities.map(gameAssetCapabilityById);
  const protocol = mergeGameOrgSkillProtocol(
    skill.protocol,
    createDefaultGameOrgSkillProtocol(
      {
        label: localized.label ?? skill.label,
        summary: localized.summary ?? skill.summary,
        prompt: localized.prompt ?? skill.prompt,
      },
      locale,
    ),
  );
  const collaboratorLabels = uniqueStrings(
    (skill.collaboratorExpertIds ?? [])
      .map((id) => expertById.get(id))
      .filter((expert): expert is GameExpertDefinition => Boolean(expert))
      .map((expert) => localizedGameExpertName(expert, locale)),
  );
  return {
    ...skill,
    ...localized,
    protocol,
    allowedCapabilities,
    capabilityLabels: capabilityLabels(allowedCapabilities, locale),
    capabilities,
    commandText: buildCommandText(
      primaryExpert,
      formatGameOrgSkillPrompt(
        localized.prompt ?? skill.prompt,
        protocol,
        allowedCapabilities,
        locale,
      ),
    ),
    collaboratorLabels,
  };
}

function resolveNode(
  definition: GameOrgNodeDefinition,
  expertById: Map<string, GameExpertDefinition>,
  locale: Locale,
  parentPath: string[],
): ResolvedGameOrgNode {
  const primaryExpertForLabel = (definition.expertIds ?? [])
    .map((id) => expertById.get(id))
    .find((expert): expert is GameExpertDefinition => Boolean(expert));
  const localizedDefinition = localizeGameOrgNodeText(definition.id, locale, {
    label: definition.label,
    summary: definition.summary,
    role: definition.role,
  });
  const label =
    localizedDefinition.label ||
    expertLabel(primaryExpertForLabel, definition.id, locale);

  const expertIds = uniqueStrings(definition.expertIds ?? []).filter((id) =>
    expertById.has(id),
  );
  const experts = expertIds
    .map((id) => expertById.get(id))
    .filter((expert): expert is GameExpertDefinition => Boolean(expert));

  const children = (definition.children ?? []).map((child) =>
    resolveNode(child, expertById, locale, [...parentPath, label]),
  );

  const primaryExpert = experts[0];
  const path = [...parentPath, label];
  const summary =
    localizedDefinition.summary ??
    primaryExpert?.summary ??
    (locale === "zh-CN"
      ? `${label} 的项目职责。`
      : `${label} project responsibilities.`);
  const role =
    localizedDefinition.role ??
    (locale === "zh-CN" ? primaryExpert?.role : undefined) ??
    summary;
  const groupLabels = uniqueStrings(
    experts.map((expert) => localizedGameGroupLabel(expert.group, locale)),
  );
  const allowedCapabilities = defaultCapabilityIdsForRole(
    definition.id,
    expertIds,
  );
  const mergedAllowedCapabilities = mergeCapabilityIds(
    allowedCapabilities,
    definition.allowedCapabilities ?? [],
  );
  const collaboratorLabels = uniqueStrings([
    ...experts.map((expert) => localizedGameExpertName(expert, locale)),
    ...children.map((child) => child.label),
  ]);
  const profile = mergeGameOrgRoleProfile(
    definition.profile,
    createDefaultGameOrgRoleProfile(
      {
        label,
        summary,
        role,
        collaboratorLabels,
      },
      locale,
    ),
  );

  const node: ResolvedGameOrgNode = {
    id: definition.id,
    label,
    icon: definition.icon ?? (children.length > 0 ? "team" : "gameplay"),
    summary,
    role,
    profile,
    path,
    expertIds,
    experts,
    groupLabels,
    commandText: primaryExpert
      ? `${gameExpertSlashCommand(primaryExpert)} `
      : `${localizedGameExpertRootCommand(locale)} `,
    allowedCapabilities: mergedAllowedCapabilities,
    capabilityLabels: capabilityLabels(mergedAllowedCapabilities, locale),
    capabilities: mergedAllowedCapabilities.map(gameAssetCapabilityById),
    skills: [],
    children,
  };

  const skills =
    definition.skills !== undefined
      ? definition.skills
      : [fallbackSkill(node, locale)];
  node.skills = skills.map((skill) =>
    resolveSkill(
      skill,
      definition.id,
      mergedAllowedCapabilities,
      primaryExpert,
      expertById,
      locale,
    ),
  );
  return node;
}

export function buildGameOrgTree(
  settings: GameExpertSettings,
  locale: Locale,
  definition: GameOrgNodeDefinition = DEFAULT_GAME_ORG_DEFINITION,
): ResolvedGameOrgNode {
  const normalized = normalizeGameExpertSettings(settings);
  const catalog = getGameExpertCatalog(normalized);
  const expertById = new Map(catalog.map((expert) => [expert.id, expert]));
  const rootDefinition =
    normalizeGameOrgNodeDefinition(
      definition,
      DEFAULT_GAME_ORG_DEFINITION.id,
    ) ?? DEFAULT_GAME_ORG_DEFINITION;
  return resolveNode(rootDefinition, expertById, locale, []);
}

export function flattenGameOrgNodes(
  root: ResolvedGameOrgNode,
): ResolvedGameOrgNode[] {
  return [root, ...root.children.flatMap(flattenGameOrgNodes)];
}

export function findGameOrgNode(
  root: ResolvedGameOrgNode,
  id: string,
): ResolvedGameOrgNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findGameOrgNode(child, id);
    if (match) return match;
  }
  return null;
}

function gameOrgSkillBinding(
  role: ResolvedGameOrgNode,
  skill: ResolvedGameOrgSkill,
): GameOrgSkillBinding {
  return {
    roleId: role.id,
    roleLabel: role.label,
    skillId: skill.id,
    skillLabel: skill.label,
    collaboratorExpertIds: [...(skill.collaboratorExpertIds ?? [])],
    collaboratorLabels: [...skill.collaboratorLabels],
    allowedCapabilities: [...skill.allowedCapabilities],
    capabilityLabels: [...skill.capabilityLabels],
  };
}

export function collectGameOrgSkillBindings(
  root: ResolvedGameOrgNode,
  nodeId: string,
): GameOrgSkillBindingOverview {
  const selectedNode = findGameOrgNode(root, nodeId);
  if (!selectedNode) return { own: [], incoming: [] };

  const selectedExpertIds = new Set(selectedNode.expertIds);
  const own = selectedNode.skills.map((skill) =>
    gameOrgSkillBinding(selectedNode, skill),
  );
  const incoming = flattenGameOrgNodes(root)
    .filter((node) => node.id !== selectedNode.id)
    .flatMap((node) =>
      node.skills
        .filter((skill) =>
          (skill.collaboratorExpertIds ?? []).some((expertId) =>
            selectedExpertIds.has(expertId),
          ),
        )
        .map((skill) => gameOrgSkillBinding(node, skill)),
    );

  return { own, incoming };
}

export function routeGameOrgAssetRequest(
  root: ResolvedGameOrgNode,
  nodeId: string,
  text: string,
): AssetRequestRoute | null {
  const node = findGameOrgNode(root, nodeId);
  if (!node) return null;
  return routeAssetRequest({
    text,
    roleLabel: node.label,
    capabilityIds: node.allowedCapabilities,
  });
}

function normalizedSearchText(values: readonly string[]): string {
  return values.join(" ").toLocaleLowerCase();
}

function uniqueTerms(values: readonly string[]): string[] {
  return uniqueStrings(values.map((value) => value.toLocaleLowerCase()));
}

function cjkBigrams(value: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    out.push(value.slice(index, index + 2));
  }
  return out;
}

const GAME_ORG_QUERY_EXPANSIONS: Array<{
  triggers: readonly string[];
  terms: readonly string[];
}> = [
  {
    triggers: ["攻击", "战斗", "打击", "连招", "伤害", "combat", "attack"],
    terms: ["玩法", "机制", "状态机", "输入", "反馈", "手感", "客户端", "动画"],
  },
  {
    triggers: ["性能", "帧率", "卡顿", "内存", "加载", "fps", "performance"],
    terms: [
      "性能预算",
      "性能排查",
      "剖析",
      "优化",
      "cpu",
      "gpu",
      "内存",
      "加载",
    ],
  },
  {
    triggers: ["美术", "原画", "shader", "特效", "材质", "贴图"],
    terms: ["美术", "场景", "特效", "shader", "规格", "可读性"],
  },
  {
    triggers: ["生成", "制作", "资产", "素材", "asset"],
    terms: [
      "asset request",
      "资产请求",
      "生图",
      "sprite",
      "mesh",
      "ui",
      "music",
    ],
  },
  {
    triggers: ["sprite", "spritesheet", "精灵", "精灵图", "序列帧", "动作帧"],
    terms: ["sprite", "spritesheet", "精灵图", "角色", "动画", "美术"],
  },
  {
    triggers: ["图片", "概念图", "原画", "图标", "贴图", "image", "concept"],
    terms: ["生图", "概念图", "原画", "图标", "贴图", "美术"],
  },
  {
    triggers: ["mesh", "模型", "建模", "glb", "gltf", "3d", "三维"],
    terms: ["mesh", "建模", "3d", "技术美术", "场景", "角色"],
  },
  {
    triggers: ["ui", "hud", "界面", "菜单", "控件"],
    terms: ["ui", "界面", "hud", "ux", "图标"],
  },
  {
    triggers: ["音乐", "bgm", "配乐", "音效", "语音", "配音", "audio"],
    terms: ["music", "音频", "音乐", "音效", "语音", "配音"],
  },
  {
    triggers: ["测试", "bug", "验收", "回归", "qa"],
    terms: ["qa", "测试", "验收", "回归", "复现", "质量"],
  },
  {
    triggers: ["联网", "后端", "同步", "服务器", "network", "backend"],
    terms: ["联网", "后端", "同步", "安全", "服务器", "接口"],
  },
  {
    triggers: ["关卡", "地图", "路径", "引导", "level"],
    terms: ["关卡", "路径", "引导", "节奏", "空间", "难度"],
  },
];

function extractRecommendationTerms(query: string): Map<string, number> {
  const normalized = query.toLocaleLowerCase();
  const terms = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const trimmed = term.trim().toLocaleLowerCase();
    if (trimmed.length < 2) return;
    terms.set(trimmed, Math.max(terms.get(trimmed) ?? 0, weight));
  };

  const parts = normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [];
  for (const part of parts) {
    add(part, 1);
    if (/^[\p{Script=Han}]+$/u.test(part) && part.length > 2) {
      for (const gram of cjkBigrams(part)) add(gram, 0.72);
    }
  }

  for (const expansion of GAME_ORG_QUERY_EXPANSIONS) {
    if (!expansion.triggers.some((trigger) => normalized.includes(trigger)))
      continue;
    for (const term of expansion.terms) add(term, 0.62);
  }

  return terms;
}

function scoreRecommendationTerm(
  term: string,
  weight: number,
  texts: {
    roleLabel: string;
    roleBody: string;
    skillLabel: string;
    skillBody: string;
    collaboratorBody: string;
    capabilityBody: string;
  },
): number {
  let score = 0;
  if (texts.skillLabel.includes(term)) score += 130 * weight;
  if (texts.skillBody.includes(term)) score += 74 * weight;
  if (texts.roleLabel.includes(term)) score += 72 * weight;
  if (texts.roleBody.includes(term)) score += 36 * weight;
  if (texts.capabilityBody.includes(term)) score += 92 * weight;
  if (texts.collaboratorBody.includes(term)) score += 22 * weight;
  return score;
}

export function recommendGameOrgSkills(
  root: ResolvedGameOrgNode,
  query: string,
  options: RecommendGameOrgSkillsOptions = {},
): GameOrgSkillRecommendation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const terms = extractRecommendationTerms(normalizedQuery);
  if (terms.size === 0) return [];

  const recommendations = flattenGameOrgNodes(root).flatMap((node) => {
    const roleLabel = normalizedSearchText([
      node.label,
      node.id,
      node.path.join(" "),
    ]);
    const roleBody = normalizedSearchText([
      node.summary,
      node.role,
      node.profile.position,
      ...node.profile.responsibilities,
      ...node.profile.scenarios,
      ...node.profile.deliverables,
      ...node.profile.collaborators,
      ...node.groupLabels,
      ...node.expertIds,
      ...node.experts.flatMap((expert) => [
        expert.id,
        expert.name,
        expert.summary,
        expert.role,
        ...expert.triggers,
      ]),
    ]);

    return node.skills.map((skill) => {
      const skillLabel = normalizedSearchText([skill.label, skill.id]);
      const skillBody = normalizedSearchText([
        skill.summary,
        skill.prompt,
        skill.protocol.triggerConditions,
        skill.protocol.inputs,
        ...skill.protocol.executionSteps,
        skill.protocol.toolsAndResources,
        skill.protocol.outputs,
        skill.protocol.acceptanceCriteria,
      ]);
      const capabilityBody = normalizedSearchText([
        ...skill.allowedCapabilities,
        ...skill.capabilityLabels,
        ...skill.capabilities.flatMap((capability) => [
          capability.id,
          capability.label,
          capability.assetType,
          capability.command,
          capability.modeCommand ?? "",
          capability.useWhen,
          ...capability.intentKeywords,
          ...capability.inputRequirements,
          ...capability.outputArtifacts,
          ...capability.acceptanceCriteria,
        ]),
      ]);
      const collaboratorBody = normalizedSearchText([
        ...(skill.collaboratorExpertIds ?? []),
        ...skill.collaboratorLabels,
      ]);
      const matchedTerms: string[] = [];
      let score = 0;

      for (const [term, weight] of terms) {
        const termScore = scoreRecommendationTerm(term, weight, {
          roleLabel,
          roleBody,
          skillLabel,
          skillBody,
          collaboratorBody,
          capabilityBody,
        });
        if (termScore <= 0) continue;
        score += termScore;
        matchedTerms.push(term);
      }

      if (
        skillBody.includes(normalizedQuery) ||
        skillLabel.includes(normalizedQuery)
      ) {
        score += 180;
      }
      if (
        roleBody.includes(normalizedQuery) ||
        roleLabel.includes(normalizedQuery)
      ) {
        score += 88;
      }

      return {
        roleId: node.id,
        roleLabel: node.label,
        rolePath: [...node.path],
        skillId: skill.id,
        skillLabel: skill.label,
        skillSummary: skill.summary,
        commandText: skill.commandText,
        collaboratorLabels: [...skill.collaboratorLabels],
        allowedCapabilities: [...skill.allowedCapabilities],
        capabilityLabels: [...skill.capabilityLabels],
        score,
        matchedTerms: uniqueTerms(matchedTerms),
      };
    });
  });

  return recommendations
    .filter((recommendation) => recommendation.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit ?? 5);
}

function taskPlanReason(
  recommendation: GameOrgSkillRecommendation,
  locale: Locale,
): string {
  const terms = recommendation.matchedTerms.slice(0, 3);
  if (locale !== "zh-CN") {
    return terms.length > 0
      ? `Matched ${terms.join(", ")} and falls under ${recommendation.roleLabel}.`
      : `Falls under ${recommendation.roleLabel}.`;
  }
  return terms.length > 0
    ? `命中「${terms.join("、")}」，属于「${recommendation.roleLabel}」职责范围。`
    : `属于「${recommendation.roleLabel}」职责范围。`;
}

function taskPlanDeliverable(
  recommendation: GameOrgSkillRecommendation,
  locale: Locale,
): string {
  if (locale !== "zh-CN") {
    return (
      recommendation.skillSummary ||
      `${recommendation.skillLabel} deliverable and handoff notes.`
    );
  }
  return (
    recommendation.skillSummary ||
    `「${recommendation.skillLabel}」对应的产出物和交接说明。`
  );
}

function formatGameOrgTaskPlanPrompt(
  query: string,
  steps: readonly GameOrgTaskPlanStep[],
  locale: Locale,
): string {
  if (locale !== "zh-CN") {
    const lines = steps.map(
      (step) =>
        `${step.order}. ${step.roleLabel} / ${step.skillLabel}: ${step.deliverable}`,
    );
    return [
      `Create a multi-lens guide for: ${query}`,
      "",
      "Use these role Skills as reference lenses:",
      ...lines,
      "",
      "For each lens, include focus, inputs, suggested actions, dependencies, risks, deliverables, and acceptance criteria. The main model decides whether and how to split or execute the work.",
    ].join("\n");
  }

  const lines = steps.map(
    (step) =>
      `${step.order}. ${step.roleLabel} / ${step.skillLabel}：${step.deliverable}`,
  );
  return [
    `请为以下任务生成多视角参考建议：${query}`,
    "",
    "参考这些岗位 Skill：",
    ...lines,
    "",
    "每个视角都要包含关注点、输入、建议动作、依赖、风险、产出物和验收标准。具体是否拆分任务、如何执行，由当前编程模型根据需求自行决定。",
  ].join("\n");
}

function formatGameOrgTaskPlanDocument(
  query: string,
  steps: readonly GameOrgTaskPlanStep[],
  locale: Locale,
): string {
  if (steps.length === 0) return "";

  if (locale !== "zh-CN") {
    return [
      `# Multi-lens Guide: ${query}`,
      "",
      ...steps.flatMap((step) => [
        `## Lens ${step.order}: ${step.roleLabel} / ${step.skillLabel}`,
        "",
        `- Role path: ${step.rolePath.join(" / ")}`,
        `- Reason: ${step.reason}`,
        `- Deliverable: ${step.deliverable}`,
        `- Acceptance criteria: ${step.acceptanceCriteria}`,
        `- Collaborators: ${step.collaboratorLabels.join(", ") || "None"}`,
        `- Matched terms: ${step.matchedTerms.join(", ") || "None"}`,
        "",
      ]),
    ].join("\n");
  }

  return [
    `# 多视角参考建议：${query}`,
    "",
    ...steps.flatMap((step) => [
      `## 视角 ${step.order}：${step.roleLabel} / ${step.skillLabel}`,
      "",
      `- 岗位路径：${step.rolePath.join(" / ")}`,
      `- 推荐理由：${step.reason}`,
      `- 产出物：${step.deliverable}`,
      `- 验收标准：${step.acceptanceCriteria}`,
      `- 关联视角：${step.collaboratorLabels.join("、") || "暂无"}`,
      `- 命中词：${step.matchedTerms.join("、") || "暂无"}`,
      "",
    ]),
  ].join("\n");
}

function formatGameOrgTaskPlanChecklist(
  query: string,
  steps: readonly GameOrgTaskPlanStep[],
  locale: Locale,
): string {
  if (steps.length === 0) return "";

  if (locale !== "zh-CN") {
    return [
      `# Lens Checklist: ${query}`,
      "",
      ...steps.flatMap((step) => [
        `- [ ] Lens ${step.order}: ${step.roleLabel} / ${step.skillLabel}`,
        `  - Deliverable: ${step.deliverable}`,
        `  - Acceptance: ${step.acceptanceCriteria}`,
        `  - Related lenses: ${step.collaboratorLabels.join(", ") || "None"}`,
      ]),
    ].join("\n");
  }

  return [
    `# 视角检查清单：${query}`,
    "",
    ...steps.flatMap((step) => [
      `- [ ] 视角 ${step.order}：${step.roleLabel} / ${step.skillLabel}`,
      `  - 产出物：${step.deliverable}`,
      `  - 验收：${step.acceptanceCriteria}`,
      `  - 关联视角：${step.collaboratorLabels.join("、") || "暂无"}`,
    ]),
  ].join("\n");
}

export function planGameOrgTask(
  root: ResolvedGameOrgNode,
  query: string,
  options: PlanGameOrgTaskOptions = {},
): GameOrgTaskPlan {
  const trimmedQuery = query.trim();
  const locale = options.locale ?? "zh-CN";
  if (!trimmedQuery) {
    return {
      query: "",
      steps: [],
      commandText: "",
      documentText: "",
      checklistText: "",
    };
  }

  const targetLimit = Math.max(1, options.limit ?? 4);
  const recommendations = recommendGameOrgSkills(root, trimmedQuery, {
    limit: Math.max(targetLimit * 3, 8),
  });
  const selected: GameOrgSkillRecommendation[] = [];
  const usedRoles = new Set<string>();
  const usedSkills = new Set<string>();

  for (const recommendation of recommendations) {
    if (selected.length >= targetLimit) break;
    const skillKey = `${recommendation.roleId}:${recommendation.skillId}`;
    if (usedSkills.has(skillKey)) continue;
    if (
      usedRoles.has(recommendation.roleId) &&
      selected.length < targetLimit - 1
    ) {
      continue;
    }
    selected.push(recommendation);
    usedRoles.add(recommendation.roleId);
    usedSkills.add(skillKey);
  }

  for (const recommendation of recommendations) {
    if (selected.length >= targetLimit) break;
    const skillKey = `${recommendation.roleId}:${recommendation.skillId}`;
    if (usedSkills.has(skillKey)) continue;
    selected.push(recommendation);
    usedRoles.add(recommendation.roleId);
    usedSkills.add(skillKey);
  }

  const steps = selected.map<GameOrgTaskPlanStep>((recommendation, index) => ({
    order: index + 1,
    roleId: recommendation.roleId,
    roleLabel: recommendation.roleLabel,
    rolePath: [...recommendation.rolePath],
    skillId: recommendation.skillId,
    skillLabel: recommendation.skillLabel,
    skillSummary: recommendation.skillSummary,
    commandText: recommendation.commandText,
    collaboratorLabels: [...recommendation.collaboratorLabels],
    allowedCapabilities: [...recommendation.allowedCapabilities],
    capabilityLabels: [...recommendation.capabilityLabels],
    matchedTerms: [...recommendation.matchedTerms],
    reason: taskPlanReason(recommendation, locale),
    deliverable: taskPlanDeliverable(recommendation, locale),
    acceptanceCriteria:
      locale === "zh-CN"
        ? "产出可执行、职责边界清楚、风险明确，并包含可验证的验收口径。"
        : "The output is actionable, scoped, risk-aware, and has verifiable acceptance criteria.",
    score: recommendation.score,
  }));

  const commandText =
    steps.length > 0
      ? formatGameOrgTaskPlanPrompt(trimmedQuery, steps, locale)
      : "";
  const documentText =
    steps.length > 0
      ? formatGameOrgTaskPlanDocument(trimmedQuery, steps, locale)
      : "";
  const checklistText =
    steps.length > 0
      ? formatGameOrgTaskPlanChecklist(trimmedQuery, steps, locale)
      : "";

  return {
    query: trimmedQuery,
    steps,
    commandText,
    documentText,
    checklistText,
  };
}
