import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function safeWorkspaceSegment(value, label = 'workspace segment') {
  const text = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

export function projectWorkspaceDir(workdir, project) {
  return workspaceChildDir(
    workdir,
    safeWorkspaceSegment(project?.userId || 'default', 'user id'),
    safeWorkspaceSegment(project?.id, 'project id'),
  );
}

export function jobWorkspaceDir(workdir, jobId) {
  return workspaceChildDir(workdir, safeWorkspaceSegment(jobId, 'job id'));
}

export function workspaceChildDir(workdir, ...segments) {
  const root = resolve(workdir);
  const target = resolve(root, ...segments);
  if (!isPathInside(root, target)) {
    throw new Error('workspace path escapes runner workdir');
  }
  return target;
}

export async function assertWorkspaceBoundary(workdir, targetDir, opts = {}) {
  const root = resolve(workdir);
  await mkdir(root, { recursive: true });
  if (opts.create) await mkdir(targetDir, { recursive: true });

  const [rootReal, targetReal] = await Promise.all([
    realpath(root),
    realpath(targetDir),
  ]);
  if (!isPathInside(rootReal, targetReal)) {
    throw new Error('workspace path escapes runner workdir');
  }

  const info = await lstat(targetDir);
  if (info.isSymbolicLink()) {
    throw new Error('workspace path must not be a symbolic link');
  }

  return { root: rootReal, target: targetReal };
}
