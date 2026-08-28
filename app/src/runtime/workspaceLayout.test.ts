/**
 * 工作区目录约定模块 + 其在 `runAgentWithInteraction` 中的注入测试。
 * 只依赖 `@/runtime`，证明目录约定是纯运行引擎的一部分，桌面 GUI 与
 * headless CLI 都会一致注入到每个 agent 节点 prompt。
 */
import { describe, expect, it } from 'vitest';
import {
  appendWorkspaceLayout,
  WORKSPACE_LAYOUT_DIRECTIVE,
  runAgentWithInteraction,
  type RunCallbacks,
  type RunContext,
  type RunGateway,
  type SpawnCliAgentOpts,
} from '@/runtime';

describe('appendWorkspaceLayout', () => {
  it('appends the directive after the node prompt', () => {
    const out = appendWorkspaceLayout('do it');
    expect(out).toContain('do it');
    expect(out).toContain(WORKSPACE_LAYOUT_DIRECTIVE);
    expect(out.indexOf('do it')).toBeLessThan(out.indexOf(WORKSPACE_LAYOUT_DIRECTIVE));
  });

  it('directs derived files into .ultragamestudio subdirectories', () => {
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/temp/');
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/scripts/');
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/tests/');
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/docs/reading/');
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/docs/dev/');
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/logs/');
    expect(WORKSPACE_LAYOUT_DIRECTIVE).toContain('.ultragamestudio/backup/');
  });
});

/* ---------------------------------------------------------- integration */

function fakeGateway(
  respond: (prompt: string, opts: SpawnCliAgentOpts) => Promise<string>,
): RunGateway {
  return {
    resolveDirectRoute: () => null,
    resolveCliRoute: async () => ({ adapter: 'claude-code', cliCommand: 'claude' }),
    completeText: async () => ({ text: '', adapter: 'claude-code' }),
    spawnCliAgent: (prompt, _adapter, opts) => respond(prompt, opts),
    applyOverride: (s) => s,
    recordCall: () => {},
    timeoutPolicy: () => ({ timeoutSeconds: 600, idleTimeoutSeconds: 180 }),
    effectiveConcurrency: (n) => n,
    effectiveConsensusSamples: (n) => n,
    nodeGatewayOverride: () => undefined,
    modelClassFromModelId: () => 'sonnet',
  };
}

function fakeCallbacks(): RunCallbacks {
  return {
    onNodeStart: () => {},
    onNodeSuccess: () => {},
    onNodeFailure: () => {},
    onLog: () => {},
    beginStream: () => ({ append: () => {}, finalize: () => {}, fail: () => {} }),
    isCancelled: () => false,
    promptInteraction: async () => null,
  };
}

function fakeCtx(gateway: RunGateway): RunContext {
  return {
    selection: { adapter: 'claude-code', modelClass: 'sonnet' },
    concurrency: 4,
    maxRetries: 2,
    consensusSamples: 3,
    gateway,
  };
}

describe('runAgentWithInteraction + workspace layout', () => {
  it('injects the workspace layout directive into the executed prompt', async () => {
    let seenPrompt = '';
    const gw = fakeGateway(async (prompt) => {
      seenPrompt = prompt;
      return 'ok';
    });

    await runAgentWithInteraction({
      context: fakeCtx(gw),
      callbacks: fakeCallbacks(),
      head: '【test】\n',
      label: 'test',
      basePrompt: 'do it',
      selection: { adapter: 'claude-code', modelClass: 'sonnet' },
      cli: {},
    });

    expect(seenPrompt).toContain('工作区目录约定');
    expect(seenPrompt).toContain('.ultragamestudio/temp/');
    expect(seenPrompt).toContain('.ultragamestudio/docs/reading/');
  });
});
