import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeGenerationSettingsStore,
  readSettingsRaw,
  resetGenerationSettingsStoreForTests,
  settingsProfileIdForRemoteWorkspace,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';

const REL_PATH = 'settings/imageGeneration.v1.json';
const LEGACY_KEY = 'ultragamestudio.imageGeneration.v1';

// In the vitest/jsdom environment tauriAvailable() is false, so the store
// behaves as the browser fallback: everything goes through localStorage.
describe('generationSettingsStore (browser fallback)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetGenerationSettingsStoreForTests();
  });
  afterEach(() => {
    window.localStorage.clear();
    resetGenerationSettingsStoreForTests();
  });

  it('writeSettingsRaw persists to localStorage and readSettingsRaw reads it back', () => {
    const ok = writeSettingsRaw(REL_PATH, LEGACY_KEY, '{"hello":"world"}');
    expect(ok).toBe(true);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('{"hello":"world"}');
    expect(readSettingsRaw(REL_PATH, LEGACY_KEY)).toBe('{"hello":"world"}');
  });

  it('readSettingsRaw returns null when nothing is stored', () => {
    expect(readSettingsRaw(REL_PATH, LEGACY_KEY)).toBeNull();
  });

  it('initializeGenerationSettingsStore is a no-op in the browser (reads still hit localStorage)', async () => {
    window.localStorage.setItem(LEGACY_KEY, '{"seed":1}');
    await initializeGenerationSettingsStore();
    expect(readSettingsRaw(REL_PATH, LEGACY_KEY)).toBe('{"seed":1}');
  });

  it('keeps remote profile writes separate from the local shared profile', () => {
    const profileId = settingsProfileIdForRemoteWorkspace('rw_cloud')!;

    expect(writeSettingsRaw(REL_PATH, LEGACY_KEY, '{"scope":"local"}')).toBe(true);
    expect(
      writeSettingsRaw(
        REL_PATH,
        LEGACY_KEY,
        '{"scope":"remote"}',
        { profileId },
      ),
    ).toBe(true);

    expect(readSettingsRaw(REL_PATH, LEGACY_KEY)).toBe('{"scope":"local"}');
    expect(readSettingsRaw(REL_PATH, LEGACY_KEY, { profileId })).toBe(
      '{"scope":"remote"}',
    );
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('{"scope":"local"}');
    expect(window.localStorage.getItem('ultragamestudio.settingsProfiles.v1')).toContain(
      profileId,
    );
  });

  it('writeSettingsRaw returns false when localStorage.setItem throws (quota)', () => {
    // jsdom routes setItem through Storage.prototype, so spy there.
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    try {
      const ok = writeSettingsRaw(REL_PATH, LEGACY_KEY, '{"x":1}');
      expect(ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
