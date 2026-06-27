// CONTRACT: disk-backed store for small settings/config blobs (image, video,
// music, 3D, speech generation, plus the UI-design / sprite / ComfyUI / mesh
// channels, free-channel model overrides + proxy port, and the model-list
// cache). It exists to lift these settings off the browser's ~5MB localStorage
// quota: in the Tauri desktop shell they are persisted to disk under
// `.ultragamestudio/settings/*.json` via the same atomic history commands the
// session store uses, while the browser/dev build falls back to localStorage.
//
// The hard problem is that every `load*Settings()` is SYNCHRONOUS (called inside
// `useState(() => load())` initializers) but Tauri `invoke` is async. We solve it
// exactly like `secureStorage.ts`: at boot we `await` a one-time load of every
// known settings file into an in-memory cache, then serve reads synchronously and
// write back to disk asynchronously (write-behind). localStorage is always kept as
// a synchronous mirror so the cache can be rebuilt and the browser path just works.

import { tauriAvailable } from '@/lib/tauri';

export interface SettingsProfileOptions {
  /**
   * Omit for the local machine-wide profile. Remote projects use
   * `remote:<workspaceId>` so generation credentials never fall through to the
   * local profile.
   */
  profileId?: string | null;
}

export const LOCAL_SETTINGS_PROFILE_ID = 'local';
export const REMOTE_SETTINGS_PROFILE_PREFIX = 'remote:';

const REMOTE_WORKSPACE_PATH_PREFIX = 'remote://';
const SETTINGS_PROFILE_REGISTRY_REL_PATH = 'settings/profiles.v1.json';
const SETTINGS_PROFILE_REGISTRY_KEY = 'ultragamestudio.settingsProfiles.v1';

/** Every settings file managed by this store, as `(relPath, legacyLocalStorageKey)`. */
const MANAGED_SETTINGS: ReadonlyArray<readonly [relPath: string, legacyKey: string]> = [
  ['settings/imageGeneration.v1.json', 'ultragamestudio.imageGeneration.v1'],
  ['settings/videoGeneration.v1.json', 'ultragamestudio.videoGeneration.v1'],
  ['settings/musicGeneration.v1.json', 'ultragamestudio.musicGeneration.v1'],
  ['settings/threeDGeneration.v1.json', 'ultragamestudio.threeDGeneration.v1'],
  ['settings/speechGeneration.v1.json', 'ultragamestudio.speechGeneration.v1'],
  ['settings/uiDesignChannels.v1.json', 'ultragamestudio.uiDesignChannels.v1'],
  ['settings/spriteGeneration.v1.json', 'ultragamestudio.spriteGeneration.v1'],
  ['settings/comfyui.v1.json', 'ultragamestudio.comfyui.v1'],
  ['settings/meshLibrary.v1.json', 'ultragamestudio.meshLibrary.v1'],
  ['settings/freeChannelModels.v1.json', 'ugs_free_channel_models_v1'],
  ['settings/freeProxyPort.v1.json', 'ugs_free_proxy_port_v1'],
  ['settings/modelListCache.v1.json', 'ugs_model_list_cache_v1'],
  ['settings/modelListHidden.v1.json', 'ugs_model_list_hidden_v1'],
  ['settings/memoryConfig.v1.json', 'ultragamestudio.memoryConfig.v1'],
  ['settings/memoryReviewState.v1.json', 'ultragamestudio.memoryReviewState.v1'],
];

// relPath -> serialized JSON. Authoritative in-memory view once `diskReady`.
const cache = new Map<string, string>();
const profileRegistry = new Set<string>();
let diskReady = false;

function normalizeProfileId(profileId: string | null | undefined): string | null {
  const trimmed = profileId?.trim();
  if (!trimmed || trimmed === LOCAL_SETTINGS_PROFILE_ID) return null;
  return trimmed;
}

