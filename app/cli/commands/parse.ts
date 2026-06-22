/**
 * `ugs parse <file>` — reverse a .js workflow script into an IRGraph (spec §3.3).
 * `--preserve-layout <file>` reuses an existing .ugs.json's layout; `--annotate`
 * prints parse stats to stderr.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA, EXEC, type IRGraph } from '../../src/core/ir';
import { parseClaudeScript } from '../../src/core/parser';
import { CliError, readInput, writeOutput } from '../utils/fs';
import { stringifyGraph, type GlobalOptions } from '../utils/format';

export interface ParseOptions extends GlobalOptions {
  output?: string;
  preserveLayout?: string;
  annotate?: boolean;
}

export async function runParse(file: string, opts: ParseOptions): Promise<number> {
  const { text } = await readInput(file);
  const graph = parseClaudeScript(text);

  if (opts.preserveLayout) {
    graph.layout = readLayout(opts.preserveLayout);
  }

  if (opts.annotate) {
    const execCount = graph.edges.filter((e) => e.kind === EXEC).length;
    const dataCount = graph.edges.filter((e) => e.kind === DATA).length;
    const codeblocks = graph.nodes.filter((n) => n.type === 'codeblock').length;
    process.stderr.write(
      `Parsed: ${graph.nodes.length} nodes, ${graph.edges.length} edges (${execCount} exec, ${dataCount} data)\n`,
    );
    if (codeblocks > 0) {
      process.stderr.write(
        `Warnings: ${codeblocks} unknown statement(s) → codeblock node\n`,
      );
    }
  }

  const json = stringifyGraph(graph, 'pretty');
  if (opts.output) {
    writeOutput(json, opts.output);
  } else {
    process.stdout.write(json.endsWith('\n') ? json : `${json}\n`);
  }
  return 0;
}

function readLayout(file: string): IRGraph['layout'] {
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    throw new CliError(`--preserve-layout file not found: ${file}`, 1);
  }
  try {
    const g = JSON.parse(readFileSync(abs, 'utf8')) as Partial<IRGraph>;
    return g.layout ?? {};
  } catch (err) {
    throw new CliError(`--preserve-layout file invalid: ${(err as Error).message}`, 2);
  }
}
