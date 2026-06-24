import { describe, expect, it } from 'vitest';
import {
  buildRemoteRouteLabel,
  closeRunningRemoteToolCards,
  fencedBlock,
  outputLooksLikeProtocolNoise,
  remoteMessageLogText,
  remoteSessionFileSentinelsForJob,
  resolveRemoteRoute,
} from './remoteChatTurn';
import { upsertProviders } from '@/lib/apiConfig';
import { remoteProviderId } from '@/lib/remoteWorkspace';
import { repairFences } from '@/components/ai/lib/repairMarkdown';
import {
  encodeToolPatch,
  extractToolSentinels,
  mergeToolPatches,
} from '@/components/ai/lib/toolEvent';
import { extractSessionFiles } from '@/lib/sessionFiles';

describe('fencedBlock', () => {
  it('wraps a normal diff in a 3-backtick fence', () => {
    expect(fencedBlock('diff --git a/a b/a\n+ok', 'diff')).toBe(
      '\n\n```diff\ndiff --git a/a b/a\n+ok\n```',
    );
  });

  it('uses a longer fence than any backtick run inside the body', () => {
    // A diff that edited a file printing markdown contains its own ``` runs.
    // A fixed 3-backtick fence would terminate early and let the rest re-parse
    // as prose — that is how `${...}`/source leaked into the rendered stream.
    const patch = 'diff --git a/x b/x\n+const s = `code ```fence``` here`;';
    const out = fencedBlock(patch, 'diff');
    expect(out.startsWith('\n\n````diff\n')).toBe(true);
    expect(out.endsWith('\n````')).toBe(true);
    // The opening fence must outlive every backtick run in the body so the
    // whole patch stays inside one fenced block after markdown repair.
    expect(repairFences(out.trimStart())).toBe(out.trimStart());
  });
});

describe('buildRemoteRouteLabel', () => {
  const config = {
    id: 'rw_1',
    label: 'UltraGameStudio腾讯云',
    serverUrl: 'https://runner.example.com',
    adapter: 'claude' as const,
    useOwnModelKey: false,
    createdAt: 0,
    updatedAt: 0,
  };

  it('shows the cloud project, channel and resolved model', () => {
    expect(
      buildRemoteRouteLabel({
        config,
        adapter: 'claude',
        model: 'claude-opus-4-8',
      }),
    ).toBe('云端项目 · UltraGameStudio腾讯云 · Claude Code · claude-opus-4-8');
  });

  it('includes the selected account/provider name when present', () => {
    expect(
      buildRemoteRouteLabel({
        config,
        adapter: 'codex',
        providerName: '腾讯云账号A',
        model: 'gpt-5-codex',
      }),
    ).toBe('云端项目 · UltraGameStudio腾讯云 · Codex · 腾讯云账号A · gpt-5-codex');
  });

  it('omits the model when it is unset or "default"', () => {
    expect(
      buildRemoteRouteLabel({ config, adapter: 'gemini', model: 'default' }),
    ).toBe('云端项目 · UltraGameStudio腾讯云 · Gemini');
    expect(buildRemoteRouteLabel({ config, adapter: 'gemini' })).toBe(
      '云端项目 · UltraGameStudio腾讯云 · Gemini',
    );
  });

  it('falls back to a generic label when the config is missing', () => {
    expect(buildRemoteRouteLabel({ config: null, adapter: 'claude' })).toBe(
      '云端项目 · Claude Code',
    );
  });
});

describe('outputLooksLikeProtocolNoise', () => {
  it('does not treat a code answer quoting a template literal as noise', () => {
    // A game-dev coding agent legitimately quotes TS like `${phase}${text}` in
    // its prose answer. The old `${...}` heuristic dropped every such answer.
    expect(
      outputLooksLikeProtocolNoise('我把日志格式改成了 `${phase}${stream}${text}`，更紧凑。'),
    ).toBe(false);
  });

  it('still flags empty and known CLI protocol output', () => {
    expect(outputLooksLikeProtocolNoise('')).toBe(true);
    expect(outputLooksLikeProtocolNoise('  ')).toBe(true);
    expect(
      outputLooksLikeProtocolNoise('{"type":"hook_response","session_id":"abc"}'),
    ).toBe(true);
  });
});

describe('remoteMessageLogText', () => {
  it('serializes remote tool messages as structured tool cards', () => {
    const text = remoteMessageLogText(
      {
        role: 'tool',
        kind: 'tool',
        toolName: 'command_execution',
        status: 'completed',
        text:
          'command_execution: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n foo app/src"',
        args: { command: 'rg -n foo app/src' },
      },
      'remote-tool-1',
    );

    expect(text).not.toContain('[model]');
    const decoded = extractToolSentinels(text);
    expect(decoded.text.trim()).toBe('');
    expect(decoded.patches).toEqual([
      {
        id: 'remote-tool-1',
        name: 'command_execution',
        subject: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n foo app/src"',
        args: { command: 'rg -n foo app/src' },
        status: 'done',
      },
    ]);
  });
});

