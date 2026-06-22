import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const USER_SETTINGS_DIR = '.ultragamestudio';

function normalizedRelSegments(relPath) {
  const trimmed = String(relPath ?? '').trim();
  if (!trimmed) throw new Error('path is required');
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new Error('path must be relative');
  }
  const segments = [];
  for (const raw of trimmed.split(/[\\/]+/)) {
    const segment = raw.trim();
    if (!segment || segment === '.') continue;
    if (segment === '..' || segment.includes(':')) {
      throw new Error('path is invalid');
    }
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error('path is required');
  return segments;
}

function safeJoin(root, relPath) {
  return join(root, ...normalizedRelSegments(relPath));
}

function validateJsonPath(relPath) {
  if (!String(relPath ?? '').trim().endsWith('.json')) {
    throw new Error('only .json settings files are allowed');
  }
}

function validateJson(json) {
  try {
    JSON.parse(json);
  } catch (err) {
    throw new Error(`invalid JSON: ${err?.message ?? err}`);
  }
}

function timestampToken() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

export function userSettingsRoot(workdir, userId = 'default') {
  const safeUserId = String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(workdir, safeUserId, USER_SETTINGS_DIR);
}

export async function readUserSettingJson({ root, relPath }) {
  validateJsonPath(relPath);
  const path = safeJoin(root, relPath);
  try {
    const text = await readFile(path, 'utf8');
    validateJson(text);
    return text;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    if (String(err?.message ?? '').startsWith('invalid JSON:')) return null;
    throw err;
  }
}

export async function writeUserSettingJson({ root, relPath, json }) {
  validateJsonPath(relPath);
  validateJson(json);
  const path = safeJoin(root, relPath);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${timestampToken()}.tmp`;
  await writeFile(tmp, json, 'utf8');
  await rename(tmp, path);
}

export async function removeUserSetting({ root, relPath }) {
  validateJsonPath(relPath);
  const path = safeJoin(root, relPath);
  await rm(path, { force: true });
}
