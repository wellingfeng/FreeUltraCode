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

import { hasBoxDrawing, isAsciiTableSep, isAsciiTableRow } from './asciiArt';

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
 *
 * 也识别「整段塞进 ```markdown 但 body 是裸 HTML/SVG」的情况：模型常把
 * <!DOCTYPE html> / <svg ...> 直接当 markdown 包一层 ```markdown，body 内
 * 不再用嵌套 fence，此时 unwrap 必须依旧生效，否则整段被原样透成纯文本。
 */
const HTML_HEAVY_LINE = /^\s*<(?:!doctype\b|html\b|head\b|body\b|style\b|script\b|svg\b|\/?[a-z][a-z0-9-]*(?:\s|>|\/))/iu;

function looksLikeHtmlDocumentBody(lines: string[]): boolean {
  let htmlLines = 0;
  let nonEmpty = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    nonEmpty += 1;
    if (HTML_HEAVY_LINE.test(line)) htmlLines += 1;
  }
  if (nonEmpty === 0) return false;
  // body 中超过 40% 的非空行是 HTML 标签开头，且至少 3 行：当作 HTML/SVG 文档。
  return htmlLines >= 3 && htmlLines / nonEmpty >= 0.4;
}

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
  // 旧规则：body 里至少得有一个嵌套 fence 才解包，避免误吃 prose。
  // 新规则：body 是高浓度 HTML/SVG 文档（模型把整段网页当 markdown 包）也解包，
  // 并把解包后的裸 HTML/SVG 包成 ```html / ```svg 围栏，让 rehype-highlight 接管。
  if (body.some(isFenceLine)) {
    return [...prefix, ...body, ...lines.slice(last + 1)].join('\n');
  }
  if (looksLikeHtmlDocumentBody(body)) {
    const joined = body.join('\n');
    // <svg 优先于 <!doctype/html：模型常只发一段 SVG 而非整页 HTML。
    const isSvg = /^\s*<svg\b/imu.test(joined) || (/<svg\b/iu.test(joined) && !/<!doctype\b|<html\b/iu.test(joined));
    const fenced = [isSvg ? '```svg' : '```html', ...body, '```'];
    return [...prefix, ...fenced, ...lines.slice(last + 1)].join('\n');
  }
  return md;
}

const SVG_ELEMENT =
  /<(?:a|circle|clipPath|defs|ellipse|filter|g|image|line|linearGradient|marker|mask|path|pattern|polygon|polyline|radialGradient|rect|symbol|text|use)\b/i;

function looksLikeSvgDocument(block: string): boolean {
  return SVG_ELEMENT.test(block);
}

/**
 * 模型有时直接输出一段裸 `<svg>…</svg>`（既没包 ```svg，也没套
 * ```markdown 外壳）。react-markdown 不启 rehype-raw，裸 SVG 会被当作
 * raw HTML 文本原样显示成源码，用户看到的就是“没解析”。这里把裸 SVG 块
 * 包成 ```svg 围栏，交给 SvgBlock 渲染成图。
 *
 * 用跨行正则匹配 `<svg … </svg>`，`<svg` 前面允许有同行说明文字（如
 * “示意图如下：<svg …”），不再要求 `<svg` 在行首。已有 ```svg 围栏和
 * inline code 先被占位掩蔽，不会被二次包裹；只处理已闭合的块，半截流式
 * 输出保持原样；不含任何 SVG 子元素的行内提及（如“用 `<svg>` 标签”）不
 * 围栏化。围栏前后按需补换行，保证 CommonMark 能在行首识别 fence。
 */
export function fenceBareSvgBlocks(md: string): string {
  if (!/<svg\b/i.test(md)) return md;

  const MARK = String.fromCharCode(0xE000);
  const stash: string[] = [];
  const mask = (s: string): string => {
    stash.push(s);
    return `${MARK}${stash.length - 1}${MARK}`;
  };

  let work = md
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, mask)
    .replace(/`[^`\n]*`/g, mask);

  const SVG_BLOCK = /<svg\b[\s\S]*?<\/svg\s*>/gi;
  work = work.replace(SVG_BLOCK, (block: string, offset: number, whole: string) => {
    if (!looksLikeSvgDocument(block)) return block;
    const lead = offset === 0 || whole[offset - 1] === '\n' ? '' : '\n';
    const rest = whole.slice(offset + block.length);
    const trail = rest === '' || rest.startsWith('\n') ? '' : '\n';
    return mask(lead + '```svg\n' + block.trim() + '\n```' + trail);
  });

  work = work.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, i: string) => stash[Number(i)] ?? _m,
  );

  return work;
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

/**
 * 模型经常用框线字符（├── └── ┌─┐ 等）画目录树/流程图，却不包 ``` 围栏。
 * CommonMark 把它们当普通段落，HTML 会折叠连续空格导致对齐错乱。这里把
 * 连续 ≥2 行的框线艺术自动包成 ```text 围栏，交给等宽文本块渲染。
 * 已在围栏内的内容原样保留，避免二次包裹破坏结构。
 */
export function fenceAsciiArtBlocks(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let openFence: FenceToken | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const token = fenceToken(line);

    if (openFence) {
      out.push(line);
      if (isFenceClose(line, openFence)) openFence = null;
      i += 1;
      continue;
    }
    if (token) {
      openFence = token;
      out.push(line);
      i += 1;
      continue;
    }

    if (line.trim() !== '' && hasBoxDrawing(line)) {
      const block: string[] = [];
      let j = i;
      while (j < lines.length && !isFenceLine(lines[j]) && hasBoxDrawing(lines[j])) {
        block.push(lines[j]);
        j += 1;
      }
      if (block.length >= 2) {
        out.push('```text', ...block, '```');
        i = j;
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n');
}

/**
 * 模型常画 `+---+` 边框式 ASCII 表格而不包围栏。识别由分隔行 + 单元格行
 * 交替组成的块（≥2 个分隔行、≥2 个单元格行），整体包成 ```text 围栏，交给
 * CodeBlock 的 AsciiTableFromText 渲染为真正的 <table>。
 */
export function fenceAsciiTables(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let openFence: FenceToken | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const token = fenceToken(line);

    if (openFence) {
      out.push(line);
      if (isFenceClose(line, openFence)) openFence = null;
      i += 1;
      continue;
    }
    if (token) {
      openFence = token;
      out.push(line);
      i += 1;
      continue;
    }

    if (isAsciiTableSep(line)) {
      const block: string[] = [];
      let j = i;
      while (j < lines.length && (isAsciiTableSep(lines[j]) || isAsciiTableRow(lines[j]))) {
        block.push(lines[j]);
        j += 1;
      }
      const sepCount = block.filter(isAsciiTableSep).length;
      const rowCount = block.filter(isAsciiTableRow).length;
      if (sepCount >= 2 && rowCount >= 2) {
        out.push('```text', ...block, '```');
        i = j;
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n');
}

function normalizeMarkdownContainers(md: string): string {
  return fenceAsciiTables(
    fenceAsciiArtBlocks(
      fenceLooseDiffBlocks(
        fenceBareSvgBlocks(unwrapMarkdownWrapper(normalizeFenceLineBreaks(md))),
      ),
    ),
  );
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
