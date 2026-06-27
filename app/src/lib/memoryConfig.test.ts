import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MEMORY_CONFIG,
  getLastReviewAt,
  loadMemoryConfig,
  saveMemoryConfig,
  setLastReviewAt,
} from './memoryConfig';
import { getMemoryLimits } from './memoryStore';
import { resetGenerationSettingsStoreForTests } from './generationSettingsStore';

beforeEach(() => {
  window.localStorage.clear();
  resetGenerationSettingsStoreForTests();
});

describe('memoryConfig', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadMemoryConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
  });

  it('round-trips a saved config', () => {
    saveMemoryConfig({ ...DEFAULT_MEMORY_CONFIG, reviewEnabled: true, memoryCharLimit: 3000 });
    const loaded = loadMemoryConfig();
    expect(loaded.reviewEnabled).toBe(true);
    expect(loaded.memoryCharLimit).toBe(3000);
  });

  it('clamps out-of-range values', () => {
    saveMemoryConfig({ ...DEFAULT_MEMORY_CONFIG, memoryCharLimit: 5, reviewMinMessages: 9999 });
    const loaded = loadMemoryConfig();
    expect(loaded.memoryCharLimit).toBe(200);
    expect(loaded.reviewMinMessages).toBe(100);
  });

  it('syncs char limits into memoryStore on load', () => {
    saveMemoryConfig({ ...DEFAULT_MEMORY_CONFIG, memoryCharLimit: 1500, userCharLimit: 900 });
    loadMemoryConfig();
    expect(getMemoryLimits()).toEqual({ memory: 1500, user: 900 });
  });
});

describe('review timestamp', () => {
  it('defaults to 0 and records per workspace', () => {
    expect(getLastReviewAt('ws-a')).toBe(0);
    setLastReviewAt('ws-a', 12345);
    expect(getLastReviewAt('ws-a')).toBe(12345);
    expect(getLastReviewAt('ws-b')).toBe(0);
  });
});
