/**
 * `ugs run <file>` — execute a workflow headlessly (spec §3.5).
 *
 * Reads .ugs.json or .js (.js is parsed to IR), then drives `runBlueprint` from
 * cli/runtime-host. A stderr logger consumes the structured RunEvent stream and
 * prints the `[time] ▶/●/✓` lines; the final result (or `--json`) goes to stdout.
 * `--dry-run` validates + emits without spawning. `--resume` seeds from
 * `.ugs-run/<name>/last-run.json`. SIGINT once = graceful, twice = force.
 *
 * IRGraph is read-only; run state is persisted under `.ugs-run/<name>/`.
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emitClaudeScript } from '../../src/core/emitter';
import type { IRGraph, IRRunStatus } from '../../src/core/ir';
import { formatClock, formatDuration } from '../../src/runtime/format';
import type { RunResult } from '../../src/runtime';
import { runBlueprint, type RunEvent } from '../runtime-host';
import { CliError, readInput, errMsg } from '../utils/fs';
import { loadGraph, c, type GlobalOptions } from '../utils/format';
import { checkGraph } from './validate';

export interface RunCommandOptions extends GlobalOptions {
  adapter?: string;
  model?: string;
  provider?: string;
  var?: string[];
  output?: string;
  dryRun?: boolean;
  interactive?: boolean;
  nonInteractive?: boolean;
  resume?: boolean;
  concurrency?: string;
  maxRetries?: string;
  timeout?: string;
  cwd?: string;
}

export async function runRun(file: string, opts: RunCommandOptions): Promise<number> {
  const { text } = await readInput(file);
  const graph = loadGraph(text, file);

  // Internal pre-validation: structural errors are a config/validation failure.
  const { exitCode: vExit } = checkGraph(graph, false);
  if (vExit === 1) {
    process.stderr.write(c.err('Validation failed; run aborted. See `ugs validate`.\n'));
    return 3;
  }

  // --dry-run: emit + validate, never spawn.
  if (opts.dryRun) {
    try {
      emitClaudeScript(graph as IRGraph);
    } catch (err) {
      throw new CliError(`dry-run emit failed: ${errMsg(err)}`, 3);
    }
    if (!opts.quiet) process.stderr.write(c.ok('dry-run ok — workflow is runnable (no agents spawned).\n'));
    return 0;
  }

  const cwd = opts.cwd ? resolve(process.cwd(), opts.cwd) : process.cwd();
  const vars = parseVars(opts.var);
  // Inject --var into the environment for spawned CLIs (read-only on the graph).
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;

  const workflowName = graph.meta.name || 'workflow';
  const runDir = join(cwd, '.ugs-run', sanitize(workflowName));

  // --resume: seed from the last-run snapshot.
  let seedOutputs: Record<string, string> | undefined;
  let seedRunState: Record<string, IRRunStatus> | undefined;
  let resumeFromNodeId: string | null | undefined;
  if (opts.resume) {
    // `.owf-run` is the pre-rebrand snapshot dir; fall back to it so runs
    // started by an older (UltraGameStudio) build can still be resumed.
    const snap =
      readSnapshot(runDir) ??
      readSnapshot(join(cwd, '.owf-run', sanitize(workflowName)));
    if (snap) {
      seedOutputs = snap.outputs;
      seedRunState = snap.nodeStates;
      resumeFromNodeId = snap.failedNodeId ?? null;
      if (!opts.quiet) {
        process.stderr.write(c.dim(`Resuming from snapshot (failed node: ${resumeFromNodeId ?? 'n/a'})\n`));
      }
    } else if (!opts.quiet) {
      process.stderr.write(c.warn('No previous run snapshot found; running fresh.\n'));
    }
  }

  // Cancellation: SIGINT once -> graceful abort; twice -> hard exit.
  const controller = new AbortController();
  let interrupts = 0;
  const onSigint = () => {
    interrupts += 1;
    if (interrupts === 1) {
      process.stderr.write(c.warn('\nInterrupt received — finishing in-flight nodes then stopping (Ctrl+C again to force).\n'));
      controller.abort();
    } else {
      process.stderr.write(c.err('\nForce kill.\n'));
      process.exit(2);
    }
  };
  process.on('SIGINT', onSigint);

  const logger = makeLogger(opts);
  let result: RunResult;
  try {
    result = await runBlueprint(graph, {
      adapter: opts.adapter,
      model: opts.model,
      providerId: opts.provider,
      cwd,
      concurrency: opts.concurrency ? Number(opts.concurrency) : undefined,
      maxRetries: opts.maxRetries ? Number(opts.maxRetries) : undefined,
      timeoutSeconds: opts.timeout ? Number(opts.timeout) : undefined,
      nonInteractive: opts.interactive ? false : opts.nonInteractive ?? true,
      seedOutputs,
      seedRunState,
      resumeFromNodeId,
      signal: controller.signal,
      onEvent: logger,
    });
  } catch (err) {
    process.removeListener('SIGINT', onSigint);
    // Distinguish config errors (no backend / no key) from generic run errors.
    const msg = errMsg(err);
    if (/NO_MODEL_GATEWAY_BACKEND|NO_API_KEY|NO_MODEL\b/.test(msg)) {
      throw new CliError(`Configuration error: ${msg}`, 4);
    }
    throw new CliError(`Run failed: ${msg}`, 1);
  }
  process.removeListener('SIGINT', onSigint);

  persistSnapshot(runDir, graph, result);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(toJsonResult(result), null, 2)}\n`);
  } else if (opts.output) {
    // result also written to file below; print a short summary to stdout
    process.stdout.write(`${result.success ? c.ok('Workflow complete') : c.err('Workflow failed')} — ${formatDuration(result.durationMs)}\n`);
  } else {
    process.stdout.write(`${result.success ? c.ok('Workflow complete') : c.err('Workflow failed')} — ${formatDuration(result.durationMs)}\n`);
  }

  if (opts.output) {
    try {
      const abs = resolve(process.cwd(), opts.output);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, `${JSON.stringify(toJsonResult(result), null, 2)}\n`, 'utf8');
    } catch (err) {
      process.stderr.write(c.warn(`Could not write --output: ${errMsg(err)}\n`));
    }
  }

  if (controller.signal.aborted && !result.success) return 2;
  return result.success ? 0 : 1;
}

/** Build the stderr RunEvent logger (the `[time] ▶/●/✓` stream). */
function makeLogger(opts: RunCommandOptions): (event: RunEvent) => void {
  const quiet = opts.quiet ?? false;
  return (event: RunEvent) => {
    if (quiet) return;
    const ts = c.dim(`[${formatClock(Date.now())}]`);
    switch (event.kind) {
      case 'node_start':
        process.stderr.write(`${ts} ${c.cyan('▶')} ${event.nodeType} ${event.nodeId}${event.label ? ` (${event.label})` : ''}\n`);
        break;
      case 'node_success':
        process.stderr.write(`${ts} ${c.ok('✓')} ${event.nodeId}\n`);
        break;
      case 'node_retry':
        process.stderr.write(`${ts} ${c.warn('↻')} ${event.nodeId} retry ${event.attempt}/${event.maxRetries} (${event.failure.code}) backoff ${event.backoffMs}ms\n`);
        break;
      case 'node_failure':
        process.stderr.write(`${ts} ${c.err('✗')} ${event.nodeId} — ${event.failure.code}: ${event.failure.message}\n`);
        break;
      case 'log':
        if (opts.verbose || event.role === 'error') {
          process.stderr.write(`${ts} ${c.dim('●')} ${event.text}\n`);
        }
        break;
      case 'stream_append':
        if (opts.verbose) process.stderr.write(event.chunk);
        break;
      default:
        break;
    }
  };
}

