import { useMemo, useState } from 'react';
import { AlertTriangle, FileImage, Maximize2 } from 'lucide-react';
import CopyButton from './CopyButton';
import RawCodeBlock from './RawCodeBlock';
import { MermaidOverlay } from './MermaidBlock';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import { sanitizeSvg } from './lib/sanitizeSvg';

/**
 * Renders a fenced ```svg block as an inline picture. The raw source is
 * sanitized (script / on* / javascript: URLs stripped) before injection, so
 * model-produced SVG can't run scripts in the chat surface. The container
 * uses `isolation: isolate` so any `<style>` embedded in the SVG can't leak
 * its rules to the surrounding header/flex layout (the same failure mode we
 * fixed for Mermaid SVG). A click on "expand" opens the shared pan/zoom
 * overlay ({@link MermaidOverlay}) with an SVG-specific title/icon.
 */
export default function SvgBlock({ code }: { code: string }) {
  const locale = useStore((s) => s.locale);
  const [expanded, setExpanded] = useState(false);

  const sanitized = useMemo(() => sanitizeSvg(code), [code]);

  if (!sanitized) {
    return (
      <div className="ai-svg my-2 overflow-hidden rounded-lg border border-[var(--code-border)]">
        <div className="ai-svg__header flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <AlertTriangle size={13} className="shrink-0 text-danger" />
            <span className="truncate">{t(locale, 'svg.renderFailed')}</span>
          </span>
          <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
        </div>
        <div className="px-3 py-2 text-xs text-fg-dim">
          {t(locale, 'svg.renderFailedHint')}
        </div>
        <RawCodeBlock raw={code} language="svg" compact className="border-x-0 border-b-0" />
      </div>
    );
  }

  return (
    <>
      <div className="ai-svg my-2 overflow-hidden rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)]">
        <div className="ai-svg__header flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <FileImage size={13} className="shrink-0 text-accent" />
            <span className="truncate">svg</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
            >
              <Maximize2 size={12} />
              {t(locale, 'chat.expand')}
            </button>
            <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
          </div>
        </div>
        <div
          className="ai-svg__body flex items-center justify-center overflow-auto p-3"
          style={{ isolation: 'isolate' }}
          aria-label={t(locale, 'svg.diagram')}
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      </div>
      {expanded && (
        <MermaidOverlay
          svg={sanitized}
          locale={locale}
          title={t(locale, 'svg.diagram')}
          icon={<FileImage size={15} className="shrink-0 text-accent" />}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
