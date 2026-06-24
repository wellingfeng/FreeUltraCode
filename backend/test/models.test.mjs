import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInvocation, supportedAdapters } from '../src/models.mjs';

test('supportedAdapters lists the known CLIs', () => {
  assert.deepEqual(supportedAdapters().sort(), ['claude', 'codex', 'gemini']);
});

test('client-supplied key overrides server env', () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  const inv = resolveInvocation({
    adapter: 'claude',
    prompt: 'do it',
    apiKey: 'client-key',
  });
  assert.equal(inv.env.ANTHROPIC_API_KEY, 'client-key');
  assert.equal(inv.missingKey, false);
  assert.deepEqual(inv.args, ['-p', '--output-format', 'stream-json', '--verbose']);
  delete process.env.ANTHROPIC_API_KEY;
});

test('falls back to server env when client omits a key', () => {
  process.env.OPENAI_API_KEY = 'srv';
  delete process.env.UGS_RUNNER_CODEX_SANDBOX;
  const inv = resolveInvocation({ adapter: 'codex', prompt: 'hi', model: 'gpt' });
  assert.equal(inv.env.OPENAI_API_KEY, 'srv');
  // Default codex runs inside its workspace sandbox (safe for multi-tenant).
  assert.deepEqual(inv.args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-c',
    'approval_policy="never"',
    '--sandbox',
    'workspace-write',
    '--model',
    'gpt',
    '-',
  ]);
  // Sandbox active => codex enforces a workspace boundary.
  assert.equal(inv.enforcesWorkspaceBoundary, true);
  delete process.env.OPENAI_API_KEY;
});

test('codex bypass mode disables sandbox and drops the boundary claim', () => {
  process.env.OPENAI_API_KEY = 'srv';
  process.env.UGS_RUNNER_CODEX_SANDBOX = 'bypass';
  try {
    const inv = resolveInvocation({ adapter: 'codex', prompt: 'hi', model: 'gpt' });
    assert.deepEqual(inv.args, [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'gpt',
      '-',
    ]);
    // No sandbox => no honest boundary; the runner's project gate must refuse it.
    assert.equal(inv.enforcesWorkspaceBoundary, false);
  } finally {
    delete process.env.UGS_RUNNER_CODEX_SANDBOX;
    delete process.env.OPENAI_API_KEY;
  }
});

test('account key is used between client key and server env', () => {
  process.env.OPENAI_API_KEY = 'server-key';
  const inv = resolveInvocation({
    adapter: 'codex',
    prompt: 'hi',
    accountApiKey: 'account-key',
  });
  assert.equal(inv.env.OPENAI_API_KEY, 'account-key');
  delete process.env.OPENAI_API_KEY;
});

test('missingKey true when neither client nor server provide a key', () => {
  delete process.env.GEMINI_API_KEY;
  const inv = resolveInvocation({ adapter: 'gemini', prompt: 'x' });
  assert.equal(inv.missingKey, true);
});

test('gemini invocation reads prompt from stdin', () => {
  const inv = resolveInvocation({ adapter: 'gemini', prompt: 'x', model: 'gemini-test' });
  assert.deepEqual(inv.args, [
    '--prompt',
    '',
    '--output-format',
    'stream-json',
    '--model',
    'gemini-test',
  ]);
});
