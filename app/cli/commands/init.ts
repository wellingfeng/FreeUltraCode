/**
 * `ugs init [name]` — create a minimal, legal IRGraph (spec §3.1).
 *
 * Templates: blank / agent-pipeline / code-review / parallel-scan (built-in) plus
 * any `~/.ugs/templates/<name>.ugs.json`. `--from <script>` reverse-imports a .js
 * via parseClaudeScript. Output to `<name>.ugs.json` or `--stdout`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA, EXEC, type IRGraph } from '../../src/core/ir';
import { defaultBlueprint } from '../../src/core/defaultBlueprint';
import { normalizeWorkflowNodeNumbers } from '../../src/core/nodeNumbers';
import { parseClaudeScript } from '../../src/core/parser';
import { CliError, readInput, writeOutput } from '../utils/fs';
import { stringifyGraph } from '../utils/format';
import { assertGraphShapeLite } from '../utils/assert';
import type { GlobalOptions } from '../utils/format';

export interface InitOptions extends GlobalOptions {
  template?: string;
  from?: string;
  output?: string;
  stdout?: boolean;
  adapter?: string;
}

export async function runInit(name: string | undefined, opts: InitOptions): Promise<number> {
  if (name !== undefined) {
    if (!name.trim() || /[\\/]/.test(name)) {
      throw new CliError(`Invalid workflow name: ${JSON.stringify(name)}`, 1);
    }
  }
  const workflowName = name?.trim() || 'untitled-workflow';
  const adapter = opts.adapter || 'claude-code';

  let graph: IRGraph;
  if (opts.from) {
    const { text } = await readInput(opts.from);
    graph = parseClaudeScript(text);
  } else if (opts.template) {
    graph = loadTemplate(opts.template, workflowName);
  } else {
    graph = defaultBlueprint(workflowName);
  }

  graph = normalizeWorkflowNodeNumbers({
    ...graph,
    meta: { ...graph.meta, name: workflowName, adapter },
  });

  const json = stringifyGraph(graph, 'pretty');
  if (opts.stdout) {
    process.stdout.write(json.endsWith('\n') ? json : `${json}\n`);
  } else {
    const out = opts.output || `${workflowName}.ugs.json`;
    writeOutput(json, out);
    if (!opts.quiet) process.stderr.write(`Created ${out}\n`);
  }
  return 0;
}

function loadTemplate(template: string, name: string): IRGraph {
  // User template wins.
  const userPath = join(homedir(), '.ugs', 'templates', `${template}.ugs.json`);
  if (existsSync(userPath)) {
    try {
      const g = JSON.parse(readFileSync(userPath, 'utf8')) as unknown;
      assertGraphShapeLite(g);
      return g;
    } catch (err) {
      throw new CliError(
        `Template ${template} is invalid: ${(err as Error).message}`,
        2,
      );
    }
  }
  const builtin = BUILTIN_TEMPLATES[template];
  if (!builtin) {
    throw new CliError(
      `Unknown template: ${template} (available: ${Object.keys(BUILTIN_TEMPLATES).join(', ')})`,
      2,
    );
  }
  return builtin(name);
}

/** A minimal start→end spine with a list of agent steps wired in sequence. */
function spine(name: string, steps: Array<{ id: string; label: string; params: Record<string, unknown> }>): IRGraph {
  const nodes = [
    { id: 'n_start', type: 'start' as const, label: 'Start', params: { userInputs: [] } },
    ...steps.map((s) => ({ id: s.id, type: 'agent' as const, label: s.label, params: s.params })),
    { id: 'n_end', type: 'end' as const, label: 'End', params: {} },
  ];
  const seq = ['n_start', ...steps.map((s) => s.id), 'n_end'];
  const edges = seq.slice(0, -1).map((from, i) => ({
    id: `e_${from}_${seq[i + 1]}`,
    from: { node: from, port: 'exec_out' },
    to: { node: seq[i + 1], port: 'exec_in' },
    kind: EXEC,
  }));
  const layout: IRGraph['layout'] = {};
  seq.forEach((id, i) => (layout![id] = { x: i * 240, y: 160 }));
  return { version: 1, meta: { name, adapter: 'claude-code' }, nodes, edges, layout };
}

