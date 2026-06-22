/**
 * `ugs diff <fileA> <fileB>` — structural comparison of two workflows (spec §3.8).
 * Both inputs are normalised to IRGraph first (mixed .ugs.json/.js/.yaml ok).
 * `--ignore-layout` drops layout; `--ignore-ids` compares structure modulo ids;
 * `--json` emits a machine diff.
 */
import type { IRGraph, IRNode } from '../../src/core/ir';
import { readInput } from '../utils/fs';
import { loadGraph, c, type GlobalOptions } from '../utils/format';

export interface DiffOptions extends GlobalOptions {
  ignoreLayout?: boolean;
  ignoreIds?: boolean;
}

interface DiffEntry {
  section: 'meta' | 'nodes' | 'edges';
  op: 'add' | 'remove' | 'change';
  detail: string;
}

export async function runDiff(fileA: string, fileB: string, opts: DiffOptions): Promise<number> {
  const [a, b] = await Promise.all([readInput(fileA), readInput(fileB)]);
  const ga = loadGraph(a.text, fileA);
  const gb = loadGraph(b.text, fileB);

  const entries = computeDiff(ga, gb, opts);

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ identical: entries.length === 0, changes: entries }, null, 2)}\n`,
    );
    return entries.length === 0 ? 0 : 1;
  }

  if (entries.length === 0) {
    if (!opts.quiet) process.stdout.write('No differences.\n');
    return 0;
  }

  const lines: string[] = [];
  lines.push(c.dim(`--- ${fileA}`));
  lines.push(c.dim(`+++ ${fileB}`));
  let section = '';
  for (const e of entries) {
    if (e.section !== section) {
      section = e.section;
      lines.push(c.bold(`@@ ${section} @@`));
    }
    if (e.op === 'add') lines.push(c.ok(`+ ${e.detail}`));
    else if (e.op === 'remove') lines.push(c.err(`- ${e.detail}`));
    else lines.push(c.warn(`~ ${e.detail}`));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 1;
}

function computeDiff(a: IRGraph, b: IRGraph, opts: DiffOptions): DiffEntry[] {
  const entries: DiffEntry[] = [];

  // meta
  const metaKeys = new Set([...Object.keys(a.meta), ...Object.keys(b.meta)]);
  for (const k of metaKeys) {
    if (k === 'run') continue; // volatile run snapshot is not a structural diff
    const av = (a.meta as Record<string, unknown>)[k];
    const bv = (b.meta as Record<string, unknown>)[k];
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      entries.push({ section: 'meta', op: 'change', detail: `${k}: ${short(av)} → ${short(bv)}` });
    }
  }

  // nodes
  if (opts.ignoreIds) {
    const mapA = nodeStructureMultiset(a.nodes);
    const mapB = nodeStructureMultiset(b.nodes);
    diffMultiset(mapA, mapB, 'nodes', entries);
  } else {
    const byA = new Map(a.nodes.map((n) => [n.id, n]));
    const byB = new Map(b.nodes.map((n) => [n.id, n]));
    for (const n of b.nodes) if (!byA.has(n.id)) entries.push({ section: 'nodes', op: 'add', detail: describeNode(n) });
    for (const n of a.nodes) if (!byB.has(n.id)) entries.push({ section: 'nodes', op: 'remove', detail: describeNode(n) });
    for (const n of a.nodes) {
      const other = byB.get(n.id);
      if (other && nodeKey(n) !== nodeKey(other)) {
        entries.push({ section: 'nodes', op: 'change', detail: `${n.id}: ${describeNode(n)} → ${describeNode(other)}` });
      }
    }
  }

  // edges
  const edgeKeyFn = (e: IRGraph['edges'][number]) =>
    opts.ignoreIds
      ? `${e.kind}:${e.from.port}→${e.to.port}`
      : `${e.kind}:${e.from.node}.${e.from.port}→${e.to.node}.${e.to.port}`;
  const setA = new Set(a.edges.map(edgeKeyFn));
  const setB = new Set(b.edges.map(edgeKeyFn));
  for (const e of b.edges) if (!setA.has(edgeKeyFn(e))) entries.push({ section: 'edges', op: 'add', detail: `${e.kind}: ${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port}` });
  for (const e of a.edges) if (!setB.has(edgeKeyFn(e))) entries.push({ section: 'edges', op: 'remove', detail: `${e.kind}: ${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port}` });

  return entries;
}

function nodeKey(n: IRNode): string {
  return `${n.type}|${n.label ?? ''}|${JSON.stringify(n.params)}`;
}

function nodeStructureMultiset(nodes: IRNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of nodes) {
    const k = `${n.type}|${JSON.stringify(n.params)}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function diffMultiset(
  a: Map<string, number>,
  b: Map<string, number>,
  section: DiffEntry['section'],
  out: DiffEntry[],
): void {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const ca = a.get(k) ?? 0;
    const cb = b.get(k) ?? 0;
    if (cb > ca) out.push({ section, op: 'add', detail: `${k.split('|')[0]} ×${cb - ca}` });
    else if (ca > cb) out.push({ section, op: 'remove', detail: `${k.split('|')[0]} ×${ca - cb}` });
  }
}

function describeNode(n: IRNode): string {
  const extra =
    n.type === 'agent'
      ? ` (${String(n.params?.agentType ?? 'agent')}${n.params?.model ? `, model=${n.params.model}` : ''})`
      : '';
  return `${n.type} "${n.id}"${extra}`;
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 60 ? `${s.slice(0, 57)}...` : String(s);
}
