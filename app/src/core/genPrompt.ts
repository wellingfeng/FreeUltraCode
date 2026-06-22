/**
 * CONTRACT: pure, framework-free helpers shared by the in-app AI editor
 * (`src/store/useStore.ts`) and the headless `ugs gen` command
 * (`cli/commands/gen.ts`).
 *
 * Historically these lived inside the Zustand store, which made them
 * unreachable from the CLI (the CLI must not import react / zustand). They are
 * pure functions over `IRGraph` + text, so they were lifted here verbatim. The
 * store now re-imports them, keeping its runtime / AI-edit behaviour identical
 * (no semantic change — only the definition site moved).
 *
 * Exports:
 *   - BLUEPRINT_DIRECT_EDIT_CONTRACT: the "短说明 + 一个完整 ```json IRGraph"
 *     hard-constraint appendix layered after UNIFIED_SYSTEM.
 *   - replyIncludesIRGraph(text): whether a model reply contains a parseable
 *     IRGraph JSON block.
 *   - strictBlueprintRetryAppendix(prev): the retry instruction appended when a
 *     turn produced prose instead of a blueprint.
 *   - prepareGraphEdit(current, ir): merge a model-produced IRGraph into the
 *     current graph (trusted-layout reuse, auto-relayout on structural change,
 *     gateway-defaults inheritance) — the canonical "apply AI edit" transform.
 *
 * Pure: imports only `src/core/*` + `src/lib/modelGateway/resolver` (themselves
 * pure) + `extractJsonObject` from `src/lib/anthropic` (a pure string helper). No
 * react, zustand, tauri, or DOM access.
 */
import type { IRGraph, IRLayout } from './ir';
import {
  autoLayoutGraph,
  hasMissingLayout,
  hasStructuralChanges,
} from './autoLayout';
import { normalizeWorkflowNodeNumbers } from './nodeNumbers';
import { withWorkflowGatewaySelection as withGatewayDefaults } from '@/lib/modelGateway/resolver';
import { extractJsonObject } from '@/lib/anthropic';

/**
 * Hard-constraint appendix layered after UNIFIED_SYSTEM for plain AI-input
 * edits: the model must answer with a short Chinese explanation plus exactly one
 * complete ```json IRGraph block, never a Markdown plan / TODO / file edit.
 */
export const BLUEPRINT_DIRECT_EDIT_CONTRACT = `---
普通 AI 输入框编辑规则：
- 默认目标是把用户需求写入 workflow 蓝图，而不是生成 Markdown 计划或让用户确认后再做。
- 必须基于当前 IRGraph 输出“简短中文说明 + 一个完整 \`\`\`json IRGraph 代码块”。
- 不要输出交互块，不要提问，不要等待批准，不要创建/修改本地文件。
- 如果需求提到“规划代码修改/支持某功能/实现某能力”，把它转成 workflow 节点：例如需求理解、代码定位、实现、验证、回归检查、总结等步骤。
- 信息不足时自行做保守假设，并把需要后续确认的事项放进蓝图中的澄清/验证节点。
- 蓝图规模要和任务复杂度匹配：简单需求优先最小充分结构，复杂需求才展开更多步骤、分支和验证。`;

/** Whether a model reply carries a parseable IRGraph (nodes[] + edges[]). */
export function replyIncludesIRGraph(text: string): boolean {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<IRGraph>;
    return Array.isArray(parsed.nodes) && Array.isArray(parsed.edges);
  } catch {
    return false;
  }
}

/**
 * The retry instruction appended when a turn returned prose / a plan instead of
 * a blueprint: quote the previous reply and demand a clean explanation + a
 * single parseable ```json IRGraph block.
 */
export function strictBlueprintRetryAppendix(previousReply: string): string {
  return `\n\n---
上一轮输出没有包含可解析的 workflow IRGraph，因此不能写入蓝图。上一轮输出节选如下：
${previousReply.slice(0, 4000)}

请忽略上一轮的 Markdown/计划/确认请求，直接基于最初的用户需求和当前 IRGraph 返回：
1) 简短中文说明。
2) 一个完整、可解析、可直接写入蓝图的 \`\`\`json IRGraph 代码块。
不得创建或修改本地文件，不得等待用户批准。`;
}

/**
 * Merge a model-produced IRGraph (`ir`) into the `currentWorkflow`:
 *   - reuse trusted layout coordinates for nodes that already exist,
 *   - re-run auto-layout when the structure changed or layout is missing,
 *   - drop any run-state snapshot,
 *   - inherit the current graph's gateway defaults when the new graph omits them.
 *
 * Pure transform; returns the next IRGraph (the input graphs are not mutated).
 */
export function prepareGraphEdit(currentWorkflow: IRGraph, ir: IRGraph): IRGraph {
  const trustedLayout: IRLayout = {};
  for (const node of ir.nodes) {
    const pos = currentWorkflow.layout?.[node.id];
    if (pos) trustedLayout[node.id] = { x: pos.x, y: pos.y };
  }
  const irWithTrustedLayout = { ...ir, layout: trustedLayout };
  const shouldRelayout =
    hasStructuralChanges(currentWorkflow, ir) ||
    hasMissingLayout(irWithTrustedLayout);
  let nextWorkflow = shouldRelayout
    ? autoLayoutGraph(irWithTrustedLayout, currentWorkflow, { relayout: 'all' })
    : irWithTrustedLayout;
  nextWorkflow = workflowWithoutRunSnapshot(nextWorkflow);
  if (
    !nextWorkflow.meta.gateway?.defaults &&
    currentWorkflow.meta.gateway?.defaults
  ) {
    nextWorkflow = withGatewayDefaults(
      nextWorkflow,
      currentWorkflow.meta.gateway.defaults,
    );
  }
  return normalizeWorkflowNodeNumbers(nextWorkflow);
}

/** Strip a run-state snapshot from meta (local copy so this module stays pure). */
function workflowWithoutRunSnapshot(workflow: IRGraph): IRGraph {
  if (!workflow.meta.run) return workflow;
  const meta = { ...workflow.meta };
  delete meta.run;
  return { ...workflow, meta };
}
