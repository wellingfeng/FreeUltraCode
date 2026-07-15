import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { SelectOption } from '@/store/types';

/**
 * Compact dropdown used by the AI-input composer (workspace / permission /
 * model). The trigger shows the current option's label (+ optional hint
 * badge); the menu pops *upward* because the composer sits at the bottom of
 * the screen. Clicking outside closes it.
 *
 * When open, an auto-focused search input at the top of the menu lets the user
 * filter options by typing — no search button needed.
 */
export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  variant?: 'default' | 'ghost';
  showSelectedHint?: boolean;
  /** Optional leading glyph, e.g. a folder icon for the workspace selector. */
  icon?: string;
  /** Accessible label for the trigger. */
  title?: string;
  className?: string;
}

const isZh = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh');

export default function Select({
  options,
  value,
  onChange,
  disabled = false,
  variant = 'default',
  showSelectedHint = true,
  icon,
  title,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // If value doesn't match any option (e.g. model override persisted but
  // options list was rebuilt), show the value itself instead of falling back
  // to options[0] — which would display a wrong label.
  const selected =
    options.find((o) => o.id === value) ??
    (value ? { id: value, label: value } : options[0]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Reset query and focus search input when the dropdown opens.
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    setQuery('');
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Filter options by label / hint / group (case-insensitive).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      return (
        opt.label.toLowerCase().includes(q) ||
        (opt.hint?.toLowerCase().includes(q) ?? false) ||
        (opt.group?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [options, query]);

  return (
    <div
      ref={rootRef}
      className={cn('relative min-w-0', open && 'z-50', className)}
    >
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
          variant === 'ghost'
            ? open
              ? 'border-transparent bg-border-soft/70 text-fg'
              : 'border-transparent bg-transparent text-fg-dim hover:bg-border-soft/55 hover:text-fg'
            : open
              ? 'border-accent bg-border-soft text-fg'
              : 'border-border bg-panel-2 text-fg-dim hover:border-accent hover:text-fg',
          disabled && 'cursor-not-allowed opacity-50 hover:border-border hover:text-fg-dim',
        )}
      >
        {icon && <span className="shrink-0 text-fg-faint">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        {showSelectedHint && selected?.hint && (
          <span className="shrink-0 rounded bg-border-soft px-1 py-0.5 text-[10px] text-fg-faint">
            {selected.hint}
          </span>
        )}
        <span className="shrink-0 text-[9px] text-fg-faint">▾</span>
      </button>

      {open && !disabled && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 min-w-full overflow-hidden rounded-md border border-border bg-panel shadow-lg"
          role="presentation"
        >
          {/* Search input — auto-focused when the menu opens. */}
          <div className="border-b border-border-soft px-2.5 py-1.5">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = filtered[0];
                  if (first) {
                    onChange(first.id);
                    setOpen(false);
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              placeholder={isZh ? '输入以筛选…' : 'Type to filter…'}
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
          {/* Options list */}
          <ul
            className="max-h-80 overflow-y-auto py-1"
            role="listbox"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-fg-faint">
                {isZh ? '无匹配结果' : 'No matches'}
              </li>
            ) : (
              filtered.map((opt, index) => {
                const active = opt.id === selected?.id;
                const showGroupHeader =
                  !opt.action &&
                  !!opt.group &&
                  opt.group !== filtered[index - 1]?.group;
                return (
                  <Fragment key={opt.id}>
                    {showGroupHeader && (
                      <li
                        role="presentation"
                        className={cn(
                          'px-3 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-faint',
                          index > 0 && 'mt-1 border-t border-border-soft',
                        )}
                      >
                        {opt.group}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onChange(opt.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs transition-colors',
                          opt.action
                            ? 'border-b border-border-soft text-accent hover:bg-accent/10 hover:text-accent'
                            : active
                              ? 'bg-border-soft text-fg'
                              : 'text-fg-dim hover:bg-border-soft hover:text-fg',
                        )}
                      >
                        <span
                          className={cn(
                            'text-[10px] leading-none',
                            opt.action
                              ? 'text-accent'
                              : active
                                ? 'text-accent'
                                : 'text-transparent',
                          )}
                        >
                          {opt.action ? '+' : '●'}
                        </span>
                        <span className="flex-1">{opt.label}</span>
                        {opt.hint && (
                          <span className="text-[10px] text-fg-faint">{opt.hint}</span>
                        )}
                      </button>
                    </li>
                  </Fragment>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
