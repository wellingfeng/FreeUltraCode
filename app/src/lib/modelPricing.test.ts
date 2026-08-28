import { describe, expect, it } from 'vitest';
import {
  buildPricingEntry,
  formatUsd,
  lookupInEntries,
  normalizeModelId,
  type PricingEntry,
} from '@/lib/modelPricing';

describe('normalizeModelId', () => {
  it('strips vendor prefix and normalizes separators', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4.5')).toBe(
      'claude-sonnet-4-5',
    );
    expect(normalizeModelId('openai/gpt-4o:2024-08-06')).toBe(
      'gpt-4o-2024-08-06',
    );
    expect(normalizeModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
    expect(normalizeModelId('  DeepSeek Chat  ')).toBe('deepseek-chat');
  });
});

describe('buildPricingEntry', () => {
  it('converts per-token USD to per-1M-token USD', () => {
    const entry = buildPricingEntry({
      id: 'anthropic/claude-sonnet-4.5',
      pricing: { prompt: '0.000003', completion: '0.000015' },
    });
    expect(entry).toEqual({
      id: 'claude-sonnet-4-5',
      inputUsd: 3,
      outputUsd: 15,
    });
  });

  it('handles numeric pricing and free models', () => {
    expect(
      buildPricingEntry({
        id: 'free/model',
        pricing: { prompt: 0, completion: '0' },
      }),
    ).toEqual({ id: 'model', inputUsd: 0, outputUsd: 0 });
  });

  it('skips models without pricing', () => {
    expect(buildPricingEntry({ id: 'x/y', pricing: null })).toBeNull();
    expect(buildPricingEntry({ id: 'x/y' })).toBeNull();
    expect(
      buildPricingEntry({ id: 'x/y', pricing: { prompt: '0.1' } }),
    ).toBeNull();
  });
});

describe('lookupInEntries', () => {
  const entries: PricingEntry[] = [
    { id: 'claude-sonnet-4-5', inputUsd: 3, outputUsd: 15 },
    { id: 'gpt-4o', inputUsd: 2.5, outputUsd: 10 },
    { id: 'gpt-4o-2024-08-06', inputUsd: 2.5, outputUsd: 10 },
    { id: 'deepseek-chat', inputUsd: 0.28, outputUsd: 1.1 },
  ];

  it('exact matches', () => {
    expect(lookupInEntries(entries, 'claude-sonnet-4.5')).toEqual({
      inputUsd: 3,
      outputUsd: 15,
    });
    expect(lookupInEntries(entries, 'deepseek-chat')).toEqual({
      inputUsd: 0.28,
      outputUsd: 1.1,
    });
  });

  it('substring matches with version suffixes', () => {
    expect(lookupInEntries(entries, 'gpt-4o')).toEqual({
      inputUsd: 2.5,
      outputUsd: 10,
    });
    expect(lookupInEntries(entries, 'gpt-4o-2024-08-06')).toEqual({
      inputUsd: 2.5,
      outputUsd: 10,
    });
  });

  it('returns null for empty or unknown models', () => {
    expect(lookupInEntries(entries, '')).toBeNull();
    expect(lookupInEntries(entries, null)).toBeNull();
    expect(lookupInEntries(entries, undefined)).toBeNull();
    expect(lookupInEntries(entries, 'totally-unknown-model')).toBeNull();
  });
});

describe('formatUsd', () => {
  it('strips trailing zeros and keeps two decimals otherwise', () => {
    expect(formatUsd(15)).toBe('15');
    expect(formatUsd(3)).toBe('3');
    expect(formatUsd(4.4)).toBe('4.4');
    expect(formatUsd(0.28)).toBe('0.28');
  });
});
