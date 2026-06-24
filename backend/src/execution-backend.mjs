import { spawn } from 'node:child_process';

/**
 * Execution backends decide HOW an agent process is launched, decoupled from
 * WHAT is launched (the adapter invocation). This is the seam that lets the same
 * runner code path run a job as a bare child process (single-tenant / self-host)
 * or, in future, inside a per-job container (multi-tenant hard isolation).
 *
 * Tenant credential isolation (agent-env.mjs) and the workspace-boundary checks
 * live in the runner and apply regardless of backend. A backend only owns the
 * launch mechanism.
 */

/** Isolation levels a job may request. */
export const SUPPORTED_ISOLATION_LEVELS = ['process', 'container'];

export const DEFAULT_ISOLATION_LEVEL = 'process';

/**
 * Resolve the isolation level for a job. Precedence: explicit job field, then
 * the UGS_RUNNER_ISOLATION env default, then 'process'. Unknown values fall
 * back to the safe default rather than throwing, so a typo never silently
 * weakens isolation in an unexpected direction.
 */
export function resolveIsolationLevel(job = {}) {
  const candidates = [
    job.isolationLevel,
    process.env.UGS_RUNNER_ISOLATION,
    DEFAULT_ISOLATION_LEVEL,
  ];
  for (const raw of candidates) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (SUPPORTED_ISOLATION_LEVELS.includes(value)) return value;
  }
  return DEFAULT_ISOLATION_LEVEL;
}

/**
 * The bare-process backend: spawn the agent CLI directly with the prepared cwd
 * and (already tenant-scoped) environment. Isolation here is only the cwd plus
 * the default-deny env — adequate for single-tenant / trusted self-host use.
 */
export const processBackend = {
  level: 'process',
  /**
   * @param {{command:string,args:string[],cwd:string,env:Record<string,string>,windowsHide?:boolean}} opts
   * @returns {import('node:child_process').ChildProcess}
   */
  spawnChild(opts) {
    return spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: opts.windowsHide !== false,
    });
  },
};

/**
 * Host-specific environment names that must NOT be forwarded into a container:
 * the image provides its own PATH/HOME/shell/temp, and UGS_HOME points at a host
 * path that is not mounted inside the container. Everything else in the prepared
 * env (the per-job credential, model config, …) is forwarded by NAME only.
 */
const CONTAINER_ENV_SKIP = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM',
  'TMPDIR', 'TEMP', 'TMP', 'UGS_HOME',
  'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'PATHEXT',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles',
  'ProgramFiles(x86)', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
]);

/** Read container config from env, with safe multi-tenant defaults. */
export function containerConfig(env = process.env) {
  const get = (name, fallback) => {
    const v = String(env[name] ?? '').trim();
    return v || fallback;
  };
  const bool = (name, fallback) => {
    const v = String(env[name] ?? '').trim().toLowerCase();
    if (v === '') return fallback;
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  };
  return {
    runtime: get('UGS_RUNNER_CONTAINER_RUNTIME', 'docker'),
    // No safe default image exists; the operator must build/choose one.
    image: get('UGS_RUNNER_CONTAINER_IMAGE', ''),
    // Default network allows egress so the agent can reach the model API.
    // Set to "none" to fully disconnect, or pair "bridge" with an egress proxy.
    network: get('UGS_RUNNER_CONTAINER_NETWORK', 'bridge'),
    memory: get('UGS_RUNNER_CONTAINER_MEMORY', '2g'),
    cpus: get('UGS_RUNNER_CONTAINER_CPUS', '2'),
    pidsLimit: get('UGS_RUNNER_CONTAINER_PIDS', '512'),
    user: get('UGS_RUNNER_CONTAINER_USER', '1000:1000'),
    // --- Stage 4: egress control + hardening ---
    // Egress proxy the agent must route HTTP(S) through. Docker has no native
    // domain firewall, so we constrain egress by forcing traffic through a proxy
    // (HTTPS_PROXY) whose own allowlist permits only model-API hosts.
    egressProxy: get('UGS_RUNNER_CONTAINER_EGRESS_PROXY', ''),
    // Hosts/CIDRs that bypass the proxy (NO_PROXY). Comma-separated.
    noProxy: get('UGS_RUNNER_CONTAINER_NO_PROXY', ''),
    // Drop all Linux capabilities and block privilege escalation.
    hardened: bool('UGS_RUNNER_CONTAINER_HARDENED', true),
    // Read-only root filesystem; the workspace mount stays writable and a small
    // tmpfs is provided for scratch. Some agents need /tmp writable.
    readOnlyRoot: bool('UGS_RUNNER_CONTAINER_READONLY_ROOT', true),
    // Size of the writable /tmp tmpfs when readOnlyRoot is on.
    tmpfsSize: get('UGS_RUNNER_CONTAINER_TMPFS_SIZE', '256m'),
  };
}

