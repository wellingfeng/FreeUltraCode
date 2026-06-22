import { DATA, type ConsensusStrategy, type IRGraph, type IRNode } from './ir';

/**
 * Free, deterministic complexity heuristic used at AUTHORING time (NOT during a
 * run) to decide whether an `agent` node should be upgraded to a `consensus`
 * node. Keeping it authoring-time means consensus stays a visible, first-class
 * node (the graph is the truth) and the exported script is portable — rather
 * than silently escalating an agent at run time.
 *
 * Signals (any one fires): long prompt, several sub-goals, multiple data inputs
 * (synthesising upstreams), or high-stakes keywords. Zero model calls.
 */
export interface ConsensusFit {
  fit: boolean;
  /** Suggested default strategy when upgrading. */
  strategy: ConsensusStrategy;
  /** Short human-readable reason (for the suggestion chip tooltip). */
  reason: string;
}

const HIGH_STAKES =
  /(审计|安全|架构|重构|审查|验证|评审|critical|security|architect|refactor|migrat|audit|review|verif)/i;
const ADVERSARIAL_HINT = /(安全|security|审计|audit|漏洞|vulnerab|风险|risk)/i;

/** Count rough sub-goals: list markers, conjunctions, and clause separators. */
function subGoalCount(text: string): number {
  const markers = text.match(/(\n\s*[-*]\s)|(\d+\s*[.、)])|[;；]| and |和|并且|然后|其次|最后/gi);
  return markers ? markers.length : 0;
}

/** Assess whether `node` (typically an agent) is complex enough to warrant consensus. */
export function assessConsensusFit(node: IRNode, workflow: IRGraph): ConsensusFit {
  const miss: ConsensusFit = { fit: false, strategy: 'multi-lens', reason: '' };
  if (node.type !== 'agent') return miss;

  const prompt = String(node.params.prompt ?? node.label ?? '');
  const len = prompt.trim().length;
  const goals = subGoalCount(prompt);
  const dataIns = workflow.edges.filter(
    (e) => e.kind === DATA && e.to.node === node.id,
  ).length;
  const stakes = HIGH_STAKES.test(prompt);

  const reasons: string[] = [];
  if (len > 600) reasons.push('提示较长');
  if (goals >= 3) reasons.push(`含 ${goals} 个子目标`);
  if (dataIns >= 2) reasons.push(`汇聚 ${dataIns} 路上游`);
  if (stakes) reasons.push('涉及高风险/审查类工作');

  if (reasons.length === 0) return miss;
  const strategy: ConsensusStrategy = ADVERSARIAL_HINT.test(prompt)
    ? 'adversarial'
    : 'multi-lens';
  return { fit: true, strategy, reason: reasons.join('、') };
}

/**
 * Distinct angles used when generating candidate blueprints by consensus (the
 * "tournament" pattern applied to AI 改图 itself): each candidate emphasises a
 * different design lens, then a judge merges the best. Candidate count = length.
 */
export const GENERATION_ANGLES = [
  '最小充分：用最小但完整的结构覆盖需求，避免过度设计与冗余节点。',
  '健壮性：重点覆盖边界、异常与失败回退，并补齐成功/验收标准节点。',
  '并行与质量：尽量并行化彼此独立的步骤；对关键/高风险步骤用 consensus 节点交叉验证。',
];

/** Pick `count` generation angles (cycling with a variation suffix when count exceeds the base set). */
export function generationAngles(count: number): string[] {
  const n = Math.max(1, Math.min(16, Math.floor(count) || 1));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(
      i < GENERATION_ANGLES.length
        ? GENERATION_ANGLES[i]
        : `${GENERATION_ANGLES[i % GENERATION_ANGLES.length]}（再给一个取舍不同的版本 #${i + 1}）`,
    );
  }
  return out;
}

/** Generation-time consensus is off unless explicitly enabled via localStorage ugs_gen_consensus=1. */
export function genConsensusEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('ugs_gen_consensus') === '1';
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Heuristic: is an AI-改图 request complex enough to warrant multi-candidate
 * consensus generation? Free + deterministic (length / sub-goal markers /
 * high-stakes keywords). Simple requests stay single-call.
 */
export function isComplexGenerationRequest(text: string): boolean {
  if (!genConsensusEnabled()) return false;
  const t = text.trim();
  if (t.length > 200) return true;
  const goals = (t.match(/\n|(\d+\s*[.、)])|然后|以及|其次|最后|；|;/g) ?? []).length;
  if (goals >= 3) return true;
  return /(审计|安全|架构|重构|迁移|系统|全面|完整|端到端|多角度|交叉验证|大规模|migrat|architect|audit|security|refactor)/i.test(
    t,
  );
}

/**
 * Distinct research lenses used by the multi-angle research step that runs
 * BEFORE generation (Feature 1). Each lens investigates the project/request
 * from a different vantage; their outputs are synthesised into the generation
 * context. `count <= 1` ⇒ no research step (today's behavior).
 */
export const RESEARCH_ANGLES = [
  '需求与约束：澄清真实目标、隐含约束、验收标准与不在范围内的事项。',
  '现状与最佳实践：调研现有方案、相关代码/接口、行业惯例与可复用资产。',
  '风险与失败模式：找出边界条件、易错点、依赖与回退策略，提出需要重点验证之处。',
];

