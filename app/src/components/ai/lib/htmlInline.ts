/**
 * CONTRACT: convertInlineHtml(md) -> md with inline formatting HTML turned into
 * Markdown.
 *
 * Many models wrap emphasis in literal HTML tags inside otherwise-Markdown prose
 * (`核心是 <b>ReSTIR</b>`). react-markdown does not parse raw HTML, so those tags
 * render as escaped literal text (`<b>ReSTIR</b>`), and the `/b` from the closing
 * tag is even mistaken for a file path and rendered as a `📄 /b` chip. Both look
 * broken.
 *
 * This pure pre-pass rewrites a small allowlist of inline formatting tags to
 * their Markdown equivalents (`<b>`/`<strong>` -> `**`, `<i>`/`<em>` -> `*`,
 * `<code>` -> `` ` ``, `<del>`/`<s>`/`<strike>` -> `~~`, `<br>` -> line break) and
 * drops a couple of harmless wrappers (`<u>`, `<span>`). Tags are matched with
 * optional inner whitespace (`< / b >`) and optional attributes so sloppy output
 * is still cleaned. Code fences and inline code are masked out first so literal
 * tags inside code samples are preserved verbatim.
 */

const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`[^`\n]*`/g;

// Opaque placeholder (private-use char) to mask code spans during the rewrite.
const MARK = String.fromCharCode(0xE000);

// tag name -> markdown wrapper that replaces both the open and close tag.
const WRAP: Record<string, string> = {
  b: '**',
  strong: '**',
  i: '*',
  em: '*',
  code: '`',
  del: '~~',
  s: '~~',
  strike: '~~',
};

// Tags we simply unwrap (drop the tags, keep the inner text).
const DROP = new Set(['u', 'span', 'mark', 'small', 'ins', 'sub', 'sup', 'font']);

const TAG_NAMES = [...Object.keys(WRAP), ...DROP].join('|');
// <tag …>, </tag >, with optional whitespace and attributes. Case-insensitive.
const TAG = new RegExp(
  `<\\s*(/?)\\s*(${TAG_NAMES})(?:\\s+[^<>]*?)?\\s*/?\\s*>`,
  'gi',
);
const BR = /<\s*br\s*\/?\s*>/gi;

function hasConvertibleTag(md: string): boolean {
  TAG.lastIndex = 0;
  BR.lastIndex = 0;
  return TAG.test(md) || BR.test(md);
}

/**
 * Rewrite formatting tags to Markdown. Drop-only tags (`<u>`, `<span>`, …) are
 * simply removed. For wrapper tags (`<b>` -> `**`) an opening tag only becomes a
 * wrapper marker when a matching closing tag follows; orphan tags (a stray
 * `</b>` or an unclosed `<b>`) are dropped so the output never leaks an
 * unbalanced `**` or the literal `/b` that prose detection mistakes for a path.
 */
function replaceTags(input: string): string {
  // First pass: count matched open/close pairs per wrapper tag so we can decide
  // which individual tags to convert vs. drop.
  const openSeen: Record<string, number> = {};
  const closeSeen: Record<string, number> = {};
  TAG.lastIndex = 0;
  for (let m = TAG.exec(input); m; m = TAG.exec(input)) {
    const name = m[2].toLowerCase();
    if (!(name in WRAP)) continue;
    if (m[1]) closeSeen[name] = (closeSeen[name] ?? 0) + 1;
    else openSeen[name] = (openSeen[name] ?? 0) + 1;
  }
  const budget: Record<string, number> = {};
  for (const name of Object.keys(WRAP)) {
    budget[name] = Math.min(openSeen[name] ?? 0, closeSeen[name] ?? 0);
  }

  const openUsed: Record<string, number> = {};
  const closeUsed: Record<string, number> = {};
  TAG.lastIndex = 0;
  return input.replace(TAG, (_full, slash: string, rawName: string) => {
    const name = rawName.toLowerCase();
    if (DROP.has(name)) return '';
    const wrap = WRAP[name];
    if (!wrap) return '';
    if (slash) {
      const used = (closeUsed[name] ?? 0) + 1;
      closeUsed[name] = used;
      return used <= budget[name] ? wrap : '';
    }
    const used = (openUsed[name] ?? 0) + 1;
    openUsed[name] = used;
    return used <= budget[name] ? wrap : '';
  });
}

export function convertInlineHtml(md: string): string {
  if (!md.includes('<') || !hasConvertibleTag(md)) return md;

  const stash: string[] = [];
  const mask = (s: string): string => {
    stash.push(s);
    return `${MARK}${stash.length - 1}${MARK}`;
  };

  let out = md.replace(FENCE, mask).replace(INLINE_CODE, mask);

  out = out.replace(BR, '\n');
  out = replaceTags(out);

  out = out.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, i: string) => stash[Number(i)] ?? _m,
  );
  return out;
}
