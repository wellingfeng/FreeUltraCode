/**
 * 编程渠道卡片的模型价格模块。
 *
 * 价格不再硬编码：应用启动时从 OpenRouter 公开接口
 * (GET https://openrouter.ai/api/v1/models，无需 API key) 拉取一次，
 * 按模型名做归一化 + 模糊匹配。价格以美元展示（每百万 token），
 * 不做人民币换算，避免汇率波动导致价格失真。拉取结果缓存到内存，
 * 并写入 localStorage 作为离线兜底——下次启动网络失败时回退到上次缓存。
 */

import { tauriFetch } from '@/lib/tauri';

export interface ModelPrice {
  /** 输入价格，美元 / 每百万 token。 */
  inputUsd: number;
  /** 输出价格，美元 / 每百万 token。 */
  outputUsd: number;
}

/** 归一化后的模型价格条目（已去掉 vendor 前缀）。 */
export interface PricingEntry {
  id: string;
  inputUsd: number;
  outputUsd: number;
}

export type ModelPricingStatus = 'loading' | 'ready' | 'error';

/** OpenRouter 模型列表里单个模型的原始字段（只取用到的部分）。 */
export interface OpenRouterModelLike {
  id: string;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
  } | null;
}

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'ugs.modelPricing.v2';

/** OpenRouter 的 pricing 字段是「每 token 美元」，换算成每百万 token。 */
const TOKENS_PER_UNIT = 1_000_000;

interface CachedPricing {
  fetchedAt: number;
  entries: PricingEntry[];
}

// ── 运行时状态 ──────────────────────────────────────────────────────────
let entries: PricingEntry[] = [];
let status: ModelPricingStatus = 'loading';
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 订阅价格数据变化；返回取消订阅函数。 */
export function subscribeModelPricing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getModelPricingStatus(): ModelPricingStatus {
  return status;
}

/** 把模型 id 归一化成可比较的 token：小写、去 vendor 前缀、分隔符归一。 */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    // 去掉 vendor 前缀（"anthropic/claude-sonnet-4.5" → "claude-sonnet-4.5"）。
    .replace(/^[a-z0-9._-]+\//, '')
    // 把连续的 `.` `_` 空格等非字母数字字符压缩成单个 `-`。
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 把 OpenRouter 的单个模型记录换算成美元价格条目（每百万 token）。
 * 无定价（pricing 缺失或 prompt/completion 缺失）时返回 null。
 */
export function buildPricingEntry(
  model: OpenRouterModelLike,
): PricingEntry | null {
  const pricing = model?.pricing;
  if (!pricing) return null;
  const prompt = toNumber(pricing.prompt);
  const completion = toNumber(pricing.completion);
  if (prompt === null || completion === null) return null;
  const id = normalizeModelId(model.id);
  if (!id) return null;
  return {
    id,
    inputUsd: roundUsd(prompt * TOKENS_PER_UNIT),
    outputUsd: roundUsd(completion * TOKENS_PER_UNIT),
  };
}

/**
 * 在价格条目列表里按模型名查找价格（纯函数）。
 * 先精确匹配，再做双向子串匹配（取重叠长度最大者）。
 */
export function lookupInEntries(
  list: PricingEntry[],
  model: string | null | undefined,
): ModelPrice | null {
  const key = normalizeModelId(model ?? '');
  if (!key || list.length === 0) return null;

  let best: { entry: PricingEntry; score: number } | null = null;
  for (const entry of list) {
    if (entry.id === key) {
      return { inputUsd: entry.inputUsd, outputUsd: entry.outputUsd };
    }
    let score = 0;
    if (entry.id.includes(key)) {
      score = key.length;
    } else if (key.includes(entry.id)) {
      score = entry.id.length;
    }
    // 太短的重叠容易误命中（如通用词），设置最小长度门槛。
    if (score >= 4 && (!best || score > best.score)) {
      best = { entry, score };
    }
  }
  if (best) {
    return { inputUsd: best.entry.inputUsd, outputUsd: best.entry.outputUsd };
  }
  return null;
}

/** 从已缓存的价格数据里查找当前选中模型的价格；未加载/未命中返回 null。 */
export function lookupModelPrice(
  model: string | null | undefined,
): ModelPrice | null {
  return lookupInEntries(entries, model);
}

/** 刷新价格目录（应用启动时调用一次）。并发调用会去重。永不 throw。 */
export async function refreshModelPricing(): Promise<void> {
  if (inflight) return inflight;
  inflight = loadAndPublish().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function loadAndPublish(): Promise<void> {
  status = 'loading';
  notify();
  try {
    const fetched = await fetchOpenRouterEntries();
    if (fetched.length === 0) throw new Error('empty pricing catalog');
    entries = fetched;
    status = 'ready';
    persistCache({ fetchedAt: Date.now(), entries: fetched });
  } catch {
    // 网络失败时回退到上次缓存；没有缓存则标记 error。
    const cached = readCache();
    if (cached && cached.entries.length > 0) {
      entries = cached.entries;
      status = 'ready';
    } else {
      status = 'error';
    }
  }
  notify();
}

async function fetchOpenRouterEntries(): Promise<PricingEntry[]> {
  const res = await tauriFetch(`${OPENROUTER_MODELS_URL}?t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as { data?: OpenRouterModelLike[] };
  const result: PricingEntry[] = [];
  for (const model of payload.data ?? []) {
    const entry = buildPricingEntry(model);
    if (entry) result.push(entry);
  }
  return result;
}

function readCache(): CachedPricing | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPricing;
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistCache(cache: CachedPricing): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 忽略写入失败（隐私模式 / 配额）。
  }
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = roundUsd(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
