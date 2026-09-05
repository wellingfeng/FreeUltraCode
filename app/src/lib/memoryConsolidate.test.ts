import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runConsolidatingReview } from './memoryConsolidate';
import {
  DIGEST_SYSTEM,
  joinDigestAndTail,
  splitTranscriptForDigest,
} from '@/core/memoryReview';
import { applyMemoryOp, loadMemory } from './memoryStore';

beforeEach(async () => {
  window.localStorage.clear();
});

const longMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: `第${i}条：这是一段足够长的对话内容，用来撑爆转录预算的 filler-${i}-${'x'.repeat(200)}`,
  }));

describe('memoryConsolidate approvalMode queue (M2)', () => {
  it('stages proposals into the pending queue instead of the store', async () => {
    const invokeModel = vi
      .fn()
      .mockResolvedValue(
        '<<UGS_MEMORY>>\n{"target":"user","operations":[{"action":"add","content":"待审批的事实"}]}\n<<UGS_MEMORY_END>>',
      );
    const out = await runConsolidatingReview({
      invokeModel,
      transcript: '用户：x\n助手：y',
      approvalMode: 'queue',
      source: 'review',
    });
    expect(out.queuedOps).toBe(1);
    expect(out.appliedOps).toBe(0); // staged, not applied
    expect(await loadMemory('user')).toHaveLength(0); // NOT applied
    const { listPendingMemoryWrites, resolvePendingMemoryWrites } = await import(
      './memoryPending'
    );
    const pending = await listPendingMemoryWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].source).toBe('review');
    await resolvePendingMemoryWrites([pending[0].id], 'reject');
  });

  it('still applies directly in the default mode', async () => {
    const invokeModel = vi
      .fn()
      .mockResolvedValue(
        '<<UGS_MEMORY>>\n{"target":"user","operations":[{"action":"add","content":"直写事实"}]}\n<<UGS_MEMORY_END>>',
      );
    const out = await runConsolidatingReview({
      invokeModel,
      transcript: '用户：x',
    });
    expect(out.queuedOps).toBe(0);
    expect(out.appliedOps).toBe(1);
    expect((await loadMemory('user')).map((e) => e.text)).toContain('直写事实');
  });
});

describe('memoryConsolidate digest replay (M3)', () => {
  it('compresses the overflow head and prepends the digest', async () => {
    const digestText = '事实A；事实B';
    const invokeModel = vi
      .fn()
      .mockImplementation(async (system: string) => {
        if (system === DIGEST_SYSTEM) return digestText;
        return '无'; // review sees digest+tail, finds nothing new
      });
    await runConsolidatingReview({
      invokeModel,
      transcript: '',
      messages: longMessages(40),
      summarize: invokeModel,
    });
    const reviewCall = invokeModel.mock.calls.find((c) => c[0] !== DIGEST_SYSTEM)!;
    expect(reviewCall[1]).toContain('（较早对话摘要）');
    expect(reviewCall[1]).toContain(digestText);
    expect(reviewCall[1]).toContain('（近期对话原文）');
  });

  it('falls back to the plain transcript when digest fails', async () => {
    const invokeModel = vi
      .fn()
      .mockImplementation(async (system: string) => {
        if (system === DIGEST_SYSTEM) throw new Error('digest model down');
        return '无';
      });
    await runConsolidatingReview({
      invokeModel,
      transcript: 'fallback-transcript',
      messages: longMessages(40),
      summarize: invokeModel,
    });
    const reviewCall = invokeModel.mock.calls.find((c) => c[0] !== DIGEST_SYSTEM)!;
    expect(reviewCall[1]).toContain('fallback-transcript');
  });
});

describe('memoryReview splitTranscriptForDigest', () => {
  it('returns null under budget', () => {
    expect(splitTranscriptForDigest([{ role: 'user', text: 'hi' }], 6000)).toBeNull();
  });

  it('splits overflow into head + tail', () => {
    const msgs = longMessages(30);
    const parts = splitTranscriptForDigest(msgs, 2000);
    expect(parts).not.toBeNull();
    expect(parts!.overflow.length + parts!.tail.length).toBeLessThanOrEqual(
      parts!.overflow.length + 2000,
    );
    const joined = joinDigestAndTail('摘要内容', parts!.tail);
    expect(joined).toContain('摘要内容');
    expect(joined).toContain(parts!.tail);
  });
});

describe('memoryStore frozen snapshot regression (M4/P6)', () => {
  it('same freezeKey renders identically twice without writes', async () => {
    const { renderFrozenMemorySnapshot, resetFrozenMemorySnapshot } = await import(
      './memoryStore'
    );
    resetFrozenMemorySnapshot();
    await applyMemoryOp('user', { action: 'add', content: '稳定条目' });
    const a = await renderFrozenMemorySnapshot(undefined, 'k');
    const b = await renderFrozenMemorySnapshot(undefined, 'k');
    expect(a).toBe(b);
    resetFrozenMemorySnapshot();
  });
});
