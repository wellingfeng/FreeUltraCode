import {
  isTauri,
  secureSecretDelete,
  secureSecretGetMany,
  secureSecretSet,
} from '@/lib/tauri';

export const PROVIDER_API_KEYS_SECRET = 'providers.apiKeys.v1';
export const GATEWAY_CHANNEL_API_KEYS_SECRET = 'gateway.channelApiKeys.v1';
export const FREE_CHANNEL_API_KEYS_SECRET = 'freeChannels.apiKeys.v1';
export const FREE_PROXY_TOKEN_SECRET = 'freeProxy.token.v1';
export const REMOTE_WORKSPACE_SECRET = 'remoteWorkspaces.secrets.v1';
export const REMOTE_RUNNER_CONNECTION_SECRET = 'remoteRunner.connection.v1';

const SECRET_NAMES = [
  PROVIDER_API_KEYS_SECRET,
  GATEWAY_CHANNEL_API_KEYS_SECRET,
  FREE_CHANNEL_API_KEYS_SECRET,
  FREE_PROXY_TOKEN_SECRET,
  REMOTE_WORKSPACE_SECRET,
  REMOTE_RUNNER_CONNECTION_SECRET,
];

const PROVIDERS_STORAGE = 'ugs_providers';
const ACTIVE_PROVIDER_STORAGE = 'ugs_active_provider_id';
const API_KEY_STORAGE = 'ugs_anthropic_key';
const BASE_URL_STORAGE = 'ugs_anthropic_base_url';
const GATEWAY_CONFIG_STORAGE = 'ugs_model_gateway_v1';
const FREE_CHANNEL_KEYS_STORAGE = 'ugs_free_channel_keys_v1';
const FREE_PROXY_TOKEN_STORAGE = 'ugs_free_proxy_token_v1';
const LEGACY_FREE_CHANNEL_KEYS_STORAGE = [
  'owf_free_channel_keys_v1',
  'ultragamestudio.free_channel_keys_v1',
  'ultragamestudio.freeChannels.keys',
];

const memorySecrets = new Map<string, string>();
let initialized = false;
let secureReady = false;

