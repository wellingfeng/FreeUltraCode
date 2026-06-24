import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ISOLATION_LEVEL,
  SUPPORTED_ISOLATION_LEVELS,
  buildContainerRunArgs,
  containerConfig,
  createExecutionBackend,
  processBackend,
  resolveIsolationLevel,
} from '../src/execution-backend.mjs';

test('resolveIsolationLevel honors an explicit job field', () => {
  assert.equal(resolveIsolationLevel({ isolationLevel: 'container' }), 'container');
  assert.equal(resolveIsolationLevel({ isolationLevel: 'process' }), 'process');
});

test('resolveIsolationLevel falls back to env then default', () => {
  delete process.env.UGS_RUNNER_ISOLATION;
  assert.equal(resolveIsolationLevel({}), DEFAULT_ISOLATION_LEVEL);
  process.env.UGS_RUNNER_ISOLATION = 'container';
  try {
    assert.equal(resolveIsolationLevel({}), 'container');
  } finally {
    delete process.env.UGS_RUNNER_ISOLATION;
  }
});

test('resolveIsolationLevel falls back safely on unknown values', () => {
  delete process.env.UGS_RUNNER_ISOLATION;
  // A typo must not silently weaken or pick an unexpected level.
  assert.equal(resolveIsolationLevel({ isolationLevel: 'sandbox' }), DEFAULT_ISOLATION_LEVEL);
  assert.equal(resolveIsolationLevel({ isolationLevel: '' }), DEFAULT_ISOLATION_LEVEL);
});

test('SUPPORTED_ISOLATION_LEVELS is the known set', () => {
  assert.deepEqual([...SUPPORTED_ISOLATION_LEVELS].sort(), ['container', 'process']);
});

