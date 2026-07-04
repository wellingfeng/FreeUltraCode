import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Maximize2, Minus, Plus, RotateCcw, Workflow } from 'lucide-react';
import CopyButton from './CopyButton';
import RawCodeBlock from './RawCodeBlock';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import { sanitizeMermaid } from './lib/sanitizeMermaid';

type MermaidRenderResult = {
  svg: string;
  bindFunctions?: (element: Element) => void;
};

type MermaidModule = {
  default: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, source: string) => Promise<MermaidRenderResult>;
  };
};

let mermaidReady = false;

export default function MermaidBlock({ code }: { code: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const locale = useStore((s) => s.locale);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg('');
    setError('');

    const render = async () => {
      const renderId = `ai-mermaid-${reactId}-${hashCode(code)}`;
      try {
        const mermaid = (await import('mermaid') as MermaidModule).default;
        if (!mermaidReady) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: 'dark',
            flowchart: { htmlLabels: false },
            sequence: { mirrorActors: false },
          });
          mermaidReady = true;
        }

        const result = await mermaid.render(renderId, sanitizeMermaid(code));
        if (!cancelled) setSvg(result.svg);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        cleanupMermaidRenderArtifacts(renderId);
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div className="ai-mermaid my-2 overflow-hidden rounded-lg border border-[var(--code-border)]">
        <div className="ai-mermaid__header flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <AlertTriangle size={13} className="shrink-0 text-danger" />
            <span className="truncate">{t(locale, 'mermaid.renderFailed')}</span>
          </span>
          <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
        </div>
        <div className="px-3 py-2 text-xs text-fg-dim">{error}</div>
        <RawCodeBlock raw={code} language="mermaid" compact className="border-x-0 border-b-0" />
      </div>
    );
  }

  return (
    <>
      <div className="ai-mermaid my-2 overflow-hidden rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)]">
        <div className="ai-mermaid__header flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <Workflow size={13} className="shrink-0 text-accent" />
            <span className="truncate">mermaid</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              disabled={!svg}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-faint hover:bg-[var(--code-border)] hover:text-fg disabled:opacity-40"
            >
              <Maximize2 size={12} />
              {t(locale, 'chat.expand')}
            </button>
            <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
          </div>
        </div>
        <div
          className="ai-mermaid__body overflow-auto p-3"
          aria-label={t(locale, 'mermaid.diagram')}
          dangerouslySetInnerHTML={
            svg
              ? { __html: svg }
              : { __html: `<span class="ai-mermaid__status">${t(locale, 'mermaid.rendering')}</span>` }
          }
        />
      </div>
      {expanded && svg && (
        <MermaidOverlay svg={svg} locale={locale} onClose={() => setExpanded(false)} />
      )}
    </>
  );
}

/**
 * Full-screen pan/zoom viewer that takes over the message stream (mounted into
 * #ugs-stream-surface when present, matching ComfyEditorOverlay; otherwise
 * rendered in-place with absolute inset-0). Wheel zooms toward the cursor;
 * pointer drag pans the canvas; toolbar offers zoom in/out, fit, and close.
 */
