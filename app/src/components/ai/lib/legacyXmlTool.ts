import {
  encodeToolPatch,
  type ToolEventPatch,
} from './toolEvent';

export interface LegacyXmlToolSplit {
  text: string;
  patches: ToolEventPatch[];
  parts: Array<{ text: string } | { patch: ToolEventPatch }>;
}

export interface LegacyXmlToolOptions {
  streamingTail?: boolean;
}

const INVOKE_OPEN_RE =
  /<invoke\b[^>]*\bname\s*=\s*(["'])([^"']+)\1[^>]*>/i;
const INVOKE_CLOSE_RE = /<\/invoke\s*>/i;
const PARAM_RE =
  /<parameter\b[^>]*\bname\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/parameter\s*>/gi;

const SUBJECT_KEYS = [
  'command',
  'pattern',
  'file_path',
  'path',
  'query',
  'url',
  'description',
];

export function hasLegacyXmlTool(text: string): boolean {
  return lineStartInvokeIndex(text, 0) !== -1;
}

export function legacyXmlToolsToSentinels(
  text: string,
  options: LegacyXmlToolOptions = {},
): string {
  const split = extractLegacyXmlTools(text, options);
  if (split.patches.length === 0) return text;
  return split.parts
    .map((part) => ('text' in part ? part.text : encodeToolPatch(part.patch)))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
}

export function extractLegacyXmlTools(
  text: string,
  options: LegacyXmlToolOptions = {},
): LegacyXmlToolSplit {
  const { streamingTail = false } = options;
  const patches: ToolEventPatch[] = [];
  const parts: Array<{ text: string } | { patch: ToolEventPatch }> = [];
  let out = '';
  let cursor = 0;

  for (;;) {
    const open = lineStartInvokeIndex(text, cursor);
    if (open === -1) {
      const tail = text.slice(cursor);
      out += tail;
      if (tail) parts.push({ text: tail });
      break;
    }

    const consumeStart = consumePrecedingResidue(text, open);
    const before = text.slice(cursor, consumeStart);
    out += before;
    if (before) parts.push({ text: before });

    const openTag = readInvokeOpenTag(text, open);
    if (!openTag) {
      const literal = text.slice(open, open + '<invoke'.length);
      out += literal;
      parts.push({ text: literal });
      cursor = open + literal.length;
      continue;
    }

    const close = findInvokeClose(text, open + openTag.length);
    if (close === -1) {
      if (!streamingTail) {
        const tail = text.slice(consumeStart);
        out += tail;
        if (tail) parts.push({ text: tail });
      } else {
        const patch = parseInvokePatch(
          text.slice(open),
          openTag,
          true,
        );
        patches.push(patch);
        parts.push({ patch });
      }
      break;
    }

    const closeTag = text.slice(close).match(INVOKE_CLOSE_RE)?.[0] ?? '</invoke>';
    const blockEnd = close + closeTag.length;
    const block = text.slice(open, blockEnd);
    const patch = parseInvokePatch(block, openTag, false);
    patches.push(patch);
    parts.push({ patch });
    cursor = consumeFollowingResidue(text, blockEnd);
  }

  return { text: out, patches, parts };
}

function lineStartInvokeIndex(text: string, from: number): number {
  let cursor = from;
  for (;;) {
    const idx = text.toLowerCase().indexOf('<invoke', cursor);
    if (idx === -1) return -1;
    const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
    if (
      /^[ \t]*$/.test(text.slice(lineStart, idx)) &&
      !isInsideMarkdownFence(text, idx)
    ) {
      return idx;
    }
    cursor = idx + '<invoke'.length;
  }
}

function isInsideMarkdownFence(text: string, offset: number): boolean {
  const matches = text.slice(0, offset).match(/(?:^|\n)(?:```|~~~)/g);
  return ((matches?.length ?? 0) % 2) === 1;
}

function readInvokeOpenTag(text: string, open: number): string | null {
  const end = text.indexOf('>', open);
  if (end === -1) return null;
  const tag = text.slice(open, end + 1);
  return INVOKE_OPEN_RE.test(tag) ? tag : null;
}

function findInvokeClose(text: string, from: number): number {
  const m = INVOKE_CLOSE_RE.exec(text.slice(from));
  return m ? from + m.index : -1;
}

function consumePrecedingResidue(text: string, invokeOpen: number): number {
  let consumeStart = text.lastIndexOf('\n', invokeOpen - 1) + 1;
  for (;;) {
    if (consumeStart <= 0) return consumeStart;
    const previousEnd = consumeStart - 1;
    const previousStart = text.lastIndexOf('\n', previousEnd - 1) + 1;
    const previousLine = text.slice(previousStart, previousEnd);
    if (!isProtocolResidueLine(previousLine)) return consumeStart;
    consumeStart = previousStart;
  }
}

function consumeFollowingResidue(text: string, from: number): number {
  let cursor = from;
  for (;;) {
    const m =
      /^[ \t]*(?:\r?\n)?[ \t]*(?:<\/?(?:function_calls|tool_calls|antml:function_calls)\s*>|function_calls|tool_calls)[ \t]*(?:\r?\n)?/i.exec(
        text.slice(cursor),
      );
    if (!m) return cursor;
    cursor += m[0].length;
  }
}

function isProtocolResidueLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:count|function_calls|tool_calls|<\/?(?:function_calls|tool_calls|antml:function_calls)\s*>)$/i.test(
    trimmed,
  );
}

function parseInvokePatch(
  block: string,
  openTag: string,
  partial: boolean,
): ToolEventPatch {
  const name = parseInvokeName(openTag) ?? 'tool';
  const args = parseParameters(block);
  const subject = subjectFromArgs(args);
  const patch: ToolEventPatch = {
    id: `legacy-xml-${stableHash(`${name}\0${subject ?? ''}\0${JSON.stringify(args)}`)}`,
    name,
    status: partial ? 'running' : 'done',
  };
  if (subject) patch.subject = subject;
  if (Object.keys(args).length > 0) patch.args = args;
  return patch;
}

function parseInvokeName(openTag: string): string | null {
  const m = INVOKE_OPEN_RE.exec(openTag);
  return m ? decodeXmlEntities(m[2]).trim() || null : null;
}

function parseParameters(block: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  PARAM_RE.lastIndex = 0;
  for (let m = PARAM_RE.exec(block); m; m = PARAM_RE.exec(block)) {
    const key = decodeXmlEntities(m[2]).trim();
    if (!key) continue;
    const value = decodeXmlEntities(m[3]).trim();
    if (key in args) {
      const existing = args[key];
      args[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      args[key] = value;
    }
  }
  return args;
}

function subjectFromArgs(args: Record<string, unknown>): string | undefined {
  for (const key of SUBJECT_KEYS) {
    const value = args[key];
    if (typeof value !== 'string') continue;
    const subject = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    if (subject) return subject;
  }
  return undefined;
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi,
    (entity, dec: string | undefined, hex: string | undefined) => {
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch (entity.toLowerCase()) {
        case '&amp;':
          return '&';
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        default:
          return entity;
      }
    },
  );
}

function stableHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(36);
}
