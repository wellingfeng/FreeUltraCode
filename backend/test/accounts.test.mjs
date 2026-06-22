import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountRegistry, loadAccountsFromEnv } from '../src/accounts.mjs';

test('loads configured accounts from JSON env', () => {
  const accounts = loadAccountsFromEnv({
    UGS_RUNNER_ACCOUNTS: JSON.stringify([
      {
        id: 'main',
        label: 'Main',
        adapter: 'claude',
        model: 'sonnet',
        models: ['sonnet', 'opus', 'sonnet'],
        apiKey: 'sk-test',
        monthlyTokenLimit: 1000,
      },
    ]),
  });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, 'main');
  assert.equal(accounts[0].adapter, 'claude');
  assert.deepEqual(accounts[0].models, ['sonnet', 'opus']);
});

test('picks lowest-usage matching account', () => {
  const registry = new AccountRegistry([
    { id: 'a', label: 'A', adapter: 'codex', enabled: true },
    { id: 'b', label: 'B', adapter: 'codex', enabled: true },
  ]);
  const account = registry.resolveForJob(
    { adapter: 'codex' },
    [{ accountId: 'a', usage: { totalTokens: 100, calls: 1 } }],
  );
  assert.equal(account.id, 'b');
});
