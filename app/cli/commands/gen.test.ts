/**
 * e2e + unit coverage for `ugs gen`.
 *
 * gen drives the local claude CLI (never an API key). We point it at a *fake*
 * claude — a platform shim that re-execs Node on a fixture which reads the
 * prompt on stdin and emits claude stream-json whose assistant text carries a
 * fenced ```json IRGraph. This lets `extractJsonObject` + `prepareGraphEdit` +
 * `emitClaudeScript` run end-to-end without a real model.
 *
 *   - generate:  gen "<需求>" -o flow.js  → writes a legal .js script
 *   - modify:    gen flow.js "<意图>"      → overwrites the script in place
 *   - run smoke: the generated .js passes `ugs run --dry-run` (exit 0)
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGen } from './gen';
import { runRun } from './run';

const IS_WINDOWS = process.platform === 'win32';

let dir: string;
let outBuf = '';
let errBuf = '';
let outSpy: { mockRestore: () => void };
let errSpy: { mockRestore: () => void };

const sink = (append: (s: string) => void) =>
  ((chunk: unknown) => {
    append(String(chunk));
    return true;
  }) as never;

beforeEach(() => {
  outBuf = '';
  errBuf = '';
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink((s) => (outBuf += s)));
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink((s) => (errBuf += s)));
  dir = mkdtempSync(join(tmpdir(), 'ugs-gen-'));
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  delete process.env.UGS_CLAUDE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a fake claude that emits a stream-json assistant block whose text holds
 * a fenced ```json IRGraph (the graph passed in `graphJson`). Returns the shim
 * path; we set UGS_CLAUDE_PATH to it so whichCli/spawnCliAgent pick it up.
 */
function makeFakeClaude(graphJson: string): string {
  const reply =
    '好的，我将据此生成 workflow。\n\n```json\n' + graphJson + '\n```\n';
  const fixture = join(dir, 'fakeclaude.cjs');
  writeFileSync(
    fixture,
    `
const reply = ${JSON.stringify(reply)};
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: reply }] },
  }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', result: reply }) + '\\n');
});
`,
    'utf8',
  );
  if (IS_WINDOWS) {
    const shim = join(dir, 'fakeclaude.cmd');
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, 'utf8');
    return shim;
  }
  const shim = join(dir, 'fakeclaude');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, 'utf8');
  chmodSync(shim, 0o755);
  return shim;
}

/** A small but legal IRGraph for the fake model to "return". */
function reviewGraph(): string {
  return JSON.stringify({
    version: 1,
    meta: { name: 'code-review', adapter: 'claude-code' },
    nodes: [
      { id: 'n_start', type: 'start', label: 'Start', params: { userInputs: [] } },
      { id: 'n_review', type: 'agent', label: '代码审查', params: { prompt: '审查代码改动并指出问题' } },
      { id: 'n_end', type: 'end', label: 'End', params: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'n_start', port: 'exec_out' }, to: { node: 'n_review', port: 'exec_in' }, kind: 'exec' },
      { id: 'e2', from: { node: 'n_review', port: 'exec_out' }, to: { node: 'n_end', port: 'exec_in' }, kind: 'exec' },
    ],
  });
}

describe('ugs gen', () => {
  it('generates a legal .js script from a natural-language request (exit 0)', async () => {
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(reviewGraph());
    const out = join(dir, 'flow.js');
    const code = await runGen('做个代码审查流程', undefined, { output: out, quiet: true });
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const script = readFileSync(out, 'utf8');
    // Emitted Claude Code script: contains an agent() call + @node annotations.
    expect(script).toMatch(/agent\(/);
    expect(script).toMatch(/@node/);
  });

  it('accepts output as the second positional arg', async () => {
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(reviewGraph());
    const out = join(dir, 'flow2.js');
    const code = await runGen('做个代码审查流程', out, { quiet: true });
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it('generated script passes `ugs run --dry-run` (exit 0)', async () => {
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(reviewGraph());
    const out = join(dir, 'flow.js');
    await runGen('做个代码审查流程', undefined, { output: out, quiet: true });
    const code = await runRun(out, { dryRun: true, quiet: true });
    expect(code).toBe(0);
  });

  it('modifies an existing script in place when arg1 is a file', async () => {
    // First generate a base script.
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(reviewGraph());
    const out = join(dir, 'flow.js');
    await runGen('做个代码审查流程', undefined, { output: out, quiet: true });
    const before = readFileSync(out, 'utf8');

    // Now point the fake at a graph with an extra verification node and modify.
    const withVerify = JSON.stringify({
      version: 1,
      meta: { name: 'code-review', adapter: 'claude-code' },
      nodes: [
        { id: 'n_start', type: 'start', label: 'Start', params: { userInputs: [] } },
        { id: 'n_review', type: 'agent', label: '代码审查', params: { prompt: '审查代码改动并指出问题' } },
        { id: 'n_verify', type: 'agent', label: '验证', params: { prompt: '验证审查结论是否成立' } },
        { id: 'n_end', type: 'end', label: 'End', params: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'n_start', port: 'exec_out' }, to: { node: 'n_review', port: 'exec_in' }, kind: 'exec' },
        { id: 'e2', from: { node: 'n_review', port: 'exec_out' }, to: { node: 'n_verify', port: 'exec_in' }, kind: 'exec' },
        { id: 'e3', from: { node: 'n_verify', port: 'exec_out' }, to: { node: 'n_end', port: 'exec_in' }, kind: 'exec' },
      ],
    });
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(withVerify);
    const code = await runGen(out, '加一个验证节点', { quiet: true });
    expect(code).toBe(0);
    const after = readFileSync(out, 'utf8');
    expect(after).not.toBe(before);
    // The new verification agent prompt is present in the rewritten script.
    expect(after).toMatch(/验证审查结论是否成立/);
  });

  it('errors with exit 4 when no claude CLI is available', async () => {
    process.env.UGS_CLAUDE_PATH = join(dir, 'does-not-exist-claude');
    const out = join(dir, 'flow.js');
    await expect(runGen('做个流程', undefined, { output: out, quiet: true })).rejects.toMatchObject({
      exitCode: 4,
    });
  });

  it('errors when generate mode is missing an output path', async () => {
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(reviewGraph());
    await expect(runGen('做个流程', undefined, { quiet: true })).rejects.toMatchObject({
      exitCode: 1,
    });
  });

  it('errors when modify mode is missing an intent', async () => {
    process.env.UGS_CLAUDE_PATH = makeFakeClaude(reviewGraph());
    const out = join(dir, 'flow.js');
    await runGen('做个代码审查流程', undefined, { output: out, quiet: true });
    await expect(runGen(out, undefined, { quiet: true })).rejects.toMatchObject({
      exitCode: 1,
    });
  });
});
