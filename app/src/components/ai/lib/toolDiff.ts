/**
 * Build a unified-diff body for Edit/Write tool calls so the renderer can
 * display the actual red/green line changes instead of a raw JSON args blob.
 *
 * The shape is what `highlight.js` diff grammar expects:
 *   --- a/path
 *   +++ b/path
 *   @@ -1,N +1,M @@
 *    ctx
 *   -old
 *   +new
 *
 * We don't run a real diff algorithm — Edit already hands us the exact
 * `old_string` / `new_string` pair, so we emit them as the sole hunk. Context
 * is omitted on purpose: the user's ask is to see *what changed*, and the
 * model already supplies the smallest matched region.
 */

export interface ToolDiffArgs {
  file_path?: unknown;
  old_string?: unknown;
  new_string?: unknown;
  content?: unknown;
}

function asText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v;
}

/** True when args look like an Edit/Write payload that we can diff-render. */
export function isDiffableEditArgs(name: string, args: unknown): args is ToolDiffArgs {
  if (!args || typeof args !== 'object') return false;
  const n = name.toLowerCase();
  if (!/^(edit|write|multi_?edit|str_?replace|file_?write|create)/.test(n)) return false;
  const a = args as ToolDiffArgs;
  // Edit: needs old+new. Write/create: needs content. str_replace: old+new.
  const hasEditPair = asText(a.old_string) !== null && asText(a.new_string) !== null;
  const hasWriteBody = asText(a.content) !== null && asText(a.file_path) !== null;
  return hasEditPair || hasWriteBody;
}

/** Render Edit (old→new) or Write (new content) args as a unified-diff body. */
export function buildEditDiff(name: string, args: ToolDiffArgs): string | null {
  const path = asText(args.file_path) ?? '(unknown)';
  const n = name.toLowerCase();
  const isWrite = /^(write|create|file_?write)/.test(n) && asText(args.content) !== null;

  const oldText = isWrite ? '' : asText(args.old_string) ?? '';
  const newText = isWrite ? asText(args.content) ?? '' : asText(args.new_string) ?? '';
  if (!isWrite && oldText === '' && newText === '') return null;

  const oldLines = oldText.length ? oldText.split('\n') : [];
  const newLines = newText.length ? newText.split('\n') : [];
  // Splitting "a\n" yields ["a", ""] — drop the trailing empty sentinel so line
  // counts match what a user sees in an editor.
  if (oldLines.length && oldLines[oldLines.length - 1] === '') oldLines.pop();
  if (newLines.length && newLines[newLines.length - 1] === '') newLines.pop();

  const oldCount = oldLines.length;
  const newCount = newLines.length;
  // For pure-addition (Write) or pure-deletion, the empty side uses start=0.
  const oldStart = oldCount === 0 ? 0 : 1;
  const newStart = newCount === 0 ? 0 : 1;

  const header = `--- a/${path}\n+++ b/${path}\n@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  const body = [
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
  ].join('\n');
  return body ? `${header}\n${body}` : header;
}
