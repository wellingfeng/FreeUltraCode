/**
 * `ugs studio-trace <run-id>` — render a finished /studio run's summary in
 * one screen instead of hand-reading events.jsonl / result.json.
 *
 * Reads `.ugs-run/<run-id>/run-summary.json` when present; otherwise recomputes
 * it from result.json (older runs). With --json, emits the raw RunSummary.
 *
 * The headline value is the phase-2 gate-vs-truth quadrant: it tells you whether
 * the acceptance gate's verdict actually matched the objective verify-command —
 * and flags `false-accept` (gate said pass, truth said fail) as the dangerous miss.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatDuration } from '../../src/runtime/format';
import { CliError } from '../utils/fs';
import { c, type GlobalOptions } from '../utils/format';
import type { StudioJsonResult } from './studio';
import {
  buildRunSummary,
  type GateClassification,
  type RunSummary,
} from './studioSummary';

export interface StudioTraceOptions extends GlobalOptions {
  cwd?: string;
}

export async function runStudioTrace(
  runId: string,
  opts: StudioTraceOptions,
): Promise<number> {
  const id = runId.trim();
  if (!id) throw new CliError('请提供 run id：ugs studio-trace <run-id>', 1);
  const cwd = opts.cwd ? resolve(process.cwd(), opts.cwd) : process.cwd();
  const runDir = join(cwd, '.ugs-run', id);
  if (!existsSync(runDir)) {
    throw new CliError(`找不到 run 目录：${runDir}`, 1);
  }

  const summary = loadOrComputeSummary(runDir);
  if (!summary) {
    throw new CliError(`无法读取 run 摘要（缺少 run-summary.json 与 result.json）：${runDir}`, 1);
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  renderSummary(summary);
  // Exit non-zero on a false-accept so this is usable as a CI gate-quality check.
  return summary.gate.classification === 'false-accept' ? 2 : 0;
}

function loadOrComputeSummary(runDir: string): RunSummary | null {
  const summaryFile = join(runDir, 'run-summary.json');
  if (existsSync(summaryFile)) {
    try {
      return JSON.parse(readFileSync(summaryFile, 'utf8')) as RunSummary;
    } catch {
      // fall through to recompute
    }
  }
  const resultFile = join(runDir, 'result.json');
  if (!existsSync(resultFile)) return null;
  try {
    const json = JSON.parse(readFileSync(resultFile, 'utf8')) as StudioJsonResult;
    return buildRunSummary(json);
  } catch {
    return null;
  }
}

const OUTCOME_LABEL: Record<RunSummary['outcome'], string> = {
  pass: 'pass',
  fail: 'fail',
  'budget-exhausted': '预算耗尽',
  error: '错误',
};

function renderSummary(s: RunSummary): void {
  const w = (line = '') => process.stdout.write(`${line}\n`);
  const outcomeText =
    s.outcome === 'pass' ? c.ok(OUTCOME_LABEL[s.outcome]) : c.err(OUTCOME_LABEL[s.outcome]);

  w(c.bold(`Studio trace · ${s.runId}`));
  w(`目标: ${s.objective || '(未记录)'}`);
  w(
    `结果: ${outcomeText} · 耗时 ${formatDuration(s.durationMs)} · ` +
      `agent 调用 ${s.agentCalls.spent}/${s.agentCalls.max}` +
      (s.agentCalls.exhausted ? c.warn(' (预算耗尽)') : ''),
  );
  const flags: string[] = [];
  if (s.planner.usedFallback) flags.push(c.warn('规划降级'));
  if (s.closingPass) flags.push(c.warn('预算收尾'));
  if (s.rework.rounds > 1) flags.push(`返工 ${s.rework.rounds} 轮 (${s.rework.reworkNodeCount} 节点)`);
  if (flags.length) w(`标志: ${flags.join(' · ')}`);

  w();
  w(c.bold('节点'));
  for (const n of s.nodes) {
    const mark = n.status === 'success' ? c.ok('✓') : n.status === 'error' ? c.err('✗') : c.dim('·');
    const retry = n.retryCount > 0 ? c.warn(` ↻${n.retryCount}`) : '';
    w(`  ${mark} ${n.role.padEnd(10)} ${formatDuration(n.durationMs).padStart(7)} ${c.dim(n.id)}${retry}`);
  }

  w();
  w(c.bold('验收门校准 (模型自评 × 客观真值)'));
  w(`  ${gateLine(s.gate.classification)}`);
  w(
    c.dim(
      `  模型自评 pass=${fmtTri(s.gate.modelVerdictPass)} · ` +
        `真值(verify-command) pass=${fmtTri(s.gate.groundTruthPass)}`,
    ),
  );

  if (s.evidence?.length) {
    w();
    w(c.bold('证据索引'));
    for (const item of s.evidence.slice(0, 8)) {
      const status = item.status ? ` ${statusLabel(item.status)}` : '';
      const target = item.path ?? item.command ?? item.source ?? '';
      const detail = item.summary || item.snippet || target;
      w(`  - [${item.kind}]${status} ${item.title}${detail ? ` — ${clip(detail, 110)}` : ''}`);
    }
  }

  if (s.nextSteps?.length) {
    w();
    w(c.bold('下一步'));
    for (const step of s.nextSteps.slice(0, 5)) {
      w(`  - ${nextStepMark(step.severity)} ${step.title} — ${clip(step.reason, 120)}`);
      if (step.nodeId) w(c.dim(`    nodeId: ${step.nodeId}`));
      if (step.path) w(c.dim(`    path: ${step.path}`));
      if (step.command) w(`    ${c.cyan(step.command)}`);
    }
  }
}

function fmtTri(v: boolean | null): string {
  return v === null ? 'n/a' : v ? 'true' : 'false';
}

function statusLabel(status: string): string {
  if (status === 'pass' || status === 'success') return c.ok(status);
  if (status === 'fail' || status === 'error') return c.err(status);
  if (status === 'skipped') return c.warn(status);
  return c.dim(status);
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

function nextStepMark(severity: string | undefined): string {
  if (severity === 'error') return c.err('!');
  if (severity === 'warn') return c.warn('!');
  return c.dim('·');
}

function gateLine(cls: GateClassification): string {
  switch (cls) {
    case 'confirmed':
      return c.ok('✓ confirmed — 门通过且真值通过');
    case 'false-accept':
      return c.err('⚠ false-accept — 门通过但真值失败（假阳性，验收门漏报！）');
    case 'over-reject':
      return c.warn('● over-reject — 门拒绝但真值通过（验收门过严）');
    case 'confirmed-fail':
      return c.ok('✓ confirmed-fail — 门拒绝且真值失败（正确拒绝）');
    default:
      return c.dim('· unverified — 缺验收门或缺 verify-command，无法校准');
  }
}