const BUILTIN_TEMPLATES: Record<string, (name: string) => IRGraph> = {
  blank: (name) => ({
    version: 1,
    meta: { name, adapter: 'claude-code' },
    nodes: [
      { id: 'n_start', type: 'start', label: 'Start', params: { userInputs: [] } },
      { id: 'n_end', type: 'end', label: 'End', params: {} },
    ],
    edges: [
      {
        id: 'e_start_end',
        from: { node: 'n_start', port: 'exec_out' },
        to: { node: 'n_end', port: 'exec_in' },
        kind: EXEC,
      },
    ],
    layout: { n_start: { x: 0, y: 160 }, n_end: { x: 240, y: 160 } },
  }),
  'agent-pipeline': (name) =>
    spine(name, [
      { id: 'n_explore', label: 'Explore', params: { agentType: 'explore', prompt: 'Survey the codebase and list the relevant files.' } },
      { id: 'n_implement', label: 'Implement', params: { agentType: 'executor', prompt: 'Implement the requested change.' } },
      { id: 'n_verify', label: 'Verify', params: { agentType: 'verifier', prompt: 'Verify the change works and tests pass.' } },
    ]),
  'code-review': (name) => {
    const g = spine(name, [
      { id: 'n_scan', label: 'Scan changes', params: { agentType: 'explore', model: 'haiku', prompt: 'Scan the changeset and list touched files and symbols.' } },
    ]);
    // Insert a parallel review node between scan and end.
    g.nodes.splice(g.nodes.length - 1, 0, {
      id: 'n_review',
      type: 'parallel',
      label: 'Review (parallel)',
      params: {
        branches: [
          { prompt: 'Review code quality and maintainability.', agentType: 'quality-reviewer' },
          { prompt: 'Review security and trust boundaries.', agentType: 'security-reviewer' },
        ],
      },
    });
    g.edges = [
      { id: 'e_start_scan', from: { node: 'n_start', port: 'exec_out' }, to: { node: 'n_scan', port: 'exec_in' }, kind: EXEC },
      { id: 'e_scan_review', from: { node: 'n_scan', port: 'exec_out' }, to: { node: 'n_review', port: 'exec_in' }, kind: EXEC },
      { id: 'e_review_end', from: { node: 'n_review', port: 'exec_out' }, to: { node: 'n_end', port: 'exec_in' }, kind: EXEC },
      { id: 'd_scan_review', from: { node: 'n_scan', port: 'data_out' }, to: { node: 'n_review', port: 'data_in' }, kind: DATA },
    ];
    g.layout = { n_start: { x: 0, y: 160 }, n_scan: { x: 240, y: 160 }, n_review: { x: 480, y: 160 }, n_end: { x: 720, y: 160 } };
    return g;
  },
  'parallel-scan': (name) => {
    const g = spine(name, []);
    g.nodes.splice(g.nodes.length - 1, 0, {
      id: 'n_scan',
      type: 'parallel',
      label: 'Parallel scan',
      params: {
        branches: [
          { prompt: 'Scan for security issues.', agentType: 'security-reviewer' },
          { prompt: 'Scan for performance issues.', agentType: 'quality-reviewer' },
          { prompt: 'Scan for style issues.', agentType: 'quality-reviewer' },
        ],
      },
    });
    g.edges = [
      { id: 'e_start_scan', from: { node: 'n_start', port: 'exec_out' }, to: { node: 'n_scan', port: 'exec_in' }, kind: EXEC },
      { id: 'e_scan_end', from: { node: 'n_scan', port: 'exec_out' }, to: { node: 'n_end', port: 'exec_in' }, kind: EXEC },
    ];
    g.layout = { n_start: { x: 0, y: 160 }, n_scan: { x: 240, y: 160 }, n_end: { x: 480, y: 160 } };
    return g;
  },
};

export const BUILTIN_TEMPLATE_NAMES = Object.keys(BUILTIN_TEMPLATES);