/**
 * Build the `docker/podman run` argv for one job. Pure + deterministic so it can
 * be unit-tested without a container runtime present.
 *
 * Secrets are forwarded by NAME ONLY (`--env KEY`); their values stay in the
 * spawned client's own environment (childEnv) and never appear in argv, so they
 * cannot leak via `ps`/process listings.
 *
 * @param {{command:string,args:string[],cwd:string,env:Record<string,string>,config?:object}} opts
 * @returns {{runtime:string, runArgs:string[], childEnv:Record<string,string>}}
 */
export function buildContainerRunArgs(opts) {
  const cfg = opts.config ?? containerConfig();
  if (!cfg.image) {
    throw new Error(
      'container isolation requires a prebuilt agent image; set UGS_RUNNER_CONTAINER_IMAGE (an image with claude/codex/gemini + node/python/git installed)',
    );
  }
  if (!opts.cwd) {
    throw new Error('container isolation requires a workspace cwd to mount');
  }

  const env = opts.env ?? {};
  // Forward only non-host env names into the container, by name.
  const forwardNames = Object.keys(env).filter((name) => !CONTAINER_ENV_SKIP.has(name));
  // The client process (docker/podman) keeps the actual values in its own env.
  const childEnv = {};
  if (process.env.PATH) childEnv.PATH = process.env.PATH;
  for (const name of forwardNames) childEnv[name] = env[name];

  const runArgs = [
    'run', '--rm', '-i',
    // Reap zombies and forward signals so kill() on the client stops the agent.
    '--init',
    // Run as a non-root user inside the container.
    '--user', cfg.user,
    // Mount ONLY this job's workspace, read-write, and work there.
    '-v', `${opts.cwd}:/workspace:rw`,
    '-w', '/workspace',
    // Resource caps so one job cannot exhaust the host.
    '--memory', cfg.memory,
    '--cpus', cfg.cpus,
    '--pids-limit', cfg.pidsLimit,
    // Network mode. "none" fully disconnects; "bridge" + an egress proxy below
    // constrains egress to the model API.
    '--network', cfg.network,
  ];

  // Hardening: drop all capabilities and block privilege escalation. An agent
  // has no business gaining new privileges or using raw capabilities.
  if (cfg.hardened) {
    runArgs.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
  }

  // Read-only root filesystem with a writable workspace mount + small tmpfs
  // mounts for scratch (/tmp) and the agent's home (CLIs write config/cache
  // there). Stops an agent from tampering with the image at runtime.
  if (cfg.readOnlyRoot) {
    runArgs.push(
      '--read-only',
      '--tmpfs',
      `/tmp:rw,size=${cfg.tmpfsSize}`,
      '--tmpfs',
      `/home/agent:rw,size=${cfg.tmpfsSize}`,
    );
  }

  // Egress control. Docker has no domain firewall, so we force HTTP(S) through
  // an operator-run proxy whose allowlist permits only model-API hosts. The
  // proxy URL itself is not a secret; pass it by name and value via childEnv,
  // consistent with how credentials are forwarded.
  if (cfg.egressProxy) {
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
      runArgs.push('--env', name);
      childEnv[name] = cfg.egressProxy;
    }
    const noProxy = cfg.noProxy || 'localhost,127.0.0.1';
    for (const name of ['NO_PROXY', 'no_proxy']) {
      runArgs.push('--env', name);
      childEnv[name] = noProxy;
    }
  }

  for (const name of forwardNames) runArgs.push('--env', name);
  runArgs.push(cfg.image, opts.command, ...opts.args);
  return { runtime: cfg.runtime, runArgs, childEnv };
}

/**
 * The container backend: launch the agent inside a one-shot `docker run --rm`
 * container. The spawned client process behaves like a ChildProcess, so the
 * runner's stream/timeout/cancel handling is unchanged. Hard isolation comes
 * from the kernel (namespaces) plus the single-workspace mount and resource
 * caps, not from application-level path checks.
 */
export const containerBackend = {
  level: 'container',
  spawnChild(opts) {
    const { runtime, runArgs, childEnv } = buildContainerRunArgs({
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env,
    });
    return spawn(runtime, runArgs, {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: opts.windowsHide !== false,
    });
  },
};

/** Pick the backend implementation for a resolved isolation level. */
export function createExecutionBackend(level = DEFAULT_ISOLATION_LEVEL) {
  switch (level) {
    case 'container':
      return containerBackend;
    case 'process':
    default:
      return processBackend;
  }
}
