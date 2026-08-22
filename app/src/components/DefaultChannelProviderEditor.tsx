import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, RefreshCw, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEFAULT_MODEL } from '@/lib/anthropic';
import { RUNTIME_ADAPTERS, type RuntimeAdapterId } from '@/lib/adapters';
import {
  addProvider,
  getProviderRuntimeInfo,
  isProviderBaseUrlValid,
  providerMetadataSignature,
  updateProvider,
  type Provider,
  type ProviderRuntimeStatus,
} from '@/lib/apiConfig';
import { flushSecureStorage } from '@/lib/secureStorage';
import {
  isCliAdapterAvailable,
  type CliRuntimeSnapshot,
} from '@/lib/cliConfig';
import { t, type Locale } from '@/lib/i18n';
import {
  loadShortcutSettings,
  matchesShortcut,
  subscribeShortcutSettings,
} from '@/lib/keyboardShortcuts';
import {
  providerModelCacheKey,
  providerModelOptions,
  refreshProviderModels,
  removeUserModel,
} from '@/lib/modelLists';
import { isTauri } from '@/lib/tauri';

export type ProviderDraft = Omit<Provider, 'id'>;
export type ProviderEditorMode = 'add' | 'edit';

export interface ProviderEditorState {
  mode: ProviderEditorMode;
  providerId?: string;
  draft: ProviderDraft;
  initial: ProviderDraft;
}

function providerKindToAdapter(kind: Provider['kind']): RuntimeAdapterId {
  if (kind === 'codex') return 'codex';
  if (kind === 'gemini') return 'gemini';
  if (kind === 'kimi') return 'kimi';
  if (kind === 'deepseek-harness') return 'deepseek-harness';
  if (kind === 'zcode') return 'zcode';
  return 'claude-code';
}

function adapterToProviderKind(adapter: RuntimeAdapterId): Provider['kind'] {
  if (adapter === 'codex') return 'codex';
  if (adapter === 'gemini') return 'gemini';
  if (adapter === 'kimi') return 'kimi';
  if (adapter === 'deepseek-harness') return 'deepseek-harness';
  if (adapter === 'zcode') return 'zcode';
  return 'anthropic';
}

export function providerDraft(provider: ProviderDraft): ProviderDraft {
  return {
    kind: provider.kind,
    name: provider.name,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    transport: provider.transport,
    model: provider.model ?? '',
    models: uniqueStringOptions(provider.models ?? []),
  };
}

function trimProviderDraft(draft: ProviderDraft): ProviderDraft {
  const model = draft.model?.trim();
  const models = uniqueStringOptions(draft.models ?? []);
  const transport =
    draft.kind === 'anthropic' ? draft.transport ?? 'direct' : 'cli';
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim(),
    transport,
    ...(model ? { model } : {}),
    ...(models.length > 0 ? { models } : {}),
  };
}

