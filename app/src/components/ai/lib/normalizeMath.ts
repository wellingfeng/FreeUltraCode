/**
 * CONTRACT: normalizeMath(md) -> md with LaTeX delimiters remark-math understands.
 *
 * LLMs frequently emit math using the LaTeX `\(inline\)` / `\[display\]`
 * delimiters, but remark-math only recognises `$inline$` / `$$display$$`. This
 * pure pre-pass rewrites the former to the latter. It ALSO escapes bare currency
 * dollar signs (`$5`, `$10.50`) to `\$` so single-dollar math mode does not
 * treat the span between two prices as a math expression — the most common
 * false positive in chat prose. Code fences and inline code are masked out first
 * so a literal `\(` or `$` inside a code sample is never touched.
 */

const FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const DISPLAY = /\\\[([\s\S]+?)\\\]/g;
const INLINE = /\\\(([\s\S]+?)\\\)/g;
// A `$` directly followed by a digit is overwhelmingly currency, not the start
// of an inline math span (math rarely opens with a bare number). Escape it,
// unless it is already escaped or is the second `$` of a `$$` display fence.
const CURRENCY = /(?<![\\$])\$(?=\d)/g;

// Opaque placeholder token (private-use char) to mask code spans during rewrite.
// Written as fromCharCode so the invisible char can never be silently stripped
// by an editor (that exact accident once broke protectWindowsPaths).
const MARK = String.fromCharCode(0xE000);

/** Replace `\( … \)` and `\[ … \]` with `$ … $` / `$$ … $$`, and escape currency. */
export function normalizeMath(md: string): string {
  const hasLatex = md.includes('\\(') || md.includes('\\[');
  const hasCurrency = /\$\d/.test(md);
  if (!hasLatex && !hasCurrency) return md;

  const stash: string[] = [];
  const mask = (s: string): string => {
    stash.push(s);
    return `${MARK}${stash.length - 1}${MARK}`;
  };

  let out = md.replace(FENCE, mask).replace(INLINE_CODE, mask);

  out = out
    .replace(DISPLAY, (_m, body: string) => `$$${body}$$`)
    .replace(INLINE, (_m, body: string) => `$${body}$`)
    .replace(CURRENCY, '\\$');

  out = out.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, i: string) => stash[Number(i)] ?? _m,
  );
  return out;
}
