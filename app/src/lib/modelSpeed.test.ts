import { afterEach, describe, expect, it } from 'vitest';
import type { GatewaySelection } from '@/core/ir';
import {
  __resetModelSpeedForTests,
  effectiveGenerationConsensusPlan,
  effectiveRunConcurrency,
  modelSpeedProfile,
  recordModelCall,
  timeoutPolicyForSelection,
} from './modelSpeed';

afterEach(() => {
  __resetModelSpeedForTests();
  window.localStorage.clear();
});

describe('model speed policy', () => {
  it('allows opt-in multi-candidate generation for known fast tiers', () => {
    const selection: GatewaySelection = {
      adapter: 'claude-code',
      modelClass: 'haiku',
    };

    expect(modelSpeedProfile(selection).tier).toBe('fast');
    expect(effectiveGenerationConsensusPlan(5, selection)).toMatchObject({
      enabled: true,
      count: 5,
    });
    expect(effectiveRunConcurrency(4, selection)).toBe(4);
    expect(effectiveRunConcurrency(16, selection)).toBe(4);
  });

  it('disables multi-candidate generation and keeps limited runtime parallelism for slow tiers', () => {
    const selection: GatewaySelection = {
      adapter: 'claude-code',
      modelClass: 'opus',
    };

    expect(modelSpeedProfile(selection).tier).toBe('slow');
    expect(effectiveGenerationConsensusPlan(3, selection)).toMatchObject({
      enabled: false,
      count: 1,
      concurrency: 1,
    });
    expect(effectiveRunConcurrency(16, selection)).toBe(2);
    expect(effectiveRunConcurrency(1, selection)).toBe(1);

    const timeout = timeoutPolicyForSelection(selection, 'x'.repeat(12_000));
    expect(timeout.timeoutSeconds).toBeGreaterThan(1800);
    expect(timeout.idleTimeoutSeconds).toBe(0);
  });

  it('promotes a standard tier to fast after observed fast calls', () => {
    const selection: GatewaySelection = {
      adapter: 'claude-code',
      modelClass: 'sonnet',
      providerId: 'p1',
      channelId: 'c1',
    };

    expect(modelSpeedProfile(selection).tier).toBe('standard');
    expect(effectiveRunConcurrency(16, selection)).toBe(3);
    recordModelCall(selection, {
      elapsedMs: 35_000,
      firstProgressMs: 4_000,
      ok: true,
    });

    expect(modelSpeedProfile(selection).tier).toBe('fast');
    expect(effectiveRunConcurrency(16, selection)).toBe(4);
    expect(effectiveGenerationConsensusPlan(3, selection).enabled).toBe(true);
  });

  it('keeps generation consensus off when candidate count is 1', () => {
    const selection: GatewaySelection = {
      adapter: 'claude-code',
      modelClass: 'haiku',
    };

    expect(effectiveGenerationConsensusPlan(1, selection)).toMatchObject({
      enabled: false,
      count: 1,
      concurrency: 1,
    });
  });

  it('uses configured per-tier concurrency caps', () => {
    window.localStorage.setItem('ugs_run_concurrency_slow', '3');
    window.localStorage.setItem('ugs_run_concurrency_standard', '6');
    window.localStorage.setItem('ugs_run_concurrency_fast', '12');

    expect(
      effectiveRunConcurrency(16, {
        adapter: 'claude-code',
        modelClass: 'opus',
      }),
    ).toBe(3);
    expect(
      effectiveRunConcurrency(16, {
        adapter: 'claude-code',
        modelClass: 'sonnet',
      }),
    ).toBe(6);
    expect(
      effectiveRunConcurrency(16, {
        adapter: 'claude-code',
        modelClass: 'haiku',
      }),
    ).toBe(12);
    expect(
      effectiveRunConcurrency(8, {
        adapter: 'claude-code',
        modelClass: 'haiku',
      }),
    ).toBe(8);
  });

  it('marks a route slow after repeated idle timeouts', () => {
    const selection: GatewaySelection = {
      adapter: 'claude-code',
      modelClass: 'sonnet',
    };

    recordModelCall(selection, {
      elapsedMs: 300_000,
      ok: false,
      failureCode: 'idle_timeout',
      idleTimeoutSeconds: 300,
    });
    recordModelCall(selection, {
      elapsedMs: 300_000,
      ok: false,
      failureCode: 'idle_timeout',
      idleTimeoutSeconds: 300,
    });

    expect(modelSpeedProfile(selection).tier).toBe('slow');
    expect(effectiveGenerationConsensusPlan(4, selection).enabled).toBe(false);
  });
});
