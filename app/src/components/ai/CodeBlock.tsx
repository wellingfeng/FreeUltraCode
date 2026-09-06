import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import RawCodeBlock from './RawCodeBlock';
import MermaidBlock from './MermaidBlock';
import SvgBlock from './SvgBlock';
import ComfyGraphBlock from './ComfyGraphBlock';
import WorldModelBlock from './WorldModelBlock';
import FileChip, { type OpenFileFn } from './FileChip';
import { parseFileRef, type FileRef } from './lib/filePath';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import {
  hasBoxDrawing,
  isAsciiTableSep,
  isAsciiTableRow,
} from './lib/asciiArt';

/**
 * Recursively collect the plain text of a hast node (rehype-highlight wraps the
 * source in nested <span> elements, so the original code lives in leaf text
 * nodes). Used to recover the raw code for the copy button.
 */
interface HastNode {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function nodeText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(nodeText).join('');
}

function languageOf(preNode: HastNode | undefined): string | null {
  const code = preNode?.children?.find((c) => c.tagName === 'code');
  const cls = code?.properties?.className;
  const classes = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(' ') : [];
  for (const c of classes) {
    if (typeof c === 'string' && c.startsWith('language-')) {
      return c.slice('language-'.length);
    }
  }
  return null;
}

/**
 * Fenced code block chrome: a header bar with the language label, word-wrap and
 * (for tall blocks) expand toggles, plus a copy button, wrapping the
 * rehype-highlighted <pre><code>. Rendered as the `pre` override in
 * {@link Markdown}; the highlighted children pass straight through.
 *
 * A ` ```diff ` fence gets per-line +/- tinting via the `.ai-code--diff` class
 * (highlight.js marks added/removed lines with `.hljs-addition`/`.hljs-deletion`).
 */
export default function CodeBlock({
  node,
  onOpenFile,
  cwd,
}: {
  node?: HastNode;
  onOpenFile?: OpenFileFn;
  cwd?: string;
}) {
  const raw = useMemo(() => nodeText(node).replace(/\n$/, ''), [node]);
  const lang = languageOf(node);
  const normalizedLang = lang?.toLowerCase() ?? null;

  // Defensive: react-markdown normally supplies `node`, but if a future plugin
  // strips it we still render a plain pre without chrome.
  if (!node) return <pre className="ai-code__scroll" />;

  if (normalizedLang === 'mermaid' || normalizedLang === 'mmd') {
    return <MermaidBlock code={raw} />;
  }

  if (normalizedLang === 'svg') {
    return <SvgBlock code={raw} />;
  }

  if (normalizedLang === 'comfyui' || normalizedLang === 'comfy') {
    return <ComfyGraphBlock code={raw} />;
  }

  if (normalizedLang === 'worldmodel' || normalizedLang === 'world') {
    return <WorldModelBlock code={raw} />;
  }

  // Plain-text blocks (no language tag, or explicitly text/txt/plain) get a
  // lightweight text-style rendering instead of the full code-block chrome —
  // no header bar, no dark code background, proportional font, subtle code tint.
  // A fenced GFM pipe-table (the model sometimes wraps an ASCII table in ```)
  // should render as a real <table>, not a text panel, so it stops reading as
  // a collapsed code block.
  if (isPlainTextLang(normalizedLang)) {
    if (looksLikeGfmTable(raw)) {
      return <TableFromText raw={raw} />;
    }
    if (looksLikeAsciiTable(raw)) {
      return <AsciiTableFromText raw={raw} />;
    }
    // 关键分支：fence 没写语言但内容明显是代码（含 `;` / `=>` / 函数调用），
    // 走 RawCodeBlock + auto-detect 给高亮；否则保持 PlainTextBlock，
    // 避免把中文散文/ASCII 框图误判成代码并染上 hljs 颜色。
    if (lang === null && looksLikeCode(raw)) {
      return <RawCodeBlock raw={raw} language={null} />;
    }
    // 纯文件引用块：AI 把生成的文件绝对路径（word/pdf/ppt/html 等）包进一个
    // 无语言或 text/txt 的 fence 时，上面不会命中代码高亮，PlainTextBlock 会把它
    // 渲染成不可点击的纯文本面板。这里检测“整块全是文件引用”，改渲染成可点击的
    // FileChip 列表，保证生成的文档始终可以点击打开。
    const fileRefBlock = buildFileRefBlock(raw);
    if (fileRefBlock) {
      return (
        <div className="ai-file-ref-block flex flex-col gap-1 py-1">
          {fileRefBlock.map((ref, i) => (
            <FileChip key={i} refData={ref} onOpenFile={onOpenFile} cwd={cwd} />
          ))}
        </div>
      );
    }
    return <PlainTextBlock raw={raw} />;
  }

  return <RawCodeBlock raw={raw} language={lang} />;
}

/**
 * Heuristic: bare-fence content "looks like code" when it has the syntactic
 * density of a real programming language — semicolons, braces, function-call
 * parens, assignment operators. Keeps pure Chinese prose and ASCII diagrams
 * routed to PlainTextBlock (no hljs false-positives on散文).
 */
