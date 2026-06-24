import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from './users.mjs';

export const VERIFICATION_PURPOSE_EMAIL = 'email_verify';
export const VERIFICATION_PURPOSE_PASSWORD_RESET = 'password_reset';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RESEND_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

export function normalizePurpose(value) {
  const purpose = String(value ?? '').trim();
  if (
    purpose === VERIFICATION_PURPOSE_EMAIL ||
    purpose === VERIFICATION_PURPOSE_PASSWORD_RESET
  ) {
    return purpose;
  }
  return '';
}

export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashVerificationCode(email, purpose, code, secret = '') {
  const input = [
    normalizeEmail(email),
    normalizePurpose(purpose),
    String(code ?? '').trim(),
    String(secret ?? ''),
  ].join(':');
  return createHash('sha256').update(input).digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function issueVerification(store, input, opts = {}) {
  const email = normalizeEmail(input?.email);
  const purpose = normalizePurpose(input?.purpose);
  const userId = String(input?.userId ?? '').trim();
  if (!email) throw new Error('invalid email');
  if (!purpose) throw new Error('invalid verification purpose');
  if (!userId) throw new Error('user id is required');

  const now = opts.now ?? Date.now();
  const last = store.findLatestVerification(email, purpose);
  const resendMs = opts.resendMs ?? DEFAULT_RESEND_MS;
  if (last && !last.consumed && now - (last.lastSentAt ?? last.createdAt ?? 0) < resendMs) {
    const retryAfterMs = resendMs - (now - (last.lastSentAt ?? last.createdAt ?? 0));
    const err = new Error('verification code recently sent');
    err.code = 'rate_limited';
    err.retryAfterMs = retryAfterMs;
    throw err;
  }

  store.consumeVerifications(email, purpose, now);
  const code = opts.code ?? generateCode();
  const record = {
    id: `ver_${randomUUID().slice(0, 12)}`,
    userId,
    email,
    purpose,
    codeHash: hashVerificationCode(email, purpose, code, opts.secret),
    expiresAt: now + (opts.ttlMs ?? DEFAULT_TTL_MS),
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    lastSentAt: now,
    consumed: false,
    createdAt: now,
    updatedAt: now,
  };
  store.upsertVerification(record);
  return { record, code };
}

export function verifyCode(store, input, opts = {}) {
  const email = normalizeEmail(input?.email);
  const purpose = normalizePurpose(input?.purpose);
  const code = String(input?.code ?? '').trim();
  if (!email || !purpose || !/^\d{6}$/.test(code)) return { ok: false, error: 'invalid code' };
  const record = store.findLatestVerification(email, purpose);
  const now = opts.now ?? Date.now();
  if (!record || record.consumed) return { ok: false, error: 'invalid code' };
  if (record.expiresAt <= now) return { ok: false, error: 'code expired' };
  if ((record.attempts ?? 0) >= (record.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
    return { ok: false, error: 'too many attempts' };
  }
  const expected = hashVerificationCode(email, purpose, code, opts.secret);
  if (!safeEqual(record.codeHash, expected)) {
    record.attempts = (record.attempts ?? 0) + 1;
    record.updatedAt = now;
    store.upsertVerification(record);
    return { ok: false, error: 'invalid code' };
  }
  record.consumed = true;
  record.consumedAt = now;
  record.updatedAt = now;
  store.upsertVerification(record);
  return { ok: true, record };
}
