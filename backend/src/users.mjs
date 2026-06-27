import { randomUUID } from 'node:crypto';

export const USER_STATUS_ACTIVE = 'active';

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  if (email.length > 254) return '';
  return email;
}

// Derive a friendly display name when the client doesn't supply one. We keep the
// sanitized email local-part and append a short random suffix so every account
// gets an assigned username, distinct from other users that share a local-part.
export function assignDisplayName(email) {
  const local = String(email ?? '')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 24);
  const base = local.length >= 2 ? local : 'user';
  return `${base}_${randomUUID().slice(0, 4)}`;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? '',
    emailVerified: user.emailVerified === true,
    status: user.status ?? USER_STATUS_ACTIVE,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function createUser(store, input) {
  const email = normalizeEmail(input?.email);
  if (!email) throw new Error('invalid email');
  if (store.findUserByEmail(email)) throw new Error('email already exists');
  const now = Date.now();
  const user = {
    id: `usr_${randomUUID().slice(0, 12)}`,
    email,
    passwordHash: String(input?.passwordHash ?? ''),
    displayName:
      typeof input?.displayName === 'string' && input.displayName.trim()
        ? input.displayName.trim().slice(0, 80)
        : assignDisplayName(email),
    emailVerified: input?.emailVerified === true,
    status: USER_STATUS_ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  if (!user.passwordHash) throw new Error('password hash is required');
  store.upsertUser(user);
  return user;
}

export function findUserByEmail(store, email) {
  const normalized = normalizeEmail(email);
  return normalized ? store.findUserByEmail(normalized) : null;
}

export function findUserById(store, id) {
  const userId = String(id ?? '').trim();
  return userId ? store.getUser(userId) : null;
}

export function setEmailVerified(store, userId, verified = true) {
  const user = findUserById(store, userId);
  if (!user) return null;
  user.emailVerified = verified === true;
  user.updatedAt = Date.now();
  return store.upsertUser(user);
}

export function updatePassword(store, userId, passwordHash) {
  const user = findUserById(store, userId);
  if (!user) return null;
  user.passwordHash = String(passwordHash ?? '');
  user.updatedAt = Date.now();
  return store.upsertUser(user);
}
