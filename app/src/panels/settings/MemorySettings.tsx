import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';

import {
  applyMemoryOp,
  backfillMemoryTimestamps,
  getMemoryLimits,
  normalizeImportance,
  setMemoryImportance,
  type MemoryEntry,
  type MemoryImportance,
  type MemoryTarget,
} from '@/lib/memoryStore';
import { refreshMemoryFromHistory, type RefreshScope } from '@/lib/memoryRefresh';
import {
  listPendingMemoryWrites,
  resolvePendingMemoryWrites,
  type PendingMemoryWrite,
} from '@/lib/memoryPending';
import {
  DEFAULT_MEMORY_CONFIG,
  loadMemoryConfig,
  saveMemoryConfig,
  type MemoryConfig,
} from '@/lib/memoryConfig';
import { SettingRow, StepperControl, SwitchControl } from '@/panels/settings/controls';
import { t, type Locale, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { listGatewayRunOptions, selectionFromKey, selectionKey } from '@/lib/modelGateway/resolver';

interface MemorySettingsProps {
  locale: Locale;
  /** Active workspace id; scopes the `memory` (assistant notes) store. */
  workspaceId: string | null;
}

interface StoreView {
  entries: MemoryEntry[];
  used: number;
  limit: number;
}

const EMPTY_VIEW: StoreView = { entries: [], used: 0, limit: 0 };

function fmt(locale: Locale, key: TranslationKey, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
    t(locale, key),
  );
}

function formatUpdatedAt(locale: Locale, ts: number | undefined): string {
  if (!ts) return t(locale, 'settings.memory.updatedUnknown');
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return t(locale, 'settings.memory.updatedUnknown');
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return fmt(locale, 'settings.memory.updatedAt', { at: `${date} ${time}` });
}

const IMPORTANCE_ORDER: MemoryImportance[] = ['minor', 'important', 'must'];

/**
 * Colored importance badge: 必须 = red, 重要 = amber, 不重要 = gray.
 * Untagged entries render as a hollow "untagged" badge. Clicking cycles the
 * tier (must → important → minor → …) and persists via setMemoryImportance.
 */
function ImportanceBadge({
  locale,
  importance,
  onCycle,
}: {
  locale: Locale;
  importance: MemoryImportance | undefined;
  onCycle?: (next: MemoryImportance) => void;
}) {
  const style =
    importance === 'must'
      ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
      : importance === 'important'
        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
        : importance === 'minor'
          ? 'border-border bg-bg-soft text-fg-faint'
          : 'border-dashed border-border bg-transparent text-fg-faint/70';
  const dot =
    importance === 'must'
      ? 'bg-rose-400'
      : importance === 'important'
        ? 'bg-amber-400'
        : importance === 'minor'
          ? 'bg-fg-faint/60'
          : 'bg-transparent border border-dashed border-fg-faint/60';
  const label = importance
    ? t(locale, `settings.memory.importance.${importance}` as TranslationKey)
    : t(locale, 'settings.memory.importanceUntagged');
  return (
    <button
      type="button"
      title={t(locale, 'settings.memory.importanceHint')}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none transition-colors',
        onCycle && 'hover:border-accent',
        style,
      )}
      onClick={
        onCycle
          ? () => {
              const idx = importance ? IMPORTANCE_ORDER.indexOf(importance) : 1;
              const next = IMPORTANCE_ORDER[(idx + 1) % IMPORTANCE_ORDER.length];
              if (next !== importance) onCycle(next);
            }
          : undefined
      }
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </button>
  );
}

