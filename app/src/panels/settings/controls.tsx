import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Check,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const isZh =
  typeof navigator !== 'undefined' && navigator.language?.startsWith('zh');

export function SelectControl<T extends string>({
  value,
  options,
  onChange,
  icon,
}: {
  value: T;
  options: { id: T; label: string; hint?: string; group?: string }[];
  onChange: (id: T) => void;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Reset query and focus the search input when the dropdown opens.
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

  const selected = options.find((o) => o.id === value);

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
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex min-h-9 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
          open
            ? 'border-accent bg-border-soft text-fg'
            : 'border-border bg-panel text-fg-dim hover:border-accent hover:text-fg',
        )}
      >
        {icon && <span className="shrink-0 text-fg-faint">{icon}</span>}
        <span className="min-w-0 flex-1 truncate text-fg">{selected?.label}</span>
        {selected?.hint && (
          <span className="hidden shrink-0 font-mono text-[10px] text-fg-faint sm:inline">
            {selected.hint}
          </span>
        )}
        <ChevronDown
          size={15}
          strokeWidth={2.1}
          className={cn('shrink-0 text-fg-faint transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-full min-w-[16rem] max-w-[20rem] overflow-hidden rounded-md border border-border bg-panel shadow-xl">
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
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
          <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-fg-faint">
                {isZh ? '无匹配结果' : 'No matches'}
              </li>
            ) : (
              filtered.map((option, index) => {
                const active = option.id === value;
                const showGroupHeader =
                  !!option.group && option.group !== filtered[index - 1]?.group;
                return (
                  <Fragment key={option.id}>
                    {showGroupHeader && (
                      <li
                        role="presentation"
                        className={cn(
                          'px-3 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-faint',
                          index > 0 && 'mt-1 border-t border-border-soft',
                        )}
                      >
                        {option.group}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onChange(option.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                          active
                            ? 'bg-border-soft text-fg'
                            : 'text-fg-dim hover:bg-border-soft hover:text-fg',
                        )}
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                          {active && <Check size={14} strokeWidth={2.4} className="text-accent" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {option.hint && (
                          <span className="shrink-0 font-mono text-[10px] text-fg-faint">
                            {option.hint}
                          </span>
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

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  description,
  error,
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <label className={cn('block space-y-1', fullWidth && 'sm:col-span-2')}>
      <span className="text-[11px] font-medium text-fg-dim">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none transition-colors focus:border-accent',
          mono && 'font-mono',
          error && 'border-rose-500/60',
        )}
      />
      {description && (
        <p className="text-[11px] leading-relaxed text-fg-faint">{description}</p>
      )}
      {error && (
        <p className="text-[11px] leading-relaxed text-rose-300">{error}</p>
      )}
    </label>
  );
}

export function ReadonlyField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="block space-y-1">
      <span className="text-[11px] font-medium text-fg-dim">{label}</span>
      <div className="min-h-[31px] rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg-dim">
        {value}
      </div>
    </div>
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-bg-alt p-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(16rem,32rem)] lg:items-center">
      <div className="space-y-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        {description && (
          <p className="text-xs leading-relaxed text-fg-faint">{description}</p>
        )}
      </div>
      <div className="min-w-0 lg:flex lg:w-full lg:justify-end">{children}</div>
    </div>
  );
}

export function SwitchControl({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full border transition-colors',
        checked ? 'border-accent bg-accent/25' : 'border-border bg-panel-2',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform',
          checked ? 'translate-x-5 bg-accent' : 'translate-x-0 bg-fg-faint',
        )}
      />
    </button>
  );
}

export function StepperControl({
  value,
  min,
  max,
  disabled = false,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <button
        type="button"
        aria-label="−"
        onClick={() => set(value - 1)}
        disabled={value <= min}
        className={btn}
      >
        −
      </button>
      <span className="w-10 text-center font-mono text-sm text-fg">{value}</span>
      <button
        type="button"
        aria-label="+"
        onClick={() => set(value + 1)}
        disabled={value >= max}
        className={btn}
      >
        +
      </button>
    </div>
  );
}
