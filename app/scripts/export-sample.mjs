/**
 * Dev helper: bundle src/core/sample.ts with esbuild and write its
 * `sampleWorkflow` export to sample.ugs.json (for CLI smoke-testing only).
 */
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'ugs-'));
const out = join(dir, 'bundle.mjs');
await build({
  entryPoints: ['src/core/sample.ts'],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': join(process.cwd(), 'src') },
  logLevel: 'silent',
});
const mod = await import(pathToFileURL(out).href);
const target = process.argv[2] || 'sample.ugs.json';
writeFileSync(target, JSON.stringify(mod.sampleWorkflow, null, 2));
console.log('wrote', target);
