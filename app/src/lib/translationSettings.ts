export const TRANSLATION_PROVIDER_IDS = [
  'google',
  'baidu',
  'mymemory',
  'libretranslate',
] as const;

export type TranslationProviderId = (typeof TRANSLATION_PROVIDER_IDS)[number];

export interface TranslationSettings {
  providerId: TranslationProviderId;
  baiduAppId: string;
  baiduSecretKey: string;
  libreTranslateBaseUrl: string;
  libreTranslateApiKey: string;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  providerId: 'google',
  baiduAppId: '',
  baiduSecretKey: '',
  libreTranslateBaseUrl: 'https://libretranslate.com',
  libreTranslateApiKey: '',
};

const STORAGE_KEY = 'ultragamestudio.translationSettings.v1';
const CHANGE_EVENT = 'ugs:translation-settings-changed';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function isProviderId(value: unknown): value is TranslationProviderId {
  return (
    typeof value === 'string' &&
    TRANSLATION_PROVIDER_IDS.includes(value as TranslationProviderId)
  );
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: unknown): string {
  const raw = cleanString(value);
  if (!raw) return DEFAULT_TRANSLATION_SETTINGS.libreTranslateBaseUrl;
  return raw.replace(/\/+$/u, '');
}

export function normalizeTranslationSettings(
  value: unknown,
): TranslationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_TRANSLATION_SETTINGS };
  }
  const record = value as Partial<Record<keyof TranslationSettings, unknown>>;
  return {
    providerId: isProviderId(record.providerId)
      ? record.providerId
      : DEFAULT_TRANSLATION_SETTINGS.providerId,
    baiduAppId: cleanString(record.baiduAppId),
    baiduSecretKey: cleanString(record.baiduSecretKey),
    libreTranslateBaseUrl: normalizeBaseUrl(record.libreTranslateBaseUrl),
    libreTranslateApiKey: cleanString(record.libreTranslateApiKey),
  };
}

export function loadTranslationSettings(): TranslationSettings {
  if (!hasStorage()) return { ...DEFAULT_TRANSLATION_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeTranslationSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_TRANSLATION_SETTINGS };
  }
}

export function saveTranslationSettings(settings: TranslationSettings): void {
  if (!hasStorage()) return;
  try {
    const normalized = normalizeTranslationSettings(settings);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Settings persistence is best-effort.
  }
}

export function subscribeTranslationSettings(
  listener: (settings: TranslationSettings) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => listener(loadTranslationSettings());
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function translationProviderReady(
  providerId: TranslationProviderId,
  settings = loadTranslationSettings(),
): boolean {
  if (providerId === 'baidu') {
    return !!settings.baiduAppId && !!settings.baiduSecretKey;
  }
  if (providerId === 'libretranslate') {
    return !!settings.libreTranslateBaseUrl;
  }
  return true;
}

export function translationSettingsCacheKey(
  settings = loadTranslationSettings(),
): string {
  return [
    settings.providerId,
    settings.baiduAppId,
    settings.baiduSecretKey ? 'baidu-key' : 'no-baidu-key',
    settings.libreTranslateBaseUrl,
    settings.libreTranslateApiKey ? 'libre-key' : 'no-libre-key',
  ].join('|');
}
