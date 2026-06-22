import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  type AppearanceSettings,
} from '@/lib/appearance';

export const APPEARANCE_STORAGE_KEY = 'ultragamestudio.appearance.v1';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function loadAppearance(): AppearanceSettings {
  if (!hasStorage()) return DEFAULT_APPEARANCE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE_SETTINGS;
    return normalizeAppearanceSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
}

export function saveAppearance(settings: AppearanceSettings): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // non-fatal
  }
}
