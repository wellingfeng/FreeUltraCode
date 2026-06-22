export type ShortcutActionId =
  | 'composer-send'
  | 'composer-newline'
  | 'modal-close'
  | 'return-search';

export interface ShortcutBinding {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type ShortcutSettings = Record<ShortcutActionId, ShortcutBinding>;

type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

export const SHORTCUT_SETTINGS_STORAGE_KEY =
  'ultragamestudio.keyboardShortcuts.v1';
export const SHORTCUT_SETTINGS_EVENT = 'ugs:keyboard-shortcuts-changed';

export const SHORTCUT_ACTION_IDS: ShortcutActionId[] = [
  'composer-send',
  'composer-newline',
  'return-search',
  'modal-close',
];

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  'composer-send': {
    key: 'Enter',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  },
  'composer-newline': {
    key: 'Enter',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  },
  'return-search': {
    key: 'F',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  },
  'modal-close': {
    key: 'Escape',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  },
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function cloneBinding(binding: ShortcutBinding): ShortcutBinding {
  return { ...binding };
}

function cloneSettings(settings: ShortcutSettings): ShortcutSettings {
  return SHORTCUT_ACTION_IDS.reduce((out, id) => {
    out[id] = cloneBinding(settings[id]);
    return out;
  }, {} as ShortcutSettings);
}

export function normalizeShortcutKey(key: unknown): string {
  if (typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (!trimmed) return key === ' ' ? 'Space' : '';
  if (trimmed === 'Esc') return 'Escape';
  if (trimmed === 'Spacebar') return 'Space';
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

export function normalizeShortcutBinding(
  value: unknown,
): ShortcutBinding | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ShortcutBinding>;
  const key = normalizeShortcutKey(candidate.key);
  if (!key || MODIFIER_KEYS.has(key)) return null;
  return {
    key,
    ctrlKey: candidate.ctrlKey === true,
    altKey: candidate.altKey === true,
    shiftKey: candidate.shiftKey === true,
    metaKey: candidate.metaKey === true,
  };
}

export function normalizeShortcutSettings(value: unknown): ShortcutSettings {
  const settings = cloneSettings(DEFAULT_SHORTCUT_SETTINGS);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return settings;
  }
  const persisted = value as Partial<Record<ShortcutActionId, unknown>>;
  for (const id of SHORTCUT_ACTION_IDS) {
    const binding = normalizeShortcutBinding(persisted[id]);
    if (binding) settings[id] = binding;
  }
  return settings;
}

export function loadShortcutSettings(): ShortcutSettings {
  if (!hasStorage()) return cloneSettings(DEFAULT_SHORTCUT_SETTINGS);
  try {
    const raw = window.localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY);
    if (!raw) return cloneSettings(DEFAULT_SHORTCUT_SETTINGS);
    return normalizeShortcutSettings(JSON.parse(raw));
  } catch {
    return cloneSettings(DEFAULT_SHORTCUT_SETTINGS);
  }
}

export function saveShortcutSettings(settings: ShortcutSettings): void {
  const normalized = normalizeShortcutSettings(settings);
  if (hasStorage()) {
    try {
      window.localStorage.setItem(
        SHORTCUT_SETTINGS_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      // Quota / serialization errors are non-fatal.
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SHORTCUT_SETTINGS_EVENT));
  }
}

export function setShortcutBinding(
  settings: ShortcutSettings,
  id: ShortcutActionId,
  binding: ShortcutBinding,
): ShortcutSettings {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return cloneSettings(settings);
  return {
    ...cloneSettings(settings),
    [id]: normalized,
  };
}

export function resetShortcutBinding(
  settings: ShortcutSettings,
  id: ShortcutActionId,
): ShortcutSettings {
  return {
    ...cloneSettings(settings),
    [id]: cloneBinding(DEFAULT_SHORTCUT_SETTINGS[id]),
  };
}

export function resetAllShortcutSettings(): ShortcutSettings {
  return cloneSettings(DEFAULT_SHORTCUT_SETTINGS);
}

export function shortcutFromKeyboardEvent(
  event: KeyboardShortcutEvent,
): ShortcutBinding | null {
  return normalizeShortcutBinding({
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
  });
}

export function sameShortcutBinding(
  left: ShortcutBinding,
  right: ShortcutBinding,
): boolean {
  return (
    left.key === right.key &&
    left.ctrlKey === right.ctrlKey &&
    left.altKey === right.altKey &&
    left.shiftKey === right.shiftKey &&
    left.metaKey === right.metaKey
  );
}

export function matchesShortcut(
  event: KeyboardShortcutEvent,
  binding: ShortcutBinding,
): boolean {
  const fromEvent = shortcutFromKeyboardEvent(event);
  const normalized = normalizeShortcutBinding(binding);
  return !!fromEvent && !!normalized && sameShortcutBinding(fromEvent, normalized);
}

export function shortcutConflict(
  settings: ShortcutSettings,
  currentId: ShortcutActionId,
  binding: ShortcutBinding,
): ShortcutActionId | null {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return null;
  return (
    SHORTCUT_ACTION_IDS.find(
      (id) =>
        id !== currentId &&
        sameShortcutBinding(settings[id], normalized),
    ) ?? null
  );
}

function displayKey(key: string): string {
  if (key === 'Escape') return 'Esc';
  if (key === ' ') return 'Space';
  return key;
}

export function shortcutParts(binding: ShortcutBinding): string[] {
  const parts: string[] = [];
  if (binding.ctrlKey) parts.push('Ctrl');
  if (binding.altKey) parts.push('Alt');
  if (binding.shiftKey) parts.push('Shift');
  if (binding.metaKey) parts.push('Meta');
  parts.push(displayKey(binding.key));
  return parts;
}

export function describeShortcutBinding(binding: ShortcutBinding): string {
  return shortcutParts(binding).join('+');
}

export function isNativeTextareaNewlineShortcut(
  event: KeyboardShortcutEvent,
): boolean {
  return (
    event.key === 'Enter' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

export function subscribeShortcutSettings(
  listener: (settings: ShortcutSettings) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const notify = () => listener(loadShortcutSettings());
  const onStorage = (event: StorageEvent) => {
    if (event.key === SHORTCUT_SETTINGS_STORAGE_KEY) notify();
  };

  window.addEventListener(SHORTCUT_SETTINGS_EVENT, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SHORTCUT_SETTINGS_EVENT, notify);
    window.removeEventListener('storage', onStorage);
  };
}