function MermaidOverlay({
  svg,
  locale,
  onClose,
}: {
  svg: string;
  locale: ReturnType<typeof useStore.getState>['locale'];
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);

  // Mount into the chat stream surface so the overlay fills the entire info
  // stream rather than being clipped to the message bubble. The surface is
  // the positioned ancestor (#ugs-stream-surface) that wraps the scroll
  // container in AIDock. Falls back to in-place rendering (absolute inset-0
  // relative to the message bubble) when the surface isn't present.
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSurface(document.getElementById('ugs-stream-surface'));
  }, []);

  // Escape closes the overlay, matching the rest of the app's dialog behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clampScale = (s: number) => Math.max(0.1, Math.min(8, s));

  const applyFit = useCallback(() => {
    const c = containerRef.current;
    const inner = contentRef.current;
    if (!c || !inner) return;
    const svgEl = inner.querySelector('svg');
    if (!svgEl) return;
    // Read the SVG's intrinsic size: prefer explicit pixel width/height
    // attributes, fall back to the viewBox (covers mermaid diagrams that emit
    // only a viewBox), then to the untransformed layout box. Percentage widths
    // resolve to 0 in baseVal.value, so guard against that. Force fixed pixel
    // dimensions so the CSS transform scales cleanly instead of the SVG
    // reflowing to the container on every zoom.
    const wLen = svgEl.width.baseVal;
    const hLen = svgEl.height.baseVal;
    const isPercent = (l: SVGLength) =>
      l.unitType === SVGLength.SVG_LENGTHTYPE_PERCENTAGE;
    let nw = !isPercent(wLen) ? wLen.value : 0;
    let nh = !isPercent(hLen) ? hLen.value : 0;
    if ((!nw || !nh) && svgEl.viewBox.baseVal.width) {
      nw = svgEl.viewBox.baseVal.width;
      nh = svgEl.viewBox.baseVal.height;
    }
    if (!nw || !nh) {
      nw = inner.scrollWidth;
      nh = inner.scrollHeight;
    }
    if (!nw || !nh) return;
    svgEl.setAttribute('width', String(nw));
    svgEl.setAttribute('height', String(nh));
    svgEl.style.width = `${nw}px`;
    svgEl.style.height = `${nh}px`;
    svgEl.style.maxWidth = 'none';
    svgEl.style.maxHeight = 'none';
    svgEl.style.display = 'block';
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    const s = Math.min(cw / nw, ch / nh, 1);
    setView({ scale: s, tx: (cw - nw * s) / 2, ty: (ch - nh * s) / 2 });
  }, []);

  // Fit on first paint and whenever the portal target changes (surface goes
  // from null → element when #ugs-stream-surface is discovered). The rAF
  // fallback catches cases where the container hasn't been laid out yet
  // during the layout-effect phase.
  useLayoutEffect(() => {
    applyFit();
    const raf = requestAnimationFrame(() => applyFit());
    return () => cancelAnimationFrame(raf);
  }, [applyFit, surface]);

  // Refit when the viewport resizes (dock resize, window resize, or portal
  // target size change). ResizeObserver catches dock/panel resizes that
  // don't fire window resize.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => applyFit());
    ro.observe(c);
    window.addEventListener('resize', applyFit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', applyFit);
    };
  }, [applyFit, surface]);

  // Wheel zoom toward the cursor. Attached as a non-passive listener so we can
  // preventDefault and stop the page from scrolling under the overlay.
  // Re-attach when surface changes because the portal swaps the container DOM node.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((v) => {
        const next = clampScale(v.scale * factor);
        const ratio = next / v.scale;
        return {
          scale: next,
          tx: px - (px - v.tx) * ratio,
          ty: py - (py - v.ty) * ratio,
        };
      });
    };
    c.addEventListener('wheel', handler, { passive: false });
    return () => c.removeEventListener('wheel', handler);
  }, [surface]);

  const zoomBy = (factor: number) => {
    const c = containerRef.current;
    if (!c) return;
    const px = c.clientWidth / 2;
    const py = c.clientHeight / 2;
    setView((v) => {
      const next = clampScale(v.scale * factor);
      const ratio = next / v.scale;
      return {
        scale: next,
        tx: px - (px - v.tx) * ratio,
        ty: py - (py - v.ty) * ratio,
      };
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only pan with the primary button; let other pointers pass through.
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({
      ...v,
      tx: d.tx + (e.clientX - d.sx),
      ty: d.ty + (e.clientY - d.sy),
    }));
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const overlay = (
    <div
      className="ai-mermaid-overlay absolute inset-0 z-40 flex flex-col bg-[var(--bg)]"
      style={{ overflow: 'hidden' }}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2"
        style={{ flexShrink: 0, position: 'relative', zIndex: 10 }}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-fg">
          <Workflow size={15} className="shrink-0 text-accent" />
          <span className="truncate">{t(locale, 'mermaid.diagram')}</span>
          <span className="hidden text-xs font-normal text-fg-dim sm:inline">
            · {t(locale, 'mermaid.expandHint')}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="min-w-[3rem] text-right text-xs tabular-nums text-fg-dim">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            title={t(locale, 'mermaid.zoomOut')}
            className="flex h-7 w-7 items-center justify-center rounded border border-border text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            title={t(locale, 'mermaid.zoomIn')}
            className="flex h-7 w-7 items-center justify-center rounded border border-border text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={applyFit}
            title={t(locale, 'mermaid.fit')}
            className="flex h-7 w-7 items-center justify-center rounded border border-border text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
          >
            {t(locale, 'comfy.back')}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', isolation: 'isolate' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          ref={contentRef}
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );

  return surface ? createPortal(overlay, surface) : overlay;
}

function hashCode(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanupMermaidRenderArtifacts(renderId: string) {
  document.getElementById(`d${renderId}`)?.remove();
  document.getElementById(`i${renderId}`)?.remove();
}
