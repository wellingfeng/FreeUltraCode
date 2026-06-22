import { beforeEach, describe, expect, it, vi } from 'vitest';

const keychain = new Map<string, string>();

vi.mock('@/lib/tauri', () => ({
  isTauri: () => true,
  tauriAvailable: () => true,
  secureSecretGetMany: async (keys: string[]) => {
    const out: Record<string, string> = {};
    for (const key of keys) {
      const value = keychain.get(key);
      if (value) out[key] = value;
    }
    return out;
  },
  secureSecretSet: async (key: string, value: string) => {
    keychain.set(key, value);
  },
  secureSecretDelete: async (key: string) => {
    keychain.delete(key);
  },
}));

describe('remote runner secret hydration', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    keychain.clear();
    const secure = await import('@/lib/secureStorage');
    secure.resetSecureStorageForTests();
  });

  it('loads the global remote runner token after an app restart', async () => {
    const secure = await import('@/lib/secureStorage');
    const remote = await import('@/lib/remoteWorkspace');
    keychain.set(
      secure.REMOTE_RUNNER_CONNECTION_SECRET,
      JSON.stringify({ token: 'stable-runner-token' }),
    );

    secure.resetSecureStorageForTests();
    await secure.initializeSecureStorage();

    expect(remote.readRemoteRunnerConnectionSecrets().token).toBe(
      'stable-runner-token',
    );
  });

  it('loads legacy per-workspace remote tokens after an app restart', async () => {
    const secure = await import('@/lib/secureStorage');
    const remote = await import('@/lib/remoteWorkspace');
    keychain.set(
      secure.REMOTE_WORKSPACE_SECRET,
      JSON.stringify({ 'rw_1:token': 'legacy-workspace-token' }),
    );

    secure.resetSecureStorageForTests();
    await secure.initializeSecureStorage();

    expect(remote.readRemoteSecrets('rw_1').token).toBe(
      'legacy-workspace-token',
    );
  });
});
