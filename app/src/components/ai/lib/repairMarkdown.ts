/**
 * CONTRACT: repair(md) -> markdown with balanced code fences and inline ticks.
 *
 * AI output streams in token-by-token, so the last bubble is frequently
 * mid-token: an unclosed ``` fence or a dangling `inline` backtick. Feeding that
 * straight to react-markdown makes the whole subtree flip layout on every chunk
 * (a half-open fence swallows the rest of the document as code). We close the
 * dangling constructs on a *copy* of the text before parsing so the live bubble
 * renders stably; the real text in the store is never mutated.
 *
 * Pure + synchronous so it can run on every render of the streaming bubble.
 */

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const MARKDOWN_WRAPPER_INFO = /^(?:markdown|md|mdx)$/i;
const MERMAID_FENCE_INFO = /^(?:mermaid|mmd)$/i;
const SAFE_MARKDOWN_WRAPPER_PREFIX = /^(?:⚙|⏱|✓|✗|耗时|路由|模型)/u;
const LOOSE_DIFF_LINE = /^ {0,3}[+-](?: {4,}|\t+)\S/;
const LOOSE_DIFF_HUNK = /^ {0,3}@@\s.+@@/;
const FENCE_RUN = /(`{3,}|~{3,})/g;
const FENCE_INFO_HEAD = /^[A-Za-z][\w.+#-]*$/;
const FENCE_INFO_ATTR = /^\{\.?[A-Za-z][\w.+#-]*\}$/;

type FenceToken = {
  indent: string;
  sequence: string;
  mark: string;
  len: number;
  info: string;
};

function fenceToken(line: string): FenceToken | null {
  const match = FENCE_LINE.exec(line);
  if (!match) return null;
  const sequence = match[2];
  return {
    indent: match[1],
    sequence,
    mark: sequence[0],
    len: sequence.length,
    info: match[3].trim(),
  };
}

function isFenceClose(line: string, open: FenceToken): boolean {
  const token = fenceToken(line);
  return !!token && token.mark === open.mark && token.len >= open.len && token.info === '';
}

function isFenceLine(line: string): boolean {
  return !!fenceToken(line);
}

function looksLikeFenceInfo(info: string): boolean {
  const trimmed = info.trim();
  return FENCE_INFO_HEAD.test(trimmed) || FENCE_INFO_ATTR.test(trimmed);
}

function isMermaidFenceInfo(info: string): boolean {
  return MERMAID_FENCE_INFO.test(info.trim().split(/\s+/u)[0] ?? '');
}

function splitDirtyClosingFence(line: string, open: FenceToken): string[] | null {
  const token = fenceToken(line);
  if (!token || token.mark !== open.mark || token.len < open.len || !token.info) {
    return null;
  }

  const trailer = token.info.trim();
  if (!trailer) return null;

  // CommonMark does not accept text after a closing fence. Models often emit
  // ```%% ... for Mermaid comments; treat it as a close and drop the comment.
  if (isMermaidFenceInfo(open.info) && trailer.startsWith('%%')) {
    return [token.indent + token.sequence];
  }

  // A valid info string (` ```ts`, ` ```powershell`, `{.js}`) is more likely a
  // literal nested fence mention. Non-info trailers are usually prose/status
  // text glued to the close, e.g. "```46 · 耗时 ...".
  if (looksLikeFenceInfo(trailer)) return null;
  return [token.indent + token.sequence, trailer];
}

function splitGluedOpeningFence(line: string): string[] | null {
  FENCE_RUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RUN.exec(line))) {
    const index = match.index;
    if (index === 0) continue;

    const before = line.slice(0, index);
    if (!before.trim()) continue;

    const after = line.slice(index + match[1].length);
    if (!looksLikeFenceInfo(after)) continue;

    return [before.trimEnd(), match[1] + after];
  }
  return null;
}

/**
 * Models often glue a fenced block directly after prose
 * (`说明```mermaid`). CommonMark then treats the later closing fence as a new
 * opener, so the diagram source spills into prose and the rest of the answer
 * becomes one giant code block. Split only language-tagged fences; ordinary
 * inline triple-backtick mentions stay untouched.
 */
export function normalizeFenceLineBreaks(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let openFence: FenceToken | null = null;

  for (const line of lines) {
    if (openFence) {
      const splitClose = splitDirtyClosingFence(line, openFence);
      if (splitClose) {
        out.push(...splitClose);
        openFence = null;
        continue;
      }

      out.push(line);
      if (isFenceClose(line, openFence)) openFence = null;
      continue;
    }

    const token = fenceToken(line);
    if (token) {
      openFence = token;
      out.push(line);
      continue;
    }

    const split = splitGluedOpeningFence(line);
    if (!split) {
      out.push(line);
      continue;
    }

    out.push(...split);
    const opened = fenceToken(split[1]);
    if (opened) openFence = opened;
  }

  return out.join('\n');
}

function lastNonEmptyLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

/**
 * Models sometimes wrap an entire answer in ```markdown even though the body
 * already contains fenced code. CommonMark then treats the first inner fence as
 * the outer close, fragmenting the stream into random code blocks/lists. When
 * the wrapper is the whole message (or follows only route/timing chrome), remove
 * that wrapper and render the intended Markdown body.
 */
