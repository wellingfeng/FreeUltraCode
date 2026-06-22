import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Accessibility,
  AudioLines,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Brush,
  Bug,
  ChevronDown,
  ChevronRight,
  Check,
  Code2,
  Copy,
  Cpu,
  Crown,
  Database,
  Drama,
  Gamepad2,
  Gauge,
  Globe2,
  Hash,
  Image,
  Languages,
  Lightbulb,
  LocateFixed,
  Map as MapIcon,
  Megaphone,
  Monitor,
  Music,
  Paintbrush,
  PenLine,
  Pencil,
  Plus,
  RotateCcw,
  Rocket,
  Search,
  Server,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Trees,
  Users,
  Wand2,
  X,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  cloneGameOrgDefinition,
  collectGameOrgSkillBindings,
  createDefaultGameOrgSkillProtocol,
  GAME_ORG_NODE_ICONS,
  buildGameOrgTree,
  findGameOrgNode,
  flattenGameOrgNodes,
  loadGameOrgDefinition,
  resetGameOrgDefinition,
  saveGameOrgDefinition,
  type GameOrgNodeDefinition,
  type GameOrgNodeIcon,
  type GameOrgRoleProfile,
  type GameOrgSkillBinding,
  type GameOrgSkillDefinition,
  type GameOrgSkillProtocol,
  type ResolvedGameOrgNode,
  type ResolvedGameOrgSkill,
} from "@/lib/gameOrg";
import { normalizeGameAssetCapabilityIds } from "@/lib/gameAssetCapabilities";
import { localizedGameExpertName } from "@/lib/gameExpertI18n";
import type { Locale } from "@/lib/i18n";
import { useStore } from "@/store/useStore";

const SELECTED_NODE_STORAGE_KEY = "ultragamestudio.gameTeam.selectedNode.v1";
export const OPEN_GAME_TEAM_DETAILS_EVENT = "ugs:open-game-team-details";
export interface OpenGameTeamDetailsEventDetail {
  nodeId?: string;
}

const GAME_TEAM_TEXT = {
  "zh-CN": {
    add: "新增",
    addChildRoleButton: "添加下级视角",
    addChildRoleTitle: "添加下级视角",
    addSkillTitle: "新增 Skill",
    bindingChildren: "下级视角",
    bindingCollaborators: "Skill 关联视角",
    bindingEmpty: "暂无",
    bindingIncoming: "被其它视角参考",
    bindingIncomingCount: "{count} 引用",
    bindingOverview: "绑定关系",
    bindingSkills: "视角绑定 Skill",
    cancel: "取消",
    capabilities: "可用能力",
    capabilitiesPlaceholder: "image, sprite, mesh, ui, music, speech, video",
    chartAria: "专家视角蓝图",
    childCountCollapsed: "已收起 {count}",
    childCountExpanded: "{count} 下级",
    close: "关闭",
    closeNodeEditorAria: "关闭岗位编辑",
    closeSkillEditorAria: "关闭 Skill 编辑",
    collaboratorIds: "关联视角 ID（逗号分隔）",
    collapseChildren: "收起下级",
    copySkillCommand: "复制 Skill 命令",
    copySkillCommandAria: "复制 {label} 命令",
    deleteRoleButton: "删除岗位",
    deleteSkill: "删除 Skill",
    deleteSkillAria: "删除 {label}",
    editRoleButton: "编辑岗位",
    editRoleTitle: "编辑岗位",
    editSkill: "编辑 Skill",
    editSkillAria: "编辑 {label}",
    editSkillTitle: "编辑 Skill",
    expandChildren: "展开下级",
    expertIds: "关联视角 ID（逗号分隔）",
    experts: "关联视角",
    icon: "图标",
    insertCommand: "插入命令：{command}",
    levelDeveloper: "基层开发",
    levelDirector: "直属总监",
    levelGroup: "小组长 / 职能组",
    levelLead: "制作人视角",
    locateAria: "定位 {label}",
    name: "名称",
    newRole: "新岗位",
    newSkill: "新 Skill",
    noMatches: "没有匹配的岗位",
    noSkills: "暂无 Skill",
    nodeRolePlaceholder: "更完整的职责说明",
    nodeSummaryPlaceholder: "这个岗位视角的职责摘要",
    peopleCount: "{count} 视角",
    promptPlaceholder: "插入输入框时使用的完整提示词",
    profileCollaborators: "关联视角",
    profileCollaboratorsPlaceholder: "每行一个相关岗位或专家视角",
    profileDeliverables: "主要产出",
    profileDeliverablesPlaceholder: "每行一个交付物或检查结果",
    profilePosition: "岗位定位",
    profilePositionPlaceholder: "这个岗位在组织中的定位",
    profileResponsibilities: "核心职责",
    profileResponsibilitiesPlaceholder: "每行一条核心职责",
    profileScenarios: "适用场景",
    profileScenariosPlaceholder: "每行一个适用任务场景",
    protocolAcceptance: "验收标准",
    protocolAcceptancePlaceholder: "怎样判断这个 Skill 的结果合格",
    protocolInputs: "输入",
    protocolInputsPlaceholder: "需要用户需求、项目上下文、文件、素材或约束",
    protocolOutputs: "输出",
    protocolOutputsPlaceholder:
      "方案、代码变更、素材清单、测试结果或其它交付物",
    protocolSteps: "建议步骤",
    protocolStepsPlaceholder: "每行一个建议步骤",
    protocolTools: "工具/资源",
    protocolToolsPlaceholder: "当前工作区、引擎工具、文件系统、联网检索等",
    protocolTrigger: "触发条件",
    protocolTriggerPlaceholder: "什么情况应该参考这个 Skill",
    resetTemplateButton: "恢复默认组织模板",
    responsibilities: "职责",
    role: "职责",
    roleId: "岗位 ID",
    roleName: "岗位名称",
    roleNamePlaceholder: "技术总监",
    rootDeleteDisabled: "根岗位不能删除",
    save: "保存",
    saveFallbackPrompt:
      "请参考 {label} 视角，并给出可执行建议、风险和验收标准。",
    searchAria: "搜索组织岗位",
    searchPlaceholder: "搜索岗位、职责、视角或 Skill",
    skillNamePlaceholder: "发起功能开发",
    skillSummaryPlaceholder: "这个 Skill 的用途",
    summary: "摘要",
  },
  "en-US": {
    add: "Add",
    addChildRoleButton: "Add child lens",
    addChildRoleTitle: "Add Child Lens",
    addSkillTitle: "New Skill",
    bindingChildren: "Child Lenses",
    bindingCollaborators: "Related Skill Lenses",
    bindingEmpty: "None",
    bindingIncoming: "Referenced By Other Lenses",
    bindingIncomingCount: "{count} refs",
    bindingOverview: "Bindings",
    bindingSkills: "Lens-bound Skills",
    cancel: "Cancel",
    capabilities: "Capabilities",
    capabilitiesPlaceholder: "image, sprite, mesh, ui, music, speech, video",
    chartAria: "Expert lens blueprint",
    childCountCollapsed: "Hidden {count}",
    childCountExpanded: "{count} child lenses",
    close: "Close",
    closeNodeEditorAria: "Close role editor",
    closeSkillEditorAria: "Close Skill editor",
    collaboratorIds: "Related lens IDs (comma separated)",
    collapseChildren: "Collapse child lenses",
    copySkillCommand: "Copy Skill command",
    copySkillCommandAria: "Copy {label} command",
    deleteRoleButton: "Delete role",
    deleteSkill: "Delete Skill",
    deleteSkillAria: "Delete {label}",
    editRoleButton: "Edit role",
    editRoleTitle: "Edit Role",
    editSkill: "Edit Skill",
    editSkillAria: "Edit {label}",
    editSkillTitle: "Edit Skill",
    expandChildren: "Expand child lenses",
    expertIds: "Lens IDs (comma separated)",
    experts: "Linked Lenses",
    icon: "Icon",
    insertCommand: "Insert command: {command}",
    levelDeveloper: "Individual Contributor",
    levelDirector: "Direct Director",
    levelGroup: "Lead / Functional Group",
    levelLead: "Producer Lens",
    locateAria: "Locate {label}",
    name: "Name",
    newRole: "New Role",
    newSkill: "New Skill",
    noMatches: "No matching roles",
    noSkills: "No Skills",
    nodeRolePlaceholder: "Full responsibility description",
    nodeSummaryPlaceholder: "Short summary of this role lens",
    peopleCount: "{count} lenses",
    promptPlaceholder: "Full prompt inserted into the composer",
    profileCollaborators: "Related Lenses",
    profileCollaboratorsPlaceholder: "One related role or expert lens per line",
    profileDeliverables: "Deliverables",
    profileDeliverablesPlaceholder: "One deliverable or check result per line",
    profilePosition: "Positioning",
    profilePositionPlaceholder: "Where this role sits in the organization",
    profileResponsibilities: "Core Responsibilities",
    profileResponsibilitiesPlaceholder: "One core responsibility per line",
    profileScenarios: "Use Cases",
    profileScenariosPlaceholder: "One task scenario per line",
    protocolAcceptance: "Acceptance Criteria",
    protocolAcceptancePlaceholder:
      "How to decide this Skill result is good enough",
    protocolInputs: "Inputs",
    protocolInputsPlaceholder:
      "User request, project context, files, assets, or constraints",
    protocolOutputs: "Outputs",
    protocolOutputsPlaceholder:
      "Plan, code changes, asset list, test result, or other deliverable",
    protocolSteps: "Suggested Steps",
    protocolStepsPlaceholder: "One suggested step per line",
    protocolTools: "Tools / Resources",
    protocolToolsPlaceholder:
      "Workspace, engine tools, filesystem, web research, etc.",
    protocolTrigger: "Trigger Conditions",
    protocolTriggerPlaceholder: "When this Skill should be referenced",
    resetTemplateButton: "Restore default organization template",
    responsibilities: "Responsibilities",
    role: "Role",
    roleId: "Role ID",
    roleName: "Role Name",
    roleNamePlaceholder: "Technical Director",
    rootDeleteDisabled: "The root role cannot be deleted",
    save: "Save",
    saveFallbackPrompt:
      "Use the {label} lens and provide actionable recommendations, risks, and acceptance criteria.",
    searchAria: "Search organization roles",
    searchPlaceholder: "Search roles, responsibilities, experts, or Skills",
    skillNamePlaceholder: "Start Feature Development",
    skillSummaryPlaceholder: "What this Skill is used for",
    summary: "Summary",
  },
} as const;

