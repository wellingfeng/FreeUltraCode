import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secureSecretGetMany: vi.fn(async () => ({} as Record<string, string>)),
  secureSecretSet: vi.fn<(key: string, value: string) => Promise<void>>(),
  secureSecretDelete: vi.fn(async () => undefined),
}));

vi.mock('@/lib/tauri', () => ({
  isTauri: () => true,
  secureSecretGetMany: mocks.secureSecretGetMany,
  secureSecretSet: mocks.secureSecretSet,
  secureSecretDelete: mocks.secureSecretDelete,
}));

describe('secure storage persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.secureSecretSet.mockResolvedValue(undefined);
    const secure = await import('@/lib/secureStorage');
    secure.resetSecureStorageForTests();
    await secure.initializeSecureStorage();
  });

  it('serializes rapid writes to the same key so the newest value wins', async () => {
    const secure = await import('@/lib/secureStorage');
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.secureSecretSet
      .mockImplementationOnce(async () => firstGate)
      .mockResolvedValueOnce(undefined);

    secure.writeSecureSecret('rapid.secret', 'first');
    secure.writeSecureSecret('rapid.secret', 'second');
    secure.writeSecureSecret('rapid.secret', 'third');

    await vi.waitFor(() => expect(mocks.secureSecretSet).toHaveBeenCalledTimes(1));
    releaseFirst();
    await secure.flushSecureStorage();

    expect(mocks.secureSecretSet.mock.calls).toEqual([
      ['rapid.secret', 'first'],
      ['rapid.secret', 'third'],
    ]);
  });

  it('surfaces a durable write failure from flushSecureStorage', async () => {
    const secure = await import('@/lib/secureStorage');
    mocks.secureSecretSet.mockRejectedValueOnce(new Error('credential too large'));

    secure.writeSecureSecret('failed.secret', 'value');

    await expect(secure.flushSecureStorage()).rejects.toThrow(
      '安全存储写入失败 (failed.secret)',
    );
  });
});
