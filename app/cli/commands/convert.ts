/**
 * `ugs convert <file>` — convert between .ugs.json / .js / .yaml (spec §3.7).
 * Normalises to an IRGraph then re-serialises into the target format.
 * `--strip-layout` drops layout coordinates; `--strip-run` drops meta.run.
 */
import { emitClaudeScript } from '../../src/core/emitter';
import type { IRGraph } from '../../src/core/ir';
import { readInput, writeOutput } from '../utils/fs';
import { graphToYaml } from '../utils/yaml';
import { loadGraph, stringifyGraph, type GlobalOptions } from '../utils/format';

export interface ConvertOptions extends GlobalOptions {
  from?: 'auto' | 'ugs' | 'js' | 'yaml';
  to?: 'ugs' | 'js' | 'yaml';
  output?: string;
  stripLayout?: boolean;
  stripRun?: boolean;
}

export async function runConvert(file: string, opts: ConvertOptions): Promise<number> {
  const { text } = await readInput(file);
  const graph = loadGraph(text, file, opts.from);

  if (opts.stripLayout) delete graph.layout;
  if (opts.stripRun && graph.meta.run) {
    const meta = { ...graph.meta };
    delete meta.run;
    graph.meta = meta;
  }

  const to = opts.to ?? 'ugs';
  const out = serialise(graph as IRGraph, to);

  if (opts.output) {
    writeOutput(out, opts.output);
  } else {
    process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  }
  return 0;
}

function serialise(graph: IRGraph, to: 'ugs' | 'js' | 'yaml'): string {
  switch (to) {
    case 'ugs':
      return stringifyGraph(graph, 'pretty');
    case 'js':
      return emitClaudeScript(graph);
    case 'yaml':
      return graphToYaml(graph);
  }
}