type GameTeamTextKey = keyof (typeof GAME_TEAM_TEXT)["zh-CN"];

function gameTeamText(
  locale: Locale,
  key: GameTeamTextKey,
  values: Record<string, string | number> = {},
): string {
  const dictionary =
    locale === "zh-CN" ? GAME_TEAM_TEXT["zh-CN"] : GAME_TEAM_TEXT["en-US"];
  return dictionary[key].replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

const NODE_ICON_BY_KIND: Record<GameOrgNodeIcon, LucideIcon> = {
  producer: Crown,
  design: Lightbulb,
  gameplay: Gamepad2,
  systems: SlidersHorizontal,
  economy: Hash,
  level: MapIcon,
  narrative: BookOpen,
  writing: PenLine,
  world: Globe2,
  tech: Cpu,
  client: Monitor,
  engine: Code2,
  backend: Server,
  "technical-art": Wand2,
  tools: Wrench,
  data: Database,
  art: Paintbrush,
  concept: Brush,
  character: Drama,
  environment: Trees,
  ui: Image,
  vfx: Sparkles,
  audio: Music,
  sound: AudioLines,
  qa: Bug,
  performance: Gauge,
  accessibility: Accessibility,
  release: Rocket,
  community: Megaphone,
  localization: Languages,
  analytics: BarChart3,
  team: Users,
};

const NODE_ICON_TONE_BY_KIND: Record<GameOrgNodeIcon, string> = {
  producer: "text-accent",
  design: "text-accent-3",
  gameplay: "text-accent-3",
  systems: "text-accent-3",
  economy: "text-accent-3",
  level: "text-accent-3",
  narrative: "text-accent-3",
  writing: "text-accent-3",
  world: "text-accent-3",
  tech: "text-accent-2",
  client: "text-accent-2",
  engine: "text-accent-2",
  backend: "text-accent-2",
  "technical-art": "text-accent-4",
  tools: "text-accent-2",
  data: "text-accent-2",
  art: "text-accent-4",
  concept: "text-accent-4",
  character: "text-accent-4",
  environment: "text-accent-4",
  ui: "text-accent-4",
  vfx: "text-accent-4",
  audio: "text-accent-3",
  sound: "text-accent-3",
  qa: "text-fg-dim",
  performance: "text-accent-3",
  accessibility: "text-accent-2",
  release: "text-accent",
  community: "text-accent",
  localization: "text-accent",
  analytics: "text-accent-2",
  team: "text-accent",
};

function GameOrgIcon({
  node,
  size = 14,
  className,
}: {
  node: ResolvedGameOrgNode;
  size?: number;
  className?: string;
}) {
  const Icon = NODE_ICON_BY_KIND[node.icon] ?? Users;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      className={cn("shrink-0", NODE_ICON_TONE_BY_KIND[node.icon], className)}
    />
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded border border-border-soft bg-bg/50 px-1.5 py-0.5 text-[10px] leading-none text-fg-faint">
      <span className="truncate">{children}</span>
    </span>
  );
}

function readSelectedNodeId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_NODE_STORAGE_KEY);
  } catch {
    // localStorage 不可用 / 配额读取异常时静默降级，绝不让选中态读取打断渲染。
    return null;
  }
}

function writeSelectedNodeId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_NODE_STORAGE_KEY, id);
  } catch {
    // 配额写满（QuotaExceededError）等异常下静默忽略：持久化选中节点只是“记住上次
    // 选择”的锦上添花，绝不能因为它抛错而中断点击处理函数里后续的 onSelect /
    // 派发 ugs:open-game-team-details，否则桌面端 localStorage 一满，点岗位节点就
    // 整个没反应、右侧详情面板永远打不开。
  }
}

function findNodeDefinition(
  root: GameOrgNodeDefinition,
  id: string,
): GameOrgNodeDefinition | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const match = findNodeDefinition(child, id);
    if (match) return match;
  }
  return null;
}

function findParentNodeDefinition(
  root: GameOrgNodeDefinition,
  id: string,
): GameOrgNodeDefinition | null {
  for (const child of root.children ?? []) {
    if (child.id === id) return root;
    const match = findParentNodeDefinition(child, id);
    if (match) return match;
  }
  return null;
}

