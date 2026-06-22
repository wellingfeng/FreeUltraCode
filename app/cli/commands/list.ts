/**
 * `ugs list <resource>` — query environment capabilities (spec §3.6).
 *   adapters  : scan PATH for claude/codex/gemini CLIs (via io/which-cli).
 *   models    : built-in model list per adapter.
 *   templates : built-in templates + ~/.ugs/templates/*.ugs.json.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { adapterBinary, isCliAvailable, whichCli } from '../io/which-cli';
import { CliError } from '../utils/fs';
import { table, c, type GlobalOptions } from '../utils/format';
import { BUILTIN_TEMPLATE_NAMES } from './init';

export interface ListOptions extends GlobalOptions {
  adapter?: string;
}

const KNOWN_ADAPTERS = ['claude-code', 'codex', 'gemini'];

const BUILTIN_MODELS: Record<string, Array<{ model: string; cls: string; desc: string }>> = {
  'claude-code': [
    { model: 'claude-opus-4-8', cls: 'opus', desc: 'Most capable' },
    { model: 'claude-sonnet-4-6', cls: 'sonnet', desc: 'Balanced' },
    { model: 'claude-haiku-4-5', cls: 'haiku', desc: 'Fastest' },
  ],
  codex: [{ model: 'gpt-5-codex', cls: 'default', desc: 'OpenAI Codex' }],
  gemini: [{ model: 'gemini-2.5-pro', cls: 'default', desc: 'Google Gemini' }],
};

export async function runList(resource: string, opts: ListOptions): Promise<number> {
  switch (resource) {
    case 'adapters':
      return listAdapters(opts);
    case 'models':
      return listModels(opts);
    case 'templates':
      return listTemplates(opts);
    default:
      throw new CliError(
        `Unknown resource: ${resource} (expected adapters | models | templates)`,
        1,
      );
  }
}

function listAdapters(opts: ListOptions): number {
  const rows = KNOWN_ADAPTERS.map((adapter) => {
    const available = isCliAvailable(adapter);
    const path = available ? whichCli(adapter) : '(not found)';
    return { adapter, binary: adapterBinary(adapter), path, available };
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(
    `${table(['ADAPTER', 'BINARY', 'PATH'], rows.map((r) => [r.adapter, r.binary, r.path]))}\n`,
  );
  return 0;
}

function listModels(opts: ListOptions): number {
  const adapter = opts.adapter ?? 'claude-code';
  const models = BUILTIN_MODELS[adapter] ?? [];
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ adapter, models }, null, 2)}\n`);
    return 0;
  }
  if (models.length === 0) {
    process.stderr.write(c.warn(`No built-in model list for adapter '${adapter}'.\n`));
    return 0;
  }
  process.stdout.write(
    `${table(['MODEL', 'CLASS', 'DESCRIPTION'], models.map((m) => [m.model, m.cls, m.desc]))}\n`,
  );
  return 0;
}

function listTemplates(opts: ListOptions): number {
  const builtin = BUILTIN_TEMPLATE_NAMES.map((name) => ({ name, source: 'builtin' }));
  const userDir = join(homedir(), '.ugs', 'templates');
  const user: Array<{ name: string; source: string }> = [];
  if (existsSync(userDir)) {
    for (const f of readdirSync(userDir)) {
      if (f.endsWith('.ugs.json')) user.push({ name: f.replace(/\.ugs\.json$/, ''), source: 'user' });
    }
  }
  const all = [...builtin, ...user];
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${table(['TEMPLATE', 'SOURCE'], all.map((t) => [t.name, t.source]))}\n`);
  return 0;
}
