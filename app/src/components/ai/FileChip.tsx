import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { FileCode, FolderOpen, ImageOff, Loader2 } from 'lucide-react';
import {
  displayFileRefLabel,
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
  const budget = createFileChipBudget(limit);

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
  return (
    <span
      className="ai-file-chip-limit inline-flex max-w-full items-center rounded border border-border-soft bg-panel-2 px-1.5 py-0.5 align-baseline text-[11px] leading-snug text-fg-faint"
      title={t(locale, 'chat.fileRefsFolded')}
    >
      {t(locale, 'chat.fileRefsFolded')}
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
}: {
  refData: FileRef;
  onOpenFile?: OpenFileFn;
  cwd?: string;
}) {
  const slot = useFileChipSlot();
  if (slot === 'notice') return <FileChipLimitNotice />;
  if (slot === 'hidden') return null;

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
  const displayPath = displayFileRefPath(refData, cwd);
  const label = displayFileRefLabel(refData, cwd);
  const interactive = typeof onOpenFile === 'function';
  const isImage = isImageFileRef(refData);
  const thumb = useImageThumbnail(isImage ? displayPath : null, cwd);

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
    if (interactive) void onOpenFile(refData);
  };

  const revealFile = () => {
    setMenu(null);
    if (interactive) void onOpenFile(refData, { reveal: true });
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
          disabled={!interactive}
          onClick={interactive ? openFile : undefined}
          onContextMenu={openContextMenu}
          title={
            interactive
              ? `${label}\n${t(locale, 'chat.revealHint')}`
              : label
          }
          className={
            'ai-file-chip-thumb group relative inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel-2 align-top ' +
            (interactive ? 'cursor-pointer hover:border-accent' : 'cursor-default')
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

  return (
    <span className="relative inline-flex max-w-full align-baseline">
      <button
        type="button"
        disabled={!interactive}
        onClick={interactive ? openFile : undefined}
        onContextMenu={openContextMenu}
        title={
          interactive
            ? `${label}\n${t(locale, 'chat.revealHint')}`
            : label
        }
        className={
          'ai-file-chip inline-flex max-w-full items-center gap-1 rounded border border-transparent bg-transparent px-0.5 py-px align-baseline font-mono text-[12px] leading-snug ' +
          (interactive
            ? 'ai-file-chip--interactive cursor-pointer'
            : 'cursor-default text-fg-dim')
        }
      >
        {isImage ? (
          <ImageOff size={11} className="shrink-0 opacity-70" />
        ) : (
          <FileCode size={11} className="shrink-0 opacity-70" />
        )}
        <span className="ai-file-chip__label min-w-0 whitespace-normal break-all text-left">
          {displayPath}
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
