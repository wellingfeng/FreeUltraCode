import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonStore } from '../src/store.mjs';
import { JobRunner } from '../src/runner.mjs';

async function makeRunner(opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ugs-runner-data-'));
  const workdir = await mkdtemp(join(tmpdir(), 'ugs-runner-work-'));
  const store = await new JsonStore(dataDir).load();
  const runner = new JobRunner({
    store,
    workdir,
    maxConcurrency: opts.maxConcurrency ?? 1,
    jobTimeoutMs: 60_000,
    execAllowlist: opts.execAllowlist ?? [],
  });
  return { runner, store, dataDir, workdir };
}

async function cleanup(ctx) {
  await ctx.store._writeChain;
  await Promise.all([
    rm(ctx.dataDir, { recursive: true, force: true }),
    rm(ctx.workdir, { recursive: true, force: true }),
  ]);
}

function waitForStatus(runner, id, statuses) {
  const allowed = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  const current = runner.store.getJob(id)?.status;
  if (allowed.has(current)) return Promise.resolve(current);
  return new Promise((resolve) => {
    const onStatus = (status) => {
      if (!allowed.has(status)) return;
      runner.off(`status:${id}`, onStatus);
      resolve(status);
    };
    runner.on(`status:${id}`, onStatus);
  });
}

test('exec allowlist blocks unapproved adapter command', async () => {
  const ctx = await makeRunner({ execAllowlist: ['not-claude'] });
  try {
    const job = ctx.runner.enqueue({ prompt: 'hi', adapter: 'claude' });
    const status = await waitForStatus(ctx.runner, job.id, 'error');
    const stored = ctx.store.getJob(job.id);
    assert.equal(status, 'error');
    assert.equal(stored.error, 'command not allowed: claude');
    assert.equal(JSON.stringify(stored).includes('_apiKey'), false);
  } finally {
    await cleanup(ctx);
  }
});

test('cancel marks a queued job as canceled', async () => {
  const ctx = await makeRunner();
  try {
    const job = ctx.runner.enqueue({ prompt: 'hi', adapter: 'claude' });
    assert.equal(ctx.runner.cancel(job.id), true);
    const stored = ctx.store.getJob(job.id);
    assert.equal(stored.status, 'canceled');
    assert.equal(stored.error, 'canceled');
  } finally {
    await cleanup(ctx);
  }
});

test('completed jobs write runtime and token ledger entries', async () => {
  const ctx = await makeRunner();
  try {
    ctx.runner._spawn = async () => ({
      code: 0,
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        cachedInputTokens: 0,
        totalTokens: 7,
        calls: 1,
      },
    });
    const job = ctx.runner.enqueue({ prompt: 'hi', adapter: 'claude' });
    await waitForStatus(ctx.runner, job.id, 'done');
    const stored = ctx.store.getJob(job.id);
    const entries = ctx.store.listLedgerEntries();
    assert.equal(stored.status, 'done');
    assert.equal(stored.usage.totalTokens, 7);
    assert.equal(entries.length, 2);
    assert.ok(entries.some((entry) => entry.type === 'runtime'));
    assert.ok(entries.some((entry) => entry.type === 'model_tokens'));
  } finally {
    await cleanup(ctx);
  }
});

test('project job with a non-sandboxing adapter is rejected under process isolation', async () => {
  const ctx = await makeRunner();
  try {
    ctx.store.upsertProject({
      id: 'proj_claude',
      userId: 'default',
      label: 'Game',
      repoUrl: null,
      branch: 'main',
      adapter: 'claude',
      model: null,
      createdAt: 1,
      updatedAt: 2,
    });
    let spawned = false;
    ctx.runner._spawn = async () => {
      spawned = true;
      return { code: 0, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, calls: 0 } };
    };
    const job = ctx.runner.enqueue({
      projectId: 'proj_claude',
      prompt: 'hi',
      adapter: 'claude',
      isolationLevel: 'process',
    });
    await waitForStatus(ctx.runner, job.id, 'error');
    const stored = ctx.store.getJob(job.id);
    assert.equal(stored.error, 'adapter does not enforce workspace boundary: claude');
    assert.equal(spawned, false);
  } finally {
    await cleanup(ctx);
  }
});

test('container isolation satisfies the workspace boundary for a non-sandboxing adapter', async () => {
  const ctx = await makeRunner();
  try {
    ctx.store.upsertProject({
      id: 'proj_claude_c',
      userId: 'default',
      label: 'Game',
      repoUrl: null,
      branch: 'main',
      adapter: 'claude',
      model: null,
      isolationLevel: 'container',
      createdAt: 1,
      updatedAt: 2,
    });
    let spawned = false;
    ctx.runner._spawn = async () => {
      spawned = true;
      return { code: 0, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, calls: 0 } };
    };
    const job = ctx.runner.enqueue({
      projectId: 'proj_claude_c',
      prompt: 'hi',
      adapter: 'claude',
      isolationLevel: 'container',
    });
    await waitForStatus(ctx.runner, job.id, 'done');
    const stored = ctx.store.getJob(job.id);
    assert.equal(stored.status, 'done');
    assert.equal(stored.isolationLevel, 'container');
    assert.equal(spawned, true);
  } finally {
    await cleanup(ctx);
  }
});

