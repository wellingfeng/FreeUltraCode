import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authEnvForUrl,
  authenticatedUrl,
  normalizeRepoUrl,
  redact,
} from '../src/git.mjs';

test('authenticatedUrl injects token for https', () => {
  const url = authenticatedUrl('https://github.com/me/repo.git', 'tok');
  assert.equal(url, 'https://x-access-token:tok@github.com/me/repo.git');
});

test('authenticatedUrl rewrites scp-form ssh to https when a token is supplied', () => {
  assert.equal(
    authenticatedUrl('git@github.com:me/repo.git', 'tok'),
    'https://x-access-token:tok@github.com/me/repo.git',
  );
});

test('normalizeRepoUrl leaves ssh urls alone without a token', () => {
  assert.equal(
    normalizeRepoUrl('git@github.com:me/repo.git', ''),
    'git@github.com:me/repo.git',
  );
});

test('normalizeRepoUrl rewrites ssh:// urls to https with a token', () => {
  assert.equal(
    normalizeRepoUrl('ssh://git@github.com/me/repo.git', 'tok'),
    'https://github.com/me/repo.git',
  );
});

test('redact strips embedded credentials', () => {
  assert.equal(
    redact('cloning https://x-access-token:secret@github.com/me/repo'),
    'cloning https://***@github.com/me/repo',
  );
});

test('authEnvForUrl injects auth through env-backed git config', () => {
  const env = authEnvForUrl('https://github.com/me/repo.git', 'tok');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.match(env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
  assert.equal(JSON.stringify(env).includes('tok'), false);
});

test('redact strips auth headers', () => {
  assert.equal(
    redact('AUTHORIZATION: basic abc123\nok'),
    'AUTHORIZATION: ***\nok',
  );
});
