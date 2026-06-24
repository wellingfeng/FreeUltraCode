import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, validatePassword, verifyPassword } from '../src/password.mjs';

test('passwords hash with argon2id and verify', async () => {
  const hash = await hashPassword('password123');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'password123'), true);
  assert.equal(await verifyPassword(hash, 'wrongpass123'), false);
});

test('password validation rejects short values', async () => {
  assert.equal(validatePassword('short'), 'password must be at least 8 characters');
  await assert.rejects(() => hashPassword('short'), /at least 8 characters/);
});
