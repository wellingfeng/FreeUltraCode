/**
 * CONTRACT: user-tunable memory system configuration.
 *
 * Small synchronous config blob for the long-term memory features: enable
 * switches, character limits, and background-review parameters. Persisted via
 * the generationSettingsStore write-behind cache (disk under Tauri,
 * localStorage in the browser) so UI `useState(() => load())` initializers can
 * read it synchronously.
 *
 * Defaults are conservative: memory write + recall are ON (cheap, no extra
 * model calls beyond the turn the user already paid for), but background review
 * is OFF by default because it spends model quota autonomously.
 */

import { readSettingsRaw, writeSettingsRaw } from '@/lib/generationSettingsStore';
import { setMemoryLimits } from '@/lib/memoryStore';

const REL_PATH = 'settings/memoryConfig.v1.json';
const LEGACY_KEY = 'ultragamestudio.memoryConfig.v1';

export interface MemoryConfig {
  /** Inject the frozen memory snapshot into the chat system prompt. */
  snapshotEnabled: boolean;
  /** Offer the <<UGS_MEMORY>> write protocol to the model. */
  writeEnabled: boolean;
  /** Offer the <<UGS_RECALL>> history-search protocol to the model. */
  recallEnabled: boolean;
  /** Character cap for the assistant-notes (memory) store. */
  memoryCharLimit: number;
  /** Character cap for the user-profile (user) store. */
  userCharLimit: number;
  /** Background self-review after qualifying turns (spends model quota). */
  reviewEnabled: boolean;
  /** Only review turns with at least this many messages (signal gate). */
  reviewMinMessages: number;
  /** Minimum minutes between background reviews (rate limit). */
  reviewMinIntervalMinutes: number;
  /** Prefer the cheapest model tier for review when routing allows. */
  reviewPreferCheapModel: boolean;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  snapshotEnabled: true,
  writeEnabled: true,
  recallEnabled: true,
  memoryCharLimit: 2200,
  userCharLimit: 1375,
  reviewEnabled: false,
  reviewMinMessages: 6,
  reviewMinIntervalMinutes: 30,
  reviewPreferCheapModel: true,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function coerce(raw: Partial<MemoryConfig> | null | undefined): MemoryConfig {
  const d = DEFAULT_MEMORY_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    snapshotEnabled: raw.snapshotEnabled ?? d.snapshotEnabled,
    writeEnabled: raw.writeEnabled ?? d.writeEnabled,
    recallEnabled: raw.recallEnabled ?? d.recallEnabled,
    memoryCharLimit: clampInt(raw.memoryCharLimit, d.memoryCharLimit, 200, 20000),
    userCharLimit: clampInt(raw.userCharLimit, d.userCharLimit, 200, 20000),
    reviewEnabled: raw.reviewEnabled ?? d.reviewEnabled,
    reviewMinMessages: clampInt(raw.reviewMinMessages, d.reviewMinMessages, 2, 100),
    reviewMinIntervalMinutes: clampInt(
      raw.reviewMinIntervalMinutes,
      d.reviewMinIntervalMinutes,
      0,
      1440,
    ),
    reviewPreferCheapModel: raw.reviewPreferCheapModel ?? d.reviewPreferCheapModel,
  };
}

/** Synchronous read. Also syncs the live char limits into memoryStore. */
export function loadMemoryConfig(): MemoryConfig {
  let parsed: Partial<MemoryConfig> | null = null;
  try {
    const raw = readSettingsRaw(REL_PATH, LEGACY_KEY);
    if (raw) parsed = JSON.parse(raw) as Partial<MemoryConfig>;
  } catch {
    parsed = null;
  }
  const config = coerce(parsed);
  setMemoryLimits({ memory: config.memoryCharLimit, user: config.userCharLimit });
  return config;
}

/** Synchronous write-behind. Applies char limits to the live memoryStore. */
export function saveMemoryConfig(config: MemoryConfig): MemoryConfig {
  const next = coerce(config);
  writeSettingsRaw(REL_PATH, LEGACY_KEY, JSON.stringify(next));
  setMemoryLimits({ memory: next.memoryCharLimit, user: next.userCharLimit });
  return next;
}

// --- background-review rate-limit timestamp ---------------------------------
// Stored separately from the config blob so writing a review timestamp does not
// race the user editing settings. Scoped per-workspace so one project's review
// cadence doesn't gate another's.

const REVIEW_TS_REL = 'settings/memoryReviewState.v1.json';
const REVIEW_TS_KEY = 'ultragamestudio.memoryReviewState.v1';

type ReviewState = Record<string, number>;

function readReviewState(): ReviewState {
  try {
    const raw = readSettingsRaw(REVIEW_TS_REL, REVIEW_TS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as ReviewState;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

/** Last background-review epoch-ms for a workspace (0 if never). */
export function getLastReviewAt(workspaceId: string): number {
  const state = readReviewState();
  const v = state[workspaceId || '_global'];
  return typeof v === 'number' ? v : 0;
}

/** Record a background-review run time for a workspace. */
export function setLastReviewAt(workspaceId: string, at: number = Date.now()): void {
  const state = readReviewState();
  state[workspaceId || '_global'] = at;
  writeSettingsRaw(REVIEW_TS_REL, REVIEW_TS_KEY, JSON.stringify(state));
}
