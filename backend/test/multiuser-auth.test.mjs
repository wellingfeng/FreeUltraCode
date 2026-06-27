import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunnerClient } from '../../packages/protocol/index.js';

function codeFromLogs(logs, email, purpose) {
  const pattern = new RegExp(`${purpose} code for ${email}: (\\d{6})`);
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const match = pattern.exec(logs[i]);
    if (match) return match[1];
  }
  return '';
}

test('multiuser email auth verifies users and isolates projects', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ugs-runner-auth-data-'));
  const workDir = await mkdtemp(join(tmpdir(), 'ugs-runner-auth-work-'));
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    originalLog(...args);
  };
  process.env.UGS_RUNNER_AUTH_MODE = 'multiuser';
  process.env.UGS_RUNNER_JWT_SECRET = 'test-jwt-secret';
  process.env.UGS_MAILER = 'console';
  process.env.UGS_RUNNER_TOKEN = 'admin-token';
  process.env.UGS_RUNNER_HOST = '127.0.0.1';
  process.env.UGS_RUNNER_PORT = '0';
  process.env.UGS_RUNNER_DATADIR = dataDir;
  process.env.UGS_RUNNER_WORKDIR = workDir;
  process.env.UGS_RUNNER_ACCOUNTS = '[]';
  const savedKeys = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_GEMINI_BASE_URL: process.env.GOOGLE_GEMINI_BASE_URL,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GEMINI_BASE_URL;
  const mod = await import(`../src/server.mjs?test=${Date.now()}`);
  await new Promise((resolve) => mod.server.once('listening', resolve));
  const { port } = mod.server.address();
  const base = `http://127.0.0.1:${port}`;
  const anon = new RunnerClient(base, '');

  try {
    const health = await anon.health();
    assert.equal(health.authMode, 'multiuser');
    await assert.rejects(() => anon.projects(), /unauthorized/);

    await anon.register({ email: 'A@Example.com', password: 'password123' });
    await assert.rejects(
      () => anon.login({ email: 'a@example.com', password: 'password123' }),
      /email is not verified/,
    );
    const verifyCode = codeFromLogs(logs, 'a@example.com', 'email_verify');
    assert.match(verifyCode, /^\d{6}$/);
    const sessionA = await anon.verifyEmail({ email: 'a@example.com', code: verifyCode });
    assert.equal(sessionA.user.email, 'a@example.com');
    // 注册时未给定用户名，后端必须自动分配一个非空账号名。
    assert.ok(
      typeof sessionA.user.displayName === 'string' &&
        sessionA.user.displayName.length > 0,
      'expected an assigned displayName',
    );
    const clientA = new RunnerClient(base, sessionA.accessToken);

    const project = await clientA.saveProject({
      label: 'A Project',
      repoUrl: 'https://example.test/a.git',
      adapter: 'codex',
    });
    assert.equal(project.userId, sessionA.user.id);
    assert.equal((await clientA.projects()).length, 1);

    await anon.register({ email: 'b@example.com', password: 'password123' });
    const codeB = codeFromLogs(logs, 'b@example.com', 'email_verify');
    const sessionB = await anon.verifyEmail({ email: 'b@example.com', code: codeB });
    const clientB = new RunnerClient(base, sessionB.accessToken);
    assert.equal((await clientB.projects()).length, 0);
    await assert.rejects(() => clientB.getProject(project.id), /not found/);

    await assert.rejects(
      () =>
        clientB.saveAccount({
          id: 'codex-main',
          label: 'Codex Main',
          adapter: 'codex',
          apiKey: 'sk-test',
        }),
      /service token required/,
    );

    const refreshed = await anon.refresh({ refreshToken: sessionA.refreshToken });
    assert.equal(refreshed.user.id, sessionA.user.id);

    await anon.forgotPassword({ email: 'a@example.com' });
    const resetCode = codeFromLogs(logs, 'a@example.com', 'password_reset');
    const reset = await anon.resetPassword({
      email: 'a@example.com',
      code: resetCode,
      password: 'newpass123',
    });
    assert.equal(reset.user.id, sessionA.user.id);
    await assert.rejects(
      () => anon.login({ email: 'a@example.com', password: 'password123' }),
      /invalid email or password/,
    );
    assert.equal(
      (await anon.login({ email: 'a@example.com', password: 'newpass123' })).user.id,
      sessionA.user.id,
    );

    await anon.logout({ refreshToken: reset.refreshToken });
    await assert.rejects(
      () => anon.refresh({ refreshToken: reset.refreshToken }),
      /invalid refresh token/,
    );
  } finally {
    await new Promise((resolve) => mod.server.close(resolve));
    await mod.store._writeChain;
    await mod.settleWorkspacePrepares();
    console.log = originalLog;
    await rm(dataDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
    delete process.env.UGS_RUNNER_AUTH_MODE;
    delete process.env.UGS_RUNNER_JWT_SECRET;
    delete process.env.UGS_MAILER;
    delete process.env.UGS_RUNNER_TOKEN;
    delete process.env.UGS_RUNNER_HOST;
    delete process.env.UGS_RUNNER_PORT;
    delete process.env.UGS_RUNNER_DATADIR;
    delete process.env.UGS_RUNNER_WORKDIR;
    delete process.env.UGS_RUNNER_ACCOUNTS;
    for (const [key, value] of Object.entries(savedKeys)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
