import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseAgentEnv,
  buildAgentEnv,
  isLikelySecretEnvName,
} from '../src/agent-env.mjs';

test('isLikelySecretEnvName flags credential-shaped names', () => {
  for (const name of [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'GITHUB_TOKEN',
    'DB_PASSWORD',
    'SESSION_COOKIE',
    'MY_PRIVATE_THING',
  ]) {
    assert.equal(isLikelySecretEnvName(name), true, name);
  }
  for (const name of ['PATH', 'HOME', 'LANG', 'TERM']) {
    assert.equal(isLikelySecretEnvName(name), false, name);
  }
});

test('baseAgentEnv carries only allowlisted, non-secret system vars', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    LANG: 'en_US.UTF-8',
    // secrets that must never be carried over:
    ANTHROPIC_API_KEY: 'sk-anthropic-leak',
    OPENAI_API_KEY: 'sk-openai-leak',
    OTHER_TENANT_TOKEN: 'tok-leak',
    // not on the allowlist, must be dropped even though harmless:
    RANDOM_APP_VAR: 'keep-out',
  };
  const env = baseAgentEnv(source);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/u');
  assert.equal(env.LANG, 'en_US.UTF-8');
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal('OPENAI_API_KEY' in env, false);
  assert.equal('OTHER_TENANT_TOKEN' in env, false);
  assert.equal('RANDOM_APP_VAR' in env, false);
});

test('buildAgentEnv injects only this job key and drops the rest', () => {
  const runnerEnv = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    ANTHROPIC_API_KEY: 'sk-tenant-A',
    OPENAI_API_KEY: 'sk-tenant-B',
    GEMINI_API_KEY: 'sk-tenant-C',
  };
  // The runner resolved exactly this job's key into invocation.env.
  const injected = { ANTHROPIC_API_KEY: 'sk-this-job', UGS_HOME: '/work/userA/.ugs' };
  const env = buildAgentEnv(injected, runnerEnv);
  // Base system vars survive.
  assert.equal(env.PATH, '/usr/bin');
  // The injected job key is present and is the job's, not the runner global.
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-this-job');
  assert.equal(env.UGS_HOME, '/work/userA/.ugs');
  // Other tenants' keys never leak through.
  assert.equal('OPENAI_API_KEY' in env, false);
  assert.equal('GEMINI_API_KEY' in env, false);
});

test('buildAgentEnv skips null/undefined injected values', () => {
  const env = buildAgentEnv(
    { ANTHROPIC_API_KEY: undefined, FOO: null, BAR: 'ok' },
    { PATH: '/bin' },
  );
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal('FOO' in env, false);
  assert.equal(env.BAR, 'ok');
});
