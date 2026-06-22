import { afterEach, describe, expect, it } from 'vitest';
import { EXEC, type ConsensusStrategy, type IRGraph } from './ir';
import { emitClaudeScript } from './emitter';
import { parseClaudeScript } from './parser';
import { roundtrip } from './roundtrip';
import { isComplexGenerationRequest } from './consensusHeuristic';

afterEach(() => {
  window.localStorage.clear();
});

/** A start → consensus → end workflow with three lens voters and a VERDICT schema. */
function buildConsensusWorkflow(
  strategy: ConsensusStrategy,
  extra: Record<string, unknown> = {},
): IRGraph {
  return {
    version: 1,
    meta: {
      name: 'consensus roundtrip',
      adapter: 'claude-code',
      schemaDefs: { VERDICT: '{ real: true, confidence: 0 }' },
    },
    nodes: [
      { id: 'n_start', type: 'start', label: 'Start', params: {} },
      {
        id: 'n_consensus',
        type: 'consensus',
        label: 'Consensus',
        binding: 'decision',
        params: {
          strategy,
          quorum: 2,
          schema: 'VERDICT',
          voters: [
            { prompt: '从正确性审查目标', schema: 'VERDICT' },
            { prompt: '从安全性审查目标', schema: 'VERDICT' },
            { prompt: '从可复现性审查目标', schema: 'VERDICT' },
          ],
          ...extra,
        },
      },
      { id: 'n_end', type: 'end', label: 'End', params: {} },
    ],
    edges: [
      {
        id: 'e_1',
        from: { node: 'n_start', port: 'exec_out' },
        to: { node: 'n_consensus', port: 'exec_in' },
        kind: EXEC,
      },
      {
        id: 'e_2',
        from: { node: 'n_consensus', port: 'exec_out' },
        to: { node: 'n_end', port: 'exec_in' },
        kind: EXEC,
      },
    ],
  };
}

describe('consensus node emission', () => {
  it('emits a self-contained, runnable consensus(...) call + runtime helper', () => {
    const script = emitClaudeScript(buildConsensusWorkflow('multi-lens'));

    // Self-contained helper so the export runs in real Claude Code, annotated so
    // the parser skips it.
    expect(script).toContain('async function consensus(voters, opts)');
    expect(script).toContain('// @ugs:runtime consensus');
    // The call site uses fixed-key-order options and a bare schema identifier.
    expect(script).toContain('await consensus([');
    expect(script).toContain("strategy: 'multi-lens'");
    expect(script).toContain('quorum: 2');
    expect(script).toContain('schema: VERDICT');
    // Schema preamble defines the bare identifier so the script is runnable.
    expect(script).toContain('const VERDICT = { real: true, confidence: 0 } // @schema VERDICT');
    // The var name avoids shadowing the helper (reserved 'consensus').
    expect(script).not.toContain('const consensus = await consensus(');
  });

  it('emits the self-consistency samples option', () => {
    const script = emitClaudeScript(
      buildConsensusWorkflow('self-consistency', { samples: 4 }),
    );
    expect(script).toContain("strategy: 'self-consistency'");
    expect(script).toContain('samples: 4');
  });

  it('only injects the helper when a consensus node exists', () => {
    const noConsensus: IRGraph = {
      version: 1,
      meta: { name: 'plain', adapter: 'claude-code' },
      nodes: [
        { id: 'n_start', type: 'start', label: 'Start', params: {} },
        { id: 'n_agent', type: 'agent', label: 'A', params: { prompt: 'hi' } },
        { id: 'n_end', type: 'end', label: 'End', params: {} },
      ],
      edges: [],
    };
    expect(emitClaudeScript(noConsensus)).not.toContain('@ugs:runtime');
  });
});

describe('consensus round-trip (emit → parse → emit)', () => {
  for (const strategy of [
    'adversarial',
    'multi-lens',
    'tournament',
    'self-consistency',
  ] as ConsensusStrategy[]) {
    it(`is structurally lossless and idempotent for strategy=${strategy}`, () => {
      const ir = buildConsensusWorkflow(strategy, { samples: 3 });
      const report = roundtrip(ir);
      expect(report.diffs).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.idempotent).toBe(true);
    });
  }

  it('recovers consensus params and skips the runtime helper (no stray node)', () => {
    const ir = buildConsensusWorkflow('multi-lens');
    const reparsed = parseClaudeScript(emitClaudeScript(ir));

    // The helper must NOT become a node: only start + consensus + end survive.
    expect(reparsed.nodes.map((n) => n.type).sort()).toEqual([
      'consensus',
      'end',
      'start',
    ]);
    expect(reparsed.nodes.some((n) => n.type === 'codeblock')).toBe(false);

    const node = reparsed.nodes.find((n) => n.type === 'consensus')!;
    expect(node.id).toBe('n_consensus'); // id preserved via // @node
    expect(node.binding).toBe('decision'); // var name preserved
    expect(node.params.strategy).toBe('multi-lens');
    expect(node.params.quorum).toBe(2);
    expect(node.params.schema).toBe('VERDICT');
    expect(Array.isArray(node.params.voters)).toBe(true);
    expect((node.params.voters as unknown[]).length).toBe(3);
  });
});

describe('generation-time consensus heuristic', () => {
  it('is off by default', () => {
    expect(isComplexGenerationRequest('对这个项目做一次全面的安全审计')).toBe(false);
    expect(isComplexGenerationRequest('a'.repeat(250))).toBe(false);
  });

  it('flags long / multi-goal / high-stakes requests as complex after opt-in', () => {
    window.localStorage.setItem('ugs_gen_consensus', '1');

    expect(isComplexGenerationRequest('对这个项目做一次全面的安全审计')).toBe(true);
    expect(isComplexGenerationRequest('重构整个鉴权模块的架构')).toBe(true);
    expect(
      isComplexGenerationRequest('1. 抓取数据\n2. 清洗\n3. 训练模型\n4. 评估'),
    ).toBe(true);
    expect(isComplexGenerationRequest('a'.repeat(250))).toBe(true);
  });

  it('leaves simple requests single-call', () => {
    expect(isComplexGenerationRequest('加一个日志节点')).toBe(false);
    expect(isComplexGenerationRequest('把这步改成并行')).toBe(false);
    expect(isComplexGenerationRequest('重命名这个节点')).toBe(false);
  });
});
