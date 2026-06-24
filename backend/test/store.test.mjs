import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonStore } from '../src/store.mjs';

test('stored account secrets are encrypted on disk and decrypted for callers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugs-runner-store-'));
  process.env.UGS_RUNNER_SECRET_KEY = 'test-secret-key';
  try {
    const store = await new JsonStore(dir).load();
    store.upsertAccount({
      id: 'codex-main',
      label: 'Codex Main',
      adapter: 'codex',
      apiKey: 'sk-test',
      baseUrl: 'https://api.test',
      enabled: true,
    });
    await store._writeChain;

    const raw = await readFile(join(dir, 'runner-state.json'), 'utf8');
    assert.equal(raw.includes('sk-test'), false);
    assert.match(raw, /enc:v1:/);

    const reloaded = await new JsonStore(dir).load();
    assert.equal(reloaded.getAccount('codex-main').apiKey, 'sk-test');
    assert.equal(reloaded.listAccounts()[0].baseUrl, 'https://api.test');
  } finally {
    delete process.env.UGS_RUNNER_SECRET_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test('stored project git tokens are encrypted on disk and decrypted for callers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugs-runner-store-'));
  process.env.UGS_RUNNER_SECRET_KEY = 'test-secret-key';
  try {
    const store = await new JsonStore(dir).load();
    store.upsertProject({
      id: 'proj_game',
      userId: 'default',
      label: 'Game',
      repoUrl: 'https://example.test/repo.git',
      branch: 'main',
      gitToken: 'git-secret',
      createdAt: 1,
      updatedAt: 2,
    });
    await store._writeChain;

    const raw = await readFile(join(dir, 'runner-state.json'), 'utf8');
    assert.equal(raw.includes('git-secret'), false);
    assert.match(raw, /enc:v1:/);

    const reloaded = await new JsonStore(dir).load();
    assert.equal(reloaded.getProject('proj_game', 'default').gitToken, 'git-secret');
    assert.equal(reloaded.listProjects('default')[0].repoUrl, 'https://example.test/repo.git');
    assert.equal(reloaded.getProject('proj_game', 'other'), null);
  } finally {
    delete process.env.UGS_RUNNER_SECRET_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test('usage ledger entries persist idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugs-runner-store-'));
  try {
    const store = await new JsonStore(dir).load();
    store.upsertLedgerEntries([
      {
        id: 'ledger_job_1_runtime',
        type: 'runtime',
        at: 100,
        jobId: 'job_1',
        runtimeMs: 60_000,
      },
      {
        id: 'ledger_job_1_runtime',
        type: 'runtime',
        at: 200,
        jobId: 'job_1',
        runtimeMs: 120_000,
      },
    ]);
    await store._writeChain;

    const reloaded = await new JsonStore(dir).load();
    const entries = reloaded.listLedgerEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].at, 200);
    assert.equal(entries[0].runtimeMs, 120_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('auth secrets are encrypted on disk and indexed by normalized email', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugs-runner-store-auth-'));
  process.env.UGS_RUNNER_SECRET_KEY = 'test-secret-key';
  try {
    const store = await new JsonStore(dir).load();
    store.upsertUser({
      id: 'usr_1',
      email: 'a@example.com',
      passwordHash: '$argon2id$secret',
      displayName: '',
      emailVerified: false,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    store.upsertVerification({
      id: 'ver_1',
      userId: 'usr_1',
      email: 'a@example.com',
      purpose: 'email_verify',
      codeHash: 'code-secret',
      expiresAt: 2,
      attempts: 0,
      consumed: false,
      createdAt: 1,
      updatedAt: 1,
    });
    store.upsertSession({
      id: 'sess_1',
      userId: 'usr_1',
      tokenHash: 'refresh-secret',
      expiresAt: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    await store._writeChain;

    const raw = await readFile(join(dir, 'runner-state.json'), 'utf8');
    assert.equal(raw.includes('$argon2id$secret'), false);
    assert.equal(raw.includes('code-secret'), false);
    assert.equal(raw.includes('refresh-secret'), false);

    const reloaded = await new JsonStore(dir).load();
    assert.equal(reloaded.findUserByEmail('a@example.com').passwordHash, '$argon2id$secret');
    assert.equal(reloaded.findLatestVerification('a@example.com', 'email_verify').codeHash, 'code-secret');
    assert.equal(reloaded.findSessionByTokenHash('refresh-secret').id, 'sess_1');
  } finally {
    delete process.env.UGS_RUNNER_SECRET_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});
