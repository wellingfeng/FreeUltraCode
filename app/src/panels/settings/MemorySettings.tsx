import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';

import {
  applyMemoryOp,
  getMemoryLimits,
  loadMemory,
  type MemoryTarget,
} from '@/lib/memoryStore';
import {
  DEFAULT_MEMORY_CONFIG,
  loadMemoryConfig,
  saveMemoryConfig,
  type MemoryConfig,
} from '@/lib/memoryConfig';
import { SettingRow, StepperControl, SwitchControl } from '@/panels/settings/controls';
import { t, type Locale, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';

interface MemorySettingsProps {
  locale: Locale;
  /** Active workspace id; scopes the `memory` (assistant notes) store. */
  workspaceId: string | null;
}

interface StoreView {
  entries: string[];
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

export default function MemorySettings({ locale, workspaceId }: MemorySettingsProps) {
  const wsId = workspaceId ?? undefined;
  const [user, setUser] = useState<StoreView>(EMPTY_VIEW);
  const [memory, setMemory] = useState<StoreView>(EMPTY_VIEW);
  const [error, setError] = useState<string>('');
  const [config, setConfig] = useState<MemoryConfig>(() => {
    try {
      return loadMemoryConfig();
    } catch {
      return { ...DEFAULT_MEMORY_CONFIG };
    }
  });

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
    const [u, m] = await Promise.all([loadMemory('user'), loadMemory('memory', wsId)]);
    setUser({ entries: u, used: u.join('\n').length, limit: limits.user });
    setMemory({ entries: m, used: m.join('\n').length, limit: limits.memory });
  }, [wsId]);

  useEffect(() => {
    void refresh();
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

      <MemoryStoreSection
        locale={locale}
        title={t(locale, 'settings.memory.userTitle')}
        hint={t(locale, 'settings.memory.userHint')}
        view={user}
        onAdd={(content) => runOp('user', { action: 'add', content })}
        onReplace={(oldText, content) => runOp('user', { action: 'replace', oldText, content })}
        onRemove={(oldText) => runOp('user', { action: 'remove', oldText })}
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
        onAdd={(content) => runOp('memory', { action: 'add', content })}
        onReplace={(oldText, content) => runOp('memory', { action: 'replace', oldText, content })}
        onRemove={(oldText) => runOp('memory', { action: 'remove', oldText })}
        usageLabel={fmt(locale, 'settings.memory.usage', { used: memory.used, limit: memory.limit })}
      />

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
  onAdd: (content: string) => Promise<boolean>;
  onReplace: (oldText: string, content: string) => Promise<boolean>;
  onRemove: (oldText: string) => Promise<boolean>;
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
}: SectionProps) {
  const [adding, setAdding] = useState('');
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
              key={`${index}-${entry.slice(0, 16)}`}
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
                      if (next && next !== entry) {
                        const ok = await onReplace(entry, next);
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
                  <span className="flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-dim">
                    {entry}
                  </span>
                  <button
                    type="button"
                    title={t(locale, 'settings.memory.edit')}
                    className="rounded p-1 text-fg-faint opacity-0 transition-opacity hover:bg-bg-soft group-hover:opacity-100"
                    onClick={() => {
                      setEditIndex(index);
                      setEditText(entry);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    title={t(locale, 'settings.memory.delete')}
                    className="rounded p-1 text-fg-faint opacity-0 transition-opacity hover:bg-bg-soft hover:text-rose-400 group-hover:opacity-100"
                    onClick={() => void onRemove(entry)}
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
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder={t(locale, 'settings.memory.addPlaceholder')}
          className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && adding.trim()) {
              const ok = await onAdd(adding.trim());
              if (ok) setAdding('');
            }
          }}
        />
        <button
          type="button"
          disabled={!adding.trim()}
          className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          onClick={async () => {
            const ok = await onAdd(adding.trim());
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
