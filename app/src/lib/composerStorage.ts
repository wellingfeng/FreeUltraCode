import type {
  ComposerSettings,
  PromptGroup,
  SessionComposerSettings,
} from '@/store/types';
import {
  defaultPersonalInstructionsByModel,
  ensureRequiredPersonalInstructions,
  personalInstructionsKey,
  type PersonalInstructionsByModel,
} from '@/core/personalInstructions';
import type { GatewaySelection } from '@/core/ir';
import { isLocale, systemLocale, type Locale } from '@/lib/i18n';
import { uniqueWorkspaceHistory } from '@/lib/workspaceHistory';
import {
  DEFAULT_GAME_EXPERT_SETTINGS,
  normalizeGameExpertSettings,
  type GameExpertSettings,
} from '@/lib/gameExperts';
import { tauriAvailable } from '@/lib/tauri';

/**
 * localStorage persistence for AI-input composer state, the AIDock height, and
 * the user-editable prompt library. All access is guarded so it is safe in
 * non-browser contexts and never throws.
 */

const COMPOSER_KEY = 'ultragamestudio.composer.v1';
const DOCK_HEIGHT_KEY = 'ultragamestudio.dockHeight.v1';
const PROMPT_GROUPS_KEY = 'ultragamestudio.promptGroups.v1';
const LOCALE_KEY = 'ultragamestudio.locale.v1';
const PROMPT_AUTO_TRANSLATE_KEY = 'ultragamestudio.promptAutoTranslate.v1';
const PERSONAL_INSTRUCTIONS_KEY = 'ultragamestudio.personalInstructions.v1';
const PERSONAL_INSTRUCTIONS_BY_MODEL_KEY =
  'ultragamestudio.personalInstructionsByModel.v1';
const GAME_EXPERT_SETTINGS_KEY = 'ultragamestudio.gameExperts.v1';
/** Tracks which PROMPT_DEFAULTS_VERSION the persisted library was migrated to. */
const PROMPT_GROUPS_VERSION_KEY = 'ultragamestudio.promptGroups.version.v1';

export interface PersistedComposer {
  composer: ComposerSettings;
  composerBySession?: Record<string, SessionComposerSettings>;
  workspaceHistory: string[];
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function loadComposer(): PersistedComposer | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(COMPOSER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedComposer>;
    if (!parsed.composer) return null;
    return {
      composer: parsed.composer,
      composerBySession:
        parsed.composerBySession &&
        typeof parsed.composerBySession === 'object' &&
        !Array.isArray(parsed.composerBySession)
          ? (parsed.composerBySession as Record<string, SessionComposerSettings>)
          : {},
      workspaceHistory: Array.isArray(parsed.workspaceHistory)
        ? uniqueWorkspaceHistory(parsed.workspaceHistory)
        : [],
    };
  } catch {
    return null;
  }
}

export function saveComposer(state: PersistedComposer): void {
  if (!hasStorage()) return;
  try {
    const previous = loadComposer();
    window.localStorage.setItem(
      COMPOSER_KEY,
      JSON.stringify({
        ...state,
        workspaceHistory: uniqueWorkspaceHistory(state.workspaceHistory),
        composerBySession:
          state.composerBySession ?? previous?.composerBySession ?? {},
      }),
    );
  } catch {
    // Quota / serialization errors are non-fatal.
  }
}

export function loadDockHeight(): number | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(DOCK_HEIGHT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveDockHeight(height: number): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(DOCK_HEIGHT_KEY, String(Math.round(height)));
  } catch {
    // non-fatal
  }
}

export function loadLocale(): Locale {
  if (!hasStorage()) return systemLocale();
  try {
    const raw = window.localStorage.getItem(LOCALE_KEY);
    return isLocale(raw) ? raw : systemLocale();
  } catch {
    return systemLocale();
  }
}

export function saveLocale(locale: Locale): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // non-fatal
  }
}

export function loadPromptAutoTranslate(): boolean {
  if (!hasStorage()) return true;
  try {
    const raw = window.localStorage.getItem(PROMPT_AUTO_TRANSLATE_KEY);
    if (raw == null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function savePromptAutoTranslate(enabled: boolean): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PROMPT_AUTO_TRANSLATE_KEY, String(enabled));
  } catch {
    // non-fatal
  }
}

export function loadPersonalInstructions(): string {
  if (!hasStorage()) return '';
  try {
    return window.localStorage.getItem(PERSONAL_INSTRUCTIONS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePersonalInstructions(instructions: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PERSONAL_INSTRUCTIONS_KEY, instructions);
  } catch {
    // non-fatal
  }
}

function normalizePersonalInstructionsByModel(
  value: unknown,
): PersonalInstructionsByModel | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const out: PersonalInstructionsByModel = {};
  for (const [key, instructions] of Object.entries(value)) {
    if (typeof key !== 'string' || !key) continue;
    if (typeof instructions !== 'string') continue;
    out[key] = ensureRequiredPersonalInstructions(instructions);
  }
  return out;
}

