/**
 * `ugs info <file>` — display workflow metadata + node/edge stats (spec §3.9).
 * `.js` inputs are parsed first. `--json` for machine output.
 */
import { DATA, EXEC, type IRGraph, type NodeType } from '../../src/core/ir';
import { readInput } from '../utils/fs';
import { loadGraph, c, type GlobalOptions } from '../utils/format';

export interface InfoOptions extends GlobalOptions {}

export async function runInfo(file: string, opts: InfoOptions): Promise<number> {
  const { text } = await readInput(file);
  const graph = loadGraph(text, file);
  const stats = computeStats(graph, text.length);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return 0;
  }

  const lines: string[] = [];
  lines.push(`${c.bold('Name:')}        ${stats.name}`);
  lines.push(`${c.bold('Description:')} ${stats.description || c.dim('(none)')}`);
  lines.push(`${c.bold('Adapter:')}     ${stats.adapter}`);
  lines.push(`${c.bold('Nodes:')}       ${stats.nodeCount} (${stats.nodeBreakdown})`);
  lines.push(`${c.bold('Edges:')}       ${stats.edgeCount} (${stats.execEdges} exec, ${stats.dataEdges} data)`);
  if (stats.phases.length > 0) {
    lines.push(`${c.bold('Phases:')}      ${stats.phases.join(' → ')}`);
  }
  if (stats.lastRun) {
    lines.push(`${c.bold('Status:')}      last run ${stats.lastRun}`);
  }
  lines.push(`${c.bold('Size:')}        ${stats.sizeLabel}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

interface InfoStats {
  name: string;
  description: string;
  adapter: string;
  nodeCount: number;
  nodeBreakdown: string;
  nodeCounts: Record<string, number>;
  edgeCount: number;
  execEdges: number;
  dataEdges: number;
  phases: string[];
  lastRun: string | null;
  sizeBytes: number;
  sizeLabel: string;
}

function computeStats(graph: IRGraph, sizeBytes: number): InfoStats {
  const counts: Record<string, number> = {};
  for (const n of graph.nodes) {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
  }
  const order: NodeType[] = ['agent', 'parallel', 'pipeline', 'consensus', 'phase', 'branch', 'loop', 'workflow', 'log', 'variable', 'codeblock', 'start', 'end'];
  const breakdown = order
    .filter((t) => counts[t])
    .map((t) => `${counts[t]} ${t}`)
    .join(', ');
  const phases = graph.nodes
    .filter((n) => n.type === 'phase')
    .map((n) => String(n.params?.title ?? n.label ?? '').trim())
    .filter(Boolean);
  const run = graph.meta.run;
  const lastRun = run
    ? `${run.updatedAt ? new Date(run.updatedAt).toISOString().slice(0, 10) : '?'}, ${run.status}`
    : null;

  return {
    name: graph.meta.name ?? '(unnamed)',
    description: graph.meta.description ?? '',
    adapter: graph.meta.adapter ?? 'claude-code',
    nodeCount: graph.nodes.length,
    nodeBreakdown: breakdown,
    nodeCounts: counts,
    edgeCount: graph.edges.length,
    execEdges: graph.edges.filter((e) => e.kind === EXEC).length,
    dataEdges: graph.edges.filter((e) => e.kind === DATA).length,
    phases,
    lastRun,
    sizeBytes,
    sizeLabel: formatSize(sizeBytes),
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
