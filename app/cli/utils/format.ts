/**
 * Output formatting helpers: ANSI colour (chalk), simple aligned tables, IRGraph
 * load/normalisation, and shared global-flag plumbing for the CLI commands.
 *
 * Pure Node + chalk. No react / zustand / tauri. The `loadGraph` helper is the
 * single funnel that turns any input (.ugs.json / .js / .yaml) into an IRGraph
 * for the read-only commands (info / validate / emit / diff / convert / run).
 */
import chalk from 'chalk';
import type { IRGraph } from '../../src/core/ir';
import { parseClaudeScript } from '../../src/core/parser';
import { assertGraphShapeLite } from './assert';
import { detectFormat, parseJson } from './fs';
import { yamlToGraph } from './yaml';

/** Global flags resolved by the root command, shared with subcommands. */
export interface GlobalOptions {
  config?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  color?: boolean;
}

let colorEnabled = true;

/** Toggle ANSI colour globally (respects `--no-color` / NO_COLOR / non-TTY). */
export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
  // chalk@4 honours its `.level`; force 0 when disabled.
  (chalk as unknown as { level: number }).level = enabled ? (chalk.level || 1) : 0;
}

/** Resolve whether colour should be on, given a flag + environment. */
export function resolveColor(flag: boolean | undefined): boolean {
  if (flag === false) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY ?? false;
}

export const c = {
  ok: (s: string) => (colorEnabled ? chalk.green(s) : s),
  warn: (s: string) => (colorEnabled ? chalk.yellow(s) : s),
  err: (s: string) => (colorEnabled ? chalk.red(s) : s),
  dim: (s: string) => (colorEnabled ? chalk.gray(s) : s),
  bold: (s: string) => (colorEnabled ? chalk.bold(s) : s),
  cyan: (s: string) => (colorEnabled ? chalk.cyan(s) : s),
};

/** Render a simple left-aligned table (header row + rows), space-padded. */
export function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  const lines = [c.bold(fmt(header)), ...rows.map(fmt)];
  return lines.join('\n');
}

/**
 * Normalise any supported input text into an IRGraph. `.ugs.json` is parsed as
 * JSON and shape-checked; `.js` is run through `parseClaudeScript`; `.yaml` is
 * deserialised then (if it is a script) parsed. Throws {@link CliError} with the
 * spec'd exit codes on failure.
 */
export function loadGraph(
  text: string,
  file: string,
  formatHint?: string,
): IRGraph {
  const format = detectFormat(file, formatHint);
  if (format === 'js') {
    return parseClaudeScript(text);
  }
  if (format === 'yaml') {
    return yamlToGraph(text);
  }
  const raw = parseJson<IRGraph>(text, file === '-' ? 'stdin' : file);
  assertGraphShape(raw);
  return raw;
}

/** Minimal structural shape check for a parsed .ugs.json (exit code 3). */
export function assertGraphShape(g: unknown): asserts g is IRGraph {
  assertGraphShapeLite(g);
}

/** Pretty- or minified-print an IRGraph as JSON. */
export function stringifyGraph(g: IRGraph, format: 'pretty' | 'minified' = 'pretty'): string {
  return format === 'minified' ? JSON.stringify(g) : JSON.stringify(g, null, 2);
}
