import { describe, expect, it } from 'vitest';

import {
  REVIEW_SYSTEM,
  buildReviewTranscript,
  buildReviewUserPrompt,
  shouldRunReview,
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

  it('user prompt wraps the transcript', () => {
    expect(buildReviewUserPrompt('T')).toContain('T');
  });
});
