import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFICATION_PURPOSE_EMAIL,
  issueVerification,
  verifyCode,
} from '../src/verification.mjs';

function makeStore() {
  const state = new Map();
  return {
    upsertVerification(record) {
      state.set(record.id, { ...record });
      return record;
    },
    listVerifications(email, purpose) {
      return [...state.values()]
        .filter((item) => item.email === email && item.purpose === purpose)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    findLatestVerification(email, purpose) {
      return this.listVerifications(email, purpose)[0] ?? null;
    },
    consumeVerifications(email, purpose, now) {
      for (const item of this.listVerifications(email, purpose)) {
        item.consumed = true;
        item.consumedAt = now;
        item.updatedAt = now;
        state.set(item.id, item);
      }
    },
  };
}

test('verification codes are one-time and expire', () => {
  const store = makeStore();
  issueVerification(
    store,
    { userId: 'usr_1', email: 'A@Example.com', purpose: VERIFICATION_PURPOSE_EMAIL },
    { code: '123456', secret: 'secret', now: 1000, ttlMs: 5000 },
  );
  assert.equal(
    verifyCode(
      store,
      { email: 'a@example.com', purpose: VERIFICATION_PURPOSE_EMAIL, code: '123456' },
      { secret: 'secret', now: 2000 },
    ).ok,
    true,
  );
  assert.equal(
    verifyCode(
      store,
      { email: 'a@example.com', purpose: VERIFICATION_PURPOSE_EMAIL, code: '123456' },
      { secret: 'secret', now: 3000 },
    ).ok,
    false,
  );

  issueVerification(
    store,
    { userId: 'usr_1', email: 'a@example.com', purpose: VERIFICATION_PURPOSE_EMAIL },
    { code: '111111', secret: 'secret', now: 10_000, ttlMs: 1000 },
  );
  assert.equal(
    verifyCode(
      store,
      { email: 'a@example.com', purpose: VERIFICATION_PURPOSE_EMAIL, code: '111111' },
      { secret: 'secret', now: 12_000 },
    ).error,
    'code expired',
  );
});

test('verification send rate limit blocks immediate resend', () => {
  const store = makeStore();
  issueVerification(
    store,
    { userId: 'usr_1', email: 'a@example.com', purpose: VERIFICATION_PURPOSE_EMAIL },
    { code: '123456', now: 1000 },
  );
  assert.throws(
    () =>
      issueVerification(
        store,
        { userId: 'usr_1', email: 'a@example.com', purpose: VERIFICATION_PURPOSE_EMAIL },
        { code: '654321', now: 2000 },
      ),
    /recently sent/,
  );
});
