import type { GatewaySelection } from '@/core/ir';
import { runConcurrencyCapForTier } from '@/lib/consensusSettings';

export type ModelSpeedTier = 'fast' | 'standard' | 'slow';

export interface ModelSpeedProfile {
  key: string;
  tier: ModelSpeedTier;
  reason: string;
  ewmaMs?: number;
  firstProgressEwmaMs?: number;
  timeoutCount: number;
  sampleCount: number;
}

export interface ModelCallTiming {
  elapsedMs: number;
  firstProgressMs?: number;
  ok: boolean;
  failureCode?: string;
  timeoutSeconds?: number;
  idleTimeoutSeconds?: number;
}

export interface CliTimeoutPolicy {
  /** Total runtime limit. 0 disables it in favour of progress-aware idle detection. */
  timeoutSeconds: number;
  /**
   * No-progress timeout in seconds. 0 disables the idle watchdog; long-running
   * tool calls can stay silent while waiting for external work such as CI.
   */
  idleTimeoutSeconds: number;
}

export interface GenerationConsensusPlan {
  enabled: boolean;
  count: number;
  concurrency: number;
  tier: ModelSpeedTier;
  reason: string;
}

interface StoredSpeed {
  count: number;
  okCount: number;
  timeoutCount: number;
  ewmaMs?: number;
  firstProgressEwmaMs?: number;
  updatedAt: number;
}

type StoredSpeedMap = Record<string, StoredSpeed>;

const STORAGE_KEY = 'ugs_model_speed_v1';
const EWMA_ALPHA = 0.35;
const FAST_MS = 90_000;
const SLOW_MS = 210_000;
const SLOW_FIRST_PROGRESS_MS = 240_000;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load(): StoredSpeedMap {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StoredSpeedMap)
      : {};
  } catch {
    return {};
  }
}

function save(map: StoredSpeedMap): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage quota / private mode */
  }
}

function modelLabel(selection: GatewaySelection): string {
  return String(selection.modelClass ?? '').trim().toLowerCase();
}

export function modelSpeedKey(selection: GatewaySelection): string {
  return [
    selection.adapter || 'claude-code',
    modelLabel(selection) || 'default',
    selection.providerId ?? '',
    selection.channelId ?? '',
  ].join('|');
}

function staticTier(selection: GatewaySelection): {
  tier: ModelSpeedTier;
  reason: string;
} {
  const model = modelLabel(selection);
  if (/(haiku|flash|mini|lite|fast|turbo)/iu.test(model)) {
    return { tier: 'fast', reason: '模型档位偏快' };
  }
  if (/(opus|pro|reason|thinking|o3|deep)/iu.test(model)) {
    return { tier: 'slow', reason: '模型档位偏慢' };
  }
  return { tier: 'standard', reason: '模型速度未知，按标准档处理' };
}

function ewma(current: number | undefined, sample: number): number {
  if (!Number.isFinite(sample) || sample <= 0) return current ?? sample;
  if (current == null || !Number.isFinite(current)) return sample;
  return Math.round(current * (1 - EWMA_ALPHA) + sample * EWMA_ALPHA);
}

export function recordModelCall(
  selection: GatewaySelection,
  timing: ModelCallTiming,
): void {
  const relevantFailure =
    timing.failureCode === 'timeout' ||
    timing.failureCode === 'idle_timeout' ||
    timing.failureCode === 'startup_timeout' ||
    timing.failureCode === 'first_event_timeout';
  if (!timing.ok && !relevantFailure) return;

  const key = modelSpeedKey(selection);
  const map = load();
  const current = map[key] ?? {
    count: 0,
    okCount: 0,
    timeoutCount: 0,
    updatedAt: 0,
  };

  const timeoutMs =
    Math.max(timing.timeoutSeconds ?? 0, timing.idleTimeoutSeconds ?? 0) *
    1000;
  const elapsedMs = Math.max(1, Math.round(timing.elapsedMs || timeoutMs || 1));
  map[key] = {
    count: current.count + 1,
    okCount: current.okCount + (timing.ok ? 1 : 0),
    timeoutCount: current.timeoutCount + (relevantFailure ? 1 : 0),
    ewmaMs: ewma(current.ewmaMs, elapsedMs),
    firstProgressEwmaMs:
      timing.firstProgressMs == null
        ? current.firstProgressEwmaMs
        : ewma(current.firstProgressEwmaMs, timing.firstProgressMs),
    updatedAt: Date.now(),
  };
  save(map);
}

