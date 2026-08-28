import { useMemo, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, WrapText } from 'lucide-react';
import CopyButton from './CopyButton';
import { highlightCode } from './lib/highlight';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';

/** Collapse tall code blocks past this many lines behind an expand toggle. */
const DEFAULT_MAX_LINES = 5;
/** Blocks this short render as a lightweight inline-ish panel (no boxed chrome), matching PlainTextBlock's weight. */
const TINY_MAX_LINES = 3;

export default function RawCodeBlock({
  raw,
  language,
  compact = false,
  className = '',
  maxLines = DEFAULT_MAX_LINES,
}: {
  raw: string;
  language?: string | null;
  compact?: boolean;
  className?: string;
  maxLines?: number;
}) {
  const [wrap, setWrap] = useState(false);
  const locale = useStore((s) => s.locale);
  const code = raw.replace(/\n$/, '');
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const lang = normalizeLabel(language);
  const isDiff = lang === 'diff';
  const isPlainText = isPlainTextLanguage(lang);
  // 默认折叠：聊天正文的代码块只露出前 5 行，点击"展开"才显示全部。
  // compact（工具卡片 / 图表面板）保持默认展开——它们本身已嵌在可折叠容器里。
  const [expanded, setExpanded] = useState(compact);
  // Diff blocks always fold by default. Plain-text transcripts only fold when
  // they're genuinely long; short CMD/stdout snippets stay open so the stream
  // doesn't fill up with "table-row-looking" collapsed headers.
  const PLAIN_TEXT_FOLD_LINES = 20;
  const foldsBodyByDefault = isDiff || (isPlainText && lineCount > PLAIN_TEXT_FOLD_LINES);
  const collapsible = lineCount > maxLines || foldsBodyByDefault;
  const collapsed = collapsible && !expanded;
  const highlighted = useMemo(
    () => highlightCode(code, lang),
    [code, lang],
  );

  // A 1-3 line snippet (e.g. a single UE_LOG call quoted inline in an answer)
  // never collapses and gets no toolbar, so the full boxed chrome only reads
  // as a stray "block" breaking up the surrounding prose. Render it with the
  // same light-weight surface as PlainTextBlock (subtle code tint, no border)
  // while keeping syntax highlighting, so it sits inside the text flow instead
  // of popping out as its own panel.
  const isTiny = !compact && !collapsible && lineCount <= TINY_MAX_LINES;

  // Short blocks have no expand affordance, so a full header bar would only add
  // a "table-row-looking" label row. Show the header only when the block is
  // collapsible; otherwise float wrap + copy as a hover-only toolbar. Compact
  // blocks (ToolCard's request/response panels) always keep their header —
  // it's the only place the language/kind label lives there.
  const showHeader = collapsible || compact;

  if (isTiny) {
    return (
      <div
        className={
          'ai-code ai-code--tiny group/code relative my-1.5 rounded-lg px-3.5 py-2.5 ' +
          (wrap ? 'ai-code--wrap ' : '') +
          className
        }
      >
        <pre className="ai-code__scroll ai-code--tiny__scroll overflow-auto leading-relaxed text-[13px]">
          <code
            className={highlighted?.className}
            style={{
              whiteSpace: wrap ? 'pre-wrap' : 'pre',
              wordBreak: wrap ? 'break-word' : 'normal',
            }}
            dangerouslySetInnerHTML={{ __html: highlighted?.html ?? escapeHtml(code) }}
          />
        </pre>
        <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded border border-border-soft bg-panel-2/80 px-0.5 py-0.5 opacity-0 backdrop-blur transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => setWrap((w) => !w)}
            title={wrap ? t(locale, 'chat.wrapOff') : t(locale, 'chat.wrapOn')}
            aria-label={t(locale, 'chat.toggleWrap')}
            className={
              'inline-flex items-center rounded p-0.5 transition-colors ' +
              (wrap ? 'text-accent' : 'text-fg-faint hover:text-fg')
            }
          >
            <WrapText size={13} />
          </button>
          <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        'ai-code group/code overflow-hidden border border-[var(--code-border)] ' +
        (compact ? 'ai-code--compact rounded-sm ' : 'my-2 rounded-lg ') +
        className
      }
    >
      {showHeader && (
        <div className="flex items-center justify-between border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="font-mono text-[11px] normal-case tracking-normal text-fg-faint">
            {lang ?? 'text'}
            {collapsible && (
              <span className="ml-2 text-fg-faint/70">{lineCount} {t(locale, 'chat.lines')}</span>
            )}
          </span>
          <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
            {collapsible && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                title={expanded ? t(locale, 'chat.collapse') : t(locale, 'chat.expandAll')}
                aria-label={expanded ? t(locale, 'chat.collapseCode') : t(locale, 'chat.expandCode')}
                className="inline-flex items-center rounded p-0.5 text-fg-faint transition-colors hover:text-fg"
              >
                {expanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setWrap((w) => !w)}
              title={wrap ? t(locale, 'chat.wrapOff') : t(locale, 'chat.wrapOn')}
              aria-label={t(locale, 'chat.toggleWrap')}
              className={
                'inline-flex items-center rounded p-0.5 transition-colors ' +
                (wrap ? 'text-accent' : 'text-fg-faint hover:text-fg')
              }
            >
              <WrapText size={13} />
            </button>
            <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
          </div>
        </div>
      )}
      <div className="relative">
        <div
          className={
            'ai-code__scroll bg-[var(--code-bg)] leading-relaxed ' +
            (compact ? 'text-[11.5px] ' : 'text-[12.5px] ') +
            (wrap ? 'ai-code--wrap ' : '') +
            (isDiff ? 'ai-code--diff ' : '') +
            (collapsed ? 'overflow-hidden ' : 'overflow-auto ')
          }
          style={
            collapsed
              ? { maxHeight: compact ? 'calc(8.125em + 0.9rem)' : 'calc(8.125em + 1.5rem)' }
              : undefined
          }
          data-testid="ai-code-scroll"
        >
          <pre>
            <code
              className={highlighted?.className}
              dangerouslySetInnerHTML={{ __html: highlighted?.html ?? escapeHtml(code) }}
            />
          </pre>
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title={t(locale, 'chat.expandAll')}
            aria-label={t(locale, 'chat.expandCode')}
            className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5 text-[11px] text-fg-faint transition-colors hover:text-fg"
          >
            <ChevronsUpDown size={12} className="shrink-0" />
            <span>
              {t(locale, 'chat.expandAll')} · {lineCount} {t(locale, 'chat.lines')}
            </span>
          </button>
        )}
        {!showHeader && (
          <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded border border-[var(--code-border)] bg-panel-2/90 px-0.5 py-0.5 opacity-0 backdrop-blur transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => setWrap((w) => !w)}
              title={wrap ? t(locale, 'chat.wrapOff') : t(locale, 'chat.wrapOn')}
              aria-label={t(locale, 'chat.toggleWrap')}
              className={
                'inline-flex items-center rounded p-0.5 transition-colors ' +
                (wrap ? 'text-accent' : 'text-fg-faint hover:text-fg')
              }
            >
              <WrapText size={13} />
            </button>
            <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeLabel(language: string | null | undefined): string | null {
  const value = language?.trim().toLowerCase();
  return value || null;
}

function isPlainTextLanguage(language: string | null): boolean {
  return (
    language === null ||
    language === 'text' ||
    language === 'txt' ||
    language === 'plain' ||
    language === 'plaintext'
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