export default function MemorySettings({ locale, workspaceId }: MemorySettingsProps) {
  const wsId = workspaceId ?? undefined;
  const [user, setUser] = useState<StoreView>(EMPTY_VIEW);
  const [memory, setMemory] = useState<StoreView>(EMPTY_VIEW);
  const [error, setError] = useState<string>('');
  const [pending, setPending] = useState<PendingMemoryWrite[]>([]);
  const [pendingDone, setPendingDone] = useState('');
  const [refreshDays, setRefreshDays] = useState(10);
  const [refreshing, setRefreshing] = useState<RefreshScope | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string>('');
  const [config, setConfig] = useState<MemoryConfig>(() => {
    try {
      return loadMemoryConfig();
    } catch {
      return { ...DEFAULT_MEMORY_CONFIG };
    }
  });
  const [reviewOptions, setReviewOptions] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    try {
      setReviewOptions(
        listGatewayRunOptions()
          // claude-code channels surface one entry per tier; keep every option
          // so the review pin can point at any channel or tier.
          .map((o) => ({ id: o.id, label: o.label })),
      );
    } catch {
      setReviewOptions([]);
    }
  }, []);

  const patchConfig = useCallback(
    (patch: Partial<MemoryConfig>) => {
      setConfig((prev) => {
        const next = saveMemoryConfig({ ...prev, ...patch });
        return next;
      });
    },
    [],
  );

  const refresh = useCallback(async () => {
    const limits = getMemoryLimits();
    const [u, m] = await Promise.all([
      backfillMemoryTimestamps('user'),
      backfillMemoryTimestamps('memory', wsId),
    ]);
    setUser({
      entries: u,
      used: u.map((e) => e.text).join('\n').length,
      limit: limits.user,
    });
    setMemory({
      entries: m,
      used: m.map((e) => e.text).join('\n').length,
      limit: limits.memory,
    });
  }, [wsId]);

  useEffect(() => {
    void refresh();
    void listPendingMemoryWrites().then(setPending).catch(() => setPending([]));
  }, [refresh]);

  const runOp = useCallback(
    async (
      target: MemoryTarget,
      op: Parameters<typeof applyMemoryOp>[1],
    ): Promise<boolean> => {
      setError('');
      const res = await applyMemoryOp(target, op, target === 'memory' ? wsId : undefined);
      if (!res.success) {
        setError(res.error || t(locale, 'settings.memory.overLimit'));
        return false;
      }
      await refresh();
      return true;
    },
    [locale, refresh, wsId],
  );

  /** Cycle one entry's importance tier straight to disk (text/time untouched). */
  const cycleImportance = useCallback(
    async (target: MemoryTarget, entry: MemoryEntry, next: MemoryImportance) => {
      setError('');
      const ok = await setMemoryImportance(target, entry.text, next, target === 'memory' ? wsId : undefined);
      if (!ok) setError(t(locale, 'settings.memory.importanceFail'));
      await refresh();
    },
    [locale, refresh, wsId],
  );

  const resolvePending = useCallback(
    async (ids: string[], action: 'approve' | 'reject') => {
      setError('');
      setPendingDone('');
      try {
        const res = await resolvePendingMemoryWrites(ids, action, wsId, {
          evictOnOverflow: config.evictOnOverflow,
        });
        setPendingDone(fmt(locale, 'settings.memory.pendingDone', { count: res.resolvedIds.length }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      await refresh();
      void listPendingMemoryWrites().then(setPending).catch(() => setPending([]));
    },
    [wsId, config.evictOnOverflow, locale, refresh],
  );

  const runRefresh = useCallback(
    async (scope: RefreshScope) => {
      if (refreshing) return;
      setRefreshing(scope);
      setRefreshMessage('');
      setError('');
      const res = await refreshMemoryFromHistory({
        scope,
        days: refreshDays,
        workspaceId: scope === 'project' ? wsId : undefined,
        evictOnOverflow: config.evictOnOverflow,
        approvalRequired: config.approvalRequired,
      });
      setRefreshing(null);
      if (!res.ok) {
        setRefreshMessage(
          fmt(locale, 'settings.memory.refreshError', { msg: res.error ?? '' }),
        );
        return;
      }
      if (res.messagesScanned === 0) {
        setRefreshMessage(
          res.taggedEntries > 0
            ? fmt(locale, 'settings.memory.refreshTaggedOnly', { tagged: res.taggedEntries })
            : t(locale, 'settings.memory.refreshEmpty'),
        );
      } else if (res.queuedOps > 0) {
        // Approval mode: writes staged, not applied — report them as queued.
        setRefreshMessage(
          fmt(locale, 'settings.memory.queuedNote', { queued: res.queuedOps }),
        );
      } else if (res.appliedOps > 0 || res.taggedEntries > 0) {
        setRefreshMessage(
          fmt(locale, 'settings.memory.refreshSuccess', {
            sessions: res.sessionsScanned,
            messages: res.messagesScanned,
            applied: res.appliedOps,
            tagged: res.taggedEntries,
          }),
        );
      } else {
        setRefreshMessage(
          fmt(locale, 'settings.memory.refreshNoChange', {
            sessions: res.sessionsScanned,
            messages: res.messagesScanned,
          }),
        );
      }
      await refresh();
    },
    [refreshing, refreshDays, wsId, config.evictOnOverflow, config.approvalRequired, locale, refresh],
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-fg">{t(locale, 'settings.memory.title')}</h3>
        <p className="text-[11px] leading-relaxed text-fg-faint">
          {t(locale, 'settings.memory.desc')}
        </p>
      </div>

      {error && (
        <p className="rounded border border-rose-500/60 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
          {error}
        </p>
      )}

      {pending.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-fg">
              {t(locale, 'settings.memory.pendingTitle')}
              <span className="ml-1.5 rounded-full bg-amber-500/30 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-200">
                {pending.length}
              </span>
            </h4>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
                onClick={() =>
                  void resolvePending(
                    pending.map((p) => p.id),
                    'approve',
                  )
                }
              >
                <Check size={12} className="mr-1 inline" />
                {t(locale, 'settings.memory.pendingApproveAll')}
              </button>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-40"
                onClick={() =>
                  void resolvePending(
                    pending.map((p) => p.id),
                    'reject',
                  )
                }
              >
                <X size={12} className="mr-1 inline" />
                {t(locale, 'settings.memory.pendingRejectAll')}
              </button>
            </div>
          </div>
          {pendingDone && <p className="text-[11px] text-fg-dim">{pendingDone}</p>}
          <ul className="space-y-1">
            {pending.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2 rounded border border-border/60 bg-bg px-2 py-1.5"
              >
                <div className="flex-1 space-y-0.5">
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-dim">
                    {p.op.action === 'remove'
                      ? `− ${p.op.oldText ?? ''}`
                      : `${p.op.action === 'replace' ? '~' : '+'} ${
                          p.op.content ?? p.op.oldText ?? ''
                        }`}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-faint">
                    <ImportanceBadge
                      locale={locale}
                      importance={normalizeImportance(p.op.importance)}
                    />
                    <span>
                      {fmt(locale, 'settings.memory.pendingSource', {
                        source: t(
                          locale,
                          p.source === 'refresh'
                            ? 'settings.memory.sourceRefresh'
                            : 'settings.memory.sourceReview',
                        ),
                        target: t(
                          locale,
                          p.target === 'user'
                            ? 'settings.memory.targetUser'
                            : 'settings.memory.targetMemory',
                        ),
                      })}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  title={t(locale, 'settings.memory.pendingApprove')}
                  className="rounded p-1 text-emerald-400 hover:bg-bg-soft"
                  onClick={() => void resolvePending([p.id], 'approve')}
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  title={t(locale, 'settings.memory.pendingReject')}
                  className="rounded p-1 text-fg-faint hover:bg-bg-soft hover:text-rose-400"
                  onClick={() => void resolvePending([p.id], 'reject')}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MemoryStoreSection
        locale={locale}
        title={t(locale, 'settings.memory.userTitle')}
        hint={t(locale, 'settings.memory.userHint')}
        view={user}
        onAdd={(content, importance) => runOp('user', { action: 'add', content, importance })}
        onReplace={(oldText, content) => runOp('user', { action: 'replace', oldText, content })}
        onRemove={(oldText) => runOp('user', { action: 'remove', oldText })}
        onCycleImportance={(entry, next) => void cycleImportance('user', entry, next)}
        usageLabel={fmt(locale, 'settings.memory.usage', { used: user.used, limit: user.limit })}
      />

      <MemoryStoreSection
        locale={locale}
        title={t(locale, 'settings.memory.memoryTitle')}
        hint={
          workspaceId
            ? t(locale, 'settings.memory.memoryHint')
            : t(locale, 'settings.memory.memoryGlobalHint')
        }
        view={memory}
        onAdd={(content, importance) => runOp('memory', { action: 'add', content, importance })}
        onReplace={(oldText, content) => runOp('memory', { action: 'replace', oldText, content })}
        onRemove={(oldText) => runOp('memory', { action: 'remove', oldText })}
        onCycleImportance={(entry, next) => void cycleImportance('memory', entry, next)}
        usageLabel={fmt(locale, 'settings.memory.usage', { used: memory.used, limit: memory.limit })}
      />

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">{t(locale, 'settings.memory.refreshTitle')}</h4>
        <p className="text-[11px] leading-relaxed text-fg-faint">
          {t(locale, 'settings.memory.refreshHint')}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-dim">{t(locale, 'settings.memory.refreshDays')}</span>
          <StepperControl value={refreshDays} min={1} max={90} onChange={setRefreshDays} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={refreshing !== null}
            className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
            onClick={() => void runRefresh('global')}
          >
            <RefreshCw size={13} className={refreshing === 'global' ? 'animate-spin' : ''} />
            {t(locale, 'settings.memory.refreshGlobal')}
          </button>
          <button
            type="button"
            disabled={refreshing !== null || !workspaceId}
            className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
            onClick={() => void runRefresh('project')}
          >
            <RefreshCw size={13} className={refreshing === 'project' ? 'animate-spin' : ''} />
            {t(locale, 'settings.memory.refreshProject')}
          </button>
        </div>
        {refreshMessage && (
          <p className="text-[11px] leading-relaxed text-fg-dim">{refreshMessage}</p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">{t(locale, 'settings.memory.optionsTitle')}</h4>
        <SettingRow
          title={t(locale, 'settings.memory.snapshotEnabled')}
          description={t(locale, 'settings.memory.snapshotHint')}
        >
          <SwitchControl
            checked={config.snapshotEnabled}
            onChange={(v) => patchConfig({ snapshotEnabled: v })}
          />
        </SettingRow>
        <SettingRow
          title={t(locale, 'settings.memory.writeEnabled')}
          description={t(locale, 'settings.memory.writeHint')}
        >
          <SwitchControl
            checked={config.writeEnabled}
            onChange={(v) => patchConfig({ writeEnabled: v })}
          />
        </SettingRow>
        <SettingRow
          title={t(locale, 'settings.memory.recallEnabled')}
          description={t(locale, 'settings.memory.recallHint')}
        >
          <SwitchControl
            checked={config.recallEnabled}
            onChange={(v) => patchConfig({ recallEnabled: v })}
          />
        </SettingRow>
        <SettingRow
          title={t(locale, 'settings.memory.evictOnOverflow')}
          description={t(locale, 'settings.memory.evictHint')}
        >
          <SwitchControl
            checked={config.evictOnOverflow}
            onChange={(v) => patchConfig({ evictOnOverflow: v })}
          />
        </SettingRow>
        <SettingRow
          title={t(locale, 'settings.memory.safetyScan')}
          description={t(locale, 'settings.memory.safetyHint')}
        >
          <SwitchControl
            checked={config.safetyScanEnabled}
            onChange={(v) => patchConfig({ safetyScanEnabled: v })}
          />
        </SettingRow>
        <SettingRow
          title={t(locale, 'settings.memory.approvalRequired')}
          description={t(locale, 'settings.memory.approvalHint')}
        >
          <SwitchControl
            checked={config.approvalRequired}
            onChange={(v) => patchConfig({ approvalRequired: v })}
          />
        </SettingRow>
        {config.approvalRequired && (
          <SettingRow
            title={t(locale, 'settings.memory.triageAutoRun')}
            description={t(locale, 'settings.memory.triageAutoRunHint')}
          >
            <SwitchControl
              checked={config.triageAutoRun}
              onChange={(v) => patchConfig({ triageAutoRun: v })}
            />
          </SettingRow>
        )}
        <SettingRow title={t(locale, 'settings.memory.userLimit')}>
          <StepperControl
            value={config.userCharLimit}
            min={200}
            max={20000}
            onChange={(v) => {
              patchConfig({ userCharLimit: v });
              void refresh();
            }}
          />
        </SettingRow>
        <SettingRow title={t(locale, 'settings.memory.memoryLimit')}>
          <StepperControl
            value={config.memoryCharLimit}
            min={200}
            max={20000}
            onChange={(v) => {
              patchConfig({ memoryCharLimit: v });
              void refresh();
            }}
          />
        </SettingRow>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">{t(locale, 'settings.memory.reviewTitle')}</h4>
        <SettingRow
          title={t(locale, 'settings.memory.reviewEnabled')}
          description={t(locale, 'settings.memory.reviewHint')}
        >
          <SwitchControl
            checked={config.reviewEnabled}
            onChange={(v) => patchConfig({ reviewEnabled: v })}
          />
        </SettingRow>
        {config.reviewEnabled && (
          <>
            <SettingRow title={t(locale, 'settings.memory.reviewMinMessages')}>
              <StepperControl
                value={config.reviewMinMessages}
                min={2}
                max={100}
                onChange={(v) => patchConfig({ reviewMinMessages: v })}
              />
            </SettingRow>
            <SettingRow title={t(locale, 'settings.memory.reviewInterval')}>
              <StepperControl
                value={config.reviewMinIntervalMinutes}
                min={0}
                max={1440}
                onChange={(v) => patchConfig({ reviewMinIntervalMinutes: v })}
              />
            </SettingRow>
            <SettingRow title={t(locale, 'settings.memory.reviewCheap')}>
              <SwitchControl
                checked={config.reviewPreferCheapModel}
                onChange={(v) => patchConfig({ reviewPreferCheapModel: v })}
              />
            </SettingRow>
            {config.reviewPreferCheapModel && (
              <SettingRow title={t(locale, 'settings.memory.reviewModel')}>
                <select
                  className="max-w-[240px] rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
                  value={
                    config.reviewModelSelection
                      ? selectionKey({
                          adapter: config.reviewModelSelection.adapter,
                          modelClass: config.reviewModelSelection.modelClass,
                          providerId: config.reviewModelSelection.providerId,
                          channelId: config.reviewModelSelection.channelId,
                          systemDefault: config.reviewModelSelection.systemDefault,
                        })
                      : ''
                  }
                  onChange={(e) => {
                    const picked = selectionFromKey(e.target.value);
                    patchConfig({ reviewModelSelection: picked });
                  }}
                >
                  <option value="">{t(locale, 'settings.memory.reviewModelInherit')}</option>
                  {reviewOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </SettingRow>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  locale: Locale;
  title: string;
  hint: string;
  view: StoreView;
  usageLabel: string;
  onAdd: (content: string, importance: MemoryImportance) => Promise<boolean>;
  onReplace: (oldText: string, content: string) => Promise<boolean>;
  onRemove: (oldText: string) => Promise<boolean>;
  onCycleImportance: (entry: MemoryEntry, next: MemoryImportance) => void;
}

function MemoryStoreSection({
  locale,
  title,
  hint,
  view,
  usageLabel,
  onAdd,
  onReplace,
  onRemove,
  onCycleImportance,
}: SectionProps) {
  const [adding, setAdding] = useState('');
  const [addImportance, setAddImportance] = useState<MemoryImportance>('important');
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const pct = view.limit > 0 ? Math.min(100, Math.round((view.used / view.limit) * 100)) : 0;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-bg-soft/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h4 className="text-xs font-semibold text-fg">{title}</h4>
          <p className="text-[11px] leading-relaxed text-fg-faint">{hint}</p>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">{usageLabel}</span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-border">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-rose-400' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {view.entries.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-fg-faint">
          {t(locale, 'settings.memory.empty')}
        </p>
      ) : (
        <ul className="space-y-1">
          {view.entries.map((entry, index) => (
            <li
              key={`${index}-${entry.text.slice(0, 16)}`}
              className="group flex items-start gap-2 rounded border border-border/60 bg-bg px-2 py-1.5"
            >
              {editIndex === index ? (
                <>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    className="flex-1 resize-y rounded border border-border bg-bg px-1.5 py-1 text-xs text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    title={t(locale, 'settings.memory.save')}
                    className="rounded p-1 text-emerald-400 hover:bg-bg-soft"
                    onClick={async () => {
                      const next = editText.trim();
                      if (next && next !== entry.text) {
                        const ok = await onReplace(entry.text, next);
                        if (!ok) return;
                      }
                      setEditIndex(null);
                    }}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    type="button"
                    title={t(locale, 'settings.memory.cancel')}
                    className="rounded p-1 text-fg-faint hover:bg-bg-soft"
                    onClick={() => setEditIndex(null)}
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1 space-y-0.5">
                    <span className="block whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-dim">
                      {entry.text}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ImportanceBadge
                        locale={locale}
                        importance={entry.importance}
                        onCycle={(next) => onCycleImportance(entry, next)}
                      />
                      <span className="text-[10px] tabular-nums text-fg-faint">
                        {formatUpdatedAt(locale, entry.updatedAt)}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    title={t(locale, 'settings.memory.edit')}
                    className="rounded p-1 text-fg-faint opacity-0 transition-opacity hover:bg-bg-soft group-hover:opacity-100"
                    onClick={() => {
                      setEditIndex(index);
                      setEditText(entry.text);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    title={t(locale, 'settings.memory.delete')}
                    className="rounded p-1 text-fg-faint opacity-0 transition-opacity hover:bg-bg-soft hover:text-rose-400 group-hover:opacity-100"
                    onClick={() => void onRemove(entry.text)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <select
          value={addImportance}
          onChange={(e) => setAddImportance(e.target.value as MemoryImportance)}
          title={t(locale, 'settings.memory.importanceLabel')}
          className="shrink-0 rounded border border-border bg-bg px-1.5 py-1.5 text-xs text-fg-dim outline-none focus:border-accent"
        >
          {IMPORTANCE_ORDER.slice()
            .reverse()
            .map((level) => (
              <option key={level} value={level}>
                {t(locale, `settings.memory.importance.${level}` as TranslationKey)}
              </option>
            ))}
        </select>
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder={t(locale, 'settings.memory.addPlaceholder')}
          className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && adding.trim()) {
              const ok = await onAdd(adding.trim(), addImportance);
              if (ok) setAdding('');
            }
          }}
        />
        <button
          type="button"
          disabled={!adding.trim()}
          className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          onClick={async () => {
            const ok = await onAdd(adding.trim(), addImportance);
            if (ok) setAdding('');
          }}
        >
          <Plus size={13} />
          {t(locale, 'settings.memory.add')}
        </button>
      </div>
    </section>
  );
}
