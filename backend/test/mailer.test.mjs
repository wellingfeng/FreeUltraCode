import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMailer } from '../src/mailer.mjs';

test('console mailer logs verification codes without external network', async () => {
  const lines = [];
  const mailer = makeMailer({ UGS_MAILER: 'console' }, { log: (line) => lines.push(line) });
  await mailer.sendVerificationCode('a@example.com', '123456');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /email_verify code for a@example\.com: 123456/);
});
