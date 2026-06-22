/**
 * `ugs gen` — generate or modify a workflow script from natural language.
 *
 * This is one of the two user-facing commands (the other is `run`). To the user
 * a workflow IS a `.js` script; IRGraph / emit / parse / validate are hidden
 * intermediate steps reused internally here.
 *
 * Two forms:
 *   1. generate:  ugs gen "<自然语言需求>" -o flow.js   (or: ugs gen "<需求>" flow.js)
 *   2. modify:    ugs gen flow.js "<修改意图>"
 *
 * Zero-config credentials: gen drives the **local `claude` CLI login state**
 * (same path as `ugs run`), never ANTHROPIC_API_KEY. It assembles
 * UNIFIED_SYSTEM + BLUEPRINT_DIRECT_EDIT_CONTRACT + the current (seed/empty or
 * parsed) IRGraph + the user's intent, sends it to claude via `spawnCliAgent`,
 * extracts the returned IRGraph, merges it with `prepareGraphEdit`, emits a
 * `.js` script with `emitClaudeScript`, and writes it (overwriting on modify).
 *
 * Pure Node: imports cli/io + src/core + src/lib pure modules only. No react /
 * zustand / tauri.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitClaudeScript } from '../../src/core/emitter';
import { parseClaudeScript } from '../../src/core/parser';
import { defaultBlueprint } from '../../src/core/defaultBlueprint';
import {
  BLUEPRINT_DIRECT_EDIT_CONTRACT,
  prepareGraphEdit,
  replyIncludesIRGraph,
  strictBlueprintRetryAppendix,
} from '../../src/core/genPrompt';
import { UNIFIED_SYSTEM, extractJsonObject } from '../../src/lib/anthropic';
import type { IRGraph } from '../../src/core/ir';
import { spawnCliAgent } from '../io/cli-spawn';
import { isCliAvailable } from '../io/which-cli';
import { CliError, errMsg, readInput, writeOutput } from '../utils/fs';
import { c, type GlobalOptions } from '../utils/format';

export interface GenOptions extends GlobalOptions {
  /** Output path for the generated/modified .js script. */
  output?: string;
  /** Adapter id (default claude-code → local claude CLI login). */
  adapter?: string;
  /** Model override forwarded to the CLI when valid. */
  model?: string;
  /** Explicit CLI path / bare name override. */
  cliCommand?: string;
}

/** Detect whether `arg` points at an existing readable script file. */
function isExistingScript(arg: string): boolean {
  if (!arg) return false;
  return existsSync(resolve(process.cwd(), arg));
}

/**
 * Resolve the two positional args into a normalized shape:
 *   - generate:  { mode: 'generate', request, output }
 *   - modify:    { mode: 'modify', scriptPath, request }
 *
 * Disambiguation: if the FIRST positional is an existing file, it is a modify
 * (arg2 = intent). Otherwise it is a generate (arg1 = request, arg2/`-o` = out).
 */
function resolveArgs(
  arg1: string,
  arg2: string | undefined,
  opts: GenOptions,
): { mode: 'generate'; request: string; output: string } | { mode: 'modify'; scriptPath: string; request: string } {
  if (isExistingScript(arg1)) {
    const request = (arg2 ?? '').trim();
    if (!request) {
      throw new CliError(
        '修改已有脚本需要提供修改意图：ugs gen <flow.js> "<修改意图>"',
        1,
      );
    }
    return { mode: 'modify', scriptPath: arg1, request };
  }
  // generate
  const request = arg1.trim();
  if (!request) {
    throw new CliError('请提供自然语言需求：ugs gen "<需求>" -o flow.js', 1);
  }
  const output = (opts.output ?? arg2 ?? '').trim();
  if (!output) {
    throw new CliError(
      '请用 -o 指定输出脚本路径：ugs gen "<需求>" -o flow.js',
      1,
    );
  }
  return { mode: 'generate', request, output };
}

/** Build the system prompt: UNIFIED_SYSTEM + the direct-edit hard constraint. */
function buildSystem(): string {
  return `${UNIFIED_SYSTEM}\n\n${BLUEPRINT_DIRECT_EDIT_CONTRACT}`;
}

/** Build the user turn: current IRGraph + the user's request. */
function buildUserContent(currentGraph: IRGraph, request: string): string {
  return [
    '当前 workflow 蓝图(IRGraph JSON)：',
    '```json',
    JSON.stringify(currentGraph, null, 2),
    '```',
    '',
    '用户需求：',
    request,
  ].join('\n');
}

/**
 * Call the local claude CLI with the assembled prompt. The model is instructed
 * not to touch local files (readonly permission → claude `--permission-mode
 * plan`), so gen only ever produces a blueprint, never edits the user's tree.
 * Streams progress to stderr. Returns the full assistant text.
 */
