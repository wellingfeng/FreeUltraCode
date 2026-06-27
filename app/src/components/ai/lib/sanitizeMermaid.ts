/**
 * CONTRACT: sanitizeMermaid(code) -> mermaid source with node labels quoted.
 *
 * Models routinely emit flowchart labels containing characters that mermaid's
 * grammar treats as syntax: a colon (`A[采样: 权重]`), a double quote
 * (`B[按"无遮挡贡献"抽样]`), a slash, parentheses, etc. Unquoted, those abort the
 * whole parse with "Expecting 'SQE'… got 'STR'", so the diagram never renders.
 *
 * Mermaid lets any text be a label when it is wrapped in double quotes, so this
 * pure pre-pass walks the source, finds each node-shape body (`[...]`, `(...)`,
 * `{...}`, `([...])`, `[[...]]`, `((...))`, `{{...}}`, `[(...)]`) that directly
 * follows a node id, and wraps the inner text in quotes — escaping any inner `"`
 * as the HTML entity `#quot;` that mermaid restores in the rendered label.
 *
 * Bodies that are already quoted are left untouched, and shapes are only quoted
 * when they immediately follow an identifier char so edge labels and arrows
 * (`-->|text|`, `A -- text -->`) are not disturbed. Only applied to flowchart /
 * graph diagrams, where this `id[label]` syntax exists.
 */

type Shape = readonly [open: string, close: string];

// Longest openers first so `[[` wins over `[`, `([` over `(`, etc.
const SHAPES: readonly Shape[] = [
  ['[[', ']]'],
  ['[(', ')]'],
  ['((', '))'],
  ['{{', '}}'],
  ['([', '])'],
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
];

const FLOWCHART_HEADER = /^\s*(?:flowchart|graph)\b/im;

// An identifier char that can precede a node shape (ASCII word chars plus CJK so
// unicode node ids still anchor the shape).
function isIdChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[\w一-鿿]/.test(ch);
}

function quoteLabel(inner: string): string {
  return `"${inner.replace(/"/g, '#quot;')}"`;
}

/**
 * Wrap unquoted flowchart node labels in quotes so special characters (`:`, `"`,
 * `/`, parentheses, …) inside them no longer break mermaid's parser. Non-flowchart
 * diagrams and already-valid sources pass through effectively unchanged.
 */
export function sanitizeMermaid(code: string): string {
  if (!FLOWCHART_HEADER.test(code)) return code;

  let out = '';
  let i = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];

    // Pass through an existing quoted string verbatim so we never double-wrap.
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      const stop = end === -1 ? n : end + 1;
      out += code.slice(i, stop);
      i = stop;
      continue;
    }

    if (isIdChar(code[i - 1])) {
      let matched = false;
      for (const [open, close] of SHAPES) {
        if (!code.startsWith(open, i)) continue;
        const end = code.indexOf(close, i + open.length);
        if (end === -1) continue;
        const inner = code.slice(i + open.length, end);
        const trimmed = inner.trim();
        const alreadyQuoted =
          trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
        // Skip empty bodies and ones already quoted; quote everything else.
        const body = trimmed.length === 0 || alreadyQuoted ? inner : quoteLabel(inner);
        out += open + body + close;
        i = end + close.length;
        matched = true;
        break;
      }
      if (matched) continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
