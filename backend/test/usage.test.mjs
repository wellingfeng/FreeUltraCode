import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsage,
  summarizeLedger,
  usageFromText,
  usageLedgerEntriesForJob,
} from '../src/usage.mjs';

test('normalizes OpenAI/Codex-style usage', () => {
  assert.deepEqual(
    normalizeUsage({
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 20,
      total_tokens: 120,
    }),
    {
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 40,
      totalTokens: 120,
      calls: 1,
    },
  );
});

test('normalizes Anthropic-style cached usage', () => {
  assert.deepEqual(
    normalizeUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 5,
    }),
    {
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 45,
      totalTokens: 60,
      calls: 1,
    },
  );
});

test('extracts usage from jsonl text', () => {
  const usage = usageFromText(
    [
      'hello',
      '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":2}}',
      '{"response":{"usage":{"input_tokens":5,"output_tokens":1,"total_tokens":6}}}',
    ].join('\n'),
  );
  assert.equal(usage.inputTokens, 8);
  assert.equal(usage.outputTokens, 3);
  assert.equal(usage.totalTokens, 11);
  assert.equal(usage.calls, 2);
});

test('builds usage ledger entries for completed jobs', () => {
  const entries = usageLedgerEntriesForJob({
    id: 'job_1',
    status: 'done',
    createdAt: 1000,
    startedAt: 1500,
    finishedAt: 63_000,
    adapter: 'codex',
    model: 'gpt-test',
    accountId: 'codex-main',
    usage: {
      inputTokens: 8,
      outputTokens: 3,
      cachedInputTokens: 1,
      totalTokens: 11,
      calls: 2,
    },
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'runtime');
  assert.equal(entries[0].runtimeMs, 61_500);
  assert.equal(entries[1].type, 'model_tokens');
  assert.equal(entries[1].usage.calls, 2);
});

test('summarizes ledger totals by account', () => {
  const totals = summarizeLedger([
    {
      id: 'runtime',
      type: 'runtime',
      at: 10,
      jobId: 'job_1',
      accountId: 'a',
      runtimeMs: 61_000,
    },
    {
      id: 'tokens',
      type: 'model_tokens',
      at: 11,
      jobId: 'job_1',
      accountId: 'a',
      usage: {
        inputTokens: 8,
        outputTokens: 3,
        cachedInputTokens: 1,
        totalTokens: 11,
        calls: 2,
      },
    },
  ], 'a');
  assert.equal(totals.totalTokens, 11);
  assert.equal(totals.runtimeMinutes, 2);
  assert.equal(totals.jobs, 1);
  assert.equal(totals.calls, 2);
});
