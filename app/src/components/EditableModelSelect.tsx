import { useEffect, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { t, type Locale } from '@/lib/i18n';
import {
  addUserModel,
  editableModelOptions,
  removeUserModel,
} from '@/lib/modelLists';

/**
 * Editable model picker shared by the programming/image/music/video/speech/3D
 * provider rows.
 *
 * - A text input + "add" button above lets the user type a custom model name.
 * - The list below shows every option (selected + fetched/added + built-in
 *   catalog, minus user-deleted), each with an × to remove it (works for
 *   built-in models too — handy for retiring an outdated model).
 * - The "fetch models" button merges results into the list without dropping
 *   manual additions (see modelLists.refreshEndpointModels).
 *
 * All add/remove state lives in the model-list cache (modelLists.ts), keyed by
 * `cacheKey`, and broadcasts `ugs:model-list-changed` so every mounted picker
 * for the same key stays in sync.
 */
export function EditableModelSelect({
  cacheKey,
  builtins,
  value,
  label,
  locale,
  loading,
  error,
  canRefresh,
  className,
  onChange,
  onAddModel,
  onRemoveModel,
  onRefresh,
}: {
  cacheKey: string;
  builtins: string[];
  value: string;
  label: string;
  locale: Locale;
  loading: boolean;
  error: string | null;
  canRefresh: boolean;
  className?: string;
  onChange: (model: string) => void;
  onAddModel?: (model: string) => void;
  onRemoveModel?: (model: string, nextValue: string) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState('');
  // Re-render when any picker mutates the shared model-list cache.
  const [, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((n) => n + 1);
    window.addEventListener('ugs:model-list-changed', bump);
    return () => window.removeEventListener('ugs:model-list-changed', bump);
  }, []);

  const options = editableModelOptions(cacheKey, builtins, value);

  const commitAdd = () => {
    const next = draft.trim();
    if (!next) return;
    addUserModel(cacheKey, next);
    setDraft('');
    if (onAddModel) onAddModel(next);
    else onChange(next);
  };

  const remove = (model: string) => {
    removeUserModel(cacheKey, model);
    const selected = model.trim().toLowerCase() === value.trim().toLowerCase();
    const remaining = editableModelOptions(cacheKey, builtins, '').filter(
      (m) => m.toLowerCase() !== model.trim().toLowerCase(),
    );
    const nextValue = selected ? remaining[0] ?? '' : value;
    if (onRemoveModel) {
      onRemoveModel(model, nextValue);
      return;
    }
    if (model.trim().toLowerCase() === value.trim().toLowerCase()) {
      onChange(nextValue);
    }
  };

  return (
    <label className={className ?? 'block space-y-1 lg:col-span-2'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-fg-dim">{label}</span>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={!canRefresh || loading}
          title={
            canRefresh
              ? t(locale, 'settings.models.fetchModels')
              : t(locale, 'settings.models.fetchModelsUnavailable')
          }
          className="inline-flex items-center gap-1 rounded border border-border bg-panel px-2 py-0.5 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RefreshCw
            size={11}
            strokeWidth={2}
            className={loading ? 'animate-spin' : undefined}
          />
          {t(locale, 'settings.models.fetchModels')}
        </button>
      </div>

      {/* Add a custom model */}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitAdd();
            }
          }}
          placeholder={locale === 'zh-CN' ? '输入自定义模型名…' : 'Enter a custom model name…'}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-accent"
        />
        <button
          type="button"
          onClick={commitAdd}
          disabled={!draft.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus size={13} strokeWidth={2.2} />
          {locale === 'zh-CN' ? '添加' : 'Add'}
        </button>
      </div>

      {/* Model list with per-item delete */}
      {options.length > 0 ? (
        <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-bg p-1">
          {options.map((model) => {
            const selected = model.trim().toLowerCase() === value.trim().toLowerCase();
            return (
              <li key={model} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onChange(model)}
                  className={
                    'min-w-0 flex-1 truncate rounded px-2 py-1 text-left font-mono text-xs transition-colors ' +
                    (selected
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg-dim hover:bg-panel hover:text-fg')
                  }
                  title={model}
                >
                  {selected ? '● ' : ''}
                  {model}
                </button>
                <button
                  type="button"
                  onClick={() => remove(model)}
                  title={t(locale, 'settings.models.delete')}
                  aria-label={t(locale, 'settings.models.delete')}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <X size={12} strokeWidth={2.4} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-fg-faint">
          {locale === 'zh-CN'
            ? '暂无模型，请在上方输入框添加或点击「获取模型」。'
            : 'No models yet. Add one above or click "Fetch models".'}
        </p>
      )}

      {error && (
        <p className="text-[11px] leading-relaxed text-amber-300">{error}</p>
      )}
    </label>
  );
}
