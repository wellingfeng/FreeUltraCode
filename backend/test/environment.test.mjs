import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEnvironment,
  ensureGitReadyForSync,
} from '../src/environment.mjs';

test('detectEnvironment reports the required tools with stable shape', async () => {
  const report = await detectEnvironment();
  assert.equal(typeof report.platform, 'string');
  assert.equal(typeof report.checkedAt, 'number');
  assert.equal(typeof report.ready, 'boolean');
  assert.equal(typeof report.gitReady, 'boolean');
  assert.ok(Array.isArray(report.tools));
  assert.deepEqual(
    report.tools.map((t) => t.id),
    [
      'git',
      'git-lfs',
      'node',
      'python',
      'ffmpeg',
      'curl',
      'unzip',
      'claude',
      'codex',
      'gemini',
    ],
  );
  for (const tool of report.tools) {
    assert.equal(typeof tool.label, 'string');
    assert.equal(typeof tool.installed, 'boolean');
    assert.equal(typeof tool.installable, 'boolean');
    assert.equal(typeof tool.required, 'boolean');
  }
  // Agent CLIs are optional and install via npm, not the OS package manager.
  const agentIds = ['claude', 'codex', 'gemini'];
  for (const id of agentIds) {
    const tool = report.tools.find((t) => t.id === id);
    assert.equal(tool.required, false);
    assert.equal(tool.channel, 'npm');
  }
  // Required tools must be marked required and use the package-manager channel.
  const git = report.tools.find((t) => t.id === 'git');
  assert.equal(git.required, true);
  assert.equal(git.channel, 'package-manager');
  // "ready" tracks only required tools, so optional agents never block it.
  assert.equal(
    report.ready,
    report.tools.filter((t) => t.required).every((t) => t.installed),
  );
  // The test host has git, so gitReady must reflect that and gate sync open.
  const gitTool = report.tools.find((t) => t.id === 'git');
  assert.equal(report.gitReady, gitTool.installed);
});

test('ensureGitReadyForSync resolves when git is present on the host', async () => {
  // CI/dev hosts have git on PATH; the gate should not throw there.
  await assert.doesNotReject(ensureGitReadyForSync());
});