export function unwrapMarkdownWrapper(md: string): string {
  const lines = md.split('\n');
  const first = lines.findIndex((line) => {
    const token = fenceToken(line);
    return !!token && MARKDOWN_WRAPPER_INFO.test(token.info);
  });
  if (first === -1) return md;

  const prefix = lines.slice(0, first);
  const prefixText = prefix.join('\n').trim();
  if (prefixText && !SAFE_MARKDOWN_WRAPPER_PREFIX.test(prefixText)) return md;
  if (prefix.some(isFenceLine)) return md;

  const open = fenceToken(lines[first]);
  if (!open) return md;
  const last = lastNonEmptyLine(lines);
  if (last <= first || !isFenceClose(lines[last], open)) return md;

  const body = lines.slice(first + 1, last);
  if (!body.some(isFenceLine)) return md;
  return [...prefix, ...body, ...lines.slice(last + 1)].join('\n');
}

function isLooseDiffLine(line: string): boolean {
  return LOOSE_DIFF_LINE.test(line) || LOOSE_DIFF_HUNK.test(line);
}

function looseDiffLineLooksLikeCode(line: string): boolean {
  const body = line
    .replace(/^ {0,3}[+-](?: {4,}|\t+)/, '')
    .replace(/^ {0,3}@@\s.+@@/, '@@')
    .trim();
  return (
    body === '@@' ||
    /^[{}()[\].,;]|^<\/?/.test(body) ||
    /^(?:async|await|case|catch|class|const|describe|else|enum|export|expect|finally|for|function|if|import|interface|it|let|new|return|switch|throw|try|type|var|while)\b/.test(body) ||
    /^[A-Za-z_$][\w$.[\]'"]*\s*(?:[=:({.,]|=>)/.test(body) ||
    /^['"`][\s\S]*[;,]?$/.test(body)
  );
}

/**
 * Diff-like code streamed without a fence starts with `-        code` /
 * `+        code`. Markdown parses those as list items with nested code blocks,
 * producing the scattered bullets seen in the info stream. Wrap only multi-line,
 * code-shaped runs so normal prose lists stay untouched.
 */
export function fenceLooseDiffBlocks(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let openFence: FenceToken | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const token = fenceToken(line);
    if (openFence) {
      out.push(line);
      if (isFenceClose(line, openFence)) openFence = null;
      continue;
    }
    if (token) {
      openFence = token;
      out.push(line);
      continue;
    }
    if (!isLooseDiffLine(line)) {
      out.push(line);
      continue;
    }

    const block: string[] = [];
    let diffLines = 0;
    let codeLike = false;
    let j = i;
    for (; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (candidate.trim() === '') {
        block.push(candidate);
        continue;
      }
      if (!isLooseDiffLine(candidate)) break;
      block.push(candidate);
      diffLines += 1;
      codeLike = codeLike || looseDiffLineLooksLikeCode(candidate);
    }

    while (block.length > 0 && block[block.length - 1].trim() === '') {
      j -= 1;
      block.pop();
    }

    if (diffLines >= 2 && codeLike) {
      out.push('```diff', ...block, '```');
      i = j - 1;
    } else {
      out.push(...block);
      i = j - 1;
    }
  }

  return out.join('\n');
}

function normalizeMarkdownContainers(md: string): string {
  return fenceLooseDiffBlocks(unwrapMarkdownWrapper(normalizeFenceLineBreaks(md)));
}

function danglingFenceClose(md: string): string | null {
  let openFence: FenceToken | null = null;
  for (const line of md.split('\n')) {
    const token = fenceToken(line);
    if (!token) continue;
    if (!openFence) {
      openFence = token;
    } else if (isFenceClose(line, openFence)) {
      openFence = null;
    }
  }
  return openFence ? openFence.mark.repeat(openFence.len) : null;
}

function stripFencedBlocks(md: string): string {
  const out: string[] = [];
  let openFence: FenceToken | null = null;
  for (const line of md.split('\n')) {
    const token = fenceToken(line);
    if (openFence) {
      if (isFenceClose(line, openFence)) openFence = null;
      continue;
    }
    if (token) {
      openFence = token;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Balance an odd number of ``` fences only.
 *
 * Applied on EVERY render (streaming and final), not just live bubbles: a
 * finalized message can still carry an unbalanced fence (the CLI was
 * interrupted/truncated, or the prose mentions a stray ```), and an open fence
 * swallows the rest of the document into one code block. With `rehype-highlight`
 * on for final renders, that makes the whole message render as a garbled wall of
 * syntax-highlighted text. Closing the fence is purely corrective — balanced
 * input is returned unchanged.
 */
export function repairFences(md: string): string {
  const out = normalizeMarkdownContainers(md);
  const close = danglingFenceClose(out);
  if (close) {
    return out + (out.endsWith('\n') ? '' : '\n') + close;
  }
  return out;
}

/** Balance an odd number of ``` fences and a trailing inline backtick. */
export function repairMarkdown(md: string): string {
  // 1. Close a dangling triple-fence (``` count is odd).
  let out = repairFences(md);

  // 2. Close a dangling single inline backtick. Strip complete fenced blocks
  // first (step 1 guarantees fences are now balanced) so their inner backticks
  // don't skew the inline count.
  const withoutFences = stripFencedBlocks(out);
  const singles = (withoutFences.match(/`/g) ?? []).length;
  if (singles % 2 === 1) out += '`';

  return out;
}