function encodeProfilePart(profileId: string): string {
  return encodeURIComponent(profileId).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function remoteWorkspaceIdForProfileId(profileId: string | null | undefined): string {
  const normalized = normalizeProfileId(profileId);
  if (!normalized?.startsWith(REMOTE_SETTINGS_PROFILE_PREFIX)) return '';
  return normalized.slice(REMOTE_SETTINGS_PROFILE_PREFIX.length);
}

function scopedRelPath(relPath: string, profileId: string | null): string {
  if (!profileId) return relPath;
  if (isRemoteSettingsProfile(profileId)) return relPath;
  const suffix = relPath.replace(/^settings[\\/]/, '');
  return `settings/profiles/${encodeProfilePart(profileId)}/${suffix}`;
}

function scopedCacheKey(relPath: string, profileId: string | null): string {
  if (!profileId) return relPath;
  if (isRemoteSettingsProfile(profileId)) return `${profileId}\0${relPath}`;
  return scopedRelPath(relPath, profileId);
}

function scopedLegacyKey(legacyKey: string, profileId: string | null): string {
  if (!profileId) return legacyKey;
  return `${legacyKey}.profile.${encodeProfilePart(profileId)}`;
}

function scopedStorage(
  relPath: string,
  legacyKey: string,
  options: SettingsProfileOptions = {},
): {
  relPath: string;
  cacheKey: string;
  legacyKey: string;
  profileId: string | null;
  remote: boolean;
} {
  const profileId = normalizeProfileId(options.profileId);
  return {
    relPath: scopedRelPath(relPath, profileId),
    cacheKey: scopedCacheKey(relPath, profileId),
    legacyKey: scopedLegacyKey(legacyKey, profileId),
    profileId,
    remote: isRemoteSettingsProfile(profileId),
  };
}

function parseProfileRegistry(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => normalizeProfileId(item))
      .filter((item): item is string => !!item);
  } catch {
    return [];
  }
}

function serializeProfileRegistry(): string {
  return JSON.stringify([...profileRegistry].sort());
}

function persistProfileRegistry(): void {
  const payload = serializeProfileRegistry();
  localSet(SETTINGS_PROFILE_REGISTRY_KEY, payload);
  diskWriteSoon(SETTINGS_PROFILE_REGISTRY_REL_PATH, payload);
}

function registerProfile(profileId: string | null): void {
  if (!profileId || profileRegistry.has(profileId)) return;
  if (isRemoteSettingsProfile(profileId) && tauriAvailable()) return;
  profileRegistry.add(profileId);
  persistProfileRegistry();
}

export function settingsProfileIdForRemoteWorkspace(workspaceId: string): string | null {
  const trimmed = workspaceId.trim();
  return trimmed ? `${REMOTE_SETTINGS_PROFILE_PREFIX}${trimmed}` : null;
}

export function settingsProfileIdForWorkspacePath(
  workspacePath: string | null | undefined,
): string | null {
  const trimmed = workspacePath?.trim();
  if (!trimmed?.startsWith(REMOTE_WORKSPACE_PATH_PREFIX)) return null;
  return settingsProfileIdForRemoteWorkspace(
    trimmed.slice(REMOTE_WORKSPACE_PATH_PREFIX.length),
  );
}

export function isRemoteSettingsProfile(profileId: string | null | undefined): boolean {
  return normalizeProfileId(profileId)?.startsWith(REMOTE_SETTINGS_PROFILE_PREFIX) ?? false;
}

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

async function remoteRunnerClientForProfile(profileId: string | null) {
  const workspaceId = remoteWorkspaceIdForProfileId(profileId);
  if (!workspaceId) return null;
  const remote = await import('@/lib/remoteWorkspace');
  const config = remote.getRemoteWorkspace(workspaceId);
  if (!config) return null;
  const connection = await remote.resolveRemoteRunnerConnectionAsync(config);
  if (!connection) return null;
  return new remote.RunnerClient(connection.serverUrl, connection.token);
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function localGet(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage may be full — non-fatal here because disk is the source of
    // truth under Tauri. The synchronous writeSettingsRaw return value already
    // tells the caller whether the durable write (disk or localStorage) landed.
  }
}

async function diskRead(
  relPath: string,
  profileId: string | null = null,
): Promise<string | null> {
  if (isRemoteSettingsProfile(profileId)) {
    try {
      const client = await remoteRunnerClientForProfile(profileId);
      return client ? await client.readUserSetting(relPath) : null;
    } catch (err) {
      console.warn('[generationSettings] remote read failed', relPath, err);
      return null;
    }
  }
  if (!tauriAvailable()) return null;
  try {
    const invoke = await getInvoke();
    return await invoke<string | null>('history_read_json', { relPath });
  } catch (err) {
    console.warn('[generationSettings] disk read failed', relPath, err);
    return null;
  }
}

function diskWriteSoon(
  relPath: string,
  json: string,
  profileId: string | null = null,
): void {
  if (isRemoteSettingsProfile(profileId)) {
    void (async () => {
      try {
        const client = await remoteRunnerClientForProfile(profileId);
        await client?.writeUserSetting(relPath, json);
      } catch (err) {
        console.error('[generationSettings] remote write failed', relPath, err);
      }
    })();
    return;
  }
  if (!tauriAvailable()) return;
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke<void>('history_write_json', { relPath, json });
    } catch (err) {
      console.error('[generationSettings] disk write failed', relPath, err);
    }
  })();
}

/**
 * Boot-time load. For each managed file: read from disk into the cache. If the
 * disk has nothing yet but a legacy localStorage value exists, migrate it to
 * disk once. Must be awaited before the first synchronous `load*Settings()`.
 */