function sameStringOptions(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

export function providerDraftChanged(a: ProviderDraft, b: ProviderDraft): boolean {
  const left = trimProviderDraft(a);
  const right = trimProviderDraft(b);
  return (
    left.kind !== right.kind ||
    left.name !== right.name ||
    left.apiKey !== right.apiKey ||
    left.baseUrl !== right.baseUrl ||
    (left.transport ?? '') !== (right.transport ?? '') ||
    (left.model ?? '') !== (right.model ?? '') ||
    !sameStringOptions(left.models, right.models)
  );
}

function uniqueStringOptions(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function providerStatusLabel(
  status: ProviderRuntimeStatus,
  locale: Locale,
): string {
  if (status === 'direct') return t(locale, 'settings.models.statusDirect');
  if (status === 'cli') return t(locale, 'settings.models.statusCli');
  return t(locale, 'settings.models.statusUnavailable');
}

function clearErrorsForPatch(
  patch: Partial<ProviderDraft>,
): { name?: undefined; baseUrl?: undefined; duplicate?: undefined } {
  return {
    ...(patch.name !== undefined ? { name: undefined, duplicate: undefined } : {}),
    ...(patch.baseUrl !== undefined
      ? { baseUrl: undefined, duplicate: undefined }
      : {}),
    ...(patch.kind !== undefined ? { duplicate: undefined } : {}),
    ...(patch.model !== undefined ? { duplicate: undefined } : {}),
  };
}

export function DefaultChannelProviderEditor({
  locale,
  editor,
  providers,
  cliRuntime,
  onChange,
  onClose,
  onDelete,
  onSaved,
}: {
  locale: Locale;
  editor: ProviderEditorState;
  providers: Provider[];
  cliRuntime: CliRuntimeSnapshot;
  onChange: (draft: ProviderDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSaved: (provider?: Provider) => void;
}) {
  const [shortcutSettings, setShortcutSettingsState] = useState(
    loadShortcutSettings,
  );
  const [keyVisible, setKeyVisible] = useState(false);
  const [modelRefresh, setModelRefresh] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });
  const [errors, setErrors] = useState<{
    name?: string;
    baseUrl?: string;
    duplicate?: string;
  }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftAdapter = providerKindToAdapter(editor.draft.kind);
  const canUseCliFallback =
    isTauri() && isCliAdapterAvailable(draftAdapter, cliRuntime);
  const runtime = getProviderRuntimeInfo(editor.draft, { canUseCliFallback });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, shortcutSettings['modal-close'])) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, shortcutSettings]);

  useEffect(
    () => subscribeShortcutSettings(setShortcutSettingsState),
    [],
  );

  const patchDraft = (patch: Partial<ProviderDraft>) => {
    setSaveError(null);
    setErrors((prev) => ({ ...prev, ...clearErrorsForPatch(patch) }));
    onChange({ ...editor.draft, ...patch });
  };

  const refreshModels = async () => {
    setModelRefresh({ loading: true, error: null });
    try {
      const result = await refreshProviderModels(editor.draft);
      setModelRefresh({
        loading: false,
        error: result.error ?? null,
      });
    } catch (err) {
      setModelRefresh({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSave = async () => {
    const next = trimProviderDraft(editor.draft);
    const nextErrors: typeof errors = {};
    if (!next.name) {
      nextErrors.name = t(locale, 'settings.models.validationNameRequired');
    }
    if (!isProviderBaseUrlValid(next.baseUrl)) {
      nextErrors.baseUrl = t(locale, 'settings.models.validationBaseUrl');
    }
    const duplicate = providers.some((provider) => {
      if (editor.mode === 'edit' && provider.id === editor.providerId) {
        return false;
      }
      return (
        providerMetadataSignature(provider) === providerMetadataSignature(next)
      );
    });
    if (duplicate) {
      nextErrors.duplicate = t(locale, 'settings.models.validationDuplicate');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      let savedProvider: Provider | undefined;
      if (editor.mode === 'edit' && editor.providerId) {
        updateProvider(editor.providerId, next);
        savedProvider = { ...next, id: editor.providerId };
      } else {
        savedProvider = addProvider(next);
      }
      await flushSecureStorage();
      onSaved(savedProvider);
    } catch {
      setSaveError(t(locale, 'settings.models.saveError'));
    }
  };

  const title =
    editor.mode === 'add'
      ? t(locale, 'settings.models.addTitle')
      : t(locale, 'settings.models.editTitle');
  const keyToggleLabel = keyVisible
    ? t(locale, 'settings.models.hideKey')
    : t(locale, 'settings.models.showKey');
  const KeyIcon = keyVisible ? EyeOff : Eye;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 sm:flex sm:items-center sm:justify-center sm:p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-editor-title"
        data-provider-editor="true"
        data-settings-child-modal="true"
        className="fixed inset-x-0 bottom-0 flex max-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-t-lg border border-border bg-panel shadow-2xl sm:relative sm:inset-auto sm:max-h-[calc(100vh-3rem)] sm:w-[min(720px,calc(100vw-2rem))] sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border-soft bg-bg-alt px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3
                id="provider-editor-title"
                className="text-base font-semibold text-fg"
              >
                {title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, 'settings.modelsDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              title={t(locale, 'common.close')}
              aria-label={t(locale, 'common.close')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-faint transition-colors hover:border-accent hover:text-fg"
            >
              <X size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t(locale, 'settings.models.providerName')}
              value={editor.draft.name}
              onChange={(value) => patchDraft({ name: value })}
              placeholder={t(locale, 'settings.models.newProviderName')}
              error={errors.name}
            />
            <div className="block space-y-1">
              <span className="text-[11px] font-medium text-fg-dim">
                {t(locale, 'settings.models.sourceType')}
              </span>
              <div className="flex gap-1">
                {RUNTIME_ADAPTERS.map((adapter) => {
                  const active = draftAdapter === adapter.id;
                  return (
                    <button
                      key={adapter.id}
                      type="button"
                      onClick={() =>
                        patchDraft({ kind: adapterToProviderKind(adapter.id) })
                      }
                      className={cn(
                        'flex-1 rounded border px-2 py-1.5 text-[11px] transition-colors',
                        active
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-bg text-fg-dim hover:border-accent/50 hover:text-fg',
                      )}
                    >
                      {adapter.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ReadonlyField
              label={t(locale, 'settings.models.authState')}
              value={
                runtime.hasApiKey
                  ? t(locale, 'settings.models.authConfigured')
                  : t(locale, 'settings.models.authMissing')
              }
            />
            <ReadonlyField
              label={t(locale, 'settings.models.availability')}
              value={
                <StatusBadge
                  state={runtime.status}
                  label={providerStatusLabel(runtime.status, locale)}
                />
              }
            />
            <TextField
              label={t(locale, 'settings.models.baseUrl')}
              value={editor.draft.baseUrl}
              onChange={(value) => patchDraft({ baseUrl: value })}
              placeholder="https://api.anthropic.com"
              error={errors.baseUrl}
              mono
              fullWidth
            />
            <ModelTextField
              label={t(locale, 'settings.models.defaultModel')}
              value={editor.draft.model ?? ''}
              onChange={(value) => patchDraft({ model: value })}
              placeholder={DEFAULT_MODEL}
              description={t(locale, 'settings.models.modelMetadataHelp')}
              options={providerModelOptions(editor.draft)}
              loading={modelRefresh.loading}
              error={modelRefresh.error}
              refreshLabel={t(locale, 'settings.models.fetchModels')}
              selectLabel={t(locale, 'settings.models.selectModel')}
              onRefresh={refreshModels}
              deleteLabel={t(locale, 'settings.models.delete')}
              onRemoveModel={(model) => {
                // Remove from the persistent model cache (and hide it so a later
                // fetch does not bring it back), plus from the draft's own list.
                removeUserModel(providerModelCacheKey(editor.draft), model);
                const trimmed = model.trim().toLowerCase();
                const nextModels = (editor.draft.models ?? []).filter(
                  (m) => m.trim().toLowerCase() !== trimmed,
                );
                const clearSelected =
                  (editor.draft.model ?? '').trim().toLowerCase() === trimmed;
                patchDraft({
                  models: nextModels,
                  ...(clearSelected ? { model: nextModels[0] ?? '' } : {}),
                });
              }}
            />
            <div className="block space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="provider-api-key"
                  className="text-[11px] font-medium text-fg-dim"
                >
                  {t(locale, 'settings.models.apiKey')}
                </label>
                <button
                  type="button"
                  aria-label={keyToggleLabel}
                  title={keyToggleLabel}
                  onClick={() => setKeyVisible((visible) => !visible)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-panel-2 hover:text-fg"
                >
                  <KeyIcon size={15} strokeWidth={2.1} />
                </button>
              </div>
              <input
                id="provider-api-key"
                type={keyVisible ? 'text' : 'password'}
                value={editor.draft.apiKey}
                onChange={(event) => patchDraft({ apiKey: event.target.value })}
                placeholder="sk-ant-..."
                autoComplete="off"
                spellCheck={false}
                aria-describedby="provider-api-key-help"
                className="w-full rounded border border-border bg-bg py-1.5 pl-2 pr-10 font-mono text-xs text-fg outline-none transition-colors focus:border-accent"
              />
            </div>
          </div>

          {errors.duplicate && (
            <p className="mt-3 text-[11px] leading-relaxed text-rose-300">
              {errors.duplicate}
            </p>
          )}

          <p
            id="provider-api-key-help"
            className="mt-4 rounded border border-border-soft bg-bg-alt px-3 py-2 text-[11px] leading-relaxed text-fg-faint"
          >
            {t(locale, 'settings.models.localHint')}
          </p>
        </div>

        <div className="shrink-0 border-t border-border-soft bg-bg-alt px-5 py-3">
          {saveError && (
            <p className="mb-2 text-[11px] leading-relaxed text-rose-300">
              {saveError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition-colors hover:bg-rose-500/20"
              >
                <Trash2 size={13} strokeWidth={2.2} />
                {t(locale, 'settings.models.delete')}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
              >
                {t(locale, 'common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90"
              >
                {t(locale, 'settings.models.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  state,
  label,
}: {
  state: ProviderRuntimeStatus;
  label: string;
}) {
  const styles =
    state === 'direct'
      ? {
          pill: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
          dot: 'bg-emerald-400',
        }
      : state === 'unavailable'
        ? {
            pill: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
            dot: 'bg-rose-400',
          }
        : {
            pill: 'border-border bg-panel text-fg-faint',
            dot: 'bg-fg-faint',
          };

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]',
        styles.pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
      {label}
    </span>
  );
}

function ReadonlyField({
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

function TextField({
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

function ModelTextField({
  label,
  value,
  onChange,
  placeholder,
  description,
  options,
  loading,
  error,
  refreshLabel,
  selectLabel,
  onRefresh,
  onRemoveModel,
  deleteLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  options: string[];
  loading: boolean;
  error: string | null;
  refreshLabel: string;
  selectLabel: string;
  onRefresh: () => void;
  onRemoveModel: (model: string) => void;
  deleteLabel: string;
}) {
  const modelOptions = uniqueStringOptions([value, ...options]);
  const selectValue = modelOptions.includes(value.trim()) ? value.trim() : '';
  return (
    <label className="block space-y-1 sm:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-fg-dim">{label}</span>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            strokeWidth={2}
            className={loading ? 'animate-spin' : undefined}
          />
          {refreshLabel}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)]">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-accent"
        />
        <select
          value={selectValue}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
          className="h-[31px] w-full rounded border border-border bg-bg px-2 font-mono text-xs text-fg outline-none transition-colors focus:border-accent"
        >
          <option value="">{selectLabel}</option>
          {modelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>
      {modelOptions.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {modelOptions.map((model) => {
            const selected = model.trim().toLowerCase() === value.trim().toLowerCase();
            return (
              <li
                key={model}
                className={
                  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] ' +
                  (selected
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border bg-bg text-fg-dim')
                }
              >
                <button
                  type="button"
                  onClick={() => onChange(model)}
                  className="max-w-[14rem] truncate text-left hover:text-fg"
                  title={model}
                >
                  {model}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveModel(model)}
                  title={deleteLabel}
                  aria-label={deleteLabel}
                  className="flex h-4 w-4 items-center justify-center rounded text-fg-faint transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <X size={11} strokeWidth={2.4} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {description && (
        <p className="text-[11px] leading-relaxed text-fg-faint">{description}</p>
      )}
      {error && (
        <p className="text-[11px] leading-relaxed text-amber-300">{error}</p>
      )}
    </label>
  );
}
