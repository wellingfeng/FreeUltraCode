import { useEffect, useMemo, useState } from 'react';
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
 * - The text input above doubles as a live filter: typing narrows the list
 *   below to models whose name contains the query.
 * - Clicking a list item only marks it as pending (highlighted); it does not
 *   filter the list away. The user must then click the "Select / Add" button
 *   to confirm.
 * - The "Select / Add" button picks the pending model, or an existing model
 *   matching the input, or adds a new custom model when nothing matches.
 * - The list shows every option (selected + fetched/added + built-in catalog,
 *   minus user-deleted), each with an × to remove it (works for built-in models
 *   too — handy for retiring an outdated model).
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
  const [pending, setPending] = useState('');
  // Re-render when any picker mutates the shared model-list cache.
  const [, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((n) => n + 1);
    window.addEventListener('ugs:model-list-changed', bump);
    return () => window.removeEventListener('ugs:model-list-changed', bump);
  }, []);

  const options = editableModelOptions(cacheKey, builtins, value);

  const query = draft.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      query
        ? options.filter((model) => model.toLowerCase().includes(query))
        : options,
    [options, query],
  );

  const existingMatch = (candidate: string) =>
    options.find((model) => model.toLowerCase() === candidate.trim().toLowerCase());

  const commit = () => {
    const target = pending || draft.trim();
    if (!target) return;
    const existing = existingMatch(target);
    if (existing) {
      onChange(existing);
    } else {
      addUserModel(cacheKey, target);
      if (onAddModel) onAddModel(target);
      else onChange(target);
    }
    setPending('');
    setDraft('');
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

  const pick = (model: string) => {
    setPending(model);
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

      {/* Search / add a custom model */}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setPending('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          placeholder={
            locale === 'zh-CN'
              ? '搜索或输入自定义模型名…'
              : 'Search or enter a custom model name…'
          }
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-accent"
        />
        <button
          type="button"
          onClick={commit}
          disabled={!pending && !draft.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus size={13} strokeWidth={2.2} />
          {locale === 'zh-CN' ? '选中/添加' : 'Select / Add'}
        </button>
      </div>

      {/* Model list with per-item delete */}
      {filteredOptions.length > 0 ? (
        <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-bg p-1">
          {filteredOptions.map((model) => {
            const selected =
              model.trim().toLowerCase() === value.trim().toLowerCase() ||
              model === pending;
            return (
              <li key={model} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => pick(model)}
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
      ) : query ? (
        <p className="mt-1 rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-fg-faint">
          {locale === 'zh-CN'
            ? '没有匹配的模型，按 Enter 或点击「选中/添加」创建新模型。'
            : 'No matching models. Press Enter or click "Select / Add" to create a new model.'}
        </p>
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
