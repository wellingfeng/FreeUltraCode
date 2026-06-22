/**
 * Minimal, dependency-free YAML <-> IRGraph (de)serialiser for `ugs convert`.
 *
 * Scope: enough YAML to round-trip an IRGraph (the JSON data model — maps, lists,
 * strings, numbers, booleans, null). NOT a general YAML parser; anchors, tags,
 * flow-folding, multi-doc etc. are out of scope. We emit block style with 2-space
 * indentation and parse the same shape back. For anything richer, the spec allows
 * a real lib, but we keep the dependency surface minimal per the constraints.
 *
 * Pure Node. No react / zustand / tauri.
 */
import type { IRGraph } from '../../src/core/ir';
import { assertGraphShapeLite } from './assert';

/** Serialise an IRGraph to block-style YAML. */
export function graphToYaml(graph: IRGraph): string {
  return dump(graph as unknown, 0).replace(/\n+$/, '') + '\n';
}

/** Parse block-style YAML (as produced by {@link graphToYaml}) into an IRGraph. */
export function yamlToGraph(text: string): IRGraph {
  const value = parseYaml(text);
  assertGraphShapeLite(value);
  return value as IRGraph;
}

// ---------------------------------------------------------------------------
// Dumper
// ---------------------------------------------------------------------------

function dump(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return `${scalar(value)}\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `[]\n`;
    let out = '';
    for (const item of value) {
      if (isContainer(item)) {
        const nested = dump(item, indent + 1).replace(/^ {2}/, '');
        out += `${pad}- ${nested.startsWith(pad) ? nested.slice(pad.length) : nested}`;
      } else {
        out += `${pad}- ${scalar(item)}\n`;
      }
    }
    return out;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `{}\n`;
    let out = '';
    for (const [k, v] of entries) {
      if (v === undefined) continue;
      if (isContainer(v) && !(Array.isArray(v) && v.length === 0) && Object.keys(v as object).length > 0) {
        out += `${pad}${key(k)}:\n${dump(v, indent + 1)}`;
      } else {
        out += `${pad}${key(k)}: ${dump(v, indent).trimStart()}`;
      }
    }
    return out;
  }
  return `${scalar(value)}\n`;
}

function isContainer(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

function key(k: string): string {
  return /^[A-Za-z0-9_]+$/.test(k) ? k : JSON.stringify(k);
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '') return '""';
  // Quote when it could be misread as a non-string scalar or contains specials.
  if (
    /[:#\-?[\]{}&*!|>'"%@`]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /[\n\t]/.test(s) ||
    /^(true|false|null|~|\d)/i.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Parser (indentation-based block YAML, the subset we emit)
// ---------------------------------------------------------------------------

interface Line {
  indent: number;
  content: string;
  raw: string;
}

function parseYaml(text: string): unknown {
  const lines: Line[] = [];
  for (const raw of text.split('\n')) {
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ indent, content: stripped.trim(), raw: stripped });
  }
  const [value] = parseBlock(lines, 0, 0);
  return value;
}

function stripComment(line: string): string {
  // Remove trailing comments not inside quotes (best-effort for our own output).
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr && line[i - 1] !== '\\') inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

function parseBlock(lines: Line[], start: number, indent: number): [unknown, number] {
  if (start >= lines.length) return [null, start];
  const first = lines[start];
  if (first.content.startsWith('- ')) {
    return parseList(lines, start, first.indent);
  }
  return parseMap(lines, start, indent === 0 ? first.indent : indent);
}

function parseList(lines: Line[], start: number, indent: number): [unknown[], number] {
  const arr: unknown[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && lines[i].content.startsWith('- ')) {
    const itemContent = lines[i].content.slice(2);
    if (itemContent.includes(': ') || /:\s*$/.test(itemContent)) {
      // Inline map start on the dash line: re-synthesise as a deeper map block.
      const synthetic: Line[] = [
        { indent: indent + 2, content: itemContent, raw: itemContent },
      ];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        synthetic.push(lines[j]);
        j += 1;
      }
      const [val] = parseMap(synthetic, 0, indent + 2);
      arr.push(val);
      i = j;
    } else {
      arr.push(parseScalar(itemContent));
      i += 1;
    }
  }
  return [arr, i];
}

function parseMap(lines: Line[], start: number, indent: number): [Record<string, unknown>, number] {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].content.startsWith('- ')) {
    const { content } = lines[i];
    const colon = findColon(content);
    if (colon === -1) {
      i += 1;
      continue;
    }
    const rawKey = content.slice(0, colon).trim();
    const k = rawKey.startsWith('"') ? (JSON.parse(rawKey) as string) : rawKey;
    const rest = content.slice(colon + 1).trim();
    if (rest === '') {
      // Nested block follows.
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent + 2;
      if (i + 1 < lines.length && childIndent > indent) {
        const [val, next] = parseBlock(lines, i + 1, childIndent);
        obj[k] = val;
        i = next;
      } else {
        obj[k] = null;
        i += 1;
      }
    } else {
      obj[k] = parseScalar(rest);
      i += 1;
    }
  }
  return [obj, i];
}

function findColon(content: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (inStr) {
      if (ch === inStr && content[i - 1] !== '\\') inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === ':' && (i + 1 >= content.length || content[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s;
    }
  }
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