/**
 * 个性化指令（按 adapter 分桶）的持久化通道。
 *
 * 为什么不能只用 localStorage：WebView2 的 localStorage 底层是 Chromium
 * leveldb，写入是 write-behind（先进内存 log，再异步压实到 .ldb）。托盘右键
 * 「退出」会同步 setItem 后立即强杀 WebView2 进程，内存 log 段根本没机会压实，
 * 重启后丢失。实证：扫 `%LOCALAPPDATA%\com.ultragamestudio.desktop\EBWebView\
 * Default\Local Storage\leveldb\*.ldb|*.log`，其他 ultragamestudio key 都在盘
 * 上，唯独 `personalInstructionsByModel.v1` 完全不存在。
 *
 * 修法（与 apiConfig/generationSettingsStore 同模式）：Tauri 下以
 * `~/.ultragamestudio/settings/personalInstructionsByModel.v1.json` 为权威源
 * （`history_write_json` invoke 同步落盘，不经 WebView2），localStorage 仅作
 * 同步读镜像；启动时 hydrate 磁盘 → cache，退出前 quitFlush 冲刷 pending 写。
 */
const PERSONAL_INSTRUCTIONS_BY_MODEL_REL_PATH =
  'settings/personalInstructionsByModel.v1.json';

// Authoritative in-memory view once hydrate has run under Tauri. `null` 表示
// 尚未 hydrate（此时读走 localStorage 镜像，写仍双写，等 hydrate 时被磁盘值
// 覆盖或落盘一次）。
let personalInstructionsDiskCache: PersonalInstructionsByModel | null = null;
let personalInstructionsDiskReady = false;
const personalInstructionsPendingWrites = new Set<Promise<void>>();

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function personalInstructionsDiskWriteSoon(
  value: PersonalInstructionsByModel,
): void {
  if (!tauriAvailable()) return;
  const json = JSON.stringify(value);
  const task = (async (): Promise<void> => {
    try {
      const invoke = await getInvoke();
      await invoke<void>('history_write_json', {
        relPath: PERSONAL_INSTRUCTIONS_BY_MODEL_REL_PATH,
        json,
      });
    } catch (err) {
      console.error(
        '[composerStorage] personalInstructions disk write failed',
        err,
      );
    }
  })();
  personalInstructionsPendingWrites.add(task);
  void task.finally(() => personalInstructionsPendingWrites.delete(task));
}

/**
 * 启动时把磁盘上的 personalInstructionsByModel 读进内存 cache；磁盘为空且
 * localStorage 有 legacy 值时迁移一次。必须在 settingsSlice 冷启动（
 * `loadPersonalInstructionsByModel`）之前 await。浏览器/dev 构建下 no-op。
 */
export async function initializePersonalInstructionsStore(): Promise<void> {
  if (personalInstructionsDiskReady) return;
  if (!tauriAvailable()) return;
  try {
    const invoke = await getInvoke();
    const fromDisk = await invoke<string | null>('history_read_json', {
      relPath: PERSONAL_INSTRUCTIONS_BY_MODEL_REL_PATH,
    });
    if (fromDisk != null && fromDisk !== '' && fromDisk !== 'null') {
      try {
        const parsed = normalizePersonalInstructionsByModel(
          JSON.parse(fromDisk),
        );
        if (parsed) {
          personalInstructionsDiskCache = parsed;
          // 同步镜像到 localStorage，供任何 sync reader 兜底。
          try {
            if (hasStorage()) {
              window.localStorage.setItem(
                PERSONAL_INSTRUCTIONS_BY_MODEL_KEY,
                JSON.stringify(parsed),
              );
            }
          } catch {
            /* non-fatal */
          }
          return;
        }
      } catch (err) {
        console.warn(
          '[composerStorage] personalInstructions disk parse failed',
          err,
        );
      }
    }
    // 迁移：磁盘为空但 localStorage 有值时，把 localStorage 写到磁盘。
    let legacy: string | null = null;
    try {
      legacy = hasStorage()
        ? window.localStorage.getItem(PERSONAL_INSTRUCTIONS_BY_MODEL_KEY)
        : null;
    } catch {
      legacy = null;
    }
    if (legacy) {
      try {
        const parsed = normalizePersonalInstructionsByModel(
          JSON.parse(legacy),
        );
        if (parsed && Object.keys(parsed).length > 0) {
          personalInstructionsDiskCache = parsed;
          personalInstructionsDiskWriteSoon(parsed);
        }
      } catch {
        /* legacy value unparseable — ignore */
      }
    }
  } catch (err) {
    console.warn(
      '[composerStorage] personalInstructions disk init failed',
      err,
    );
  } finally {
    personalInstructionsDiskReady = true;
  }
}

/** 退出前冲刷所有未完成的 personalInstructions 磁盘写。 */
export async function flushPersonalInstructionsDiskWrites(): Promise<void> {
  const inFlight = [...personalInstructionsPendingWrites];
  if (inFlight.length === 0) return;
  await Promise.all(inFlight);
}