/** Pick `count` research angles (cycling with a variation suffix beyond the base set). */
export function researchAngles(count: number): string[] {
  const n = Math.max(1, Math.min(16, Math.floor(count) || 1));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(
      i < RESEARCH_ANGLES.length
        ? RESEARCH_ANGLES[i]
        : `${RESEARCH_ANGLES[i % RESEARCH_ANGLES.length]}（再补一个侧重不同的视角 #${i + 1}）`,
    );
  }
  return out;
}

/**
 * Deterministic, zero-model complexity signal for a node, in [0,1]. Reuses the
 * exact signals `assessConsensusFit` weighs (long prompt / many sub-goals /
 * multiple data inputs / high-stakes keywords): counts how many fire (0..4) and
 * normalises. Used as the multiplier source for `complexityScaling`.
 */
export function nodeComplexitySignal(node: IRNode, workflow: IRGraph): number {
  const prompt = String(node.params.prompt ?? node.label ?? '');
  const len = prompt.trim().length;
  const goals = subGoalCount(prompt);
  const dataIns = workflow.edges.filter(
    (e) => e.kind === DATA && e.to.node === node.id,
  ).length;
  let fired = 0;
  if (len > 600) fired += 1;
  if (goals >= 3) fired += 1;
  if (dataIns >= 2) fired += 1;
  if (HIGH_STAKES.test(prompt)) fired += 1;
  return fired / 4;
}

/**
 * Keyword half of terminal-node detection: a node whose label/prompt reads like
 * a self-test / summary / validation / review step. Combined (AND-gated with
 * spine-tail proximity) by the run engine so mid-graph "验证…" nodes aren't
 * misclassified.
 */
const TERMINAL_INTENT =
  /(自检|自测|汇总|总结|校验|核验|验收|复核|self.?test|summary|summarize|validate|validation|verif|review)/i;
export function isTerminalIntentNode(node: IRNode): boolean {
  const text = `${node.label ?? ''}\n${String(node.params.prompt ?? '')}`;
  return TERMINAL_INTENT.test(text);
}

/**
 * Scale a base count by a 0..1 complexity `signal` and an integer `mult`,
 * capped to `max`. `mult === 1` (or `signal === 0`) is the identity — returns
 * `base` unchanged, so the default (complexityScaling=1) means no scaling.
 *
 * A `base <= 1` always returns 1: a configured count of 1 means the feature is
 * OFF, and the complexity multiplier must never *enable* it — it only amplifies
 * a count the user has already opted into (>= 2).
 */
export function scaleCount(
  base: number,
  signal: number,
  mult: number,
  max: number,
): number {
  const b = Math.max(1, Math.floor(base) || 1);
  if (b <= 1) return 1;
  const m = Math.max(1, Math.floor(mult) || 1);
  const s = Math.max(0, Math.min(1, signal));
  const scaled = Math.round(b * (1 + s * (m - 1)));
  return Math.min(max, Math.max(b, scaled));
}

/**
 * Divergence-driven adaptive escalation tunables. The escalation loop keeps
 * doubling the agent/sample count (min → 2× → … → max) while the measured
 * disagreement among outputs stays above this threshold, then votes over the
 * accumulated pool. Living here (not in settings) keeps the engine contract
 * narrow — these are algorithm constants, not user knobs.
 */
export const VOTE_DIVERGENCE_THRESHOLD = 0.34;

/**
 * Normalised bucket key for grouping textually-identical outputs. Shared by
 * {@link measureDivergence} and resolveConsensus's self-consistency tally so
 * the two never drift.
 */
export function normalizeForBucket(c: string): string {
  return c.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * CHEAP (no model call) divergence proxy over N outputs, in [0,1]:
 * `1 - largestBucket/total` after normalisation. 0 = all agree, →1 = all
 * differ. Accurate for STRUCTURED outputs (pass a `bucketKey` extractor that
 * pulls a canonical field from JSON). For free-form PROSE this saturates near 1
 * (distinct wording ⇒ singleton buckets), so the run engine drives escalation
 * for prose off a judge-scored disagreement instead and uses this only as a
 * structured-output fast path / fallback signal.
 */
export function measureDivergence(
  outputs: string[],
  bucketKey: (s: string) => string = normalizeForBucket,
): number {
  if (outputs.length < 2) return 0;
  const buckets = new Map<string, number>();
  let largest = 0;
  for (const o of outputs) {
    const k = bucketKey(o);
    const n = (buckets.get(k) ?? 0) + 1;
    buckets.set(k, n);
    if (n > largest) largest = n;
  }
  return 1 - largest / outputs.length;
}

/** Default differentiated lens prompts seeded when converting an agent → consensus. */
export function defaultConsensusLenses(target: string): { prompt: string; schema?: string }[] {
  const t = target.trim();
  const base = t ? `\n\n目标：\n${t}` : '';
  return [
    { prompt: `从「正确性」角度审查并给出结论。${base}` },
    { prompt: `从「安全性 / 边界情况」角度审查并给出结论。${base}` },
    { prompt: `从「可行性 / 可复现性」角度审查并给出结论。${base}` },
  ];
}
