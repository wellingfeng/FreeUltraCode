import { RUNTIME_ADAPTERS, runtimeAdapterLabel } from '@/lib/adapters';

/**
 * 能力统一翻译（IR → 各 agent 原生格式）的目标模型。
 *
 * UGS 不介入任何 agent 的运行时；这里只做「离线生成」：把同一份能力 IR
 * 翻译成每个 agent 的原生配置文件，写到该 agent 的原生配置位置。
 *
 * 支持矩阵（与 Rust 端 `translate_capability` 保持一致）：
 *   - skill：claude-code / codex / gemini / agents（跨 agent 标准）
 *   - mcp  ：claude-code（.mcp.json）/ codex（~/.codex/config.toml）/ gemini（settings.json）
 *   - lsp  ：运行时能力，无法文本翻译 → 生成统一目录清单供各 agent 复用
 */

export type CapabilityTranslateKind = 'skill' | 'mcp' | 'lsp';

/** 跨 agent 标准 skill 目录（`.agents/skills`），不属于某个具体 CLI。 */
export const CROSS_AGENT_AGENT_ID = 'agents';

export interface CapabilityTranslateAgent {
  id: string;
  label: string;
  /** 该 agent 是否有该能力的原生格式支持；false 会在计划里标记为「待接入」。 */
  supported: boolean;
  /** 为什么不支持（给用户看的简短说明）。 */
  reason?: string;
}

/** 各能力下每个 agent 的原生支持情况。 */
const AGENT_SUPPORT: Record<
  CapabilityTranslateKind,
  Record<string, { supported: boolean; reason?: string }>
> = {
  skill: {
    'claude-code': { supported: true },
    codex: { supported: true },
    gemini: { supported: true },
    [CROSS_AGENT_AGENT_ID]: { supported: true },
    kimi: {
      supported: false,
      reason: '尚无标准 skill 安装目录，待接入',
    },
    'deepseek-harness': {
      supported: false,
      reason: '尚无标准 skill 安装目录，待接入',
    },
    zcode: { supported: false, reason: '尚无标准 skill 安装目录，待接入' },
  },
  mcp: {
    'claude-code': { supported: true },
    codex: { supported: true },
    gemini: { supported: true },
    [CROSS_AGENT_AGENT_ID]: {
      supported: false,
      reason: '跨 agent 标准暂无统一 MCP 配置格式',
    },
    kimi: { supported: false, reason: '尚无标准 MCP 配置文件，待接入' },
    'deepseek-harness': {
      supported: false,
      reason: '尚无标准 MCP 配置文件，待接入',
    },
    zcode: { supported: false, reason: '尚无标准 MCP 配置文件，待接入' },
  },
  lsp: {
    // LSP 是运行时能力：任何 agent 都只能「复用」同一 LSP 进程，而不是翻译文本。
    'claude-code': {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
    codex: {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
    gemini: {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
    [CROSS_AGENT_AGENT_ID]: {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
    kimi: {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
    'deepseek-harness': {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
    zcode: {
      supported: true,
      reason: 'LSP 为运行时能力，仅生成统一目录清单供复用',
    },
  },
};

/** 某能力下参与翻译的全部 agent（含跨 agent 标准 + 全部 CLI）。 */
export function capabilityTranslateAgents(
  kind: CapabilityTranslateKind,
): CapabilityTranslateAgent[] {
  const agents: CapabilityTranslateAgent[] = [];
  if (kind === 'skill') {
    agents.push({
      id: CROSS_AGENT_AGENT_ID,
      label: 'Agents (跨 agent 标准)',
      supported: true,
    });
  }
  for (const adapter of RUNTIME_ADAPTERS) {
    const support = AGENT_SUPPORT[kind][adapter.id];
    agents.push({
      id: adapter.id,
      label: adapter.label,
      supported: support?.supported ?? false,
      reason: support?.reason,
    });
  }
  return agents;
}

export function capabilityTranslateAgentLabel(agent: string): string {
  if (agent === CROSS_AGENT_AGENT_ID) return 'Agents (跨 agent 标准)';
  return runtimeAdapterLabel(agent);
}

/** 某能力下「原生支持」的 agent id 列表（作为默认勾选）。 */
export function supportedTranslateAgentIds(
  kind: CapabilityTranslateKind,
): string[] {
  return capabilityTranslateAgents(kind)
    .filter((agent) => agent.supported)
    .map((agent) => agent.id);
}

export interface CapabilityTranslationPlan {
  kind: CapabilityTranslateKind;
  agents: CapabilityTranslateAgent[];
}

/**
 * 纯函数：为给定能力构建翻译计划。前端用它渲染「一键翻译」对话框里的
 * agent 勾选列表（不支持的 agent 灰显并标注原因），不涉及任何 IO。
 */
export function buildTranslationPlan(
  kind: CapabilityTranslateKind,
): CapabilityTranslationPlan {
  return { kind, agents: capabilityTranslateAgents(kind) };
}
