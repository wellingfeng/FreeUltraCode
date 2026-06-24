import {
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { extractBearer } from './auth.mjs';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseJsonBase64Url(value) {
  try {
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function sign(input, secret) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function makeJwtSecret(configured) {
  const value = String(configured ?? '').trim();
  return value || '';
}

export function signAccessToken(user, secret, opts = {}) {
  if (!secret) throw new Error('jwt secret is required');
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  const expiresSeconds = Math.floor((opts.expiresAt ?? Date.now() + ACCESS_TTL_MS) / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    email: user.email,
    typ: 'access',
    iat: nowSeconds,
    exp: expiresSeconds,
  };
  const body = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  return `${body}.${sign(body, secret)}`;
}

export function verifyAccessToken(token, secret, opts = {}) {
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [headerRaw, payloadRaw, sig] = parts;
  const header = parseJsonBase64Url(headerRaw);
  const payload = parseJsonBase64Url(payloadRaw);
  if (!header || header.alg !== 'HS256' || !payload || payload.typ !== 'access') return null;
  const expected = sign(`${headerRaw}.${payloadRaw}`, secret);
  if (!safeEqual(sig, expected)) return null;
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return payload;
}

export function issueSession(store, user, opts = {}) {
  const now = opts.now ?? Date.now();
  const refreshToken = randomBytes(32).toString('base64url');
  const session = {
    id: `sess_${randomUUID().slice(0, 12)}`,
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: now + (opts.refreshTtlMs ?? REFRESH_TTL_MS),
    device: typeof opts.device === 'string' ? opts.device.slice(0, 200) : '',
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  store.upsertSession(session);
  return {
    accessToken: signAccessToken(user, opts.jwtSecret, {
      now,
      expiresAt: now + (opts.accessTtlMs ?? ACCESS_TTL_MS),
    }),
    refreshToken,
    session,
  };
}

export function refreshSession(store, refreshToken, opts = {}) {
  const session = store.findSessionByTokenHash(hashToken(refreshToken));
  if (!session || session.revokedAt || session.expiresAt <= (opts.now ?? Date.now())) {
    return null;
  }
  const user = store.getUser(session.userId);
  if (!user || user.status !== 'active') return null;
  return {
    accessToken: signAccessToken(user, opts.jwtSecret, {
      now: opts.now,
      expiresAt: (opts.now ?? Date.now()) + (opts.accessTtlMs ?? ACCESS_TTL_MS),
    }),
    refreshToken,
    session,
    user,
  };
}

export function revokeSession(store, refreshToken) {
  const session = store.findSessionByTokenHash(hashToken(refreshToken));
  if (!session) return false;
  session.revokedAt = Date.now();
  session.updatedAt = session.revokedAt;
  store.upsertSession(session);
  return true;
}

export function authenticateJwtHeader(store, headerValue, secret) {
  const token = extractBearer(headerValue);
  const payload = verifyAccessToken(token, secret);
  if (!payload) return null;
  const user = store.getUser(payload.sub);
  if (!user || user.status !== 'active') return null;
  return { user, payload };
}
