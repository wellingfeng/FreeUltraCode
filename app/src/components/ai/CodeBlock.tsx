import { useMemo, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import RawCodeBlock from './RawCodeBlock';
import MermaidBlock from './MermaidBlock';
import SvgBlock from './SvgBlock';
import ComfyGraphBlock from './ComfyGraphBlock';
import WorldModelBlock from './WorldModelBlock';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';

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
  children,
  node,
}: {
  children?: ReactNode;
  node?: HastNode;
}) {
  const raw = useMemo(() => nodeText(node).replace(/\n$/, ''), [node]);
  const lang = languageOf(node);
  const normalizedLang = lang?.toLowerCase() ?? null;

  // Defensive: react-markdown normally supplies `node`, but if a future plugin
  // strips it we still render the (highlighted) children without chrome.
  if (!node) return <pre className="ai-code__scroll">{children}</pre>;

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
  // no header bar, no dark code background, proportional font, subtle border.
  if (isPlainTextLang(normalizedLang)) {
    return <PlainTextBlock raw={raw} />;
  }

  return <RawCodeBlock raw={raw} language={lang}>{children}</RawCodeBlock>;
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
 * Lightweight rendering for plain-text fences: no header bar, no dark code
 * background, no monospace font. Uses a subtle surface with left border so it
 * reads as a "text panel" rather than a code block. Copy button on hover.
 */
function PlainTextBlock({ raw }: { raw: string }) {
  const locale = useStore((s) => s.locale);
  const [hovered, setHovered] = useState(false);
  const text = raw.replace(/\n$/, '');
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
          className="absolute right-1.5 top-1.5 z-10 rounded border border-border-soft bg-panel-2/80 px-1.5 py-0.5 text-[11px] text-fg-faint backdrop-blur transition-colors hover:text-fg"
          title={t(locale, 'chat.copy')}
        >
          <Copy size={11} className="inline mr-0.5" />
          {t(locale, 'chat.copy')}
        </button>
      )}
      <div className="ai-plain-block__body whitespace-pre-wrap break-words rounded-lg border-l-2 border-[var(--stream-surface-border)] bg-[var(--stream-surface-bg)] px-3.5 py-2.5 text-[13px] leading-relaxed text-fg">
        {text}
      </div>
    </div>
  );
}
