import { describe, expect, it } from 'vitest';

import {
  REVIEW_SYSTEM,
  buildReviewTranscript,
  buildReviewUserPrompt,
  formatReviewMemoryContext,
  shouldRunReview,
  buildConsolidateFeedback,
  buildConsolidateRetryPrompt,
  MAX_CONSOLIDATE_RETRIES,
  type ReviewGateConfig,
} from './memoryReview';

const cfg = (over: Partial<ReviewGateConfig> = {}): ReviewGateConfig => ({
  reviewEnabled: true,
  reviewMinMessages: 4,
  reviewMinIntervalMinutes: 30,
  ...over,
});

describe('shouldRunReview', () => {
  it('is false when disabled', () => {
    expect(shouldRunReview(cfg({ reviewEnabled: false }), 0, 100)).toBe(false);
  });

  it('is false below the message threshold', () => {
    expect(shouldRunReview(cfg(), 0, 3)).toBe(false);
  });

  it('is false within the rate-limit window', () => {
    const now = 1_000_000;
    const last = now - 10 * 60_000; // 10 min ago, interval is 30
    expect(shouldRunReview(cfg(), last, 10, now)).toBe(false);
  });

  it('is true when all gates pass', () => {
    const now = 1_000_000;
    const last = now - 31 * 60_000;
    expect(shouldRunReview(cfg(), last, 10, now)).toBe(true);
  });

  it('ignores rate limit when interval is 0', () => {
    expect(shouldRunReview(cfg({ reviewMinIntervalMinutes: 0 }), Date.now(), 10)).toBe(true);
  });
});

describe('buildReviewTranscript', () => {
  it('formats roles and skips empties', () => {
    const out = buildReviewTranscript([
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '' },
      { role: 'assistant', text: '在' },
    ]);
    expect(out).toContain('用户：你好');
    expect(out).toContain('助手：在');
  });

  it('truncates to the tail when over the cap', () => {
    const big = 'x'.repeat(10000);
    const out = buildReviewTranscript([{ role: 'user', text: big }], 500);
    expect(out.length).toBeLessThan(700);
    expect(out).toContain('已截断');
  });
});

describe('prompts', () => {
  it('review system includes the do-not-record rules and sentinel', () => {
    expect(REVIEW_SYSTEM).toContain('记忆审阅员');
    expect(REVIEW_SYSTEM).toContain('不要写');
    expect(REVIEW_SYSTEM).toContain('<<UGS_MEMORY>>');
  });

  it('review system teaches consolidation, not just add', () => {
    expect(REVIEW_SYSTEM).toContain('replace');
    expect(REVIEW_SYSTEM).toContain('remove');
    expect(REVIEW_SYSTEM).toContain('腾出空间');
  });

  it('user prompt wraps the transcript', () => {
    expect(buildReviewUserPrompt('T')).toContain('T');
  });

  it('user prompt injects the current-store snapshot when provided', () => {
    const out = buildReviewUserPrompt('T', ['【当前记忆库快照】用户画像：…']);
    expect(out).toContain('【当前记忆库快照】用户画像');
    expect(out).toContain('T');
  });

  it('user prompt omits the snapshot section when none given', () => {
    const out = buildReviewUserPrompt('T');
    expect(out).not.toContain('当前记忆库快照');
  });
});

describe('formatReviewMemoryContext', () => {
  it('returns empty for an empty store', () => {
    expect(formatReviewMemoryContext({ label: 'x', entries: [], used: 0, limit: 10 })).toBe('');
  });

  it('lists entries with usage and a consolidate hint', () => {
    const out = formatReviewMemoryContext({
      label: '助手笔记（本项目）',
      entries: ['引擎 Unity', '目录 Assets'],
      used: 20,
      limit: 100,
    });
    expect(out).toContain('助手笔记（本项目）');
    expect(out).toContain('- 引擎 Unity');
    expect(out).toContain('- 目录 Assets');
    expect(out).toContain('20/100');
    expect(out).toContain('replace');
  });

  it('flags an over-limit store', () => {
    const out = formatReviewMemoryContext({
      label: 'x',
      entries: ['a'],
      used: 120,
      limit: 100,
    });
    expect(out).toContain('已超上限');
  });

  it('flags a near-limit store', () => {
    const out = formatReviewMemoryContext({
      label: 'x',
      entries: ['a'],
      used: 90,
      limit: 100,
    });
    expect(out).toContain('接近上限');
  });
});

describe('consolidate retry prompts', () => {
  it('caps retries at Hermes-like 3', () => {
    expect(MAX_CONSOLIDATE_RETRIES).toBe(3);
  });

  it('feedback echoes the rejection reason and current entries', () => {
    const out = buildConsolidateFeedback({
      target: 'user',
      error: 'Result would be 1500/1375 chars — over the limit.',
      entries: ['偏好 Unity', '常用引擎'],
      used: 1500,
      limit: 1375,
    });
    expect(out).toContain('用户画像（全局）');
    expect(out).toContain('1500/1375');
    expect(out).toContain('- 偏好 Unity');
    expect(out).toContain('- 常用引擎');
    expect(out).toContain('remove');
    expect(out).toContain('replace');
  });

  it('labels the memory store distinctly from the user store', () => {
    const out = buildConsolidateFeedback({
      target: 'memory',
      error: 'x',
      entries: ['a'],
      used: 1,
      limit: 10,
    });
    expect(out).toContain('助手笔记（本项目）');
  });

  it('retry prompt keeps the transcript and appends the feedback', () => {
    const out = buildConsolidateRetryPrompt('TRANSCRIPT', ['【上一轮写入被拒】…']);
    expect(out).toContain('TRANSCRIPT');
    expect(out).toContain('【上一轮写入被拒】');
  });

  it('retry prompt tolerates an empty feedback list', () => {
    const out = buildConsolidateRetryPrompt('TRANSCRIPT', []);
    expect(out).toContain('TRANSCRIPT');
  });
});
