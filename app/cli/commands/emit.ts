/**
 * `ugs emit <file>` — compile an IRGraph (.ugs.json) into a runnable Claude Code
 * workflow script (spec §3.2). Overrides adapter/schema, format pretty|minified,
 * optional `--strip-annotations`, `--dry-run`.
 */
import { emitClaudeScript } from '../../src/core/emitter';
import type { IRGraph } from '../../src/core/ir';
import { CliError, errMsg, readInput, writeOutput } from '../utils/fs';
import { loadGraph, type GlobalOptions } from '../utils/format';

export interface EmitOptions extends GlobalOptions {
  output?: string;
  adapter?: string;
  schema?: string[];
  format?: 'pretty' | 'minified';
  stripAnnotations?: boolean;
  dryRun?: boolean;
}

export async function runEmit(file: string, opts: EmitOptions): Promise<number> {
  const { text, source } = await readInput(file);
  const graph = loadGraph(text, file === '-' ? source : file, 'ugs');

  if (opts.adapter) graph.meta = { ...graph.meta, adapter: opts.adapter };
  if (opts.schema && opts.schema.length > 0) {
    const schemaDefs = { ...(graph.meta.schemaDefs ?? {}) };
    for (const entry of opts.schema) {
      const eq = entry.indexOf('=');
      if (eq === -1) {
        throw new CliError(`Invalid --schema (expected name=def): ${entry}`, 1);
      }
      schemaDefs[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim();
    }
    graph.meta = { ...graph.meta, schemaDefs };
  }

  let script: string;
  try {
    script = emitClaudeScript(graph as IRGraph);
  } catch (err) {
    throw new CliError(`emit failed: ${errMsg(err)}`, 4);
  }

  if (opts.stripAnnotations) {
    script = stripAnnotations(script);
  }
  if (opts.format === 'minified') {
    script = script.replace(/\n{2,}/g, '\n');
  }

  if (opts.dryRun) {
    if (!opts.quiet) process.stderr.write('emit ok (dry-run)\n');
    return 0;
  }

  if (opts.output) {
    writeOutput(script, opts.output);
  } else {
    process.stdout.write(script.endsWith('\n') ? script : `${script}\n`);
  }
  return 0;
}

/** Drop trailing `// @node …` and `// @schema …` annotations from each line. */
function stripAnnotations(script: string): string {
  return script
    .split('\n')
    .map((line) => line.replace(/\s*\/\/\s*@(node|schema)\b.*$/, ''))
    .join('\n');
}