export function secureStorageAvailable(): boolean {
  return secureReady;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function rawGet(key: string): string | null {
  try {
    if (!hasWindow()) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key: string, value: string): void {
  try {
    if (!hasWindow()) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function rawRemove(key: string): void {
  try {
    if (!hasWindow()) return;
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function parseStoredRecord(key: string): Record<string, string> {
  return parseStringRecord(parseJsonObject(rawGet(key)));
}

function parseSecretRecord(secretName: string): Record<string, string> {
  return parseStringRecord(parseJsonObject(memorySecrets.get(secretName) ?? null));
}

function serializeRecord(record: Record<string, string>): string {
  const clean: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    const value = raw.trim();
    if (value) clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : '';
}

function cacheSecret(secretName: string, value: string): void {
  if (value) memorySecrets.set(secretName, value);
  else memorySecrets.delete(secretName);
}

async function persistSecretNow(secretName: string, value: string): Promise<void> {
  cacheSecret(secretName, value);
  if (!secureStorageAvailable()) return;
  if (value) await secureSecretSet(secretName, value);
  else await secureSecretDelete(secretName);
}

function persistSecretSoon(secretName: string, value: string): void {
  cacheSecret(secretName, value);
  if (!secureStorageAvailable()) return;
  const task = value
    ? secureSecretSet(secretName, value)
    : secureSecretDelete(secretName);
  void task.catch((err) => {
    console.warn('[secureStorage] failed to persist secret', secretName, err);
  });
}

export function readSecureRecord(secretName: string): Record<string, string> {
  return parseSecretRecord(secretName);
}

export function readSecureRecordValue(secretName: string, key: string): string {
  return readSecureRecord(secretName)[key] ?? '';
}

export function writeSecureRecord(
  secretName: string,
  record: Record<string, string>,
): boolean {
  const next = serializeRecord(record);
  const prev = memorySecrets.get(secretName) ?? '';
  if (next === prev) return false;
  persistSecretSoon(secretName, next);
  return true;
}

export function setSecureRecordValue(
  secretName: string,
  key: string,
  value: string,
): boolean {
  const record = readSecureRecord(secretName);
  const trimmed = value.trim();
  if (trimmed) record[key] = trimmed;
  else delete record[key];
  return writeSecureRecord(secretName, record);
}

export function readSecureSecret(secretName: string): string {
  return memorySecrets.get(secretName) ?? '';
}

export function writeSecureSecret(secretName: string, value: string): boolean {
  const next = value.trim();
  const prev = memorySecrets.get(secretName) ?? '';
  if (next === prev) return false;
  persistSecretSoon(secretName, next);
  return true;
}

export function gatewayChannelSecretKey(
  providerId: string,
  channelId: string,
): string {
  return JSON.stringify([providerId, channelId]);
}

function genProviderId(): string {
  try {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stripProviderSecrets(
  providerKeys: Record<string, string>,
): { value: string | null; changed: boolean } {
  const raw = rawGet(PROVIDERS_STORAGE);
  if (raw === null) {
    const legacyKey = (rawGet(API_KEY_STORAGE) ?? '').trim();
    if (!legacyKey) return { value: null, changed: false };
    const id = genProviderId();
    providerKeys[id] = legacyKey;
    const provider = {
      id,
      kind: 'anthropic',
      name: 'Claude',
      baseUrl: (rawGet(BASE_URL_STORAGE) ?? '').trim(),
    };
    rawSet(ACTIVE_PROVIDER_STORAGE, id);
    return { value: JSON.stringify([provider]), changed: true };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { value: null, changed: false };
    let changed = false;
    const sanitized = parsed.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return item;
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : '';
      if (id && apiKey) providerKeys[id] = apiKey;
      if ('apiKey' in record) {
        changed = true;
        const rest = { ...record };
        delete rest.apiKey;
        return rest;
      }
      return item;
    });
    return { value: changed ? JSON.stringify(sanitized) : null, changed };
  } catch {
    return { value: null, changed: false };
  }
}

function stripGatewaySecrets(
  gatewayKeys: Record<string, string>,
): { value: string | null; changed: boolean } {
  const raw = parseJsonObject(rawGet(GATEWAY_CONFIG_STORAGE));
  if (!raw || !Array.isArray(raw.providers)) return { value: null, changed: false };
  let changed = false;
  const providers = raw.providers.map((provider) => {
    if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
      return provider;
    }
    const providerRecord = provider as Record<string, unknown>;
    const providerId = typeof providerRecord.id === 'string' ? providerRecord.id : '';
    if (!Array.isArray(providerRecord.channels)) return provider;
    const channels = providerRecord.channels.map((channel) => {
      if (typeof channel !== 'object' || channel === null || Array.isArray(channel)) {
        return channel;
      }
      const channelRecord = channel as Record<string, unknown>;
      const channelId =
        typeof channelRecord.id === 'string' && channelRecord.id
          ? channelRecord.id
          : 'default';
      const apiKey =
        typeof channelRecord.apiKey === 'string' ? channelRecord.apiKey.trim() : '';
      if (providerId && apiKey) {
        gatewayKeys[gatewayChannelSecretKey(providerId, channelId)] = apiKey;
      }
      if ('apiKey' in channelRecord) {
        changed = true;
        const rest = { ...channelRecord };
        delete rest.apiKey;
        return rest;
      }
      return channel;
    });
    return { ...providerRecord, channels };
  });
  return {
    value: changed ? JSON.stringify({ ...raw, providers }) : null,
    changed,
  };
}

function collectFreeChannelKeys(): {
  record: Record<string, string>;
  keysToRemove: string[];
} {
  const record = parseStoredRecord(FREE_CHANNEL_KEYS_STORAGE);
  const keysToRemove = [FREE_CHANNEL_KEYS_STORAGE];
  for (const legacyKey of LEGACY_FREE_CHANNEL_KEYS_STORAGE) {
    const legacy = parseStoredRecord(legacyKey);
    for (const [id, value] of Object.entries(legacy)) {
      if (!record[id]) record[id] = value;
    }
    keysToRemove.push(legacyKey);
  }
  return { record, keysToRemove };
}

async function migrateLocalStorageSecrets(): Promise<void> {
  const providerKeys = readSecureRecord(PROVIDER_API_KEYS_SECRET);
  const gatewayKeys = readSecureRecord(GATEWAY_CHANNEL_API_KEYS_SECRET);
  const freeChannelKeys = readSecureRecord(FREE_CHANNEL_API_KEYS_SECRET);
  const providerStorage = stripProviderSecrets(providerKeys);
  const gatewayStorage = stripGatewaySecrets(gatewayKeys);
  const freeKeys = collectFreeChannelKeys();
  for (const [id, value] of Object.entries(freeKeys.record)) {
    if (value) freeChannelKeys[id] = value;
  }
  const proxyToken = (rawGet(FREE_PROXY_TOKEN_STORAGE) ?? '').trim();

  await persistSecretNow(PROVIDER_API_KEYS_SECRET, serializeRecord(providerKeys));
  await persistSecretNow(
    GATEWAY_CHANNEL_API_KEYS_SECRET,
    serializeRecord(gatewayKeys),
  );
  await persistSecretNow(
    FREE_CHANNEL_API_KEYS_SECRET,
    serializeRecord(freeChannelKeys),
  );
  if (proxyToken) await persistSecretNow(FREE_PROXY_TOKEN_SECRET, proxyToken);

  if (providerStorage.value !== null) rawSet(PROVIDERS_STORAGE, providerStorage.value);
  if (gatewayStorage.value !== null) {
    rawSet(GATEWAY_CONFIG_STORAGE, gatewayStorage.value);
  }
  for (const key of freeKeys.keysToRemove) rawRemove(key);
  rawRemove(API_KEY_STORAGE);
  rawRemove(FREE_PROXY_TOKEN_STORAGE);
}

export async function initializeSecureStorage(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!isTauri()) return;
  try {
    const loaded = await secureSecretGetMany(SECRET_NAMES);
    for (const [key, value] of Object.entries(loaded)) cacheSecret(key, value);
    secureReady = true;
    await migrateLocalStorageSecrets();
  } catch (err) {
    secureReady = false;
    console.warn('[secureStorage] initialization failed; keeping localStorage fallback', err);
  }
}

export function resetSecureStorageForTests(): void {
  memorySecrets.clear();
  initialized = false;
  secureReady = false;
}
