const STORAGE_KEY = 'ultragamestudio.manifestMode.v1';
const CHANGE_EVENT = 'ultragamestudio:manifest-mode-changed';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function getManifestModeEnabled(): boolean {
  if (!hasStorage()) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setManifestModeEnabled(enabled: boolean): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { enabled } }));
  } catch {
    // localStorage writes are best-effort settings persistence.
  }
}

export function subscribeManifestMode(
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => listener(getManifestModeEnabled());
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

