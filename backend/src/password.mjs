import argon2 from '@node-rs/argon2';

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;

export function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH) return 'password must be at least 8 characters';
  if (value.length > PASSWORD_MAX_LENGTH) return 'password is too long';
  return '';
}

export async function hashPassword(password) {
  const error = validatePassword(password);
  if (error) throw new Error(error);
  return argon2.hash(String(password), {
    algorithm: argon2.Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(passwordHash, password) {
  if (!passwordHash || typeof passwordHash !== 'string') return false;
  const passwordError = validatePassword(password);
  if (passwordError) return false;
  try {
    return await argon2.verify(passwordHash, String(password));
  } catch {
    return false;
  }
}
