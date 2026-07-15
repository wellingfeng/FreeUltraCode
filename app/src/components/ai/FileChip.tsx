import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { FileCode, FolderOpen, ImageOff, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';
import {
  displayFileRefPath,
  fileRefLineSuffix,
  isImageFileRef,
  type FileRef,
} from './lib/filePath';
import {
  FileChipBudgetContext,
  claimFileChipSlot,
  createFileChipBudget,
  useFileChipBudget,
  type FileChipSlot,
} from './lib/fileChipBudget';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import { previewLocalFile } from '@/lib/tauri';
import { createObjectUrlFromBase64, revokeObjectUrl } from '@/lib/objectUrl';

export interface OpenFileIntent {
  reveal?: boolean;
}

export interface OpenFileFn {
  (ref: FileRef, intent?: OpenFileIntent): void | Promise<void>;
}

interface ContextMenuPosition {
  x: number;
  y: number;
}

const MENU_WIDTH = 168;
const MENU_HEIGHT = 36;
const MENU_MARGIN = 8;

export function FileChipBudgetProvider({
  children,
  limit,
}: {
  children: ReactNode;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const budget = createFileChipBudget(limit, expanded, setExpanded);

  return (
    <FileChipBudgetContext.Provider value={budget}>
      {children}
    </FileChipBudgetContext.Provider>
  );
}

function useFileChipSlot(): FileChipSlot {
  const budget = useFileChipBudget();
  const idRef = useRef<symbol | null>(null);
  if (!budget) return 'visible';

  if (!idRef.current) idRef.current = Symbol('file-chip');
  const slotId = idRef.current;
  const existing = budget.slots.get(slotId);
  if (existing) return existing;

  const slot = claimFileChipSlot(budget);
  budget.slots.set(slotId, slot);
  return slot;
}

export function FileChipLimitNotice() {
  const locale = useStore((s) => s.locale);
  const budget = useFileChipBudget();
  const label = t(locale, 'chat.fileRefsFolded');
  const expand = () => budget?.setExpanded?.(true);

  if (budget?.setExpanded) {
    return (
      <button
        type="button"
        className="ai-file-chip-limit inline-flex max-w-full cursor-pointer items-center rounded border border-border-soft bg-panel-2 px-1.5 py-0.5 align-baseline text-[11px] leading-snug text-fg-faint transition-colors hover:border-accent hover:text-fg"
        title={`${label} · ${t(locale, 'chat.expand')}`}
        aria-expanded={budget.expanded}
        aria-label={`${t(locale, 'chat.expand')}：${label}`}
        onClick={expand}
      >
        {label}
      </button>
    );
  }

  return (
    <span
      className="ai-file-chip-limit inline-flex max-w-full items-center rounded border border-border-soft bg-panel-2 px-1.5 py-0.5 align-baseline text-[11px] leading-snug text-fg-faint"
      title={label}
    >
      {label}
    </span>
  );
}

function contextMenuPosition(event: ReactMouseEvent): ContextMenuPosition {
  if (typeof window === 'undefined') {
    return { x: event.clientX, y: event.clientY };
  }
  return {
    x: Math.max(
      MENU_MARGIN,
      Math.min(event.clientX, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
    ),
    y: Math.max(
      MENU_MARGIN,
      Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - MENU_MARGIN),
    ),
  };
}

type ThumbState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error' };

/**
 * Lightweight existence check via the Tauri fs plugin.  Returns 'checking'
 * initially, then 'exists' or 'missing'.  Skipped for remote workspaces and
 * non-desktop contexts.
 */
function useFileExists(path: string | null, cwd: string | undefined): 'checking' | 'exists' | 'missing' {
  const [state, setState] = useState<'checking' | 'exists' | 'missing'>('checking');

  useEffect(() => {
    if (!path || path.startsWith('remote://') || cwd?.startsWith('remote://')) {
      setState('exists'); // can't check — assume OK so chip stays interactive
      return;
    }

    let disposed = false;
    setState('checking');

    void (async () => {
      try {
        const { exists } = await import('@tauri-apps/plugin-fs');
        const { join } = await import('@tauri-apps/api/path');
        let resolved = path;
        const isAbsolute = /^(?:[A-Za-z]:[/\\]|[/\\]|\\\\|~[/\\]|\$\w+[/\\])/.test(path);
        if (!isAbsolute && cwd) {
          resolved = await join(cwd, path);
        }
        const ok = await exists(resolved);
        if (!disposed) setState(ok ? 'exists' : 'missing');
      } catch {
        if (!disposed) setState('exists'); // optimistic fallback
      }
    })();

    return () => { disposed = true; };
  }, [path, cwd]);

  return state;
}

function useCopyToClipboard(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        try { ta.select(); document.execCommand('copy'); }
        finally { if (ta.parentNode) ta.parentNode.removeChild(ta); }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };
  return [copied, copy];
}

/**
 * Lazily load a small in-memory preview of an image file reference so the chip
 * can show its thumbnail. Reuses the same `preview_local_file` backend command
 * the right-side drawer relies on, and revokes the object URL on cleanup.
 */
function useImageThumbnail(
  path: string | null,
  cwd: string | undefined,
): ThumbState {
  const [state, setState] = useState<ThumbState>({ status: 'loading' });

  useEffect(() => {
    if (!path || path.startsWith('remote://') || cwd?.startsWith('remote://')) {
      setState({ status: 'error' });
      return;
    }

    let disposed = false;
    let createdUrl: string | null = null;
    setState({ status: 'loading' });

    void previewLocalFile(path, { cwd })
      .then(async (file) => {
        if (disposed) return;
        if (file.kind !== 'image' || !file.base64 || !file.mime) {
          setState({ status: 'error' });
          return;
        }
        try {
          const url = await createObjectUrlFromBase64(file.base64, file.mime);
          if (disposed) {
            revokeObjectUrl(url);
            return;
          }
          createdUrl = url;
          setState({ status: 'ready', url });
        } catch {
          if (!disposed) setState({ status: 'error' });
        }
      })
      .catch(() => {
        if (!disposed) setState({ status: 'error' });
      });

    return () => {
      disposed = true;
      revokeObjectUrl(createdUrl);
    };
  }, [path, cwd]);

  return state;
}

/**
 * A clickable chip for a local file reference (e.g. `src/store/useStore.ts:42`).
 * Shows the basename + optional `:line` suffix; the full path is in the tooltip.
 * Clicking calls `onOpenFile`; right-clicking opens a small reveal-in-folder
 * menu. When no handler is wired the chip is styled inert but still serves as a
 * visual signal that this token is a file path.
 */
export default function FileChip({
  refData,
  onOpenFile,
  cwd,
  overflowFallback,
}: {
  refData: FileRef;
  onOpenFile?: OpenFileFn;
  cwd?: string;
  overflowFallback?: ReactNode;
}) {
  const slot = useFileChipSlot();
  if (slot === 'notice') return overflowFallback ?? <FileChipLimitNotice />;
  if (slot === 'hidden') return overflowFallback ?? null;

  return <VisibleFileChip refData={refData} onOpenFile={onOpenFile} cwd={cwd} />;
}

export function VisibleFileChip({
  refData,
  onOpenFile,
  cwd,
}: {
  refData: FileRef;
  onOpenFile?: OpenFileFn;
  cwd?: string;
}) {
  const [menu, setMenu] = useState<ContextMenuPosition | null>(null);
  const locale = useStore((s) => s.locale);
  const lineSuffix = fileRefLineSuffix(refData);
  // Show the original path from AI output, not the cwd-concatenated one.
  const originalPath = refData.path;
  // Resolved path is still used for existence check, tooltip, and copy.
  const resolvedPath = displayFileRefPath(refData, cwd);
  const interactive = typeof onOpenFile === 'function';
  const isImage = isImageFileRef(refData);
  const thumb = useImageThumbnail(isImage ? resolvedPath : null, cwd);
  const existsState = useFileExists(interactive ? resolvedPath : null, cwd);
  const [copied, copyToClipboard] = useCopyToClipboard();
  const fileMissing = existsState === 'missing';

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const openFile = () => {
    setMenu(null);
    if (fileMissing) return; // Don't attempt to open a non-existent file.
    // Keep left-click type-aware inside the app. FilePreviewDrawer renders
    // images as images, source/text files as text, and unsupported binaries
    // without delegating the primary click to Windows.
    if (interactive) void onOpenFile(refData);
  };

  const previewInApp = () => {
    setMenu(null);
    if (interactive) void onOpenFile(refData);
  };

  const revealFile = () => {
    setMenu(null);
    if (interactive) void onOpenFile(refData, { reveal: true });
  };

  const copyPath = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void copyToClipboard(resolvedPath);
    setMenu(null);
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu(contextMenuPosition(event));
  };

  const contextMenu = menu && (
    <div
      role="menu"
      className="ai-file-chip-menu fixed z-[70] min-w-[168px] rounded-md border border-border bg-panel py-1 text-xs text-fg shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={copyPath}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-border-soft"
      >
        {copied ? <Check size={13} className="shrink-0 text-accent-2" /> : <Copy size={13} className="shrink-0 text-fg-faint" />}
        <span className="truncate">{copied ? t(locale, 'chat.copied') : t(locale, 'chat.copyPath')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={previewInApp}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-border-soft"
      >
        <FileCode size={13} className="shrink-0 text-fg-faint" />
        <span className="truncate">{t(locale, 'chat.previewInApp')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={revealFile}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-border-soft"
      >
        <FolderOpen size={13} className="shrink-0 text-fg-faint" />
        <span className="truncate">{t(locale, 'chat.reveal')}</span>
      </button>
    </div>
  );

  // Image references render as a clickable thumbnail card instead of a path
  // chip. Clicking still routes through onOpenFile so the right-side preview
  // drawer opens exactly as before. If the thumbnail can't be loaded (browser
  // mode, missing file) we fall through to the plain path chip below.
  if (isImage && thumb.status !== 'error') {
    return (
      <span className="relative inline-flex max-w-full align-top">
        <button
          type="button"
          disabled={!interactive || fileMissing}
          onClick={interactive && !fileMissing ? openFile : undefined}
          onContextMenu={openContextMenu}
          title={
            interactive
              ? `${resolvedPath}\n${t(locale, 'chat.revealHint')}`
              : resolvedPath
          }
          className={
            'ai-file-chip-thumb group relative inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel-2 align-top ' +
            (interactive && !fileMissing ? 'cursor-pointer hover:border-accent' : 'cursor-default') +
            (fileMissing ? ' border-status-error/50' : '')
          }
        >
          {thumb.status === 'ready' ? (
            <img
              src={thumb.url}
              alt={refData.basename}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <Loader2 size={16} className="animate-spin text-accent" />
          )}
        </button>
        {contextMenu}
      </span>
    );
  }

  const chipTitle = fileMissing
    ? `${t(locale, 'chat.fileNotFound')}: ${resolvedPath}\n${t(locale, 'chat.fileNotFoundHint')}`
    : interactive
      ? `${resolvedPath}\n${t(locale, 'chat.revealHint')}`
      : resolvedPath;

  return (
    <span className="relative inline-flex max-w-full align-baseline">
      <button
        type="button"
        disabled={!interactive || fileMissing}
        onClick={interactive && !fileMissing ? openFile : undefined}
        onContextMenu={openContextMenu}
        title={chipTitle}
        className={
          'ai-file-chip inline-flex max-w-full items-center gap-1 rounded border bg-transparent px-0.5 py-px align-baseline font-mono text-[12px] leading-snug ' +
          (fileMissing
            ? 'border-status-error/30 text-status-error'
            : 'border-transparent ') +
          (interactive && !fileMissing
            ? 'ai-file-chip--interactive cursor-pointer'
            : 'cursor-default text-fg-dim')
        }
      >
        {fileMissing ? (
          <AlertTriangle size={11} className="shrink-0 opacity-70" />
        ) : isImage ? (
          <ImageOff size={11} className="shrink-0 opacity-70" />
        ) : (
          <FileCode size={11} className="shrink-0 opacity-70" />
        )}
        <span className="ai-file-chip__label min-w-0 whitespace-normal break-all text-left">
          {originalPath}
          {lineSuffix && (
            <span className={interactive ? 'opacity-75' : 'text-fg-faint'}>
              {lineSuffix}
            </span>
          )}
        </span>
      </button>
      {contextMenu}
    </span>
  );
}
