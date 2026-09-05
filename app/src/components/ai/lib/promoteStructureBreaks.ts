/**
 * CONTRACT: promoteStructureBreaks(md) -> md with a blank line inserted before
 * markdown block structure that follows a single `\n`.
 *
 * Some models (observed: deepseek-v4-pro via OpenAI-compatible gateway, ~12%
 * of long answers) emit single `\n` between *block-level* structures — headings,
 * list items, table rows, `---` dividers, blockquotes — instead of the `\n\n`
 * CommonMark requires to separate blocks. The result is one giant paragraph
 * that `remark-breaks` renders as a wall of `<br>`s: headings lose their
 * styling, `---` never becomes an `<hr>` (so `rehypeGroupSections` never
 * groups), and tables/lists never materialise.
 *
 * This pure pre-pass upgrades `\n` -> `\n\n` when the next line opens a block
 * structure. Three guards keep it safe on well-formed markdown:
 *   - already-blank lines are left alone (idempotent);
 *   - fenced code and inline code are masked first, so literal newlines inside
 *     them are untouched;
 *   - a line that continues the *same* structure kind as the previous line
 *     (table row after table row, list item after list item, blockquote after
 *     blockquote) is NOT promoted — those consecutive lines are one block, and
 *     splitting them would break the table / list / quote.
 * Setext heading bodies (`标题\n---` meaning "H2", not "divider") are
 * deliberately NOT protected: the models that triggered this never emit setext,
 * and `---`-as-divider is the far more common intent in chat output.
 */

const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`[^`\n]*`/g;

// Same masking discipline as protectWindowsPaths: private-use char + digits,
// restored after the rewrite. See that file for why not a literal char.
const MARK = String.fromCharCode(0xE001);

// Structure kinds, keyed so the continuation guard can compare prev vs next.
// Indentation capped at 3 spaces per CommonMark (4+ = indented code, skip).
type Kind =
  | 'heading'
  | 'list'
  | 'table'
  | 'quote'
  | 'divider'
  | 'prose';

function classify(line: string): Kind {
  const m = /^( {0,3})(\S[\s\S]*)$/.exec(line);
  if (!m) return 'prose'; // blank or 4+-space indent
  const body = m[2];
  if (/^#{1,6}(?=[ \t])/.test(body)) return 'heading';
  if (/^(?:\*\s*){3,}[ \t]*$/.test(body)) return 'divider';
  if (/^(?:-\s*){3,}[ \t]*$/.test(body)) return 'divider';
  if (/^(?:_\s*){3,}[ \t]*$/.test(body)) return 'divider';
  if (/^\|/.test(body)) return 'table';
  if (/^>[ \t]?/.test(body)) return 'quote';
  if (/^(?:[-*+]|\d{1,9}[.)])(?=[ \t])/.test(body)) return 'list';
  return 'prose';
}

// Kinds whose consecutive same-kind lines form ONE block and must not be
// split. Heading and divider are single-line blocks — two in a row ARE two
// blocks, so they may be promoted freely.
const CONTINUABLE: ReadonlySet<Kind> = new Set(['list', 'table', 'quote']);

export function promoteStructureBreaks(md: string): string {
  if (!md.includes('\n')) return md;

  const stash: string[] = [];
  const mask = (s: string): string => {
    stash.push(s);
    return `${MARK}${stash.length - 1}${MARK}`;
  };

  const masked = md.replace(FENCE, mask).replace(INLINE_CODE, mask);

  const lines = masked.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      const prev = lines[i - 1];
      const prevKind = classify(prev);
      const curKind = classify(line);
      const isBlankGap = prev === ''; // already a blank line above
      const continuesBlock =
        prevKind === curKind && CONTINUABLE.has(curKind);
      if (!isBlankGap && curKind !== 'prose' && !continuesBlock) {
        out.push(''); // insert the blank line
      }
    }
    out.push(line);
  }
  let joined = out.join('\n');

  joined = joined.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, i: string) => stash[Number(i)] ?? _m,
  );
  return joined;
}
