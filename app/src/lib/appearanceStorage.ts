import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  type AppearanceSettings,
} from '@/lib/appearance';
import {
  readSettingsRaw,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';

export const APPEARANCE_STORAGE_KEY = 'ultragamestudio.appearance.v1';
export const APPEARANCE_SETTINGS_REL_PATH = 'settings/appearance.v1.json';
const LEGACY_APPEARANCE_STORAGE_KEYS = ['freeultracode.appearance.v1'] as const;

function localGet(key: string): string | null {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function parseAppearance(raw: string | null): AppearanceSettings | null {
  if (!raw) return null;
  try {
    return normalizeAppearanceSettings(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function loadAppearance(): AppearanceSettings {
  const stored = parseAppearance(
    readSettingsRaw(APPEARANCE_SETTINGS_REL_PATH, APPEARANCE_STORAGE_KEY),
  );
  if (stored) return stored;

  for (const legacyKey of LEGACY_APPEARANCE_STORAGE_KEYS) {
    const legacy = parseAppearance(localGet(legacyKey));
    if (!legacy) continue;
    saveAppearance(legacy);
    return legacy;
  }

  return DEFAULT_APPEARANCE_SETTINGS;
}

export function saveAppearance(settings: AppearanceSettings): void {
  const normalized = normalizeAppearanceSettings(settings);
  writeSettingsRaw(
    APPEARANCE_SETTINGS_REL_PATH,
    APPEARANCE_STORAGE_KEY,
    JSON.stringify(normalized),
  );
}
