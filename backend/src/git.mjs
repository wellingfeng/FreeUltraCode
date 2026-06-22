import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

/**
 * Minimal git helpers used to sync a workspace before/after an AI job.
 * Credentials are injected per-call through Git's env-backed config, never by
 * rewriting the remote URL. That keeps tokens out of `.git/config`.
 */

/** Run a command, capturing stdout/stderr. Never throws on non-zero exit. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      opts.onLog?.({ stream: 'stdout', text: d.toString() });
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      opts.onLog?.({ stream: 'stderr', text: d.toString() });
    });
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Normalize a repo URL so token auth can apply. Token-based auth is HTTPS-only,
 * but users routinely paste the SSH "scp" form (`git@github.com:owner/repo.git`)
 * that GitHub shows by default. When a token is available we rewrite that to the
 * equivalent HTTPS URL so the token actually takes effect; without a token we
 * leave SSH alone (it may rely on server-side SSH keys).
 */
export function normalizeRepoUrl(repoUrl, token) {
  if (typeof repoUrl !== 'string') return repoUrl;
  const trimmed = repoUrl.trim();
  if (!trimmed) return trimmed;
  if (!token) return trimmed;
  // scp-like syntax: [ssh://]git@host:owner/repo(.git). No double slash after host.
  const scp = /^(?:ssh:\/\/)?[^@\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  if (scp) {
    return `https://${scp[1]}/${scp[2].replace(/^\/+/, '')}`;
  }
  // ssh://git@host/owner/repo(.git) form.
  const sshProto = /^ssh:\/\/(?:[^@/\s]+@)?([^/\s]+)\/(.+)$/.exec(trimmed);
  if (sshProto) {
    return `https://${sshProto[1]}/${sshProto[2]}`;
  }
  return trimmed;
}

/** Build an authenticated clone URL without logging the token. */
export function authenticatedUrl(repoUrl, token) {
  if (!token) return repoUrl;
  try {
    const u = new URL(normalizeRepoUrl(repoUrl, token));
    if (u.protocol !== 'https:') return repoUrl;
    // GitHub/GitLab both accept token-in-username for HTTPS.
    u.username = 'x-access-token';
    u.password = token;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

/** Git env config for one HTTPS host. Token never enters command args/remotes. */
export function authEnvForUrl(repoUrl, token) {
  const env = { GIT_TERMINAL_PROMPT: '0' };
  if (!token) return env;
  try {
    const u = new URL(normalizeRepoUrl(repoUrl, token));
    if (u.protocol !== 'https:') return env;
    const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    return {
      ...env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `http.${u.origin}/.extraheader`,
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encoded}`,
    };
  } catch {
    return env;
  }
}

/** Redact any embedded credentials from a string before it leaves the server. */
export function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(https?:\/\/)[^@\s/]+@/gi, '$1***@')
    .replace(/(AUTHORIZATION:\s*)(?:basic|bearer)\s+[^\r\n]+/gi, '$1***');
}

export async function ensureClone({ repoUrl, branch, dir, token, onLog }) {
  const cloneUrl = normalizeRepoUrl(repoUrl, token);
  const args = ['clone', '--depth', '1'];
  if (branch) args.push('--branch', branch);
  args.push(cloneUrl, dir);
  const res = await run('git', args, {
    env: authEnvForUrl(cloneUrl, token),
    onLog: (l) => onLog?.({ ...l, text: redact(l.text) }),
  });
  if (res.code === 0) {
    await run('git', ['remote', 'set-url', 'origin', cloneUrl], { cwd: dir });
  }
  return {
    ok: res.code === 0,
    ...res,
    stdout: redact(res.stdout),
    stderr: redact(res.stderr),
  };
}

export async function isGitWorkspace(dir) {
  const res = await run('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: dir,
  });
  return res.code === 0 && res.stdout.trim() === 'true';
}

/**
 * Make the existing checkout's `origin` match the project's configured repo.
 * Without this, changing the repo URL in project settings has no effect — pulls
 * keep hitting whatever remote the dir was first cloned from. Compares against
 * the normalized HTTPS form so SSH<->HTTPS edits of the same repo don't churn.
 */
async function reconcileOrigin({ dir, repoUrl, token, onLog }) {
  if (!repoUrl) return;
  const desired = normalizeRepoUrl(repoUrl, token);
  const current = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir });
  const currentUrl = current.stdout.trim();
  const currentNorm = normalizeRepoUrl(currentUrl, token);
  if (currentNorm === desired) return;
  const action = current.code === 0 ? 'set-url' : 'add';
  await run('git', ['remote', action, 'origin', desired], { cwd: dir });
  onLog?.({
    phase: 'git',
    stream: 'stdout',
    text: redact(`[git] origin updated to ${desired}`),
  });
}

export async function ensureWorkspace({ repoUrl, branch, dir, token, onLog }) {
  if (!(await isGitWorkspace(dir))) {
    return ensureClone({ repoUrl, branch, dir, token, onLog });
  }

  await reconcileOrigin({ dir, repoUrl, token, onLog });

  if (branch) {
    const checkout = await run('git', ['checkout', branch], {
      cwd: dir,
      onLog: (l) => onLog?.({ ...l, text: redact(l.text) }),
    });
    if (checkout.code !== 0) {
      return {
        ok: false,
        ...checkout,
        stdout: redact(checkout.stdout),
        stderr: redact(checkout.stderr),
      };
    }
  }

  return pull({ dir, branch, token, onLog });
}

export async function pull({ dir, branch, token, onLog }) {
  const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir });
  const repoUrl = remote.stdout.trim();
  const args = ['pull', '--ff-only'];
  if (branch) args.push('origin', branch);
  const res = await run('git', args, {
    cwd: dir,
    env: authEnvForUrl(repoUrl, token),
    onLog: (l) => onLog?.({ ...l, text: redact(l.text) }),
  });
  return { ok: res.code === 0, ...res, stderr: redact(res.stderr) };
}

/** Produce a unified diff of the working tree against HEAD. */
export async function diff({ dir }) {
  const res = await run('git', ['add', '-A'], { cwd: dir });
  if (res.code !== 0) return { ok: false, patch: '', stderr: res.stderr };
  const staged = await run('git', ['diff', '--cached'], { cwd: dir });
  return { ok: staged.code === 0, patch: staged.stdout, stderr: staged.stderr };
}

/** Commit + push the current changes to a (new) branch. */
export async function commitAndPush({ dir, branch, message, token, onLog }) {
  const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir });
  const repoUrl = remote.stdout.trim();
  const steps = [
    ['checkout', '-B', branch],
    ['add', '-A'],
    ['commit', '-m', message || 'UltraGameStudio remote job'],
  ];
  for (const args of steps) {
    const res = await run('git', args, {
      cwd: dir,
      onLog: (l) => onLog?.({ ...l, text: redact(l.text) }),
    });
    // `commit` exits non-zero when there is nothing to commit; treat as soft.
    if (res.code !== 0 && args[0] !== 'commit') {
      return { ok: false, stderr: redact(res.stderr) };
    }
  }
  const push = await run(
    'git',
    ['push', '-u', 'origin', branch, '--force-with-lease'],
    {
      cwd: dir,
      env: authEnvForUrl(repoUrl, token),
      onLog: (l) => onLog?.({ ...l, text: redact(l.text) }),
    },
  );
  return { ok: push.code === 0, stderr: redact(push.stderr), branch };
}