describe('remoteSessionFileSentinelsForJob', () => {
  it('turns a remote job patch into hidden session-file data', () => {
    const text =
      remoteSessionFileSentinelsForJob({
        id: 'job_1',
        result: {
          exitCode: 0,
          patch: [
            'diff --git a/app/src/App.tsx b/app/src/App.tsx',
            '--- a/app/src/App.tsx',
            '+++ b/app/src/App.tsx',
            '@@ -1 +1 @@',
            '-old',
            '+new',
          ].join('\n'),
        },
      }) + '✓ 远程任务完成';

    const decoded = extractToolSentinels(text);
    expect(decoded.patches[0]).toMatchObject({
      id: 'remote-session-files-job_1',
      name: 'file_change',
      ephemeral: true,
    });

    const files = extractSessionFiles([
      { id: 'a1', role: 'assistant', text, createdAt: 10 },
    ]);
    expect(files.map((file) => [file.path, file.action])).toEqual([
      ['app/src/App.tsx', 'edited'],
    ]);
  });
});

describe('closeRunningRemoteToolCards', () => {
  it('adds terminal patches for running remote tool cards in final text', () => {
    const liveText =
      encodeToolPatch({
        id: 'remote-tool-1',
        name: 'command_execution',
        subject: 'cargo check',
        status: 'running',
      }) + '✓ 远程任务完成';

    const closed = closeRunningRemoteToolCards(liveText, 'done');
    const merged = mergeToolPatches(extractToolSentinels(closed).patches);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'remote-tool-1',
      name: 'command_execution',
      subject: 'cargo check',
      status: 'done',
    });
  });
});

describe('resolveRemoteRoute', () => {
  const config = {
    id: 'rw_route',
    label: '云端项目',
    serverUrl: 'https://runner.example.com',
    adapter: 'claude' as const,
    model: 'claude-opus-4-8',
    useOwnModelKey: false,
    createdAt: 0,
    updatedAt: 0,
  };

  it('falls back to the project config when nothing is selected', () => {
    const route = resolveRemoteRoute(config, 'rw_route', undefined);
    expect(route.adapter).toBe('claude');
    expect(route.model).toBe('claude-opus-4-8');
    expect(route.accountId).toBeUndefined();
    expect(route.apiKey).toBeUndefined();
  });

  it('routes an ordinary synced channel by its own adapter/model/key', () => {
    upsertProviders([
      {
        id: 'p_deepseek',
        kind: 'codex',
        name: 'DeepSeek',
        apiKey: 'sk-deepseek-123',
        baseUrl: 'https://api.deepseek.com/anthropic',
        transport: 'cli',
        model: 'deepseek-v4-pro',
        models: ['deepseek-v4-pro'],
      },
    ]);
    const route = resolveRemoteRoute(config, 'rw_route', {
      adapter: 'codex',
      modelClass: 'deepseek-v4-pro',
      modelOverride: 'deepseek-v4-pro',
      providerId: 'p_deepseek',
      channelId: 'default',
    });
    // The user's picked channel must win over the project's claude default.
    expect(route.adapter).toBe('codex');
    expect(route.model).toBe('deepseek-v4-pro');
    expect(route.accountId).toBeUndefined();
    // No server-side account exists for this provider, so its key/baseUrl must
    // be sent per job — otherwise the runner can't authenticate.
    expect(route.apiKey).toBe('sk-deepseek-123');
    expect(route.baseUrl).toBe('https://api.deepseek.com/anthropic');
    expect(route.providerName).toBe('DeepSeek');
  });

  it('keeps using a bound remote-runner account when selected', () => {
    const providerId = remoteProviderId('rw_route', 'claude-main');
    upsertProviders([
      {
        id: providerId,
        kind: 'anthropic',
        name: '云端项目 · Claude',
        apiKey: 'remote-runner',
        baseUrl: 'https://runner.example.com',
        transport: 'cli',
        model: 'claude-opus-4-8',
        models: ['claude-opus-4-8'],
      },
    ]);
    const route = resolveRemoteRoute(config, 'rw_route', {
      adapter: 'claude-code',
      modelClass: 'claude-opus-4-8',
      providerId,
      channelId: 'default',
    });
    expect(route.adapter).toBe('claude');
    expect(route.accountId).toBe('claude-main');
    // Account-backed routes never inline a per-job key.
    expect(route.apiKey).toBeUndefined();
  });
});