/** 测试专用：重置 hydrate 状态。 */
export function resetPersonalInstructionsStoreForTests(): void {
  personalInstructionsDiskCache = null;
  personalInstructionsDiskReady = false;
  personalInstructionsPendingWrites.clear();
}

export function loadPersonalInstructionsByModel(
  legacySelection?: Partial<GatewaySelection> | null,
  defaultSelections: ReadonlyArray<Partial<GatewaySelection> | null | undefined> = [],
): PersonalInstructionsByModel {
  // 磁盘 cache 优先（Tauri + hydrate 完成后，磁盘是权威源）。
  if (personalInstructionsDiskCache) {
    return personalInstructionsDiskCache;
  }
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(PERSONAL_INSTRUCTIONS_BY_MODEL_KEY);
    if (raw !== null) {
      const parsed = normalizePersonalInstructionsByModel(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to the legacy single-value migration.
  }

  const defaults = defaultPersonalInstructionsByModel([
    legacySelection,
    ...defaultSelections,
  ]);
  const legacy = loadPersonalInstructions();
  const seeded = legacy
    ? {
        ...defaults,
        [personalInstructionsKey(legacySelection)]:
          ensureRequiredPersonalInstructions(legacy),
      }
    : defaults;
  if (Object.keys(seeded).length > 0) savePersonalInstructionsByModel(seeded);
  return seeded;
}

export function savePersonalInstructionsByModel(
  byModel: PersonalInstructionsByModel,
): void {
  const normalized = normalizePersonalInstructionsByModel(byModel) ?? {};
  // 更新内存 cache（hydrate 之后磁盘是权威源，cache 即磁盘值的内存投影）。
  if (personalInstructionsDiskReady || tauriAvailable()) {
    personalInstructionsDiskCache = normalized;
  }
  // localStorage 同步镜像（非 Tauri 环境下是唯一存储；Tauri 下作同步读兜底）。
  if (hasStorage()) {
    try {
      window.localStorage.setItem(
        PERSONAL_INSTRUCTIONS_BY_MODEL_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      // non-fatal: quota / serialization errors fall through to the disk write.
    }
  }
  // 磁盘异步写（write-behind；退出前由 quitFlush 冲刷）。
  personalInstructionsDiskWriteSoon(normalized);
}

export function loadGameExpertSettings(): GameExpertSettings {
  if (!hasStorage()) return normalizeGameExpertSettings(DEFAULT_GAME_EXPERT_SETTINGS);
  try {
    const raw = window.localStorage.getItem(GAME_EXPERT_SETTINGS_KEY);
    if (!raw) return normalizeGameExpertSettings(DEFAULT_GAME_EXPERT_SETTINGS);
    return normalizeGameExpertSettings(JSON.parse(raw));
  } catch {
    return normalizeGameExpertSettings(DEFAULT_GAME_EXPERT_SETTINGS);
  }
}

export function saveGameExpertSettings(settings: GameExpertSettings): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      GAME_EXPERT_SETTINGS_KEY,
      JSON.stringify(normalizeGameExpertSettings(settings)),
    );
  } catch {
    // non-fatal
  }
}

/**
 * Load the user-edited prompt library. Returns null on any failure (missing,
 * unparseable, or structurally invalid) so callers can fall back to defaults.
 * A valid payload is an array of `{ id, label, items: PromptItem[] }`.
 */
export function loadPromptGroups(): PromptGroup[] | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(PROMPT_GROUPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.every(
      (g) =>
        g != null &&
        typeof (g as PromptGroup).id === 'string' &&
        typeof (g as PromptGroup).label === 'string' &&
        Array.isArray((g as PromptGroup).items) &&
        (g as PromptGroup).items.every(
          (it) =>
            it != null &&
            typeof it.id === 'string' &&
            typeof it.label === 'string' &&
            typeof it.text === 'string',
        ),
    );
    return valid ? (parsed as PromptGroup[]) : null;
  } catch {
    return null;
  }
}

/** Persist the prompt library. Errors are non-fatal. */
export function savePromptGroups(groups: PromptGroup[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PROMPT_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Quota / serialization errors are non-fatal.
  }
}

/**
 * The defaults version the persisted library was last migrated to (0 if never).
 * Used to merge newly-shipped default groups exactly once per version bump.
 */
export function loadPromptGroupsVersion(): number {
  if (!hasStorage()) return 0;
  try {
    const raw = window.localStorage.getItem(PROMPT_GROUPS_VERSION_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Record the defaults version the persisted library has been migrated to. */
export function savePromptGroupsVersion(version: number): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PROMPT_GROUPS_VERSION_KEY, String(version));
  } catch {
    // non-fatal
  }
}

/** Read a persisted pane width (px) for an arbitrary key; null when unset. */
export function loadPaneWidth(key: string): number | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Persist a pane width (px) under an arbitrary key. */
export function savePaneWidth(key: string, width: number): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // non-fatal
  }
}