async function callModel(
  system: string,
  userContent: string,
  opts: GenOptions,
  quiet: boolean,
): Promise<string> {
  const adapter = opts.adapter ?? 'claude-code';
  // claude takes a single prompt on stdin; fold the system prompt in front of
  // the user turn (the desktop AI path does the same for CLI adapters).
  const prompt = `${system}\n\n====\n${userContent}`;
  return spawnCliAgent(prompt, {
    adapter,
    model: opts.model,
    cliCommand: opts.cliCommand,
    // readonly → claude `--permission-mode plan`: the model can still emit text
    // but is barred from writing/editing files. gen must never mutate the tree.
    permission: 'readonly',
    onProgress: (chunk) => {
      if (!quiet) process.stderr.write(chunk);
    },
  });
}

/**
 * Extract + parse an IRGraph from a model reply. Returns null when no parseable
 * IRGraph is present (caller retries / errors).
 */
function parseReplyGraph(reply: string): IRGraph | null {
  if (!replyIncludesIRGraph(reply)) return null;
  try {
    return JSON.parse(extractJsonObject(reply)) as IRGraph;
  } catch {
    return null;
  }
}

export async function runGen(
  arg1: string,
  arg2: string | undefined,
  opts: GenOptions,
): Promise<number> {
  const quiet = opts.quiet ?? false;
  const resolved = resolveArgs(arg1, arg2, opts);
  const adapter = opts.adapter ?? 'claude-code';

  // Zero-config gate: require the local claude (or chosen adapter) CLI login —
  // NOT an API key. A missing CLI is a configuration error (exit 4).
  if (!isCliAvailable(adapter, { cliCommand: opts.cliCommand })) {
    throw new CliError(
      `未找到可用的 "${adapter}" CLI。ugs gen 复用本地 claude CLI 登录态（无需 API key）：` +
        '请先安装 claude CLI 并完成登录（claude login），或用 UGS_CLAUDE_PATH 指定其路径。',
      4,
    );
  }

  // Establish the "current graph" the model edits.
  let currentGraph: IRGraph;
  let outputPath: string;
  let request: string;
  if (resolved.mode === 'modify') {
    const { text } = await readInput(resolved.scriptPath);
    try {
      currentGraph = parseClaudeScript(text);
    } catch (err) {
      throw new CliError(
        `无法解析脚本 ${resolved.scriptPath}：${errMsg(err)}`,
        2,
      );
    }
    outputPath = resolved.scriptPath;
    request = resolved.request;
    if (!quiet) {
      process.stderr.write(c.dim(`正在修改 ${resolved.scriptPath} …\n`));
    }
  } else {
    currentGraph = defaultBlueprint();
    outputPath = resolved.output;
    request = resolved.request;
    if (!quiet) process.stderr.write(c.dim('正在生成 workflow …\n'));
  }

  const system = buildSystem();
  const userContent = buildUserContent(currentGraph, request);

  // First attempt.
  let reply: string;
  try {
    reply = await callModel(system, userContent, opts, quiet);
  } catch (err) {
    throw new CliError(`调用 claude CLI 失败：${errMsg(err)}`, 4);
  }

  let newIr = parseReplyGraph(reply);

  // Retry once with a strict blueprint-only appendix when the model returned
  // prose / a plan instead of a parseable IRGraph (mirrors the desktop retry).
  if (!newIr) {
    if (!quiet) {
      process.stderr.write(
        c.warn('\n上一轮未返回可解析蓝图，正在重试…\n'),
      );
    }
    const retrySystem = system + strictBlueprintRetryAppendix(reply);
    try {
      reply = await callModel(retrySystem, userContent, opts, quiet);
    } catch (err) {
      throw new CliError(`调用 claude CLI 失败（重试）：${errMsg(err)}`, 4);
    }
    newIr = parseReplyGraph(reply);
  }

  if (!newIr) {
    throw new CliError(
      '模型未返回可解析的 workflow 蓝图（重试后仍失败）。请调整需求描述后重试。',
      1,
    );
  }

  // Merge into the current graph (layout reuse / relayout / gateway defaults),
  // then compile to a user-facing .js script.
  const merged = prepareGraphEdit(currentGraph, newIr);
  let script: string;
  try {
    script = emitClaudeScript(merged);
  } catch (err) {
    throw new CliError(`生成脚本失败：${errMsg(err)}`, 1);
  }

  writeOutput(script, outputPath);

  const nodeCount = merged.nodes.length;
  const edgeCount = merged.edges.length;
  const verb = resolved.mode === 'modify' ? '已更新' : '已生成';
  if (!quiet) {
    process.stderr.write(
      c.ok(`\n✓ ${verb} ${outputPath}（${nodeCount} 节点 / ${edgeCount} 边）\n`),
    );
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: resolved.mode,
          output: resolve(process.cwd(), outputPath),
          nodes: nodeCount,
          edges: edgeCount,
          workflow: merged.meta.name ?? null,
        },
        null,
        2,
      )}\n`,
    );
  }

  return 0;
}
