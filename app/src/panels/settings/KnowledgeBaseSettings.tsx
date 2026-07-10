import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FilePlus2,
  FolderPlus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { pickFile, pickFolder } from '@/lib/folderPicker';
import {
  createKnowledgeBaseSourceId,
  knowledgeBaseSourceSignature,
  knowledgeBaseWorkspaceKey,
  loadKnowledgeBaseConfig,
  readKnowledgeBaseIndex,
  rebuildKnowledgeBaseIndex,
  saveKnowledgeBaseConfig,
  type KnowledgeBaseSource,
  type KnowledgeBaseSourceKind,
  type KnowledgeBaseWorkspaceConfig,
  type KnowledgeBaseWorkspaceIndex,
} from '@/lib/knowledgeBase';
import { isTauri } from '@/lib/tauri';
import { t, type Locale } from '@/lib/i18n';
import type { WorkspaceSummary } from '@/store/history/types';
import { SettingRow, StepperControl, SwitchControl } from '@/panels/settings/controls';

interface KnowledgeBaseSettingsProps {
  locale: Locale;
  workspace: WorkspaceSummary | null;
}

function formatTime(value: number | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join('/')}`;
}

function sourceLabel(kind: KnowledgeBaseSourceKind, locale: Locale): string {
  if (kind === 'file') return t(locale, 'settings.knowledgeBase.sourceFile');
  return t(locale, 'settings.knowledgeBase.sourceFolder');
}

export default function KnowledgeBaseSettings({
  locale,
  workspace,
}: KnowledgeBaseSettingsProps) {
  const workspaceKey = useMemo(
    () =>
      knowledgeBaseWorkspaceKey({
        workspaceId: workspace?.id ?? null,
        workspacePath: workspace?.path ?? null,
      }),
    [workspace?.id, workspace?.path],
  );
  const remoteWorkspace = workspace?.path?.trim().startsWith('remote://') ?? false;
  const desktop = isTauri();
  const canScan = !!workspace && desktop && !remoteWorkspace;
  const [config, setConfig] = useState<KnowledgeBaseWorkspaceConfig>(() =>
    loadKnowledgeBaseConfig(workspaceKey),
  );
  const [index, setIndex] = useState<KnowledgeBaseWorkspaceIndex | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshIndex = useCallback(async () => {
    setIndex(await readKnowledgeBaseIndex(workspaceKey));
  }, [workspaceKey]);

  useEffect(() => {
    setConfig(loadKnowledgeBaseConfig(workspaceKey));
    setStatus('');
    void refreshIndex();
  }, [refreshIndex, workspaceKey]);

  const patchConfig = useCallback(
    (patch: Partial<KnowledgeBaseWorkspaceConfig>) => {
      setConfig((prev) => saveKnowledgeBaseConfig(workspaceKey, { ...prev, ...patch }));
    },
    [workspaceKey],
  );

  const replaceSources = useCallback(
    (sources: KnowledgeBaseSource[]) => {
      patchConfig({
        sources,
        lastIndexedAtMs: null,
        lastIndexStats: null,
        lastIndexError: null,
      });
    },
    [patchConfig],
  );

  const addSource = useCallback(
    (path: string | null, kind: KnowledgeBaseSourceKind) => {
      const trimmed = path?.trim();
      if (!trimmed) return;
      const exists = config.sources.some(
        (source) => source.path.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (exists) {
        setStatus(t(locale, 'settings.knowledgeBase.duplicatePath'));
        return;
      }
      replaceSources([
        ...config.sources,
        {
          id: createKnowledgeBaseSourceId(),
          path: trimmed,
          kind,
          enabled: true,
        },
      ]);
      setStatus(t(locale, 'settings.knowledgeBase.sourceAdded'));
    },
    [config.sources, locale, replaceSources],
  );

  const pickSource = useCallback(
    async (kind: KnowledgeBaseSourceKind) => {
      if (!canScan) {
        setStatus(t(locale, 'settings.knowledgeBase.desktopOnly'));
        return;
      }
      const path =
        kind === 'file'
          ? await pickFile(t(locale, 'settings.knowledgeBase.pickFile'))
          : await pickFolder(t(locale, 'settings.knowledgeBase.pickFolder'));
      addSource(path, kind);
    },
    [addSource, canScan, locale],
  );

  const updateSource = useCallback(
    (id: string, patch: Partial<KnowledgeBaseSource>) => {
      replaceSources(
        config.sources.map((source) =>
          source.id === id ? { ...source, ...patch } : source,
        ),
      );
    },
    [config.sources, replaceSources],
  );

  const removeSource = useCallback(
    (id: string) => {
      replaceSources(config.sources.filter((source) => source.id !== id));
    },
    [config.sources, replaceSources],
  );

  const rebuild = useCallback(async () => {
    if (!canScan) {
      setStatus(t(locale, 'settings.knowledgeBase.desktopOnly'));
      return;
    }
    if (!config.sources.some((source) => source.enabled && source.path.trim())) {
      setStatus(t(locale, 'settings.knowledgeBase.noSources'));
      return;
    }
    setBusy(true);
    setStatus(t(locale, 'settings.knowledgeBase.indexing'));
    try {
      const result = await rebuildKnowledgeBaseIndex(workspaceKey, config);
      setConfig(result.config);
      setIndex(result.index);
      setStatus(t(locale, 'settings.knowledgeBase.indexDone'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const next = saveKnowledgeBaseConfig(workspaceKey, {
        ...config,
        lastIndexError: message,
      });
      setConfig(next);
      setStatus(`${t(locale, 'settings.knowledgeBase.indexFailed')}: ${message}`);
    } finally {
      setBusy(false);
    }
  }, [canScan, config, locale, workspaceKey]);

  const activeSources = config.sources.filter((source) => source.enabled);
  const stale =
    !!index &&
    index.sourceSignature !== knowledgeBaseSourceSignature(config) &&
    activeSources.length > 0;
  const stats = index?.stats ?? config.lastIndexStats ?? null;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-fg">
          {t(locale, 'settings.knowledgeBase.title')}
        </h3>
        <p className="text-[11px] leading-relaxed text-fg-faint">
          {t(locale, 'settings.knowledgeBase.desc')}
        </p>
      </div>

      {!workspace && (
        <p className="rounded-md border border-border bg-bg-alt px-3 py-2 text-xs text-fg-faint">
          {t(locale, 'settings.knowledgeBase.noWorkspace')}
        </p>
      )}
      {remoteWorkspace && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {t(locale, 'settings.knowledgeBase.remoteUnsupported')}
        </p>
      )}
      {!desktop && (
        <p className="rounded-md border border-border bg-bg-alt px-3 py-2 text-xs text-fg-faint">
          {t(locale, 'settings.knowledgeBase.desktopOnly')}
        </p>
      )}

      <SettingRow
        title={t(locale, 'settings.knowledgeBase.enabled')}
        description={t(locale, 'settings.knowledgeBase.enabledHint')}
      >
        <SwitchControl
          checked={config.enabled}
          onChange={(enabled) => patchConfig({ enabled })}
        />
      </SettingRow>

      <SettingRow
        title={t(locale, 'settings.knowledgeBase.topK')}
        description={t(locale, 'settings.knowledgeBase.topKHint')}
      >
        <StepperControl
          value={config.topK}
          min={1}
          max={12}
          onChange={(topK) => patchConfig({ topK })}
        />
      </SettingRow>

      <section className="space-y-3 rounded-lg border border-border bg-bg-alt p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-fg">
              {t(locale, 'settings.knowledgeBase.sourcesTitle')}
            </h4>
            <p className="text-[11px] leading-relaxed text-fg-faint">
              {t(locale, 'settings.knowledgeBase.sourcesHint')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!canScan}
              onClick={() => void pickSource('file')}
              className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FilePlus2 size={14} />
              {t(locale, 'settings.knowledgeBase.addFile')}
            </button>
            <button
              type="button"
              disabled={!canScan}
              onClick={() => void pickSource('folder')}
              className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FolderPlus size={14} />
              {t(locale, 'settings.knowledgeBase.addFolder')}
            </button>
          </div>
        </div>

        {config.sources.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-fg-faint">
            {t(locale, 'settings.knowledgeBase.emptySources')}
          </div>
        ) : (
          <ul className="space-y-2">
            {config.sources.map((source) => (
              <li
                key={source.id}
                className={cn(
                  'flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2',
                  !source.enabled && 'opacity-60',
                )}
              >
                <SwitchControl
                  checked={source.enabled}
                  onChange={(enabled) => updateSource(source.id, { enabled })}
                />
                <BookOpen size={15} className="shrink-0 text-fg-faint" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-fg" title={source.path}>
                    {shortPath(source.path)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-fg-faint">
                    {sourceLabel(source.kind, locale)}
                  </div>
                </div>
                <button
                  type="button"
                  title={t(locale, 'settings.knowledgeBase.removeSource')}
                  onClick={() => removeSource(source.id)}
                  className="rounded p-1 text-fg-faint transition-colors hover:bg-bg-soft hover:text-rose-400"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-bg-alt p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-fg">
              {t(locale, 'settings.knowledgeBase.indexTitle')}
            </h4>
            <p className="text-[11px] leading-relaxed text-fg-faint">
              {t(locale, 'settings.knowledgeBase.indexHint')}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || !canScan}
            onClick={() => void rebuild()}
            className="flex items-center gap-1.5 rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs text-fg transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            {t(locale, 'settings.knowledgeBase.rebuild')}
          </button>
        </div>

        <div className="grid gap-2 text-[11px] text-fg-faint sm:grid-cols-4">
          <div className="rounded-md border border-border bg-bg px-2 py-1.5">
            {t(locale, 'settings.knowledgeBase.files')}: {stats?.fileCount ?? 0}
          </div>
          <div className="rounded-md border border-border bg-bg px-2 py-1.5">
            {t(locale, 'settings.knowledgeBase.chunks')}: {stats?.chunkCount ?? 0}
          </div>
          <div className="rounded-md border border-border bg-bg px-2 py-1.5">
            {t(locale, 'settings.knowledgeBase.skipped')}: {stats?.skippedFiles ?? 0}
          </div>
          <div className="rounded-md border border-border bg-bg px-2 py-1.5">
            {t(locale, 'settings.knowledgeBase.updatedAt')}: {formatTime(index?.builtAtMs ?? config.lastIndexedAtMs)}
          </div>
        </div>

        {stale && (
          <p className="text-[11px] text-amber-200">
            {t(locale, 'settings.knowledgeBase.stale')}
          </p>
        )}
        {(status || config.lastIndexError) && (
          <p className="whitespace-pre-wrap rounded-md border border-border bg-bg px-3 py-2 text-[11px] leading-relaxed text-fg-faint">
            {status || config.lastIndexError}
          </p>
        )}
      </section>
    </div>
  );
}
