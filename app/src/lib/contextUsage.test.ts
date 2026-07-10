import { describe, expect, it } from 'vitest';
import {
  SIMPLE_CHAT_CONTEXT_MESSAGE_LIMIT,
  contextLimitForModel,
  estimateContextUsage,
  estimateTokenCount,
} from './contextUsage';
import type { Message } from '@/store/types';

function message(id: number, text: string): Message {
  return {
    id: `m_${id}`,
    role: id % 2 === 0 ? 'assistant' : 'user',
    text,
    createdAt: id,
  };
}

describe('context usage estimates', () => {
  it('uses explicit model context suffixes before adapter defaults', () => {
    expect(contextLimitForModel('claude-code', 'custom-128k')).toBe(128_000);
    expect(contextLimitForModel('claude-code', 'custom-1m')).toBe(1_000_000);
    expect(contextLimitForModel('gemini', 'default')).toBe(1_000_000);
  });

  it('estimates mixed Chinese and ASCII text as non-zero tokens', () => {
    expect(estimateTokenCount('修复 login flow and tests')).toBeGreaterThan(0);
  });

  it('bounds simple-chat history to the prompt tail', () => {
    const messages = Array.from(
      { length: SIMPLE_CHAT_CONTEXT_MESSAGE_LIMIT + 5 },
      (_, index) => message(index + 1, `第 ${index + 1} 轮：` + '内容 '.repeat(80)),
    );

    const simple = estimateContextUsage({
      messages,
      draft: '继续',
      adapter: 'claude-code',
      model: 'sonnet',
      simpleChatMode: true,
    });
    const unbounded = estimateContextUsage({
      messages,
      draft: '继续',
      adapter: 'claude-code',
      model: 'sonnet',
      simpleChatMode: false,
    });

    expect(simple.usedTokens).toBeLessThan(unbounded.usedTokens);
    expect(simple.displayPercent).toMatch(/%/);
  });

  it('uses green below 60, yellow through 80, and red above 80 percent', () => {
    const base = {
      messages: [],
      adapter: 'claude-code' as const,
      simpleChatMode: true,
    };

    expect(
      estimateContextUsage({
        ...base,
        draft: 'a'.repeat(400),
        model: 'custom-2k',
      }).tone,
    ).toBe('ok');
    expect(
      estimateContextUsage({
        ...base,
        draft: 'a'.repeat(1981),
        model: 'custom-2k',
      }).tone,
    ).toBe('warn');
    expect(
      estimateContextUsage({
        ...base,
        draft: 'a'.repeat(375),
        model: 'custom-1k',
      }).tone,
    ).toBe('warn');
    expect(
      estimateContextUsage({
        ...base,
        draft: 'a'.repeat(379),
        model: 'custom-1k',
      }).tone,
    ).toBe('danger');
  });

  it('shows over-window context as 100%+ instead of raw overflow percent', () => {
    const estimate = estimateContextUsage({
      messages: [],
      draft: 'a'.repeat(10000),
      adapter: 'claude-code',
      model: 'custom-1k',
      simpleChatMode: true,
    });

    expect(estimate.percent).toBeGreaterThan(100);
    expect(estimate.displayPercent).toBe('100%+');
  });
});
