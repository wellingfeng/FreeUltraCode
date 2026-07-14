import { useState } from 'react';
import {
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { EditableModelSelect } from '@/components/EditableModelSelect';
import { cn } from '@/lib/cn';
import type { SettingsProfileOptions } from '@/lib/generationSettingsStore';
import { t, type Locale } from '@/lib/i18n';
import {
  endpointModelCacheKey,
  refreshEndpointModels,
} from '@/lib/modelLists';
import { openExternal } from '@/lib/tauri';
import {
  createCustomVisionProviderId,
  loadVisionModelSettings,
  saveVisionModelSettings,
  visionProviderBaseUrl,
  visionProviderModel,
  visionProviderReady,
  visionProviders,
  type CustomVisionProviderDefinition,
  type VisionModelSettings,
  type VisionProviderApiKind,
  type VisionProviderCategory,
  type VisionProviderDefinition,
  type VisionProviderId,
  type VisionProviderRegion,
} from '@/lib/visionModel';
import {
  SelectControl,
  SettingRow,
  SwitchControl,
  TextField,
} from '@/panels/settings/controls';

const CATEGORY_ORDER: VisionProviderCategory[] = ['commercial', 'free-credit'];

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

function categoryLabel(category: VisionProviderCategory, locale: Locale): string {
  return t(
    locale,
    category === 'commercial'
      ? 'settings.visionModel.commercial'
      : 'settings.visionModel.freeCredit',
  );
}

function categoryDescription(
  category: VisionProviderCategory,
  locale: Locale,
): string {
  return t(
    locale,
    category === 'commercial'
      ? 'settings.visionModel.commercialDesc'
      : 'settings.visionModel.freeCreditDesc',
  );
}

function regionLabel(region: VisionProviderRegion, locale: Locale): string {
  if (region === 'china') return t(locale, 'settings.visionModel.regionChina');
  if (region === 'local') return t(locale, 'settings.visionModel.regionLocal');
  return t(locale, 'settings.visionModel.regionGlobal');
}

function regionClass(region: VisionProviderRegion): string {
  if (region === 'china') return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
  if (region === 'local') return 'border-violet-500/30 bg-violet-500/10 text-violet-200';
  return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
}

function categoryClass(category: VisionProviderCategory): string {
  return category === 'free-credit'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
}

function statusLabel(
  provider: VisionProviderDefinition,
  settings: VisionModelSettings,
  locale: Locale,
): string {
  if (visionProviderReady(provider.id, settings)) {
    return t(locale, 'settings.visionModel.ready');
  }
  return provider.local
    ? t(locale, 'settings.visionModel.localNeedsSetup')
    : t(locale, 'settings.visionModel.needsKey');
}

function uniqueCustomId(
  name: string,
  existing: readonly CustomVisionProviderDefinition[],
): `custom:${string}` {
  const base = createCustomVisionProviderId(name);
  const ids = new Set(existing.map((provider) => provider.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export default function VisionModelSettings({
  locale,
  settingsProfile,
  remoteProfile = false,
}: {
  locale: Locale;
  settingsProfile?: SettingsProfileOptions;
  remoteProfile?: boolean;
}) {
  const [settings, setSettings] = useState<VisionModelSettings>(() =>
    loadVisionModelSettings(settingsProfile),
  );
  const [category, setCategory] =
    useState<VisionProviderCategory>('commercial');
  const [dialogOpen, setDialogOpen] = useState(false);

  const persist = (next: VisionModelSettings): boolean => {
    const ok = saveVisionModelSettings(next, settingsProfile);
    if (ok) setSettings(loadVisionModelSettings(settingsProfile));
    return ok;
  };

  const update = (patch: Partial<VisionModelSettings>) => {
    persist({ ...settings, ...patch });
  };

  const providers = visionProviders(settings).filter(
    (provider) => !remoteProfile || !provider.local,
  );
  const activeProviders = providers.filter(
    (provider) => provider.category === category,
  );
  const providerOptions = providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    hint: `${regionLabel(provider.region, locale)} · ${statusLabel(provider, settings, locale)}`,
    group: categoryLabel(provider.category, locale),
  }));

  const deleteCustomProvider = (id: VisionProviderId) => {
    const providerKeys = { ...settings.providerKeys };
    const providerBaseUrls = { ...settings.providerBaseUrls };
    const providerModels = { ...settings.providerModels };
    const providerModelLists = { ...settings.providerModelLists };
    delete providerKeys[id];
    delete providerBaseUrls[id];
    delete providerModels[id];
    delete providerModelLists[id];
    const remaining = settings.customProviders.filter(
      (provider) => provider.id !== id,
    );
    persist({
      ...settings,
      preferredProviderId:
        settings.preferredProviderId === id
          ? 'google-ai-studio'
          : settings.preferredProviderId,
      customProviders: remaining,
      providerKeys,
      providerBaseUrls,
      providerModels,
      providerModelLists,
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.visionModel.title')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.visionModel.description')}
        </p>
      </div>

      <SettingRow
        title={t(locale, 'settings.visionModel.enabled')}
        description={t(locale, 'settings.visionModel.enabledDesc')}
      >
        <SwitchControl
          checked={settings.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </SettingRow>

      <SettingRow
        title={t(locale, 'settings.visionModel.defaultProvider')}
        description={t(locale, 'settings.visionModel.defaultProviderDesc')}
      >
        <div className="w-full min-w-[14rem]">
          <SelectControl
            value={settings.preferredProviderId}
            options={providerOptions}
            onChange={(preferredProviderId) => update({ preferredProviderId })}
            icon={<Eye size={15} strokeWidth={2.1} />}
          />
        </div>
      </SettingRow>

      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex w-full min-w-0 flex-wrap items-center gap-1 border-b border-border"
      >
        {CATEGORY_ORDER.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
            onClick={() => setCategory(item)}
            className={cn(
              'px-4 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent',
              category === item
                ? '-mb-px border-b-2 border-accent text-fg'
                : 'text-fg-faint hover:text-fg',
            )}
          >
            {categoryLabel(item, locale)}
          </button>
        ))}
      </div>

      <section role="tabpanel" className="rounded-lg border border-border bg-bg-alt p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h4 className="text-sm font-semibold text-fg">
              {categoryLabel(category, locale)}
            </h4>
            <p className="text-xs leading-relaxed text-fg-faint">
              {categoryDescription(category, locale)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-panel px-2.5 py-1 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
          >
            <Plus size={13} strokeWidth={2.2} />
            {t(locale, 'settings.visionModel.add')}
          </button>
        </div>

        <div className="grid gap-2.5 xl:grid-cols-2">
          {activeProviders.map((provider) => (
            <VisionProviderRow
              key={provider.id}
              provider={provider}
              settings={settings}
              locale={locale}
              onChange={persist}
              onDelete={
                provider.custom
                  ? () => deleteCustomProvider(provider.id)
                  : undefined
              }
            />
          ))}
        </div>
      </section>

      {dialogOpen && (
        <CustomVisionProviderDialog
          locale={locale}
          category={category}
          onClose={() => setDialogOpen(false)}
          onSave={(provider, apiKey) => {
            const next: VisionModelSettings = {
              ...settings,
              preferredProviderId: provider.id,
              customProviders: [...settings.customProviders, provider],
              providerKeys: { ...settings.providerKeys },
              providerBaseUrls: {
                ...settings.providerBaseUrls,
                [provider.id]: provider.defaultBaseUrl,
              },
              providerModels: {
                ...settings.providerModels,
                [provider.id]: provider.defaultModel,
              },
              providerModelLists: {
                ...settings.providerModelLists,
                [provider.id]: provider.models,
              },
            };
            if (apiKey.trim()) next.providerKeys[provider.id] = apiKey.trim();
            if (!persist(next)) return false;
            setDialogOpen(false);
            return true;
          }}
          createId={(name) => uniqueCustomId(name, settings.customProviders)}
        />
      )}
    </div>
  );
}

function VisionProviderRow({
  provider,
  settings,
  locale,
  onChange,
  onDelete,
}: {
  provider: VisionProviderDefinition;
  settings: VisionModelSettings;
  locale: Locale;
  onChange: (settings: VisionModelSettings) => boolean;
  onDelete?: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [modelRefresh, setModelRefresh] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });
  const keyValue = settings.providerKeys[provider.id] ?? '';
  const baseUrl = settings.providerBaseUrls[provider.id] ?? '';
  const effectiveBaseUrl = visionProviderBaseUrl(provider.id, settings);
  const model = visionProviderModel(provider.id, settings);
  const ready = visionProviderReady(provider.id, settings);
  const cacheKey = endpointModelCacheKey('vision', provider.id, effectiveBaseUrl);
  const builtins = uniqueStrings([
    model,
    ...(settings.providerModelLists[provider.id] ?? []),
    ...provider.models,
  ]);

  const patch = (value: Partial<{ key: string; baseUrl: string; model: string }>) => {
    const next: VisionModelSettings = {
      ...settings,
      providerKeys: { ...settings.providerKeys },
      providerBaseUrls: { ...settings.providerBaseUrls },
      providerModels: { ...settings.providerModels },
      providerModelLists: { ...settings.providerModelLists },
    };
    if (value.key !== undefined) {
      if (value.key.trim()) next.providerKeys[provider.id] = value.key.trim();
      else delete next.providerKeys[provider.id];
    }
    if (value.baseUrl !== undefined) {
      if (value.baseUrl.trim()) {
        next.providerBaseUrls[provider.id] = value.baseUrl.trim();
      } else {
        delete next.providerBaseUrls[provider.id];
      }
    }
    if (value.model !== undefined) {
      const selected = value.model.trim();
      if (selected) next.providerModels[provider.id] = selected;
      else delete next.providerModels[provider.id];
      next.providerModelLists[provider.id] = uniqueStrings([
        selected,
        ...(next.providerModelLists[provider.id] ?? []),
      ]);
    }
    onChange(next);
  };

  const refreshModels = async () => {
    if (modelRefresh.loading || !effectiveBaseUrl || (provider.needsKey && !keyValue)) {
      return;
    }
    setModelRefresh({ loading: true, error: null });
    try {
      const result = await refreshEndpointModels({
        cacheKey,
        baseUrl: effectiveBaseUrl,
        apiKey: keyValue,
        fallback: builtins,
        transport: provider.apiKind === 'anthropic' ? 'anthropic' : 'openai',
      });
      const next: VisionModelSettings = {
        ...settings,
        providerModelLists: {
          ...settings.providerModelLists,
          [provider.id]: result.models,
        },
      };
      onChange(next);
      setModelRefresh({ loading: false, error: result.error ?? null });
    } catch (error) {
      setModelRefresh({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-alt p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg">{provider.label}</span>
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              regionClass(provider.region),
            )}>
              {regionLabel(provider.region, locale)}
            </span>
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              categoryClass(provider.category),
            )}>
              {categoryLabel(provider.category, locale)}
            </span>
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              ready
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-border bg-panel text-fg-faint',
            )}>
              {statusLabel(provider, settings, locale)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
            {provider.note}
          </p>
        </div>
        {provider.credentialUrl && (
          <button
            type="button"
            onClick={() => void openExternal(provider.credentialUrl as string)}
            className="inline-flex h-7 items-center gap-1 rounded border border-border bg-panel px-2 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
          >
            <ExternalLink size={12} strokeWidth={2.2} />
            {ready
              ? t(locale, 'settings.freeChannels.manageKey')
              : t(locale, 'settings.freeChannels.getKey')}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title={t(locale, 'settings.models.delete')}
            aria-label={t(locale, 'settings.models.delete')}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 transition-colors hover:bg-rose-500/20"
          >
            <Trash2 size={13} strokeWidth={2.2} />
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-fg-dim">
            {t(locale, 'settings.models.baseUrl')}
          </span>
          <input
            type="text"
            value={baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            placeholder={effectiveBaseUrl}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 font-mono text-sm text-fg outline-none transition-colors focus:border-accent"
          />
        </label>

        {provider.needsKey && (
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-fg-dim">
              {t(locale, 'settings.models.apiKey')}
            </span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyValue}
                onChange={(event) => patch({ key: event.target.value })}
                placeholder={provider.keyPlaceholder ?? 'API Key'}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 pr-14 font-mono text-sm text-fg outline-none transition-colors focus:border-accent"
              />
              <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  title={t(
                    locale,
                    showKey ? 'settings.models.hideKey' : 'settings.models.showKey',
                  )}
                  className="flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:text-fg"
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                {keyValue && (
                  <button
                    type="button"
                    onClick={() => patch({ key: '' })}
                    title={t(locale, 'settings.models.clear')}
                    className="flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:text-rose-300"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          </label>
        )}

        <EditableModelSelect
          cacheKey={cacheKey}
          builtins={builtins}
          value={model}
          label={t(locale, 'settings.freeChannels.modelLabel')}
          locale={locale}
          loading={modelRefresh.loading}
          error={modelRefresh.error}
          canRefresh={
            !!effectiveBaseUrl && (!provider.needsKey || !!keyValue.trim())
          }
          onChange={(next) => patch({ model: next })}
          onAddModel={(next) => patch({ model: next })}
          onRemoveModel={(_, next) => patch({ model: next })}
          onRefresh={() => void refreshModels()}
        />
      </div>
    </div>
  );
}

function CustomVisionProviderDialog({
  locale,
  category,
  onClose,
  onSave,
  createId,
}: {
  locale: Locale;
  category: VisionProviderCategory;
  onClose: () => void;
  onSave: (provider: CustomVisionProviderDefinition, apiKey: string) => boolean;
  createId: (name: string) => `custom:${string}`;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('vision-model');
  const [apiKind, setApiKind] =
    useState<VisionProviderApiKind>('openai-compatible');
  const [region, setRegion] = useState<VisionProviderRegion>('global');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const cleanName = name.trim() || 'Custom VLM';
    const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    const cleanModel = model.trim() || 'vision-model';
    if (!cleanBaseUrl) {
      setError(locale === 'zh-CN' ? '请填写 URL。' : 'Enter a URL.');
      return;
    }
    const provider: CustomVisionProviderDefinition = {
      id: createId(cleanName),
      label: cleanName,
      category,
      region,
      apiKind,
      defaultModel: cleanModel,
      models: [cleanModel],
      needsKey: region !== 'local',
      local: region === 'local',
      defaultBaseUrl: cleanBaseUrl,
      keyPlaceholder: 'API Key',
      note: locale === 'zh-CN' ? '自定义视觉模型渠道。' : 'Custom vision model route.',
    };
    if (!onSave(provider, apiKey)) {
      setError(t(locale, 'settings.visionModel.saveFailed'));
    }
  };

  return (
    <div className="fixed inset-0 z-[75] bg-black/60 sm:flex sm:items-center sm:justify-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        data-custom-vision-provider-editor="true"
        className="fixed inset-x-0 bottom-0 flex max-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-t-lg border border-border bg-panel shadow-2xl sm:relative sm:inset-auto sm:max-h-[calc(100vh-3rem)] sm:w-[min(560px,calc(100vw-2rem))] sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border-soft bg-bg-alt px-5 py-4">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-fg">
            {t(locale, 'settings.visionModel.addTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            title={t(locale, 'common.close')}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-faint transition-colors hover:border-accent hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <TextField
            label={t(locale, 'settings.visionModel.name')}
            value={name}
            onChange={setName}
            placeholder="Custom VLM"
          />
          <TextField
            label={t(locale, 'settings.models.baseUrl')}
            value={baseUrl}
            onChange={(value) => {
              setBaseUrl(value);
              setError(null);
            }}
            placeholder="https://api.example.com/v1"
            error={error ?? undefined}
            mono
          />
          <TextField
            label={t(locale, 'settings.models.apiKey')}
            value={apiKey}
            onChange={setApiKey}
            placeholder="sk-..."
            mono
          />
          <TextField
            label={t(locale, 'settings.freeChannels.modelLabel')}
            value={model}
            onChange={setModel}
            placeholder="vision-model"
            mono
          />
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-fg-dim">
              {t(locale, 'settings.visionModel.protocol')}
            </span>
            <select
              value={apiKind}
              onChange={(event) => setApiKind(event.target.value as VisionProviderApiKind)}
              className="h-9 w-full rounded border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-accent"
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-fg-dim">
              {locale === 'zh-CN' ? '地区' : 'Region'}
            </span>
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value as VisionProviderRegion)}
              className="h-9 w-full rounded border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-accent"
            >
              <option value="china">{t(locale, 'settings.visionModel.regionChina')}</option>
              <option value="global">{t(locale, 'settings.visionModel.regionGlobal')}</option>
              <option value="local">{t(locale, 'settings.visionModel.regionLocal')}</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-soft bg-bg-alt px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
          >
            {t(locale, 'common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!baseUrl.trim()}
            className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-border disabled:bg-panel disabled:text-fg-faint"
          >
            {t(locale, 'settings.models.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
