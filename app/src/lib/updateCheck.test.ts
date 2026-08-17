import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_VERSION,
  checkForUpdate,
  fetchVersionManifest,
  isNewerVersion,
} from '@/lib/updateCheck';

// openExternal pulls in the Tauri bridge; stub it so importing the module under
// test never touches the desktop IPC layer.
vi.mock('@/lib/tauri', () => ({
  openExternal: vi.fn(async () => {}),
}));

function mockFetchOnce(body: string, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      text: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isNewerVersion', () => {
  it('flags any difference as newer', () => {
    expect(isNewerVersion('0.1.0', '0.1.0-rc.6')).toBe(true);
    expect(isNewerVersion('3.7.7', '3.7.7-13')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true);
    expect(isNewerVersion('0.38.2', '0.49.0')).toBe(true);
    expect(isNewerVersion('2.1.197', '2.1.202')).toBe(true);
  });

  it('ignores leading v and whitespace', () => {
    expect(isNewerVersion('v1.2.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('  1.2.0  ', '1.2.0')).toBe(false);
  });

  it('returns false for identical strings', () => {
    expect(isNewerVersion('0.1.2', '0.1.2')).toBe(false);
    expect(isNewerVersion('0.142.5', '0.142.5')).toBe(false);
  });
});

describe('fetchVersionManifest', () => {
  it('parses a well-formed manifest', async () => {
    mockFetchOnce(
      JSON.stringify({ version: '9.9.9', url: 'https://example/setup.exe' }),
    );
    const m = await fetchVersionManifest();
    expect(m.version).toBe('9.9.9');
    expect(m.url).toBe('https://example/setup.exe');
  });

  it('rejects a malformed manifest', async () => {
    mockFetchOnce(JSON.stringify({ nope: true }));
    await expect(fetchVersionManifest()).rejects.toThrow();
  });

  it('rejects on non-2xx responses', async () => {
    mockFetchOnce('', false, 404);
    await expect(fetchVersionManifest()).rejects.toThrow();
  });
});

describe('checkForUpdate', () => {
  it('flags an update when the manifest is newer than APP_VERSION', async () => {
    mockFetchOnce(
      JSON.stringify({ version: '999.0.0', url: 'https://example/x.exe' }),
    );
    const status = await checkForUpdate();
    expect(status.updateAvailable).toBe(true);
    expect(status.latest).toBe('999.0.0');
    expect(status.error).toBeUndefined();
  });

  it('reports no update when the manifest matches APP_VERSION', async () => {
    mockFetchOnce(
      JSON.stringify({ version: APP_VERSION, url: 'https://example/x.exe' }),
    );
    const status = await checkForUpdate();
    expect(status.updateAvailable).toBe(false);
  });

  it('never throws and surfaces network failures via error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const status = await checkForUpdate();
    expect(status.updateAvailable).toBe(false);
    expect(status.error).toBeDefined();
    expect(status.manifest).toBeNull();
  });
});
