/**
 * CONTRACT: convertDetailsHtml(md) -> md with <details><summary>…</summary>…
 * </details> blocks rewritten as a blockquote container that the renderer
 * expands back into a collapsible panel.
 *
 * Models (especially a sub-agent handing evidence back to a summarising agent)
 * emit `<details><summary>标题</summary>` to fold away supporting detail. The
 * chat pipeline runs react-markdown WITHOUT rehype-raw — raw HTML is escaped as
 * literal text, a deliberate XSS boundary (see MessageContent.test.tsx
 * "does not emit raw html (no rehype-raw)"). A raw <details> block therefore
 * shows up as visible source. This pre-pass rewrites ONLY the fixed
 * <details>/<summary> pair (a two-tag allowlist) into GFM blockquote form:
 *
 *   > [!details] 标题
 *   >
 *   > body…
 *
 * which the blockquote override in Markdown.tsx turns into <DetailsBlock/> (a
 * real <details><summary> element). Every other tag stays raw-HTML-safe.
 */

const DETAILS_BLOCK =
  /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>([\s\S]*?)<\/details\s*>/gi;

// Code is masked out so a <details> sample inside a fenced/inline code block is
// never rewritten. Body code is restored and re-indented line by line below.
const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`[^`\n]*`/g;
const MARK = String.fromCharCode(0xe000);

const DETAILS_MARKER = /^\s*\[!DETAILS\]\s*/i;

/** Detect a leading `[!details]` marker in a blockquote's first text. */
export function detectDetails(firstText: string): boolean {
  return DETAILS_MARKER.test(firstText);
}

/** Extract the summary title from a leading `[!details] 标题` marker. */
export function detectDetailsTitle(firstText: string): string {
  const firstLine = firstText.split('\n', 1)[0] ?? '';
  const m = firstLine.match(/^\s*\[!DETAILS\]\s*(.*)$/i);
  return m ? m[1].trim() : '';
}

/** Prefix every body line with `> ` (blank lines become a lone `>`) so the whole
 *  block becomes one CommonMark blockquote that still renders inner markdown
 *  (lists, fenced code, file refs). */
function blockquoteLines(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function restoreMarked(s: string, stash: string[]): string {
  return s.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, i: string) => stash[Number(i)] ?? _m,
  );
}

export function convertDetailsHtml(md: string): string {
  if (!/<details\b/i.test(md)) return md;

  const stash: string[] = [];
  const mask = (s: string): string => {
    stash.push(s);
    return `${MARK}${stash.length - 1}${MARK}`;
  };

  let work = md.replace(FENCE, mask).replace(INLINE_CODE, mask);

  work = work.replace(
    DETAILS_BLOCK,
    (
      full,
      summaryRaw: string,
      bodyRaw: string,
      offset: number,
      whole: string,
    ) => {
      // Inline formatting tags inside the summary were already handled by
      // convertInlineHtml upstream; collapse whitespace to a single-line title.
      const title = summaryRaw.trim().replace(/\s+/g, ' ');
      const body = blockquoteLines(restoreMarked(bodyRaw, stash));
      const head = `> [!details] ${title}`;
      const out = body ? `${head}\n>\n${body}` : head;

      // `> ` only starts a blockquote at a line start. If the model glued the
      // <details> tag mid-paragraph (`说明 <details>…`), break the line so the
      // marker lands on its own line (same treatment as fenceBareSvgBlocks).
      const leadBreak = offset === 0 || whole[offset - 1] === '\n' ? '' : '\n';
      const after = whole.slice(offset + full.length);
      const trailBreak = after === '' || after.startsWith('\n') ? '' : '\n';
      return `${leadBreak}${out}${trailBreak}`;
    },
  );

  return restoreMarked(work, stash);
}