interface Snapshot {
  outputs?: Record<string, string>;
  nodeStates?: Record<string, IRRunStatus>;
  failedNodeId?: string | null;
}

function readSnapshot(runDir: string): Snapshot | null {
  const file = join(runDir, 'last-run.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}

function persistSnapshot(runDir: string, graph: IRGraph, result: RunResult): void {
  try {
    mkdirSync(runDir, { recursive: true });
    const nodeStates: Record<string, IRRunStatus> = {};
    for (const [id, r] of Object.entries(result.nodeResults)) nodeStates[id] = r.status;
    const snap: Snapshot & { status: string; updatedAt: number; workflow: string } = {
      status: result.success ? 'success' : 'error',
      updatedAt: Date.now(),
      workflow: graph.meta.name || 'workflow',
      outputs: result.outputs,
      nodeStates,
      failedNodeId: result.failedNodeId ?? null,
    };
    writeFileSync(join(runDir, 'last-run.json'), `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
  } catch {
    /* best-effort; never fail a run over snapshot IO */
  }
}

function toJsonResult(result: RunResult) {
  return {
    success: result.success,
    durationMs: result.durationMs,
    failedNodeId: result.failedNodeId ?? null,
    nodeResults: result.nodeResults,
    outputs: result.outputs,
  };
}

function parseVars(vars: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars ?? []) {
    const eq = v.indexOf('=');
    if (eq === -1) throw new CliError(`Invalid --var (expected key=value): ${v}`, 1);
    out[v.slice(0, eq).trim()] = v.slice(eq + 1);
  }
  return out;
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'workflow';
}