test('project jobs use server-owned project workspace directory', async () => {  const ctx = await makeRunner();
  try {
    ctx.store.upsertProject({
      id: 'proj_game',
      userId: 'default',
      label: 'Game',
      repoUrl: null,
      branch: 'main',
      adapter: 'codex',
      model: 'gpt-test',
      createdAt: 1,
      updatedAt: 2,
    });
    let cwd = '';
    ctx.runner._spawn = async (_job, _command, _args, opts) => {
      cwd = opts.cwd;
      return {
        code: 0,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, calls: 0 },
      };
    };
    const job = ctx.runner.enqueue({
      projectId: 'proj_game',
      prompt: 'hi',
      adapter: 'codex',
    });
    await waitForStatus(ctx.runner, job.id, 'done');
    const stored = ctx.store.getJob(job.id);
    assert.equal(stored.projectId, 'proj_game');
    assert.equal(stored.userId, 'default');
    assert.equal(stored.branch, 'main');
    assert.equal(stored.model, 'gpt-test');
    assert.equal(cwd, join(ctx.workdir, 'default', 'proj_game'));
  } finally {
    await cleanup(ctx);
  }
});

test('enqueue rejects jobs for projects outside current user', async () => {
  const ctx = await makeRunner();
  try {
    ctx.store.upsertProject({
      id: 'proj_game',
      userId: 'user_a',
      label: 'Game',
      repoUrl: null,
      createdAt: 1,
      updatedAt: 2,
    });
    assert.throws(
      () => ctx.runner.enqueue({ userId: 'user_b', projectId: 'proj_game', prompt: 'hi' }),
      /project not found/,
    );
  } finally {
    await cleanup(ctx);
  }
});

test('non-zero exits persist error before terminal status', async () => {
  const ctx = await makeRunner();
  try {
    ctx.runner._spawn = async () => ({
      code: 42,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, calls: 0 },
    });
    const job = ctx.runner.enqueue({ prompt: 'hi', adapter: 'claude' });
    await waitForStatus(ctx.runner, job.id, 'error');
    const stored = ctx.store.getJob(job.id);
    assert.equal(stored.error, 'agent exited with code 42');
  } finally {
    await cleanup(ctx);
  }
});

test('spawn writes prompt to stdin and closes it', async () => {
  const ctx = await makeRunner();
  try {
    const job = ctx.store.upsertJob({
      id: 'job_stdin',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      repoUrl: null,
      branch: null,
      adapter: 'codex',
      model: null,
      prompt: 'hello stdin',
      pushBranch: null,
      logs: [],
      result: null,
      error: null,
    });
    const script =
      'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(s));';
    const result = await Promise.race([
      ctx.runner._spawn(job, process.execPath, ['-e', script], {
        cwd: ctx.workdir,
        env: {},
        input: 'hello stdin',
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('stdin was not closed')), 2000),
      ),
    ]);
    assert.equal(result.code, 0);
    assert.ok(job.logs.some((line) => line.stream === 'stdout' && line.text === 'hello stdin'));
  } finally {
    await cleanup(ctx);
  }
});

test('spawn extracts structured assistant messages from CLI JSONL', async () => {
  const ctx = await makeRunner();
  try {
    const job = ctx.store.upsertJob({
      id: 'job_messages',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      repoUrl: null,
      branch: null,
      adapter: 'codex',
      model: null,
      prompt: 'hello',
      pushBranch: null,
      logs: [],
      messages: [],
      result: null,
      error: null,
    });
    const script = [
      'const event={type:"item.completed",item:{type:"agent_message",text:"远程消息"}};',
      'process.stdout.write(JSON.stringify(event));',
    ].join('');
    const result = await ctx.runner._spawn(job, process.execPath, ['-e', script], {
      cwd: ctx.workdir,
      env: {},
      input: 'hello',
    });
    assert.equal(result.code, 0);
    assert.equal(job.messages.length, 1);
    assert.equal(job.messages[0].role, 'assistant');
    assert.equal(job.messages[0].kind, 'delta');
    assert.equal(job.messages[0].text, '远程消息');
  } finally {
    await cleanup(ctx);
  }
});

test('toolSubject never surfaces free-form text/content snippets', async () => {
  const { toolSubject, remoteMessagesFromJsonEvent } = await import('../src/runner.mjs');
  // A codex tool item carrying the source it is editing must NOT leak that
  // source into the live chat stream — only a short subject (path/command).
  const item = {
    type: 'file_edit',
    file_path: 'app/src/store/useStore.ts',
    text: 'const a = `${phase}${stream}${text}`; // leaked source body',
    status: 'completed',
  };
  const subject = toolSubject(item);
  assert.equal(subject, 'app/src/store/useStore.ts');
  assert.ok(!subject.includes('${phase}'));

  const messages = remoteMessagesFromJsonEvent({ type: 'item.completed', item });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'tool');
  assert.ok(!String(messages[0].text).includes('${phase}'));
  assert.ok(String(messages[0].text).includes('app/src/store/useStore.ts'));
});
