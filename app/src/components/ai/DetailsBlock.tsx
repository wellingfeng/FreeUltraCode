import type { ReactNode } from 'react';

/**
 * Collapsible panel for the `> [!details] 标题` blockquote marker produced by
 * convertDetailsHtml. Renders a native <details><summary> element, so folding is
 * handled by the browser and no rehype-raw / dangerouslySetInnerHTML is needed.
 */
export default function DetailsBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="ai-details my-2 rounded-md border border-border bg-panel-2/40">
      <summary className="ai-details__summary cursor-pointer select-none px-3 py-1.5 text-[13px] font-medium text-fg">
        {title || '详情'}
      </summary>
      <div className="ai-details__body border-t border-border px-3 py-2 text-sm">
        {children}
      </div>
    </details>
  );
}
