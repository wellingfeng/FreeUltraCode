/**
 * Unit coverage for the pure CLI commands: exit codes + key output behaviour for
 * init / emit / parse / validate / info, plus run --dry-run. These exercise the
 * command functions directly (no spawn / no commander), capturing stdout/stderr.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleWorkflow } from '../../src/core/sample';
import { runInit } from './init';
import { runEmit } from './emit';
import { runParse } from './parse';
import { runValidate } from './validate';
import { runInfo } from './info';
import { runRun } from './run';

let outBuf = '';
let errBuf = '';
let outSpy: { mockRestore: () => void };
let errSpy: { mockRestore: () => void };
let dir: string;

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
  dir = mkdtempSync(join(tmpdir(), 'ugs-cmd-'));
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

function writeSample(): string {
  const file = join(dir, 'sample.ugs.json');
  writeFileSync(file, JSON.stringify(sampleWorkflow, null, 2));
  return file;
}

describe('ugs init', () => {
  it('emits a minimal legal IRGraph to stdout (exit 0)', async () => {
    const code = await runInit('demo', { stdout: true });
    expect(code).toBe(0);
    const g = JSON.parse(outBuf);
    expect(g.version).toBe(1);
    expect(g.meta.name).toBe('demo');
    expect(g.nodes.some((n: { type: string }) => n.type === 'start')).toBe(true);
    expect(g.nodes.some((n: { type: string }) => n.type === 'end')).toBe(true);
  });

  it('rejects an illegal name (exit 1)', async () => {
    await expect(runInit('a/b', { stdout: true })).rejects.toMatchObject({ exitCode: 1 });
  });

  it('builds a known template', async () => {
    const code = await runInit('rev', { stdout: true, template: 'code-review' });
    expect(code).toBe(0);
    const g = JSON.parse(outBuf);
    expect(g.nodes.some((n: { type: string }) => n.type === 'parallel')).toBe(true);
  });

  it('rejects an unknown template (exit 2)', async () => {
    await expect(runInit('x', { stdout: true, template: 'nope' })).rejects.toMatchObject({
      exitCode: 2,
    });
  });
});

describe('ugs emit', () => {
  it('compiles a blueprint to a script (exit 0)', async () => {
    const file = writeSample();
    const code = await runEmit(file, {});
    expect(code).toBe(0);
    expect(outBuf).toContain('await agent(');
    expect(outBuf).toContain('// @node n_scan');
  });

  it('--strip-annotations drops @node comments', async () => {
    const file = writeSample();
    await runEmit(file, { stripAnnotations: true });
    expect(outBuf).not.toContain('// @node');
  });

  it('--dry-run produces no stdout and exit 0', async () => {
    const file = writeSample();
    const code = await runEmit(file, { dryRun: true });
    expect(code).toBe(0);
    expect(outBuf).toBe('');
  });

  it('errors on a missing file (exit 1)', async () => {
    await expect(runEmit(join(dir, 'nope.ugs.json'), {})).rejects.toMatchObject({ exitCode: 1 });
  });
});

describe('ugs parse', () => {
  it('round-trips emit -> parse preserving structure', async () => {
    const file = writeSample();
    await runEmit(file, {});
    const script = outBuf;
    const scriptFile = join(dir, 'flow.js');
    writeFileSync(scriptFile, script);
    outBuf = '';
    const code = await runParse(scriptFile, {});
    expect(code).toBe(0);
    const g = JSON.parse(outBuf);
    expect(g.nodes.filter((n: { type: string }) => n.type === 'agent').length).toBe(2);
    expect(g.nodes.some((n: { type: string }) => n.type === 'parallel')).toBe(true);
  });
});

describe('ugs validate', () => {
  it('passes a valid blueprint (exit 0)', async () => {
    const file = writeSample();
    const code = await runValidate(file, {});
    expect(code).toBe(0);
  });

  it('fails a structurally broken blueprint (exit 1)', async () => {
    const broken = { version: 1, meta: {}, nodes: [], edges: [] };
    const file = join(dir, 'broken.ugs.json');
    writeFileSync(file, JSON.stringify(broken));
    const code = await runValidate(file, {});
    expect(code).toBe(1);
  });

  it('emits a JSON report with --json', async () => {
    const file = writeSample();
    await runValidate(file, { json: true });
    const report = JSON.parse(outBuf);
    expect(report.valid).toBe(true);
    expect(report.exitCode).toBe(0);
  });
});

describe('ugs info', () => {
  it('reports node/edge counts (exit 0)', async () => {
    const file = writeSample();
    const code = await runInfo(file, {});
    expect(code).toBe(0);
    expect(outBuf).toContain('review-changes');
    expect(outBuf).toContain('Nodes:');
  });

  it('--json carries structured stats', async () => {
    const file = writeSample();
    await runInfo(file, { json: true });
    const stats = JSON.parse(outBuf);
    expect(stats.nodeCount).toBe(5);
    expect(stats.execEdges).toBe(4);
    expect(stats.dataEdges).toBe(1);
  });
});

describe('ugs run --dry-run', () => {
  it('validates + emits without spawning (exit 0, quiet = no stderr)', async () => {
    const file = writeSample();
    const code = await runRun(file, { dryRun: true, quiet: true });
    expect(code).toBe(0);
    expect(errBuf).toBe('');
  });

  it('returns 3 when the graph is structurally invalid', async () => {
    const broken = { version: 1, meta: {}, nodes: [], edges: [] };
    const file = join(dir, 'broken.ugs.json');
    writeFileSync(file, JSON.stringify(broken));
    const code = await runRun(file, { dryRun: true, quiet: true });
    expect(code).toBe(3);
  });
});
