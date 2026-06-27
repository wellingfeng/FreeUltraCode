import { useEffect, useMemo, useState } from 'react';
import { Database, Gauge, Hash, Zap } from 'lucide-react';
import { workflowDefaultGatewaySelection } from '@/lib/modelGateway/resolver';
import { resolveGatewayRoute } from '@/lib/modelGateway/resolver';
import {
  SIMPLE_CHAT_CONTEXT_INITIAL_MESSAGE_LIMIT,
  SIMPLE_CHAT_CONTEXT_MESSAGE_LIMIT,
  estimateContextUsage,
  formatCompactTokenCount,
  type ContextUsageTone,
} from '@/lib/contextUsage';
import { RUNTIME_ADAPTERS, type RuntimeAdapterId } from '@/lib/adapters';
import {
  preferRicherSnapshot,
  readUsageMeterSnapshot,
  rebuildSnapshotFromTurns,
  sessionCachePercent,
  subscribeUsageMeter,
} from '@/lib/usageMeter';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';

function contextUsageTextColor(tone: ContextUsageTone): string {
  if (tone === 'danger') return 'text-[var(--status-error)]';
  if (tone === 'warn') return 'text-[var(--status-running)]';
  return 'text-[var(--status-success)]';
}


function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 1) return '<1%';
  return `${Math.min(999, Math.round(value))}%`;
}

function formatCachePercent(value: number | null): string {
  if (value === null) return '--';
  return formatPercent(value);
}

function hostFromBaseUrl(baseUrl: string | undefined): string {
  const raw = baseUrl?.trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0] ?? raw;
  }
}

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[?::1\]?)($|:)/i.test(host);
}

function displayHost(
  route: {
    baseUrl?: string;
    providerName?: string;
    adapter?: string;
  },
  fallback: string,
): string {
  const host = hostFromBaseUrl(route.baseUrl);
  if (host && !isLocalHost(host)) return host;
  return route.providerName || route.adapter || fallback;
}

function useGatewayVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setVersion((current) => current + 1);
    const onStorage = (event: StorageEvent) => {
      if (event.key) bump();
    };
    window.addEventListener('ugs:gateway-config-changed', bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('ugs:gateway-config-changed', bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return version;
}

function scheduleIdleContextEstimate(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const idleWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout?: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 200 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 80);
  return () => window.clearTimeout(handle);
}

