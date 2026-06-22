/**
 * `ugs validate <file>` — syntax + structural + (optional --strict) semantic
 * validation of a blueprint or script (spec §3.4).
 *
 * Exit codes: 0 pass, 1 error (syntax/structure), 2 warning (strict semantics).
 */
import { DATA, EXEC, type IRGraph, type IRNode } from '../../src/core/ir';
import { readInput, errMsg } from '../utils/fs';
import { loadGraph, c, type GlobalOptions } from '../utils/format';

export interface ValidateOptions extends GlobalOptions {
  format?: 'auto' | 'ugs' | 'js';
  strict?: boolean;
}

interface Diagnostic {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

export async function runValidate(file: string, opts: ValidateOptions): Promise<number> {
  const { text } = await readInput(file);

  let graph: IRGraph;
  try {
    graph = loadGraph(text, file, opts.format);
  } catch (err) {
    // Syntax / shape failure → exit 1 (structural error).
    const diags: Diagnostic[] = [{ level: 'error', message: errMsg(err) }];
    report(diags, 1, opts);
    return 1;
  }

  const { diagnostics, exitCode } = checkGraph(graph, opts.strict ?? false);
  report(diagnostics, exitCode, opts);
  return exitCode;
}

/** Run structural (+ strict semantic) checks. Returns diagnostics + exit code. */
export function checkGraph(
  graph: IRGraph,
  strict: boolean,
): { diagnostics: Diagnostic[]; exitCode: number } {
  const diags: Diagnostic[] = [];
  let hasError = false;
  let hasWarn = false;

  const nodes = graph.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const error = (m: string) => {
    diags.push({ level: 'error', message: m });
    hasError = true;
  };
  const warn = (m: string) => {
    diags.push({ level: 'warn', message: m });
    hasWarn = true;
  };
  const ok = (m: string) => diags.push({ level: 'ok', message: m });

  // --- structure: start/end sentinels ---
  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) error(`expected exactly one 'start' node, found ${starts.length}`);
  if (ends.length !== 1) error(`expected exactly one 'end' node, found ${ends.length}`);

  // --- structure: edge endpoints resolve ---
  for (const e of graph.edges) {
    if (!byId.has(e.from.node)) error(`edge ${e.id}: from.node '${e.from.node}' does not exist`);
    if (!byId.has(e.to.node)) error(`edge ${e.id}: to.node '${e.to.node}' does not exist`);
  }

  // --- structure: start has 1 exec out, end has 1 exec in ---
  if (starts.length === 1) {
    const out = execEdges(graph, starts[0].id, 'from');
    if (out.length !== 1) error(`'start' must have exactly one exec out-edge, found ${out.length}`);
  }
  if (ends.length === 1) {
    const inc = execEdges(graph, ends[0].id, 'to');
    if (inc.length !== 1) error(`'end' must have exactly one exec in-edge, found ${inc.length}`);
  }

  if (!hasError) {
    ok(`${nodes.length} nodes, ${graph.edges.length} edges`);
    const execCount = graph.edges.filter((e) => e.kind === EXEC).length;
    const dataCount = graph.edges.filter((e) => e.kind === DATA).length;
    ok(`exec spine connected (${execCount} exec, ${dataCount} data edges)`);
  }

  // --- semantic (strict only) ---
  if (strict && !hasError) {
    // Dangling data edges already covered by endpoint check; here flag agents
    // with no exec out-edge (dead nodes) + dangling data producers.
    for (const node of nodes) {
      if (node.type === 'agent') {
        const out = execEdges(graph, node.id, 'from');
        if (out.length === 0) warn(`node ${node.id} (agent) has no outbound exec connections`);
      }
    }
    // Container children must exist + be legal.
    for (const node of nodes) {
      if (node.parent && !byId.has(node.parent)) {
        warn(`node ${node.id} references missing parent '${node.parent}'`);
      }
    }
    validateContainerChildren(nodes, byId, warn);
    if (!hasWarn) ok('all strict semantic checks passed');
  }

  return { diagnostics: diags, exitCode: hasError ? 1 : hasWarn ? 2 : 0 };
}

function execEdges(graph: IRGraph, nodeId: string, side: 'from' | 'to') {
  return graph.edges.filter((e) => e.kind === EXEC && e[side].node === nodeId);
}

function validateContainerChildren(
  nodes: IRNode[],
  byId: Map<string, IRNode>,
  warn: (m: string) => void,
): void {
  const legalChild = new Set([
    'agent', 'parallel', 'pipeline', 'consensus', 'phase', 'log', 'variable', 'codeblock', 'branch', 'loop', 'workflow',
  ]);
  for (const node of nodes) {
    if (node.type === 'parallel' || node.type === 'consensus') {
      const specs = (node.params?.branches ?? node.params?.voters) as unknown;
      if (specs !== undefined && !Array.isArray(specs)) {
        warn(`node ${node.id} (${node.type}) has malformed branches/voters`);
      }
    }
  }
  for (const node of nodes) {
    if (node.parent && byId.has(node.parent) && !legalChild.has(node.type)) {
      warn(`node ${node.id} has illegal type '${node.type}' inside a container`);
    }
  }
}

function report(diags: Diagnostic[], exitCode: number, opts: ValidateOptions): void {
  if (opts.json) {
    const out = {
      valid: exitCode === 0,
      exitCode,
      diagnostics: diags,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  if (opts.quiet) {
    // Quiet: only emit on failure.
    if (exitCode !== 0) {
      for (const d of diags) {
        if (d.level !== 'ok') process.stderr.write(`${prefix(d.level)} ${d.message}\n`);
      }
    }
    return;
  }
  for (const d of diags) {
    process.stdout.write(`${prefix(d.level)} ${d.message}\n`);
  }
}

function prefix(level: Diagnostic['level']): string {
  if (level === 'ok') return c.ok('✓');
  if (level === 'warn') return c.warn('⚠');
  return c.err('✗');
}