function looksLikeCode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 含制表/框线字符的图示排除：归 ASCII art 路径处理。
  if (hasBoxDrawing(trimmed)) return false;
  // 代码信号：分号结尾、控制流关键字、函数调用、运算符密度、括号配对。
  let score = 0;
  if (/[;{}]\s*$/m.test(trimmed)) score += 2;
  if (/\b(?:const|let|var|function|return|if|else|for|while|class|struct|import|export|fn|def|public|private|static|void|int|float|auto|template|namespace)\b/.test(trimmed)) score += 3;
  if (/[A-Za-z_]\w*\s*\([^)]*\)\s*[;{]/.test(trimmed)) score += 2;
  if (/[=\-+*/<>!&|]=?=?/.test(trimmed)) score += 1;
  if (/^\s*(?:#include|#define|package\s|using\s|using namespace)\b/m.test(trimmed)) score += 3;
  // 大段中文叙述会快速掉分（CJK 占比高 → 不像代码）。
  const cjk = (trimmed.match(/[一-鿿]/g) ?? []).length;
  if (cjk > trimmed.length * 0.3) score -= 3;
  return score >= 3;
}

/** Check if the resolved language is "plain text" (no language or text-like). */
function isPlainTextLang(lang: string | null): boolean {
  return (
    lang === null ||
    lang === 'text' ||
    lang === 'txt' ||
    lang === 'plain' ||
    lang === 'plaintext'
  );
}

/**
 * Detect a GFM pipe-table that got wrapped inside a fence. The model frequently
 * emits an ASCII table (header row + `|---|---|` separator + body rows) inside a
 * bare or `text` fence; without this it would render as a text panel. We key on
 * the unambiguous `|---|` separator row so real prose/ASCII art is never touched.
 */
function looksLikeGfmTable(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return false;
  const header = lines[0];
  const separator = lines[1];
  if (!header.includes('|') || !separator.includes('|')) return false;
  const headerCells = splitTableRow(header);
  const sepCells = splitTableRow(separator);
  if (headerCells.length < 2 || sepCells.length !== headerCells.length) return false;
  return sepCells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

/** Render a fenced pipe-table with the same chrome as native GFM tables. */
function TableFromText({ raw }: { raw: string }) {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  const width = header.length;
  return (
    <div className="ai-table-wrap overflow-x-auto">
      <table className="ai-table w-full border-collapse">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {Array.from({ length: width }, (_, j) => (
                <td key={j}>{row[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Detect a `+---+` / `+===+` bordered ASCII table (the model often draws a
 * table with box characters instead of a GFM pipe-table). Keyed on the
 * unambiguous `+---+` separator row so prose/ASCII art is never touched.
 */
function looksLikeAsciiTable(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  if (!isAsciiTableSep(lines[0])) return false;
  if (!isAsciiTableRow(lines[1])) return false;
  // 需要一个分隔行把表头与数据隔开。
  return lines.some((line, idx) => idx > 0 && isAsciiTableSep(line));
}

function splitAsciiTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

/** Render a `+---+` bordered ASCII table with the same chrome as GFM tables. */
function AsciiTableFromText({ raw }: { raw: string }) {
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(isAsciiTableRow);
  if (rows.length === 0) return <PlainTextBlock raw={raw} />;
  const header = splitAsciiTableRow(rows[0]);
  const body = rows.slice(1).map(splitAsciiTableRow);
  const width = header.length;
  return (
    <div className="ai-table-wrap overflow-x-auto">
      <table className="ai-table w-full border-collapse">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i}>
              {Array.from({ length: width }, (_, j) => (
                <td key={j}>{row[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * When a plain-text fence is composed entirely of local file references — one
 * per non-empty line, e.g. an agent reporting generated document/image paths —
 * return the parses so the block renders as clickable chips instead of inert
 * text. Returns null when any non-empty line is not itself a file reference, so
 * prose, ASCII diagrams and real code are never hijacked.
 */
function buildFileRefBlock(raw: string): FileRef[] | null {
  const lines = raw
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const refs: FileRef[] = [];
  for (const line of lines) {
    const ref = parseFileRef(line, { allowSpaces: true });
    if (!ref) return null;
    refs.push(ref);
  }
  return refs;
}

/**
 * Lightweight rendering for plain-text fences: no header bar, no dark code
 * background, no monospace font. Uses a subtle code-tinted surface (no border)
 * so it reads as a "text panel" rather than a code block. Copy button on hover.
 * ASCII 树/框图（含制表字符）改用等宽字体，保证对齐。
 */
function PlainTextBlock({ raw }: { raw: string }) {
  const locale = useStore((s) => s.locale);
  const [hovered, setHovered] = useState(false);
  const text = raw.replace(/\n$/, '');
  const mono = hasBoxDrawing(raw);
  const bodyClass =
    'ai-plain-block__body whitespace-pre-wrap rounded-sm px-2.5 py-2 text-[12.5px] leading-normal text-fg ' +
    (mono ? 'font-mono overflow-x-auto' : 'break-words');
  return (
    <div
      className="ai-plain-block group/plain relative my-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(text)}
          className="absolute right-1.5 top-1.5 z-10 rounded px-1.5 py-0.5 text-[11px] text-fg-faint transition-colors hover:text-fg"
          title={t(locale, 'chat.copy')}
        >
          <Copy size={11} className="inline mr-0.5" />
          {t(locale, 'chat.copy')}
        </button>
      )}
      <div className={bodyClass}>
        {text}
      </div>
    </div>
  );
}