export default function StatusBar() {
  const locale = useStore((state) => state.locale);
  const workflow = useStore((state) => state.workflow);
  const composerModel = useStore((state) => state.composer.model);
  const messages = useStore((state) => state.messages);
  const composerDraft = useStore((state) => state.composerDraft);
  const simpleChatMode = useStore(
    (state) => state.workflow.meta?.simple === true,
  );
  const activeWorkspaceId = useStore((state) => state.activeWorkspaceId);
  const activeSessionId = useStore((state) => state.activeSessionId);
  const gatewayVersion = useGatewayVersion();
  const usageContext = useMemo(
    () => ({ workspaceId: activeWorkspaceId, sessionId: activeSessionId }),
    [activeWorkspaceId, activeSessionId],
  );
  const [liveUsage, setLiveUsage] = useState(() =>
    readUsageMeterSnapshot(usageContext),
  );

  useEffect(() => {
    const refresh = () => setLiveUsage(readUsageMeterSnapshot(usageContext));
    refresh();
    return subscribeUsageMeter(refresh);
  }, [usageContext]);

  // Historical sessions opened on another device / after the meter shipped have
  // no live local snapshot, so the status bar would read 0 / `--`. Each message
  // still carries its turn usage; rebuild a snapshot from those and prefer
  // whichever (live vs rebuilt) carries more accumulated tokens.
  const usage = useMemo(() => {
    const rebuilt = rebuildSnapshotFromTurns(
      messages.map((message) => message.usage),
    );
    return preferRicherSnapshot(liveUsage, rebuilt);
  }, [liveUsage, messages]);

  const route = useMemo(() => {
    const selection = workflowDefaultGatewaySelection(workflow, composerModel);
    return resolveGatewayRoute({
      ...workflow,
      meta: {
        ...workflow.meta,
        gateway: { ...(workflow.meta.gateway ?? {}), defaults: selection },
      },
    });
  }, [workflow, composerModel, gatewayVersion]);

  const adapter: RuntimeAdapterId =
    RUNTIME_ADAPTERS.find((item) => item.id === route.adapter)?.id ??
    RUNTIME_ADAPTERS[0].id;
  const contextUsageKey = useMemo(
    () =>
      [
        activeWorkspaceId ?? '',
        activeSessionId ?? '',
        messages.length,
        composerDraft.length,
        adapter,
        route.model ?? composerModel ?? '',
        simpleChatMode ? 'simple' : 'workflow',
      ].join('|'),
    [
      activeWorkspaceId,
      activeSessionId,
      messages.length,
      composerDraft.length,
      adapter,
      route.model,
      composerModel,
      simpleChatMode,
    ],
  );
  const [contextUsageWindow, setContextUsageWindow] = useState(() => ({
    key: contextUsageKey,
    limit: SIMPLE_CHAT_CONTEXT_INITIAL_MESSAGE_LIMIT,
  }));
  const effectiveContextMessageLimit =
    contextUsageWindow.key === contextUsageKey
      ? contextUsageWindow.limit
      : SIMPLE_CHAT_CONTEXT_INITIAL_MESSAGE_LIMIT;
  useEffect(() => {
    if (!simpleChatMode) return undefined;
    setContextUsageWindow({
      key: contextUsageKey,
      limit: SIMPLE_CHAT_CONTEXT_INITIAL_MESSAGE_LIMIT,
    });
    return scheduleIdleContextEstimate(() => {
      setContextUsageWindow((current) =>
        current.key === contextUsageKey
          ? { key: contextUsageKey, limit: SIMPLE_CHAT_CONTEXT_MESSAGE_LIMIT }
          : current,
      );
    });
  }, [contextUsageKey, simpleChatMode]);
  // Mirror the AI-input estimate so the status bar shows the same context
  // budget percentage the composer used to render as a circular dial.
  const contextUsage = useMemo(
    () =>
      estimateContextUsage({
        messages,
        draft: composerDraft,
        adapter,
        model: route.model ?? composerModel,
        simpleChatMode,
        simpleChatMessageLimit: effectiveContextMessageLimit,
      }),
    [
      messages,
      composerDraft,
      adapter,
      route.model,
      composerModel,
      simpleChatMode,
      effectiveContextMessageLimit,
    ],
  );

  const host = displayHost(route, t(locale, 'statusBar.model'));
  const isConfigured = route.mode === 'cli' || Boolean(route.apiKey?.trim());
  const statusLabel = isConfigured
    ? t(locale, 'statusBar.online')
    : t(locale, 'statusBar.notConfigured');
  const statusTone = isConfigured
    ? 'text-[var(--status-success)]'
    : 'text-fg-faint';
  const cachePercent = sessionCachePercent(usage);
  const contextUsageTitle =
    locale === 'zh-CN'
      ? `上下文用量（估算）：已使用 ${formatCompactTokenCount(
          contextUsage.usedTokens,
        )} / ${formatCompactTokenCount(contextUsage.limitTokens)} tokens`
      : `Context usage (estimate): ${formatCompactTokenCount(
          contextUsage.usedTokens,
        )} / ${formatCompactTokenCount(contextUsage.limitTokens)} tokens used`;

  return (
    <footer className="flex h-7 shrink-0 items-center overflow-x-auto border-t border-border bg-panel px-3 text-[11px] leading-none text-fg-dim">
      <div className="flex min-w-max items-center gap-4">
        <span
          className="inline-flex items-center gap-1.5"
          title={t(locale, 'statusBar.channelStatusTitle')}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isConfigured
                ? 'bg-[var(--status-success)]'
                : 'bg-fg-faint'
            }`}
          />
          <span className={statusTone}>{host} {statusLabel}</span>
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          title={
            cachePercent === null
              ? t(locale, 'statusBar.cacheNoData')
              : t(locale, 'statusBar.cacheHitRatio')
          }
        >
          <Zap size={12} className="text-[var(--accent-3)]" />
          <span>{t(locale, 'statusBar.cache')}</span>
          <span className="font-medium text-[var(--accent-4)]">
            {formatCachePercent(cachePercent)}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          title={t(locale, 'statusBar.tokensTitle')}
        >
          <Hash size={12} className="text-fg-faint" />
          <span>tokens</span>
          <span className="font-medium text-fg">
            {formatCompactTokenCount(usage.totals.totalTokens)}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          title={contextUsageTitle}
          aria-label={contextUsageTitle}
        >
          <Gauge
            size={12}
            className={contextUsageTextColor(contextUsage.tone)}
          />
          <span>{t(locale, 'statusBar.context')}</span>
          <span
            className={`font-medium tabular-nums ${contextUsageTextColor(
              contextUsage.tone,
            )}`}
          >
            {contextUsage.displayPercent}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-fg-faint"
          title={t(locale, 'statusBar.callsTitle')}
        >
          <Database size={12} />
          <span>{usage.totals.calls}</span>
        </span>
      </div>
    </footer>
  );
}