function collectNodeDefinitionIds(root: GameOrgNodeDefinition): Set<string> {
  const ids = new Set<string>();
  const visit = (node: GameOrgNodeDefinition) => {
    ids.add(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return ids;
}

function uniqueId(
  existing: ReadonlySet<string>,
  preferred: string,
  currentId?: string,
): string {
  const base = (
    preferred.trim() ||
    currentId ||
    `item-${Date.now().toString(36)}`
  )
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (base === currentId || !existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function updateNodeDefinition(
  root: GameOrgNodeDefinition,
  id: string,
  updater: (node: GameOrgNodeDefinition) => GameOrgNodeDefinition,
): GameOrgNodeDefinition {
  if (root.id === id) return updater(cloneGameOrgDefinition(root));
  return {
    ...root,
    children: (root.children ?? []).map((child) =>
      updateNodeDefinition(child, id, updater),
    ),
  };
}

function removeNodeDefinition(
  root: GameOrgNodeDefinition,
  id: string,
): GameOrgNodeDefinition {
  return {
    ...root,
    children: (root.children ?? [])
      .filter((child) => child.id !== id)
      .map((child) => removeNodeDefinition(child, id)),
  };
}

function csvFromStrings(values: readonly string[] | undefined): string {
  return (values ?? []).join(", ");
}

function stringsFromCsv(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,，\n]/u)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function linesFromText(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function textFromLines(values: readonly string[] | undefined): string {
  return (values ?? []).join("\n");
}

interface NodeDraft {
  id: string;
  label: string;
  icon: GameOrgNodeIcon;
  summary: string;
  role: string;
  position: string;
  responsibilities: string;
  scenarios: string;
  deliverables: string;
  collaborators: string;
  expertIds: string;
}

interface SkillDraft {
  id: string;
  label: string;
  summary: string;
  prompt: string;
  collaboratorExpertIds: string;
  allowedCapabilities: string;
  triggerConditions: string;
  inputs: string;
  executionSteps: string;
  toolsAndResources: string;
  outputs: string;
  acceptanceCriteria: string;
}

function completeRoleProfile(
  definition: GameOrgNodeDefinition,
  resolved: ResolvedGameOrgNode,
): GameOrgRoleProfile {
  const profile = definition.profile;
  return {
    position: profile?.position || resolved.profile.position,
    responsibilities:
      profile && profile.responsibilities.length > 0
        ? profile.responsibilities
        : resolved.profile.responsibilities,
    scenarios:
      profile && profile.scenarios.length > 0
        ? profile.scenarios
        : resolved.profile.scenarios,
    deliverables:
      profile && profile.deliverables.length > 0
        ? profile.deliverables
        : resolved.profile.deliverables,
    collaborators:
      profile && profile.collaborators.length > 0
        ? profile.collaborators
        : resolved.profile.collaborators,
  };
}

function nodeDraftFromDefinition(
  definition: GameOrgNodeDefinition,
  resolved: ResolvedGameOrgNode,
): NodeDraft {
  const profile = completeRoleProfile(definition, resolved);
  return {
    id: definition.id,
    label: definition.label,
    icon: definition.icon ?? "team",
    summary: definition.summary ?? "",
    role: definition.role ?? "",
    position: profile.position,
    responsibilities: textFromLines(profile.responsibilities),
    scenarios: textFromLines(profile.scenarios),
    deliverables: textFromLines(profile.deliverables),
    collaborators: textFromLines(profile.collaborators),
    expertIds: csvFromStrings(definition.expertIds),
  };
}

function completeSkillProtocol(
  skill: Pick<GameOrgSkillDefinition, "label" | "summary" | "prompt"> & {
    protocol?: GameOrgSkillProtocol;
  },
  locale: Locale,
): GameOrgSkillProtocol {
  const fallback = createDefaultGameOrgSkillProtocol(skill, locale);
  const protocol = skill.protocol;
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

function skillDraftFromDefinition(
  skill: GameOrgSkillDefinition,
  locale: Locale,
): SkillDraft {
  const protocol = completeSkillProtocol(skill, locale);
  return {
    id: skill.id,
    label: skill.label,
    summary: skill.summary,
    prompt: skill.prompt,
    collaboratorExpertIds: csvFromStrings(skill.collaboratorExpertIds),
    allowedCapabilities: csvFromStrings(skill.allowedCapabilities),
    triggerConditions: protocol.triggerConditions,
    inputs: protocol.inputs,
    executionSteps: protocol.executionSteps.join("\n"),
    toolsAndResources: protocol.toolsAndResources,
    outputs: protocol.outputs,
    acceptanceCriteria: protocol.acceptanceCriteria,
  };
}

function skillDefinitionFromResolved(
  skill: ResolvedGameOrgSkill,
): GameOrgSkillDefinition {
  return {
    id: skill.id,
    label: skill.label,
    summary: skill.summary,
    prompt: skill.prompt,
    protocol: {
      ...skill.protocol,
      executionSteps: [...skill.protocol.executionSteps],
    },
    collaboratorExpertIds: [...(skill.collaboratorExpertIds ?? [])],
    allowedCapabilities: [...skill.allowedCapabilities],
  };
}

function orgLevelLabel(level: number, locale: Locale): string {
  if (level === 0) return gameTeamText(locale, "levelLead");
  if (level === 1) return gameTeamText(locale, "levelDirector");
  if (level === 2) return gameTeamText(locale, "levelGroup");
  return gameTeamText(locale, "levelDeveloper");
}

function SkillButton({
  skill,
  onInsert,
  onCopy,
  onEdit,
  onRemove,
  copied,
  locale,
}: {
  skill: ResolvedGameOrgSkill;
  onInsert: (skill: ResolvedGameOrgSkill) => void;
  onCopy: (skill: ResolvedGameOrgSkill) => void;
  onEdit: (skill: ResolvedGameOrgSkill) => void;
  onRemove: (skill: ResolvedGameOrgSkill) => void;
  copied: boolean;
  locale: Locale;
}) {
  return (
    <div className="group rounded-md border border-border-soft bg-bg/30 transition-colors hover:border-accent/50 hover:bg-panel-2/50">
      <div className="flex min-w-0 items-stretch">
        <button
          type="button"
          onClick={() => onInsert(skill)}
          className="flex min-h-[46px] min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
          title={gameTeamText(locale, "insertCommand", {
            command: skill.commandText,
          })}
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/10 text-accent">
            <Wand2 size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-fg">
              {skill.label}
            </span>
            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-fg-faint">
              {skill.summary}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onCopy(skill)}
          title={gameTeamText(locale, "copySkillCommand")}
          aria-label={gameTeamText(locale, "copySkillCommandAria", {
            label: skill.label,
          })}
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-soft text-fg-faint transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {copied ? (
            <Check size={14} className="text-accent" />
          ) : (
            <Copy size={14} />
          )}
        </button>
        <button
          type="button"
          onClick={() => onEdit(skill)}
          title={gameTeamText(locale, "editSkill")}
          aria-label={gameTeamText(locale, "editSkillAria", {
            label: skill.label,
          })}
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-soft text-fg-faint transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => onRemove(skill)}
          title={gameTeamText(locale, "deleteSkill")}
          aria-label={gameTeamText(locale, "deleteSkillAria", {
            label: skill.label,
          })}
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-soft text-fg-faint transition-colors hover:bg-panel hover:text-status-error focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-error"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {skill.collaboratorLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-border-soft/70 px-2.5 py-1.5">
          {skill.collaboratorLabels.slice(0, 5).map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
          {skill.collaboratorLabels.length > 5 && (
            <Chip>+{skill.collaboratorLabels.length - 5}</Chip>
          )}
        </div>
      )}
      {skill.capabilityLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-border-soft/70 px-2.5 py-1.5">
          {skill.capabilityLabels.map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function BindingChip({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  if (!onClick) {
    return (
      <span
        title={title}
        className="inline-flex max-w-full items-center rounded border border-border-soft bg-bg/30 px-1.5 py-1 text-[11px] leading-none text-fg-dim"
      >
        <span className="truncate">{children}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex max-w-full items-center rounded border border-border-soft bg-bg/30 px-1.5 py-1 text-left text-[11px] leading-none text-fg-dim transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

function BindingList({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold text-fg-faint">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function RoleBindingOverview({
  selectedNode,
  ownBindings,
  incomingBindings,
  onSelectNode,
  locale,
}: {
  selectedNode: ResolvedGameOrgNode;
  ownBindings: readonly GameOrgSkillBinding[];
  incomingBindings: readonly GameOrgSkillBinding[];
  onSelectNode: (id: string) => void;
  locale: Locale;
}) {
  const collaboratorLabels = Array.from(
    new Set(ownBindings.flatMap((binding) => binding.collaboratorLabels)),
  );
  const capabilityLabels = Array.from(
    new Set(ownBindings.flatMap((binding) => binding.capabilityLabels)),
  );

  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold text-fg-faint">
        {gameTeamText(locale, "bindingOverview")}
      </h4>
      <div className="space-y-2 rounded-md border border-border-soft bg-bg/20 p-2">
        <BindingList label={gameTeamText(locale, "bindingSkills")}>
          {ownBindings.length > 0 ? (
            ownBindings.map((binding) => (
              <BindingChip
                key={`${binding.roleId}:${binding.skillId}`}
                title={`${binding.roleLabel} / ${binding.skillId}`}
              >
                {binding.skillLabel}
              </BindingChip>
            ))
          ) : (
            <BindingChip>{gameTeamText(locale, "bindingEmpty")}</BindingChip>
          )}
        </BindingList>
        <BindingList label={gameTeamText(locale, "bindingCollaborators")}>
          {collaboratorLabels.length > 0 ? (
            collaboratorLabels.map((label) => (
              <BindingChip key={label}>{label}</BindingChip>
            ))
          ) : (
            <BindingChip>{gameTeamText(locale, "bindingEmpty")}</BindingChip>
          )}
        </BindingList>
        <BindingList label={gameTeamText(locale, "capabilities")}>
          {capabilityLabels.length > 0 ? (
            capabilityLabels.map((label) => (
              <BindingChip key={label}>{label}</BindingChip>
            ))
          ) : (
            <BindingChip>{gameTeamText(locale, "bindingEmpty")}</BindingChip>
          )}
        </BindingList>
        <BindingList label={gameTeamText(locale, "bindingIncoming")}>
          {incomingBindings.length > 0 ? (
            incomingBindings.map((binding) => (
              <BindingChip
                key={`${binding.roleId}:${binding.skillId}`}
                onClick={() => onSelectNode(binding.roleId)}
                title={`${binding.roleLabel} / ${binding.skillId}`}
              >
                {binding.roleLabel} / {binding.skillLabel}
              </BindingChip>
            ))
          ) : (
            <BindingChip>{gameTeamText(locale, "bindingEmpty")}</BindingChip>
          )}
        </BindingList>
        <BindingList label={gameTeamText(locale, "bindingChildren")}>
          {selectedNode.children.length > 0 ? (
            selectedNode.children.map((child) => (
              <BindingChip
                key={child.id}
                onClick={() => onSelectNode(child.id)}
                title={child.path.join(" / ")}
              >
                {child.label}
              </BindingChip>
            ))
          ) : (
            <BindingChip>{gameTeamText(locale, "bindingEmpty")}</BindingChip>
          )}
        </BindingList>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold text-fg-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClassName =
  "h-8 w-full rounded-md border border-border-soft bg-bg px-2 text-xs text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent";
const textareaClassName =
  "min-h-[58px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent";

function NodeEditor({
  draft,
  mode,
  onChange,
  onCancel,
  onSave,
  locale,
}: {
  draft: NodeDraft;
  mode: "edit" | "add";
  onChange: (patch: Partial<NodeDraft>) => void;
  onCancel: () => void;
  onSave: () => void;
  locale: Locale;
}) {
  return (
    <section className="rounded-md border border-border-soft bg-bg/30 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold text-fg">
          {gameTeamText(
            locale,
            mode === "edit" ? "editRoleTitle" : "addChildRoleTitle",
          )}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          title={gameTeamText(locale, "close")}
          aria-label={gameTeamText(locale, "closeNodeEditorAria")}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:bg-panel-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <X size={13} />
        </button>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Field label={gameTeamText(locale, "roleId")}>
            <input
              value={draft.id}
              onChange={(event) => onChange({ id: event.target.value })}
              className={inputClassName}
              placeholder="technical-director"
            />
          </Field>
          <Field label={gameTeamText(locale, "icon")}>
            <select
              value={draft.icon}
              onChange={(event) =>
                onChange({ icon: event.target.value as GameOrgNodeIcon })
              }
              className={inputClassName}
            >
              {GAME_ORG_NODE_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={gameTeamText(locale, "roleName")}>
          <input
            value={draft.label}
            onChange={(event) => onChange({ label: event.target.value })}
            className={inputClassName}
            placeholder={gameTeamText(locale, "roleNamePlaceholder")}
          />
        </Field>
        <Field label={gameTeamText(locale, "summary")}>
          <textarea
            value={draft.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
            className={textareaClassName}
            placeholder={gameTeamText(locale, "nodeSummaryPlaceholder")}
          />
        </Field>
        <Field label={gameTeamText(locale, "role")}>
          <textarea
            value={draft.role}
            onChange={(event) => onChange({ role: event.target.value })}
            className={textareaClassName}
            placeholder={gameTeamText(locale, "nodeRolePlaceholder")}
          />
        </Field>
        <Field label={gameTeamText(locale, "profilePosition")}>
          <textarea
            value={draft.position}
            onChange={(event) => onChange({ position: event.target.value })}
            className={textareaClassName}
            placeholder={gameTeamText(locale, "profilePositionPlaceholder")}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={gameTeamText(locale, "profileResponsibilities")}>
            <textarea
              value={draft.responsibilities}
              onChange={(event) =>
                onChange({ responsibilities: event.target.value })
              }
              className="min-h-[76px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent"
              placeholder={gameTeamText(
                locale,
                "profileResponsibilitiesPlaceholder",
              )}
            />
          </Field>
          <Field label={gameTeamText(locale, "profileScenarios")}>
            <textarea
              value={draft.scenarios}
              onChange={(event) => onChange({ scenarios: event.target.value })}
              className="min-h-[76px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent"
              placeholder={gameTeamText(locale, "profileScenariosPlaceholder")}
            />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={gameTeamText(locale, "profileDeliverables")}>
            <textarea
              value={draft.deliverables}
              onChange={(event) =>
                onChange({ deliverables: event.target.value })
              }
              className="min-h-[76px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent"
              placeholder={gameTeamText(
                locale,
                "profileDeliverablesPlaceholder",
              )}
            />
          </Field>
          <Field label={gameTeamText(locale, "profileCollaborators")}>
            <textarea
              value={draft.collaborators}
              onChange={(event) =>
                onChange({ collaborators: event.target.value })
              }
              className="min-h-[76px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent"
              placeholder={gameTeamText(
                locale,
                "profileCollaboratorsPlaceholder",
              )}
            />
          </Field>
        </div>
        <Field label={gameTeamText(locale, "expertIds")}>
          <input
            value={draft.expertIds}
            onChange={(event) => onChange({ expertIds: event.target.value })}
            className={inputClassName}
            placeholder="technical-director, qa-lead"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 items-center gap-1 rounded border border-border-soft bg-panel px-2 text-[11px] text-fg-faint transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={12} />
            {gameTeamText(locale, "cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex h-7 items-center gap-1 rounded border border-accent/50 bg-accent/15 px-2 text-[11px] text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <Check size={12} />
            {gameTeamText(locale, "save")}
          </button>
        </div>
      </div>
    </section>
  );
}

function SkillEditor({
  draft,
  mode,
  onChange,
  onCancel,
  onSave,
  locale,
}: {
  draft: SkillDraft;
  mode: "edit" | "add";
  onChange: (patch: Partial<SkillDraft>) => void;
  onCancel: () => void;
  onSave: () => void;
  locale: Locale;
}) {
  return (
    <section className="rounded-md border border-border-soft bg-bg/30 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold text-fg">
          {gameTeamText(
            locale,
            mode === "edit" ? "editSkillTitle" : "addSkillTitle",
          )}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          title={gameTeamText(locale, "close")}
          aria-label={gameTeamText(locale, "closeSkillEditorAria")}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:bg-panel-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <X size={13} />
        </button>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Skill ID">
            <input
              value={draft.id}
              onChange={(event) => onChange({ id: event.target.value })}
              className={inputClassName}
              placeholder="feature-development"
            />
          </Field>
          <Field label={gameTeamText(locale, "name")}>
            <input
              value={draft.label}
              onChange={(event) => onChange({ label: event.target.value })}
              className={inputClassName}
              placeholder={gameTeamText(locale, "skillNamePlaceholder")}
            />
          </Field>
        </div>
        <Field label={gameTeamText(locale, "summary")}>
          <textarea
            value={draft.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
            className={textareaClassName}
            placeholder={gameTeamText(locale, "skillSummaryPlaceholder")}
          />
        </Field>
        <Field label="Prompt">
          <textarea
            value={draft.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            className="min-h-[86px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent"
            placeholder={gameTeamText(locale, "promptPlaceholder")}
          />
        </Field>
        <Field label={gameTeamText(locale, "capabilities")}>
          <input
            value={draft.allowedCapabilities}
            onChange={(event) =>
              onChange({ allowedCapabilities: event.target.value })
            }
            className={inputClassName}
            placeholder={gameTeamText(locale, "capabilitiesPlaceholder")}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={gameTeamText(locale, "protocolTrigger")}>
            <textarea
              value={draft.triggerConditions}
              onChange={(event) =>
                onChange({ triggerConditions: event.target.value })
              }
              className={textareaClassName}
              placeholder={gameTeamText(locale, "protocolTriggerPlaceholder")}
            />
          </Field>
          <Field label={gameTeamText(locale, "protocolInputs")}>
            <textarea
              value={draft.inputs}
              onChange={(event) => onChange({ inputs: event.target.value })}
              className={textareaClassName}
              placeholder={gameTeamText(locale, "protocolInputsPlaceholder")}
            />
          </Field>
        </div>
        <Field label={gameTeamText(locale, "protocolSteps")}>
          <textarea
            value={draft.executionSteps}
            onChange={(event) =>
              onChange({ executionSteps: event.target.value })
            }
            className="min-h-[92px] w-full resize-y rounded-md border border-border-soft bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent"
            placeholder={gameTeamText(locale, "protocolStepsPlaceholder")}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={gameTeamText(locale, "protocolTools")}>
            <textarea
              value={draft.toolsAndResources}
              onChange={(event) =>
                onChange({ toolsAndResources: event.target.value })
              }
              className={textareaClassName}
              placeholder={gameTeamText(locale, "protocolToolsPlaceholder")}
            />
          </Field>
          <Field label={gameTeamText(locale, "protocolOutputs")}>
            <textarea
              value={draft.outputs}
              onChange={(event) => onChange({ outputs: event.target.value })}
              className={textareaClassName}
              placeholder={gameTeamText(locale, "protocolOutputsPlaceholder")}
            />
          </Field>
        </div>
        <Field label={gameTeamText(locale, "protocolAcceptance")}>
          <textarea
            value={draft.acceptanceCriteria}
            onChange={(event) =>
              onChange({ acceptanceCriteria: event.target.value })
            }
            className={textareaClassName}
            placeholder={gameTeamText(locale, "protocolAcceptancePlaceholder")}
          />
        </Field>
        <Field label={gameTeamText(locale, "collaboratorIds")}>
          <input
            value={draft.collaboratorExpertIds}
            onChange={(event) =>
              onChange({ collaboratorExpertIds: event.target.value })
            }
            className={inputClassName}
            placeholder="technical-director, qa-tester"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 items-center gap-1 rounded border border-border-soft bg-panel px-2 text-[11px] text-fg-faint transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={12} />
            {gameTeamText(locale, "cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex h-7 items-center gap-1 rounded border border-accent/50 bg-accent/15 px-2 text-[11px] text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <Check size={12} />
            {gameTeamText(locale, "save")}
          </button>
        </div>
      </div>
    </section>
  );
}

const ORG_CARD_WIDTH = 214;
const ORG_CARD_HEIGHT = 112;
const ORG_X_GAP = 48;
const ORG_Y_GAP = 170;
const ORG_SEARCH_LIMIT = 8;

interface OrgFlowNodeData extends Record<string, unknown> {
  node: ResolvedGameOrgNode;
  level: number;
  collapsed: boolean;
  incomingBindingCount: number;
  locale: Locale;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onOpenDetails?: (id: string) => void;
}

type OrgFlowNode = Node<OrgFlowNodeData>;
type OrgFlowEdge = Edge;

interface OrgLayoutTree {
  node: ResolvedGameOrgNode;
  level: number;
  width: number;
  children: OrgLayoutTree[];
  hiddenChildCount: number;
}

const orgNodeTypes: NodeTypes = { org: OrgFlowNodeCard };

function visibleOrgChildren(
  node: ResolvedGameOrgNode,
  collapsedNodeIds: ReadonlySet<string>,
): ResolvedGameOrgNode[] {
  return collapsedNodeIds.has(node.id) ? [] : node.children;
}

function measureOrgLayout(
  node: ResolvedGameOrgNode,
  collapsedNodeIds: ReadonlySet<string>,
  level = 0,
): OrgLayoutTree {
  const visibleChildren = visibleOrgChildren(node, collapsedNodeIds);
  const children = visibleChildren.map((child) =>
    measureOrgLayout(child, collapsedNodeIds, level + 1),
  );
  const childrenWidth =
    children.length === 0
      ? 0
      : children.reduce((sum, child) => sum + child.width, 0) +
        ORG_X_GAP * (children.length - 1);
  return {
    node,
    level,
    width: Math.max(ORG_CARD_WIDTH, childrenWidth),
    children,
    hiddenChildCount: node.children.length - visibleChildren.length,
  };
}

function orgLevelAccent(level: number): string {
  if (level === 0) return "var(--accent)";
  if (level === 1) return "var(--accent-2)";
  if (level === 2) return "var(--accent-3)";
  return "var(--accent-4)";
}

function findOrgAncestorIds(
  root: ResolvedGameOrgNode,
  targetId: string,
): string[] {
  const walk = (node: ResolvedGameOrgNode, path: string[]): string[] | null => {
    if (node.id === targetId) return path;
    for (const child of node.children) {
      const match = walk(child, [...path, node.id]);
      if (match) return match;
    }
    return null;
  };
  return walk(root, []) ?? [];
}

// 返回从根到目标节点（含目标）的整条路径节点。用于沿当前选中分支
// 逐级生成顶部"快捷找到岗位"行，从而支持任意层级（含第四级及更深）。
function findOrgPathNodes(
  root: ResolvedGameOrgNode,
  targetId: string,
): ResolvedGameOrgNode[] {
  const walk = (
    node: ResolvedGameOrgNode,
    trail: ResolvedGameOrgNode[],
  ): ResolvedGameOrgNode[] | null => {
    const next = [...trail, node];
    if (node.id === targetId) return next;
    for (const child of node.children) {
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []) ?? [root];
}

function orgNodeContains(node: ResolvedGameOrgNode, targetId: string): boolean {
  return Boolean(findGameOrgNode(node, targetId));
}

function roleProfileSearchParts(node: ResolvedGameOrgNode): string[] {
  return [
    node.profile.position,
    ...node.profile.responsibilities,
    ...node.profile.scenarios,
    ...node.profile.deliverables,
    ...node.profile.collaborators,
  ];
}

function orgSearchText(node: ResolvedGameOrgNode): string {
  return [
    node.label,
    node.id,
    node.summary,
    node.role,
    ...roleProfileSearchParts(node),
    node.path.join(" "),
    ...node.experts.flatMap((expert) => [
      expert.id,
      expert.name,
      expert.summary,
      expert.role,
      ...expert.triggers,
    ]),
    ...node.expertIds,
    ...node.groupLabels,
    ...node.capabilityLabels,
    ...node.allowedCapabilities,
    ...node.skills.flatMap((skill) => [
      skill.label,
      skill.summary,
      skill.id,
      ...skill.capabilityLabels,
      ...skill.allowedCapabilities,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function orgSearchScore(node: ResolvedGameOrgNode, query: string): number {
  const label = node.label.toLocaleLowerCase();
  const id = node.id.toLocaleLowerCase();
  const path = node.path.join(" ").toLocaleLowerCase();
  const expertText = [
    ...node.expertIds,
    ...node.experts.flatMap((expert) => [
      expert.id,
      expert.name,
      ...expert.triggers,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
  const skillText = node.skills
    .flatMap((skill) => [
      skill.label,
      skill.id,
      ...skill.capabilityLabels,
      ...skill.allowedCapabilities,
    ])
    .join(" ")
    .toLocaleLowerCase();
  const bodyText = [
    node.summary,
    node.role,
    ...roleProfileSearchParts(node),
    ...node.groupLabels,
    ...node.capabilityLabels,
    ...node.allowedCapabilities,
    ...node.experts.flatMap((expert) => [expert.summary, expert.role]),
    ...node.skills.flatMap((skill) => [
      skill.summary,
      ...skill.capabilities.map((capability) => capability.useWhen),
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();

  let score = 0;
  if (label === query) score += 1000;
  if (label.startsWith(query)) score += 760;
  if (label.includes(query)) score += 620;
  if (id.includes(query)) score += 520;
  if (path.includes(query)) score += 360;
  if (expertText.includes(query)) score += 300;
  if (skillText.includes(query)) score += 220;
  if (bodyText.includes(query)) score += 80;
  return score;
}

function buildOrgFlow({
  tree,
  selectedId,
  collapsedNodeIds,
  onSelect,
  onToggleCollapse,
  onOpenDetails,
  locale,
}: {
  tree: ResolvedGameOrgNode;
  selectedId: string;
  collapsedNodeIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onOpenDetails?: (id: string) => void;
  locale: Locale;
}): { nodes: OrgFlowNode[]; edges: OrgFlowEdge[] } {
  const layout = measureOrgLayout(tree, collapsedNodeIds);
  const incomingBindingCountByNodeId = new Map(
    flattenGameOrgNodes(tree).map((node) => [
      node.id,
      collectGameOrgSkillBindings(tree, node.id).incoming.length,
    ]),
  );
  const nodes: OrgFlowNode[] = [];
  const edges: OrgFlowEdge[] = [];

  const place = (item: OrgLayoutTree, left: number, parentId?: string) => {
    const x = left + item.width / 2 - ORG_CARD_WIDTH / 2;
    const y = item.level * ORG_Y_GAP;
    nodes.push({
      id: item.node.id,
      type: "org",
      position: { x, y },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      selectable: true,
      selected: item.node.id === selectedId,
      data: {
        node: item.node,
        level: item.level,
        collapsed: item.hiddenChildCount > 0,
        incomingBindingCount:
          incomingBindingCountByNodeId.get(item.node.id) ?? 0,
        locale,
        onSelect,
        onToggleCollapse,
        onOpenDetails,
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}->${item.node.id}`,
        source: parentId,
        target: item.node.id,
        sourceHandle: "bottom",
        targetHandle: "top",
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: orgLevelAccent(item.level),
        },
        style: {
          stroke: orgLevelAccent(item.level),
          strokeWidth: 1.4,
        },
      });
    }

    const childrenWidth =
      item.children.length === 0
        ? 0
        : item.children.reduce((sum, child) => sum + child.width, 0) +
          ORG_X_GAP * (item.children.length - 1);
    let childLeft = left + (item.width - childrenWidth) / 2;
    for (const child of item.children) {
      place(child, childLeft, item.node.id);
      childLeft += child.width + ORG_X_GAP;
    }
  };

  place(layout, 0);
  return { nodes, edges };
}

function OrgFlowNodeCard({ data, selected }: NodeProps) {
  const {
    node,
    level,
    collapsed,
    incomingBindingCount,
    locale,
    onSelect,
    onToggleCollapse,
    onOpenDetails,
  } = data as OrgFlowNodeData;
  const childCount = node.children.length;
  const activate = () => {
    onSelect(node.id);
    onOpenDetails?.(node.id);
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border bg-panel/95 text-left shadow-[var(--node-shadow)] backdrop-blur transition-colors",
        selected
          ? "border-accent bg-panel-2 shadow-[0_0_0_1px_var(--accent),0_12px_34px_-16px_var(--accent)]"
          : "border-border-soft hover:border-accent/55 hover:bg-panel-2",
      )}
      style={{ width: ORG_CARD_WIDTH, minHeight: ORG_CARD_HEIGHT }}
      role="treeitem"
      aria-level={level + 1}
      aria-selected={selected}
      title={`${node.path.join(" / ")}\n${node.summary}`}
    >
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-accent/40 !bg-accent !opacity-0"
      />
      <button
        type="button"
        // React Flow 给每个 .react-flow__node 包装层挂了 d3-drag：pointerdown 时它会
        // 选中节点并对包装层 setPointerCapture，于是 pointerup 被重定向到包装层，内部
        // 这个按钮的原生 click 根本不会触发 —— 表现就是“节点选中框出现了，但右侧详情
        // 没打开”。给按钮加 nodrag（配合 nopan）让 React Flow 的拖拽处理跳过它、不再
        // 捕获指针，click 才能正常落到按钮上。pointerDown 再兜底一次，保证一定激活。
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          activate();
        }}
        onClick={(event) => {
          event.stopPropagation();
          activate();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          activate();
        }}
        className="nodrag nopan flex min-h-[112px] w-full min-w-0 flex-col items-start gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="flex w-full min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded border",
              selected
                ? "border-accent/55 bg-accent/15"
                : "border-border-soft bg-bg/60 group-hover:border-accent/40",
            )}
          >
            <GameOrgIcon node={node} size={18} className="stroke-[2.35]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-fg">
              {node.label}
            </span>
            <span className="mt-1 inline-flex rounded border border-border-soft bg-bg/60 px-1.5 py-0.5 text-[10px] leading-none text-fg-faint">
              {orgLevelLabel(level, locale)}
            </span>
          </span>
        </span>
        <span className="line-clamp-2 min-h-[28px] text-[10px] leading-snug text-fg-faint">
          {node.summary}
        </span>
        <span className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5">
          {node.experts.length > 0 && (
            <span className="rounded border border-border-soft bg-bg/50 px-1.5 py-0.5 text-[10px] leading-none text-fg-faint">
              {gameTeamText(locale, "peopleCount", {
                count: node.experts.length,
              })}
            </span>
          )}
          {node.skills.length > 0 && (
            <span className="rounded border border-border-soft bg-bg/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-fg-faint">
              {node.skills.length} Skill
            </span>
          )}
          {incomingBindingCount > 0 && (
            <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-accent">
              {gameTeamText(locale, "bindingIncomingCount", {
                count: incomingBindingCount,
              })}
            </span>
          )}
          {childCount > 0 && (
            <span className="rounded border border-border-soft bg-bg/50 px-1.5 py-0.5 text-[10px] leading-none text-fg-faint">
              {gameTeamText(
                locale,
                collapsed ? "childCountCollapsed" : "childCountExpanded",
                { count: childCount },
              )}
            </span>
          )}
        </span>
      </button>
      {childCount > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(node.id);
          }}
          title={gameTeamText(
            locale,
            collapsed ? "expandChildren" : "collapseChildren",
          )}
          aria-label={`${gameTeamText(
            locale,
            collapsed ? "expandChildren" : "collapseChildren",
          )}: ${node.label}`}
          className={cn(
            "absolute -bottom-3 left-1/2 z-10 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-1 rounded border px-1.5 text-[10px] shadow-sm transition-colors nodrag nopan",
            collapsed
              ? "border-accent/60 bg-accent text-bg hover:bg-accent/90"
              : "border-border-soft bg-panel-2 text-fg-faint hover:border-accent hover:text-fg",
          )}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          {collapsed && childCount}
        </button>
      )}
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-accent/40 !bg-accent !opacity-0"
      />
    </div>
  );
}

function OrganizationChartCanvas({
  tree,
  selectedId,
  onSelect,
  onOpenDetails,
  locale,
}: {
  tree: ResolvedGameOrgNode;
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenDetails?: (id: string) => void;
  locale: Locale;
}) {
  const { getZoom, setCenter, getInternalNode } = useReactFlow<
    OrgFlowNode,
    OrgFlowEdge
  >();
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  // 待居中的节点请求。zoom 为目标缩放：从画布点击时沿用当前缩放（只平移），
  // 从搜索 / 快捷定位时用一个稍微拉远的缩放，方便看清上下级。
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    zoom: number;
  } | null>(null);

  useEffect(() => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const ancestorId of findOrgAncestorIds(tree, selectedId)) {
        if (!next.has(ancestorId)) continue;
        next.delete(ancestorId);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [selectedId, tree]);

  const orgNodes = useMemo(() => flattenGameOrgNodes(tree), [tree]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return orgNodes
      .map((node) => ({
        node,
        score: orgSearchScore(node, normalizedQuery),
      }))
      .filter(
        (item) =>
          item.score > 0 || orgSearchText(item.node).includes(normalizedQuery),
      )
      .sort(
        (a, b) => b.score - a.score || a.node.path.length - b.node.path.length,
      )
      .map((item) => item.node)
      .slice(0, ORG_SEARCH_LIMIT);
  }, [normalizedQuery, orgNodes]);
  // 沿当前选中分支逐级收集"快捷找到岗位"行：左侧搜索框已经覆盖第二级
  // （根的直属下级），这里从第二级节点开始，把每个还有下级的路径节点的
  // 子岗位各渲染成一行，从而第三、第四级乃至更深层级都会自动出现。
  const shortcutRows = useMemo(() => {
    const pathNodes = findOrgPathNodes(tree, selectedId);
    return pathNodes
      .slice(1)
      .filter((node) => node.children.length > 0)
      .map((node) => ({ parent: node, nodes: node.children }));
  }, [selectedId, tree]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 激活一个岗位节点：展开其祖先、选中、打开右侧详情，并把它居中到画布中央。
  // zoom 给 0 表示沿用当前缩放（点击节点时只平移不变焦），其它值表示居中并缩放。
  const activateNode = useCallback(
    (id: string, options?: { zoom?: number }) => {
      setCollapsedNodeIds((current) => {
        const next = new Set(current);
        let changed = false;
        for (const ancestorId of findOrgAncestorIds(tree, id)) {
          if (!next.has(ancestorId)) continue;
          next.delete(ancestorId);
          changed = true;
        }
        return changed ? next : current;
      });
      onSelect(id);
      onOpenDetails?.(id);
      const targetZoom =
        options?.zoom ?? Math.min(1.05, Math.max(0.82, getZoom()));
      setFocusRequest({ id, zoom: targetZoom });
    },
    [getZoom, onOpenDetails, onSelect, tree],
  );

  const { nodes, edges } = useMemo(
    () =>
      buildOrgFlow({
        tree,
        selectedId,
        collapsedNodeIds,
        onSelect,
        onToggleCollapse: toggleCollapse,
        onOpenDetails: activateNode,
        locale,
      }),
    [
      tree,
      selectedId,
      collapsedNodeIds,
      onSelect,
      toggleCollapse,
      activateNode,
      locale,
    ],
  );
  const visibleNodeIds = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes],
  );
  const nodePositionById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of nodes) map.set(node.id, node.position);
    return map;
  }, [nodes]);

  // 居中所需的“易变”数据（布局坐标、可见节点集合、React Flow 取值方法）每次渲染都会
  // 拿到新的引用。如果直接把它们放进居中 effect 的依赖里，点击岗位触发的选中/详情面板
  // 等连锁状态更新会让 effect 反复重建，导致它的清理函数在排队的 requestAnimationFrame
  // 真正执行前就把帧取消掉，于是 setCenter 永远没被调用——表现就是“点了画布没动”。
  // 这里把它们写进 ref，让居中 effect 只依赖 focusRequest，从根本上避免被无关渲染打断。
  const focusContextRef = useRef({
    visibleNodeIds,
    nodePositionById,
    setCenter,
    getInternalNode,
  });
  focusContextRef.current = {
    visibleNodeIds,
    nodePositionById,
    setCenter,
    getInternalNode,
  };

  // 把目标岗位节点居中到画布中央。React Flow 在节点重新布局或容器尺寸还没测量
  // 完成时，setCenter 可能落空，所以这里用 requestAnimationFrame 轮询，等到 React
  // Flow 内部已经测量出该节点（getInternalNode 可用）再居中（最多重试若干帧）。
  // 如果重试用尽 React Flow 仍未测量出该节点，就直接用我们自己算好的布局坐标
  // （nodePositionById + 固定卡片尺寸）兜底居中，保证点击 / 搜索 / 快捷定位
  // 一定会把整个画布平移到该节点居中，绝不出现“点了没反应”。
  useEffect(() => {
    if (!focusRequest) return;
    if (!focusContextRef.current.visibleNodeIds.has(focusRequest.id)) {
      setFocusRequest(null);
      return;
    }
    const { id, zoom } = focusRequest;
    let frame = 0;
    let attempts = 0;
    const maxAttempts = 40;
    const centerOn = (
      target: { x: number; y: number },
      width: number,
      height: number,
    ) => {
      void focusContextRef.current.setCenter(
        target.x + width / 2,
        target.y + height / 2,
        { zoom, duration: 240 },
      );
      setFocusRequest(null);
    };
    const run = () => {
      const internal = focusContextRef.current.getInternalNode(id);
      const measured = internal?.measured;
      const internalTarget = internal?.internals.positionAbsolute;
      if (internal && internalTarget) {
        centerOn(
          internalTarget,
          measured?.width ?? ORG_CARD_WIDTH,
          measured?.height ?? ORG_CARD_HEIGHT,
        );
        return;
      }
      if (attempts++ < maxAttempts) {
        frame = window.requestAnimationFrame(run);
        return;
      }
      // React Flow 始终没测量出该节点时，用本地布局坐标兜底居中。
      const fallbackTarget = focusContextRef.current.nodePositionById.get(id);
      if (fallbackTarget) {
        centerOn(fallbackTarget, ORG_CARD_WIDTH, ORG_CARD_HEIGHT);
      } else {
        setFocusRequest(null);
      }
    };
    frame = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  // 搜索 / 快捷定位：和点击节点一样激活，但用稍微拉远的固定缩放方便看清上下级，
  // 并清空搜索框。
  const focusNode = useCallback(
    (id: string) => {
      activateNode(id, { zoom: 0.95 });
      setSearchQuery("");
    },
    [activateNode],
  );

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={orgNodeTypes}
        onNodeClick={(_, node) => activateNode(node.id)}
        onNodeDoubleClick={(_, node) => activateNode(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        // 仅在 React Flow 实例就绪（panZoom 已初始化、容器已测量）后，一次性把初始选中
        // 的岗位框入视野。之前用持久的布尔 fitView + fitViewOptions，会在标签页每次重新
        // 挂载时重新排队初始 fit，并和点击触发的 setCenter 抢占视口——异步落地的 fit 覆盖
        // 掉 setCenter，于是“点击没反应 / 只是又 fit 了一次”。改成 onInit 后，居中只剩
        // setCenter 这一条路径，点击岗位一定把整个画布平移到该节点居中。
        onInit={(instance) => {
          if (!selectedId) return;
          void instance.fitView({
            nodes: [{ id: selectedId }],
            padding: 0.72,
            minZoom: 0.78,
            maxZoom: 1.02,
          });
        }}
        minZoom={0.25}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={24}
          lineWidth={1}
          color="var(--border-soft)"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--panel-2)"
          maskColor="color-mix(in srgb, var(--bg) 62%, transparent)"
          className="!bottom-3 !right-3 !h-24 !w-36 !rounded-md !border !border-border-soft !bg-panel/90 !shadow-lg"
        />
        <Controls showInteractive={false} style={{ color: "var(--fg)" }} />
      </ReactFlow>
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-start gap-3">
        <div className="pointer-events-auto w-[min(320px,100%)] shrink-0 rounded-md border border-border-soft bg-panel/95 shadow-lg backdrop-blur">
          <label className="flex h-9 items-center gap-2 px-2.5">
            <Search size={14} className="shrink-0 text-fg-faint" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
              placeholder={gameTeamText(locale, "searchPlaceholder")}
              aria-label={gameTeamText(locale, "searchAria")}
            />
          </label>
          {!normalizedQuery && tree.children.length > 0 && (
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto border-t border-border-soft p-2">
              {tree.children.map((node) => {
                const selected = orgNodeContains(node, selectedId);
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => focusNode(node.id)}
                    aria-label={gameTeamText(locale, "locateAria", {
                      label: node.label,
                    })}
                    className={cn(
                      "inline-flex h-7 max-w-full items-center gap-1.5 rounded border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                      selected
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-border-soft bg-bg/50 text-fg-faint hover:border-accent hover:text-fg",
                    )}
                  >
                    <GameOrgIcon node={node} size={12} />
                    <span className="truncate">{node.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {normalizedQuery && (
            <div className="max-h-72 overflow-y-auto border-t border-border-soft py-1">
              {searchResults.length > 0 ? (
                searchResults.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => focusNode(node.id)}
                    className="flex w-full min-w-0 items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border-soft bg-bg/60">
                      <GameOrgIcon node={node} size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-fg">
                          {node.label}
                        </span>
                        <LocateFixed
                          size={12}
                          className="shrink-0 text-accent"
                        />
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-fg-faint">
                        {node.path.join(" / ")}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2.5 py-3 text-xs text-fg-faint">
                  {gameTeamText(locale, "noMatches")}
                </div>
              )}
            </div>
          )}
        </div>
        {!normalizedQuery && shortcutRows.length > 0 && (
          <div className="pointer-events-auto hidden min-w-0 max-w-[520px] flex-1 flex-col gap-2 rounded-md border border-border-soft bg-panel/95 p-2 shadow-lg backdrop-blur sm:flex">
            {shortcutRows.map((row) => (
              <div
                key={row.parent.id}
                className="flex max-h-28 flex-wrap items-center gap-1 overflow-y-auto"
              >
                <span className="inline-flex max-w-[120px] items-center gap-1 truncate pr-1 text-[10px] text-fg-faint">
                  <GameOrgIcon node={row.parent} size={11} />
                  <span className="truncate">{row.parent.label}</span>
                </span>
                {row.nodes.map((node) => {
                  const selected = orgNodeContains(node, selectedId);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => focusNode(node.id)}
                      aria-label={gameTeamText(locale, "locateAria", {
                        label: node.label,
                      })}
                      className={cn(
                        "inline-flex h-7 max-w-full items-center gap-1.5 rounded border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                        selected
                          ? "border-accent/60 bg-accent/15 text-accent"
                          : "border-border-soft bg-bg/50 text-fg-faint hover:border-accent hover:text-fg",
                      )}
                    >
                      <GameOrgIcon node={node} size={12} />
                      <span className="truncate">{node.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function OrganizationChart({
  tree,
  selectedId,
  onSelect,
  onOpenDetails,
  locale,
}: {
  tree: ResolvedGameOrgNode;
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenDetails?: (id: string) => void;
  locale: Locale;
}) {
  const activateNodeFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const element = event.target as Element | null;
      const nodeElement = element?.closest<HTMLElement>(
        ".react-flow__node[data-id]",
      );
      const id = nodeElement?.dataset.id;
      if (!id || !findGameOrgNode(tree, id)) return;
      onSelect(id);
      onOpenDetails?.(id);
    },
    [onOpenDetails, onSelect, tree],
  );

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-bg"
      role="tree"
      aria-label={gameTeamText(locale, "chartAria")}
      onPointerDownCapture={activateNodeFromPointer}
    >
      <ReactFlowProvider>
        <OrganizationChartCanvas
          tree={tree}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpenDetails={onOpenDetails}
          locale={locale}
        />
      </ReactFlowProvider>
    </div>
  );
}

type GameTeamPanelMode = "organization" | "details";

export default function GameTeamPanel({
  mode = "details",
  onOpenDetails,
  selectedNodeId,
}: {
  mode?: GameTeamPanelMode;
  onOpenDetails?: (id: string) => void;
  selectedNodeId?: string | null;
}) {
  const locale = useStore((s) => s.locale);
  const settings = useStore((s) => s.gameExpertSettings);
  const appendComposerDraft = useStore((s) => s.appendComposerDraft);
  const [definition, setDefinition] = useState<GameOrgNodeDefinition>(() =>
    loadGameOrgDefinition(),
  );
  const tree = useMemo(
    () => buildGameOrgTree(settings, locale, definition),
    [definition, locale, settings],
  );
  const [selectedId, setSelectedId] = useState<string>(
    () => selectedNodeId ?? readSelectedNodeId() ?? tree.id,
  );
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null);
  const selectedNode = findGameOrgNode(tree, selectedId) ?? tree;
  const selectedDefinition =
    findNodeDefinition(definition, selectedNode.id) ?? definition;
  const selectedParentDefinition = findParentNodeDefinition(
    definition,
    selectedNode.id,
  );
  const selectedIsRoot = selectedNode.id === definition.id;
  const roleSkillBindings = useMemo(
    () => collectGameOrgSkillBindings(tree, selectedNode.id),
    [selectedNode.id, tree],
  );
  const [nodeEditor, setNodeEditor] = useState<{
    mode: "edit" | "add";
    parentId?: string;
    originalId?: string;
    draft: NodeDraft;
  } | null>(null);
  const [skillEditor, setSkillEditor] = useState<{
    mode: "edit" | "add";
    originalId?: string;
    draft: SkillDraft;
  } | null>(null);
  const selectedExpertNames = selectedNode.experts.map((expert) =>
    localizedGameExpertName(expert, locale),
  );
  const HeaderIcon = NODE_ICON_BY_KIND[selectedNode.icon] ?? BriefcaseBusiness;

  const persistDefinition = (next: GameOrgNodeDefinition) => {
    const cloned = cloneGameOrgDefinition(next);
    setDefinition(cloned);
    saveGameOrgDefinition(cloned);
  };

  useEffect(() => {
    const nextNode = findGameOrgNode(tree, selectedId);
    if (nextNode) return;
    const stored = readSelectedNodeId();
    const storedNode = stored ? findGameOrgNode(tree, stored) : null;
    setSelectedId(storedNode?.id ?? tree.id);
  }, [selectedId, tree]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const nextNode = findGameOrgNode(tree, selectedNodeId);
    if (!nextNode) return;
    setSelectedId(nextNode.id);
    writeSelectedNodeId(nextNode.id);
  }, [selectedNodeId, tree]);

  const selectNode = (id: string) => {
    setSelectedId(id);
    writeSelectedNodeId(id);
  };

  const selectNodeFromBinding = (id: string) => {
    setNodeEditor(null);
    setSkillEditor(null);
    selectNode(id);
  };

  const selectOrgNode = (id: string) => {
    selectNode(id);
  };

  const openOrgNodeDetails = (id: string) => {
    selectNode(id);
    onOpenDetails?.(id);
  };

  const insertSkill = (skill: ResolvedGameOrgSkill) => {
    appendComposerDraft(skill.commandText);
  };

  const copySkill = (skill: ResolvedGameOrgSkill) => {
    setCopiedSkillId(skill.id);
    void navigator.clipboard?.writeText(skill.commandText).catch(() => {});
    window.setTimeout(() => {
      setCopiedSkillId((current) => (current === skill.id ? null : current));
    }, 1300);
  };

  const startEditNode = () => {
    setSkillEditor(null);
    setNodeEditor({
      mode: "edit",
      originalId: selectedDefinition.id,
      draft: nodeDraftFromDefinition(selectedDefinition, selectedNode),
    });
  };

  const startAddChildNode = () => {
    const existing = collectNodeDefinitionIds(definition);
    const base = uniqueId(existing, `${selectedNode.id}-role`);
    setSkillEditor(null);
    setNodeEditor({
      mode: "add",
      parentId: selectedNode.id,
      draft: {
        id: base,
        label: gameTeamText(locale, "newRole"),
        icon: "team",
        summary: "",
        role: "",
        position: "",
        responsibilities: "",
        scenarios: "",
        deliverables: "",
        collaborators: "",
        expertIds: "",
      },
    });
  };

  const saveNodeDraft = () => {
    if (!nodeEditor) return;
    const existing = collectNodeDefinitionIds(definition);
    if (nodeEditor.originalId) existing.delete(nodeEditor.originalId);
    const nextId = uniqueId(
      existing,
      nodeEditor.draft.id,
      nodeEditor.originalId,
    );
    const nextNode: GameOrgNodeDefinition = {
      id: nextId,
      label: nodeEditor.draft.label.trim() || nextId,
      icon: nodeEditor.draft.icon,
      summary: nodeEditor.draft.summary.trim() || undefined,
      role: nodeEditor.draft.role.trim() || undefined,
      profile: {
        position: nodeEditor.draft.position.trim(),
        responsibilities: linesFromText(nodeEditor.draft.responsibilities),
        scenarios: linesFromText(nodeEditor.draft.scenarios),
        deliverables: linesFromText(nodeEditor.draft.deliverables),
        collaborators: linesFromText(nodeEditor.draft.collaborators),
      },
      expertIds: stringsFromCsv(nodeEditor.draft.expertIds),
    };

    if (nodeEditor.mode === "add") {
      const parentId = nodeEditor.parentId ?? selectedNode.id;
      const next = updateNodeDefinition(definition, parentId, (node) => ({
        ...node,
        children: [...(node.children ?? []), nextNode],
      }));
      persistDefinition(next);
      selectNode(nextId);
    } else {
      const original = findNodeDefinition(
        definition,
        nodeEditor.originalId ?? "",
      );
      const next = updateNodeDefinition(
        definition,
        nodeEditor.originalId ?? selectedNode.id,
        (node) => ({
          ...node,
          ...nextNode,
          children: original?.children ?? node.children,
          skills: original?.skills ?? node.skills,
        }),
      );
      persistDefinition(next);
      selectNode(nextId);
    }
    setNodeEditor(null);
  };

  const removeSelectedNode = () => {
    if (selectedIsRoot) return;
    const fallbackId = selectedParentDefinition?.id ?? definition.id;
    const next = removeNodeDefinition(definition, selectedNode.id);
    persistDefinition(next);
    selectNode(fallbackId);
    setNodeEditor(null);
    setSkillEditor(null);
  };

  const resetOrg = () => {
    const next = resetGameOrgDefinition();
    setDefinition(next);
    setSelectedId(next.id);
    writeSelectedNodeId(next.id);
    setNodeEditor(null);
    setSkillEditor(null);
  };

  const startAddSkill = () => {
    const existing = new Set(selectedNode.skills.map((skill) => skill.id));
    const base = uniqueId(existing, `${selectedNode.id}:skill`);
    const label = gameTeamText(locale, "newSkill");
    const protocol = createDefaultGameOrgSkillProtocol(
      {
        label,
        summary: "",
        prompt: "",
      },
      locale,
    );
    setNodeEditor(null);
    setSkillEditor({
      mode: "add",
      draft: {
        id: base,
        label,
        summary: "",
        prompt: "",
        collaboratorExpertIds: csvFromStrings(selectedNode.expertIds),
        allowedCapabilities: csvFromStrings(selectedNode.allowedCapabilities),
        triggerConditions: protocol.triggerConditions,
        inputs: protocol.inputs,
        executionSteps: protocol.executionSteps.join("\n"),
        toolsAndResources: protocol.toolsAndResources,
        outputs: protocol.outputs,
        acceptanceCriteria: protocol.acceptanceCriteria,
      },
    });
  };

  const startEditSkill = (skill: ResolvedGameOrgSkill) => {
    setNodeEditor(null);
    setSkillEditor({
      mode: "edit",
      originalId: skill.id,
      draft: skillDraftFromDefinition(
        skillDefinitionFromResolved(skill),
        locale,
      ),
    });
  };

  const saveSkillDraft = () => {
    if (!skillEditor) return;
    const existing = new Set(selectedNode.skills.map((skill) => skill.id));
    if (skillEditor.originalId) existing.delete(skillEditor.originalId);
    const nextId = uniqueId(
      existing,
      skillEditor.draft.id,
      skillEditor.originalId,
    );
    const nextSkill: GameOrgSkillDefinition = {
      id: nextId,
      label: skillEditor.draft.label.trim() || nextId,
      summary:
        skillEditor.draft.summary.trim() || skillEditor.draft.prompt.trim(),
      prompt:
        skillEditor.draft.prompt.trim() ||
        gameTeamText(locale, "saveFallbackPrompt", {
          label: skillEditor.draft.label.trim() || nextId,
        }),
      protocol: {
        triggerConditions: skillEditor.draft.triggerConditions.trim(),
        inputs: skillEditor.draft.inputs.trim(),
        executionSteps: linesFromText(skillEditor.draft.executionSteps),
        toolsAndResources: skillEditor.draft.toolsAndResources.trim(),
        outputs: skillEditor.draft.outputs.trim(),
        acceptanceCriteria: skillEditor.draft.acceptanceCriteria.trim(),
      },
      collaboratorExpertIds: stringsFromCsv(
        skillEditor.draft.collaboratorExpertIds,
      ),
      allowedCapabilities: normalizeGameAssetCapabilityIds(
        stringsFromCsv(skillEditor.draft.allowedCapabilities),
      ),
    };
    const next = updateNodeDefinition(definition, selectedNode.id, (node) => {
      const skills =
        node.skills ?? selectedNode.skills.map(skillDefinitionFromResolved);
      return {
        ...node,
        skills:
          skillEditor.mode === "edit"
            ? skills.map((skill) =>
                skill.id === skillEditor.originalId ? nextSkill : skill,
              )
            : [...skills, nextSkill],
      };
    });
    persistDefinition(next);
    setSkillEditor(null);
  };

  const removeSkill = (skill: ResolvedGameOrgSkill) => {
    const next = updateNodeDefinition(definition, selectedNode.id, (node) => ({
      ...node,
      skills: (
        node.skills ?? selectedNode.skills.map(skillDefinitionFromResolved)
      ).filter((item) => item.id !== skill.id),
    }));
    persistDefinition(next);
    if (skillEditor?.originalId === skill.id) setSkillEditor(null);
  };

  if (mode === "organization") {
    return (
      <OrganizationChart
        tree={tree}
        selectedId={selectedNode.id}
        onSelect={selectOrgNode}
        onOpenDetails={openOrgNodeDetails}
        locale={locale}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-soft bg-panel px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-soft bg-bg/50">
              <HeaderIcon
                size={16}
                strokeWidth={2.1}
                className={cn(NODE_ICON_TONE_BY_KIND[selectedNode.icon])}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg">
                {selectedNode.label}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-fg-faint">
                {selectedNode.path.join(" / ")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={startEditNode}
                title={gameTeamText(locale, "editRoleButton")}
                aria-label={gameTeamText(locale, "editRoleButton")}
                className="flex h-7 w-7 items-center justify-center rounded border border-border-soft bg-bg/40 text-fg-faint transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={startAddChildNode}
                title={gameTeamText(locale, "addChildRoleButton")}
                aria-label={gameTeamText(locale, "addChildRoleButton")}
                className="flex h-7 w-7 items-center justify-center rounded border border-border-soft bg-bg/40 text-fg-faint transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={removeSelectedNode}
                disabled={selectedIsRoot}
                title={
                  selectedIsRoot
                    ? gameTeamText(locale, "rootDeleteDisabled")
                    : gameTeamText(locale, "deleteRoleButton")
                }
                aria-label={gameTeamText(locale, "deleteRoleButton")}
                className="flex h-7 w-7 items-center justify-center rounded border border-border-soft bg-bg/40 text-fg-faint transition-colors hover:border-status-error hover:text-status-error focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-error disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-soft disabled:hover:text-fg-faint"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                onClick={resetOrg}
                title={gameTeamText(locale, "resetTemplateButton")}
                aria-label={gameTeamText(locale, "resetTemplateButton")}
                className="flex h-7 w-7 items-center justify-center rounded border border-border-soft bg-bg/40 text-fg-faint transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-dim">
            {selectedNode.summary}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
          <div className="space-y-3 pb-3">
            {nodeEditor && (
              <NodeEditor
                draft={nodeEditor.draft}
                mode={nodeEditor.mode}
                onChange={(patch) =>
                  setNodeEditor((current) =>
                    current
                      ? { ...current, draft: { ...current.draft, ...patch } }
                      : current,
                  )
                }
                onCancel={() => setNodeEditor(null)}
                onSave={saveNodeDraft}
                locale={locale}
              />
            )}

            <RoleBindingOverview
              selectedNode={selectedNode}
              ownBindings={roleSkillBindings.own}
              incomingBindings={roleSkillBindings.incoming}
              onSelectNode={selectNodeFromBinding}
              locale={locale}
            />

            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold text-fg-faint">
                  {gameTeamText(locale, "responsibilities")}
                </h4>
                {selectedNode.groupLabels.length > 0 && (
                  <span
                    className="truncate text-[10px] text-fg-faint"
                    title={selectedNode.groupLabels.join(" / ")}
                  >
                    {selectedNode.groupLabels.join(" / ")}
                  </span>
                )}
              </div>
              <p className="rounded-md border border-border-soft bg-bg/20 p-2 text-xs leading-relaxed text-fg-dim">
                {[
                  selectedNode.profile.position,
                  selectedNode.profile.responsibilities.length > 0 &&
                    `${gameTeamText(locale, "profileResponsibilities")}：${selectedNode.profile.responsibilities.join("；")}`,
                  selectedNode.profile.scenarios.length > 0 &&
                    `${gameTeamText(locale, "profileScenarios")}：${selectedNode.profile.scenarios.join("；")}`,
                  selectedNode.profile.deliverables.length > 0 &&
                    `${gameTeamText(locale, "profileDeliverables")}：${selectedNode.profile.deliverables.join("；")}`,
                  selectedNode.profile.collaborators.length > 0 &&
                    `${gameTeamText(locale, "profileCollaborators")}：${selectedNode.profile.collaborators.join("、")}`,
                ]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ")}
              </p>
            </section>

            {selectedExpertNames.length > 0 && (
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold text-fg-faint">
                  {gameTeamText(locale, "experts")}
                </h4>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.experts.map((expert, index) => (
                    <button
                      key={expert.id}
                      type="button"
                      onClick={() =>
                        appendComposerDraft(
                          `${selectedNode.commandText ?? ""}`.trim(),
                        )
                      }
                      className="max-w-full rounded border border-border-soft bg-panel-2/70 px-1.5 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      title={expert.summary}
                    >
                      <span className="block truncate">
                        {selectedExpertNames[index]}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold text-fg-faint">
                  Skill
                </h4>
                <div className="flex items-center gap-1.5">
                  <span className="rounded border border-border-soft bg-bg/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-fg-faint">
                    {selectedNode.skills.length}
                  </span>
                  <button
                    type="button"
                    onClick={startAddSkill}
                    title={gameTeamText(locale, "addSkillTitle")}
                    aria-label={gameTeamText(locale, "addSkillTitle")}
                    className="inline-flex h-6 items-center gap-1 rounded border border-border-soft bg-bg/40 px-1.5 text-[10px] text-fg-faint transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    <Plus size={12} />
                    {gameTeamText(locale, "add")}
                  </button>
                </div>
              </div>
              {skillEditor && (
                <div className="mb-2">
                  <SkillEditor
                    draft={skillEditor.draft}
                    mode={skillEditor.mode}
                    onChange={(patch) =>
                      setSkillEditor((current) =>
                        current
                          ? {
                              ...current,
                              draft: { ...current.draft, ...patch },
                            }
                          : current,
                      )
                    }
                    onCancel={() => setSkillEditor(null)}
                    onSave={saveSkillDraft}
                    locale={locale}
                  />
                </div>
              )}
              <div className="space-y-2">
                {selectedNode.skills.map((skill) => (
                  <SkillButton
                    key={skill.id}
                    skill={skill}
                    onInsert={insertSkill}
                    onCopy={copySkill}
                    onEdit={startEditSkill}
                    onRemove={removeSkill}
                    copied={copiedSkillId === skill.id}
                    locale={locale}
                  />
                ))}
                {selectedNode.skills.length === 0 && (
                  <div className="rounded-md border border-dashed border-border-soft bg-bg/20 px-2.5 py-3 text-center text-[11px] text-fg-faint">
                    {gameTeamText(locale, "noSkills")}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
