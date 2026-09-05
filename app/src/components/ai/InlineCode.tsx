import type { ReactNode } from 'react';
import { parseFileRef } from './lib/filePath';
import { classifyInlineCode } from './lib/inlineCodeKind';
import FileChip, { type OpenFileFn } from './FileChip';

/**
 * Inline `code` renderer. When the span's text parses as a local file reference
 * (e.g. `src/store/useStore.ts:42`) it becomes a clickable {@link FileChip};
 * otherwise it renders a normal styled inline-code chip. Inline code is the
 * highest-signal, lowest-false-positive surface for file detection — the author
 * already wrapped it in backticks — so we relax the existence bar here.
 */
export default function InlineCode({
  children,
  onOpenFile,
  cwd,
}: {
  children?: ReactNode;
  onOpenFile?: OpenFileFn;
  cwd?: string;
}) {
  const text = childrenToText(children);
  const ref = text ? parseFileRef(text, { allowSpaces: true }) : null;

  // Color by token category (path / command / flag / function / identifier)
  // using the same theme vars the fenced code blocks use, so an answer's prose
  // and its code blocks share one palette. Unknown content keeps the plain
  // accent color.
  const kind = classifyInlineCode(text);
  const kindClass =
    kind === 'cmd'
      ? ' ai-inline-code--cmd'
      : kind === 'flag'
        ? ' ai-inline-code--flag'
        : kind === 'func'
          ? ' ai-inline-code--func'
          : kind === 'path'
            ? ' ai-inline-code--path'
            : kind === 'ident'
              ? ' ai-inline-code--ident'
              : '';

  const plainCode = (
    <code
      className={`ai-inline-code rounded-none bg-[color-mix(in_oklab,var(--code-bg)_30%,transparent)] px-1 py-0 font-mono text-[12px] text-accent-2${kindClass}`}
    >
      {children}
    </code>
  );

  if (ref) {
    return (
      <FileChip
        refData={ref}
        onOpenFile={onOpenFile}
        cwd={cwd}
        overflowFallback={plainCode}
      />
    );
  }

  return plainCode;
}

function childrenToText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (typeof children === 'number') return String(children);
  return '';
}