export async function initializeGenerationSettingsStore(): Promise<void> {
  if (diskReady) return;
  if (!tauriAvailable()) {
    // Browser/dev: nothing to preload; reads/writes go straight to localStorage.
    return;
  }
  const profileRegistryRaw =
    (await diskRead(SETTINGS_PROFILE_REGISTRY_REL_PATH)) ??
    localGet(SETTINGS_PROFILE_REGISTRY_KEY);
  for (const profileId of parseProfileRegistry(profileRegistryRaw)) {
    if (!isRemoteSettingsProfile(profileId)) profileRegistry.add(profileId);
  }
  if (profileRegistryRaw != null) {
    localSet(SETTINGS_PROFILE_REGISTRY_KEY, serializeProfileRegistry());
  }
  const preloadEntries = [
    ...MANAGED_SETTINGS.map(([relPath, legacyKey]) =>
      scopedStorage(relPath, legacyKey),
    ),
    ...[...profileRegistry].flatMap((profileId) =>
      MANAGED_SETTINGS.map(([relPath, legacyKey]) =>
        scopedStorage(relPath, legacyKey, { profileId }),
      ),
    ),
  ];
  await Promise.all(
    preloadEntries.map(async (scoped) => {
      const fromDisk = await diskRead(scoped.relPath, scoped.profileId);
      if (fromDisk != null) {
        cache.set(scoped.cacheKey, fromDisk);
        // Keep the localStorage mirror in sync so the browser fallback and any
        // synchronous reader see the same value.
        localSet(scoped.legacyKey, fromDisk);
        return;
      }
      // One-time migration: seed disk from the legacy localStorage value.
      const legacy = localGet(scoped.legacyKey);
      if (legacy != null) {
        cache.set(scoped.cacheKey, legacy);
        diskWriteSoon(scoped.relPath, legacy, scoped.profileId);
      }
    }),
  );
  diskReady = true;
}

export async function preloadSettingsProfile(
  profileId: string | null | undefined,
): Promise<void> {
  const normalized = normalizeProfileId(profileId);
  if (!normalized) return;
  if (!tauriAvailable() && !isRemoteSettingsProfile(normalized)) return;
  await Promise.all(
    MANAGED_SETTINGS.map(async ([relPath, legacyKey]) => {
      const scoped = scopedStorage(relPath, legacyKey, { profileId: normalized });
      const fromDisk = await diskRead(scoped.relPath, scoped.profileId);
      if (fromDisk != null) {
        cache.set(scoped.cacheKey, fromDisk);
        localSet(scoped.legacyKey, fromDisk);
        return;
      }
      const legacy = localGet(scoped.legacyKey);
      if (legacy != null) {
        cache.set(scoped.cacheKey, legacy);
        diskWriteSoon(scoped.relPath, legacy, scoped.profileId);
      }
    }),
  );
}

/**
 * Synchronous read. Under Tauri prefer the in-memory cache (populated at boot),
 * falling back to the localStorage mirror; in the browser read localStorage.
 */
export function readSettingsRaw(
  relPath: string,
  legacyKey: string,
  options: SettingsProfileOptions = {},
): string | null {
  const scoped = scopedStorage(relPath, legacyKey, options);
  if (tauriAvailable() || scoped.remote) {
    const cached = cache.get(scoped.cacheKey);
    if (cached != null) return cached;
  }
  return localGet(scoped.legacyKey);
}

/**
 * Synchronous write. Updates the in-memory cache and the localStorage mirror, and
 * schedules an async disk write under Tauri. Returns true when the value was
 * durably accepted (cache+disk under Tauri, or localStorage in the browser),
 * false only when the sole available sink (browser localStorage) rejected it.
 */
export function writeSettingsRaw(
  relPath: string,
  legacyKey: string,
  json: string,
  options: SettingsProfileOptions = {},
): boolean {
  const scoped = scopedStorage(relPath, legacyKey, options);
  registerProfile(scoped.profileId);
  if (tauriAvailable()) {
    cache.set(scoped.cacheKey, json);
    localSet(scoped.legacyKey, json); // best-effort mirror; disk is the source of truth
    diskWriteSoon(scoped.relPath, json, scoped.profileId);
    return true;
  }
  // Browser/dev: localStorage is the only durable sink, so surface failures.
  if (!hasLocalStorage()) return false;
  try {
    window.localStorage.setItem(scoped.legacyKey, json);
    return true;
  } catch (err) {
    console.error('[generationSettings] localStorage write failed', scoped.legacyKey, err);
    return false;
  }
}

/** Test-only: reset the in-memory state between cases. */
export function resetGenerationSettingsStoreForTests(): void {
  cache.clear();
  profileRegistry.clear();
  diskReady = false;
}