test('process backend spawns a real child', async () => {
  const backend = createExecutionBackend('process');
  assert.equal(backend, processBackend);
  const child = backend.spawnChild({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '' },
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
});

test('container backend requires a prebuilt image (fails loud, no silent fallback)', () => {
  const backend = createExecutionBackend('container');
  // No UGS_RUNNER_CONTAINER_IMAGE configured => must throw, never run unboxed.
  delete process.env.UGS_RUNNER_CONTAINER_IMAGE;
  assert.throws(
    () =>
      backend.spawnChild({
        command: 'claude',
        args: ['-p'],
        cwd: '/work/userA/proj1',
        env: {},
      }),
    /requires a prebuilt agent image/,
  );
});

test('containerConfig applies safe defaults and reads overrides', () => {
  const def = containerConfig({});
  assert.equal(def.runtime, 'docker');
  assert.equal(def.image, '');
  assert.equal(def.user, '1000:1000');
  assert.equal(def.network, 'bridge');

  const custom = containerConfig({
    UGS_RUNNER_CONTAINER_RUNTIME: 'podman',
    UGS_RUNNER_CONTAINER_IMAGE: 'ugs/agent:1',
    UGS_RUNNER_CONTAINER_MEMORY: '4g',
    UGS_RUNNER_CONTAINER_CPUS: '4',
  });
  assert.equal(custom.runtime, 'podman');
  assert.equal(custom.image, 'ugs/agent:1');
  assert.equal(custom.memory, '4g');
  assert.equal(custom.cpus, '4');
});

test('buildContainerRunArgs mounts only the job workspace and runs non-root', () => {
  const { runtime, runArgs } = buildContainerRunArgs({
    command: 'codex',
    args: ['exec', '-'],
    cwd: '/work/userA/proj1',
    env: { ANTHROPIC_API_KEY: 'sk-this-job' },
    config: { ...containerConfig({}), image: 'ugs/agent:1' },
  });
  assert.equal(runtime, 'docker');
  assert.ok(runArgs.includes('--rm'));
  assert.ok(runArgs.includes('--init'));
  // Non-root user.
  const userIdx = runArgs.indexOf('--user');
  assert.equal(runArgs[userIdx + 1], '1000:1000');
  // Exactly this job's workspace is mounted at /workspace.
  const vIdx = runArgs.indexOf('-v');
  assert.equal(runArgs[vIdx + 1], '/work/userA/proj1:/workspace:rw');
  assert.equal(runArgs[runArgs.indexOf('-w') + 1], '/workspace');
  // The agent command + args come after the image, in order.
  const imgIdx = runArgs.indexOf('ugs/agent:1');
  assert.deepEqual(runArgs.slice(imgIdx), ['ugs/agent:1', 'codex', 'exec', '-']);
});

test('buildContainerRunArgs forwards secrets by NAME only, never as values in argv', () => {
  const { runArgs, childEnv } = buildContainerRunArgs({
    command: 'claude',
    args: ['-p'],
    cwd: '/work/userA/proj1',
    env: {
      ANTHROPIC_API_KEY: 'sk-secret-value',
      // Host vars must be dropped, not forwarded into the container.
      PATH: '/host/bin',
      UGS_HOME: '/host/userA/.ugs',
    },
    config: { ...containerConfig({}), image: 'ugs/agent:1' },
  });
  // The key is passed by name to the container...
  assert.ok(runArgs.includes('--env'));
  assert.ok(runArgs.includes('ANTHROPIC_API_KEY'));
  // ...but its VALUE never appears in argv (would be visible via `ps`).
  assert.equal(runArgs.includes('sk-secret-value'), false);
  // The value rides in the docker client's own env instead.
  assert.equal(childEnv.ANTHROPIC_API_KEY, 'sk-secret-value');
  // Host-specific vars are not forwarded into the container.
  assert.equal(runArgs.includes('UGS_HOME'), false);
  assert.equal('UGS_HOME' in childEnv, false);
});

test('buildContainerRunArgs hardens the container by default', () => {
  const { runArgs } = buildContainerRunArgs({
    command: 'claude',
    args: ['-p'],
    cwd: '/work/userA/proj1',
    env: {},
    config: { ...containerConfig({}), image: 'ugs/agent:1' },
  });
  // Capabilities dropped, no privilege escalation.
  const capIdx = runArgs.indexOf('--cap-drop');
  assert.equal(runArgs[capIdx + 1], 'ALL');
  assert.ok(runArgs.includes('--security-opt'));
  assert.ok(runArgs.includes('no-new-privileges'));
  // Read-only root with writable tmpfs for /tmp and the agent home.
  assert.ok(runArgs.includes('--read-only'));
  assert.ok(runArgs.some((a) => a.startsWith('/tmp:rw,size=')));
  assert.ok(runArgs.some((a) => a.startsWith('/home/agent:rw,size=')));
});

test('hardening can be disabled for trusted single-tenant hosts', () => {
  const { runArgs } = buildContainerRunArgs({
    command: 'claude',
    args: ['-p'],
    cwd: '/work/userA/proj1',
    env: {},
    config: {
      ...containerConfig({}),
      image: 'ugs/agent:1',
      hardened: false,
      readOnlyRoot: false,
    },
  });
  assert.equal(runArgs.includes('--cap-drop'), false);
  assert.equal(runArgs.includes('--read-only'), false);
});

test('egress proxy is injected by name so all agent traffic is constrained', () => {
  const { runArgs, childEnv } = buildContainerRunArgs({
    command: 'claude',
    args: ['-p'],
    cwd: '/work/userA/proj1',
    env: { ANTHROPIC_API_KEY: 'sk-x' },
    config: {
      ...containerConfig({}),
      image: 'ugs/agent:1',
      egressProxy: 'http://egress-proxy:3128',
      noProxy: 'localhost,127.0.0.1,model.local',
    },
  });
  // Proxy vars are passed to the container by name...
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
    assert.ok(runArgs.includes(name), name);
  }
  // ...with the proxy URL carried via childEnv (not a secret, but consistent).
  assert.equal(childEnv.HTTPS_PROXY, 'http://egress-proxy:3128');
  assert.equal(childEnv.NO_PROXY, 'localhost,127.0.0.1,model.local');
});

test('no egress proxy vars when none is configured', () => {
  const { runArgs, childEnv } = buildContainerRunArgs({
    command: 'claude',
    args: ['-p'],
    cwd: '/work/userA/proj1',
    env: {},
    config: { ...containerConfig({}), image: 'ugs/agent:1' },
  });
  assert.equal(runArgs.includes('HTTPS_PROXY'), false);
  assert.equal('HTTPS_PROXY' in childEnv, false);
});

test('containerConfig reads stage-4 egress + hardening overrides', () => {
  const cfg = containerConfig({
    UGS_RUNNER_CONTAINER_EGRESS_PROXY: 'http://p:3128',
    UGS_RUNNER_CONTAINER_NO_PROXY: 'a,b',
    UGS_RUNNER_CONTAINER_HARDENED: 'false',
    UGS_RUNNER_CONTAINER_READONLY_ROOT: 'no',
    UGS_RUNNER_CONTAINER_NETWORK: 'none',
  });
  assert.equal(cfg.egressProxy, 'http://p:3128');
  assert.equal(cfg.noProxy, 'a,b');
  assert.equal(cfg.hardened, false);
  assert.equal(cfg.readOnlyRoot, false);
  assert.equal(cfg.network, 'none');
  // Hardening defaults on.
  assert.equal(containerConfig({}).hardened, true);
  assert.equal(containerConfig({}).readOnlyRoot, true);
});
