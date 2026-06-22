import { describe, expect, it } from 'vitest';
import {
  closeRunningRemoteToolCards,
  fencedBlock,
  outputLooksLikeProtocolNoise,
  remoteMessageLogText,
  remoteSessionFileSentinelsForJob,
} from './remoteChatTurn';
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
