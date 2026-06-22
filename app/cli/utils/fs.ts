/**
 * Filesystem + stdin/stdout helpers for the Node CLI commands.
 *
 * Pure Node: `node:fs` / `node:path` / `process`. No react / zustand / tauri.
 * Centralises input reading (file or `-`/stdin), atomic-ish writes, and JSON
 * parsing with friendly errors so every command shares the same IO behaviour
 * and exit-code semantics.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

/** A read input: its resolved source label + text content. */
export interface ReadInput {
  /** 'stdin' or the resolved absolute path. */
  source: string;
  text: string;
}

/** Read stdin to a string (used for `-` / `--stdin`). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Whether a path argument denotes stdin. */
export function isStdinArg(file: string): boolean {
  return file === '-' || file === '--stdin';
}

/**
 * Read a CLI file argument. `-` / `--stdin` reads stdin; otherwise the file is
 * read from disk. Throws a {@link CliError} with code 1 when a file is missing
 * or unreadable.
 */
export async function readInput(file: string): Promise<ReadInput> {
  if (isStdinArg(file)) {
    return { source: 'stdin', text: await readStdin() };
  }
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    throw new CliError(`File not found: ${file}`, 1);
  }
  try {
    return { source: abs, text: readFileSync(abs, 'utf8') };
  } catch (err) {
    throw new CliError(`Cannot read file: ${file} (${errMsg(err)})`, 1);
  }
}

/** Parse JSON text with a friendly error (exit code 2 = parse failure). */
export function parseJson<T = unknown>(text: string, label = 'input'): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new CliError(`Invalid JSON in ${label}: ${errMsg(err)}`, 2);
  }
}

/** Write text either to a file (creating parent dirs) or stdout. */
export function writeOutput(text: string, outPath?: string): void {
  if (!outPath || outPath === '-') {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    return;
  }
  const abs = resolve(process.cwd(), outPath);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  } catch (err) {
    throw new CliError(`Cannot write file: ${outPath} (${errMsg(err)})`, 3);
  }
}

/** Detect a workflow input format by extension / `--format` hint. */
export function detectFormat(
  file: string,
  hint?: string,
): 'ugs' | 'js' | 'yaml' {
  if (hint && hint !== 'auto') {
    if (hint === 'ugs' || hint === 'js' || hint === 'yaml') return hint;
    if (hint === 'owf') return 'ugs'; // pre-rebrand format hint
  }
  const lower = file.toLowerCase();
  // `.owf.json` is the pre-rebrand extension; treat it as the `ugs` format.
  if (lower.endsWith('.ugs.json') || lower.endsWith('.owf.json') || lower.endsWith('.json'))
    return 'ugs';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.ts'))
    return 'js';
  return 'ugs';
}

/** A CLI error carrying the process exit code to use. */
export class CliError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
