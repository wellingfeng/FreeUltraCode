import { afterEach, describe, expect, it } from 'vitest';
import { refreshCliRuntime } from './cliConfig';

const HISTORY_CONFIG_STORAGE = 'ultragamestudio.history.v1:config.json';

function seedHistoryConfig(config: Record<string, unknown>): void {
  window.localStorage.setItem(
    HISTORY_CONFIG_STORAGE,
    JSON.stringify({ schemaVersion: 1, ...config }),
  );
}

afterEach(async () => {
  window.localStorage.clear();
  await refreshCliRuntime();
});

describe('cliConfig legacy compatibility', () => {
  it('unwraps legacy shell command lines to the actual CLI', async () => {
    seedHistoryConfig({ selectedCli: 'cmd.exe /c codex' });

    const runtime = await refreshCliRuntime();

    expect(runtime.config.selected).toMatchObject({
      kind: 'known',
      adapter: 'codex',
      command: 'codex',
    });
    expect(runtime.config.migrationNotice).toBeUndefined();
  });

  it('falls back safely when the old value is only a shell wrapper', async () => {
    seedHistoryConfig({ selectedCli: 'powershell.exe' });

    const runtime = await refreshCliRuntime();

    expect(runtime.config.selected).toEqual({ kind: 'auto' });
    expect(runtime.config.migrationNotice).toMatchObject({
      code: 'legacy-shell-wrapper',
      raw: 'powershell.exe',
    });
  });

  it('maps old nested cli objects to the selected CLI config', async () => {
    seedHistoryConfig({
      cli: {
        cliCommand: 'bash -lc "gemini"',
        adapter: 'gemini',
      },
    });

    const runtime = await refreshCliRuntime();

    expect(runtime.config.selected).toMatchObject({
      kind: 'known',
      adapter: 'gemini',
      command: 'gemini',
    });
    expect(runtime.config.migrationNotice).toBeUndefined();
  });

  it('reads schema-versioned legacy cli objects when selected is absent', async () => {
    seedHistoryConfig({
      cli: {
        schemaVersion: 1,
        selectedCli: 'claude',
        customPaths: [],
      },
    });

    const runtime = await refreshCliRuntime();

    expect(runtime.config.selected).toMatchObject({
      kind: 'known',
      adapter: 'claude-code',
      command: 'claude',
    });
  });

  it('keeps an unknown old command on a visible safe fallback', async () => {
    seedHistoryConfig({ cliCommand: 'unknown-agent' });

    const runtime = await refreshCliRuntime();

    expect(runtime.config.selected).toEqual({ kind: 'auto' });
    expect(runtime.config.migrationNotice).toMatchObject({
      code: 'legacy-unrecognized',
      raw: 'unknown-agent',
    });
  });
});