export function modelSpeedProfile(selection: GatewaySelection): ModelSpeedProfile {
  const key = modelSpeedKey(selection);
  const observed = load()[key];
  const fallback = staticTier(selection);
  if (!observed) {
    return {
      key,
      tier: fallback.tier,
      reason: fallback.reason,
      timeoutCount: 0,
      sampleCount: 0,
    };
  }

  const ewmaMs = observed.ewmaMs;
  const firstProgress = observed.firstProgressEwmaMs;
  if (
    observed.timeoutCount >= 2 ||
    (ewmaMs != null && ewmaMs >= SLOW_MS) ||
    (firstProgress != null && firstProgress >= SLOW_FIRST_PROGRESS_MS)
  ) {
    return {
      key,
      tier: 'slow',
      reason:
        observed.timeoutCount >= 2
          ? '近期多次超时'
          : '实测响应偏慢',
      ewmaMs,
      firstProgressEwmaMs: firstProgress,
      timeoutCount: observed.timeoutCount,
      sampleCount: observed.count,
    };
  }

  if (observed.okCount > 0 && ewmaMs != null && ewmaMs <= FAST_MS) {
    return {
      key,
      tier: 'fast',
      reason: '实测响应较快',
      ewmaMs,
      firstProgressEwmaMs: firstProgress,
      timeoutCount: observed.timeoutCount,
      sampleCount: observed.count,
    };
  }

  return {
    key,
    tier: fallback.tier === 'slow' ? 'slow' : 'standard',
    reason:
      fallback.tier === 'slow'
        ? fallback.reason
        : '实测速度未达到快速档，按标准档处理',
    ewmaMs,
    firstProgressEwmaMs: firstProgress,
    timeoutCount: observed.timeoutCount,
    sampleCount: observed.count,
  };
}

export function timeoutPolicyForSelection(
  _selection: GatewaySelection,
  _prompt?: string,
): CliTimeoutPolicy {
  void _selection;
  void _prompt;
  return {
    // Total runtime is intentionally unbounded. Active builds/tests must not be
    // killed merely because the complete agent turn exceeds a fixed duration.
    timeoutSeconds: 0,
    // Only terminate after 30 minutes with no observable model/tool progress.
    // Users can still override or disable this through the backend env setting.
    idleTimeoutSeconds: 1800,
  };
}

export function effectiveRunConcurrency(
  configured: number,
  selection: GatewaySelection,
): number {
  const n = Math.max(1, Math.min(16, Math.floor(configured) || 1));
  const tier = modelSpeedProfile(selection).tier;
  return Math.min(n, runConcurrencyCapForTier(tier));
}

export function effectiveConsensusSamples(
  configured: number,
  selection: GatewaySelection,
): number {
  const n = Math.max(2, Math.min(7, Math.floor(configured) || 2));
  const tier = modelSpeedProfile(selection).tier;
  if (tier === 'slow') return 2;
  if (tier === 'standard') return Math.min(n, 3);
  return n;
}

export function effectiveGenerationConsensusPlan(
  configuredCandidates: number,
  selection: GatewaySelection,
): GenerationConsensusPlan {
  const profile = modelSpeedProfile(selection);
  const configured = Math.max(
    1,
    Math.min(5, Math.floor(configuredCandidates) || 1),
  );
  if (configured <= 1) {
    return {
      enabled: false,
      count: 1,
      concurrency: 1,
      tier: profile.tier,
      reason: '生成期多候选未开启',
    };
  }
  if (profile.tier !== 'fast') {
    return {
      enabled: false,
      count: 1,
      concurrency: 1,
      tier: profile.tier,
      reason: `${profile.reason}，已关闭生成期多候选`,
    };
  }
  return {
    enabled: true,
    count: configured,
    concurrency: Math.min(configured, effectiveRunConcurrency(configured, selection)),
    tier: profile.tier,
    reason: profile.reason,
  };
}

export function __resetModelSpeedForTests(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
