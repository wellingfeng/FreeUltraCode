/**
 * Tests for the "quantity-for-quality" helpers (multi-angle research +
 * divergence-driven adaptive escalation). Defaults are now conservative
 * (min=1, max=1): out of the box every covered node stays single-model.
 * Users can opt in by raising a feature's *Max above 1.
 */
import { describe, expect, it } from 'vitest';
import { EXEC, type IRGraph } from './ir';
import {
  isTerminalIntentNode,
  measureDivergence,
  nodeComplexitySignal,
  normalizeForBucket,
  researchAngles,
  scaleCount,
} from './consensusHeuristic';
import { execNonEndSuccessorCount } from '../runtime/dag';
import { getConsensusSettings } from '../lib/consensusSettings';

describe('scaleCount', () => {
  it('is the identity when the multiplier is 1 (default = no scaling)', () => {
    expect(scaleCount(3, 1, 1, 7)).toBe(3);
    expect(scaleCount(5, 0.5, 1, 7)).toBe(5);
  });

  it('returns 1 when base <= 1 — scaling can never *enable* a disabled feature', () => {
    expect(scaleCount(1, 1, 4, 7)).toBe(1);
    expect(scaleCount(0, 1, 4, 7)).toBe(1);
  });

  it('amplifies an enabled base by complexity, capped at max', () => {
    expect(scaleCount(2, 0, 4, 7)).toBe(2); // zero signal → unchanged
    expect(scaleCount(2, 1, 4, 7)).toBe(7); // full signal → 2*4=8, capped to 7
    expect(scaleCount(2, 1, 3, 5)).toBe(5); // 2*3=6, capped to 5
    expect(scaleCount(2, 0.5, 2, 7)).toBe(3); // round(2*(1+0.5)) = 3
  });
});

describe('researchAngles', () => {
  it('clamps to 1..16 and yields that many angles', () => {
    expect(researchAngles(1)).toHaveLength(1);
    expect(researchAngles(3)).toHaveLength(3);
    expect(researchAngles(9)).toHaveLength(9);
    expect(researchAngles(16)).toHaveLength(16);
    expect(researchAngles(99)).toHaveLength(16);
    expect(researchAngles(0)).toHaveLength(1);
  });
});

describe('isTerminalIntentNode', () => {
  const node = (label: string, prompt = '') => ({
    id: 'n',
    type: 'agent' as const,
    label,
    params: { prompt },
  });

  it('matches self-test / summary / validate / review intents', () => {
    expect(isTerminalIntentNode(node('最终自测'))).toBe(true);
    expect(isTerminalIntentNode(node('汇总结果'))).toBe(true);
    expect(isTerminalIntentNode(node('Final review', ''))).toBe(true);
    expect(isTerminalIntentNode(node('', '请校验输出是否符合验收标准'))).toBe(true);
  });

  it('does not match an ordinary processing node', () => {
    expect(isTerminalIntentNode(node('抓取网页', '下载并解析页面'))).toBe(false);
  });
});

describe('nodeComplexitySignal', () => {
  const wf = (extra: Partial<IRGraph> = {}): IRGraph => ({
    version: 1,
    meta: { name: 't' },
    nodes: [],
    edges: [],
    ...extra,
  });

  it('is 0 for a trivial node and rises with complexity signals', () => {
    const trivial = { id: 'a', type: 'agent' as const, label: 'hi', params: { prompt: '打个招呼' } };
    expect(nodeComplexitySignal(trivial, wf())).toBe(0);

    const stakes = {
      id: 'b',
      type: 'agent' as const,
      label: '安全审计',
      params: { prompt: '请做安全审计：首先 X；其次 Y；然后 Z；最后汇总。' },
    };
    expect(nodeComplexitySignal(stakes, wf())).toBeGreaterThan(0);
  });
});

describe('execNonEndSuccessorCount (terminal detection)', () => {
  // start → a → b → end
  const wf: IRGraph = {
    version: 1,
    meta: { name: 't' },
    nodes: [
      { id: 's', type: 'start', label: 'Start', params: {} },
      { id: 'a', type: 'agent', label: 'A', params: { prompt: 'a' } },
      { id: 'b', type: 'agent', label: 'B', params: { prompt: 'b' } },
      { id: 'e', type: 'end', label: 'End', params: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 's', port: 'exec_out' }, to: { node: 'a', port: 'exec_in' }, kind: EXEC },
      { id: 'e2', from: { node: 'a', port: 'exec_out' }, to: { node: 'b', port: 'exec_in' }, kind: EXEC },
      { id: 'e3', from: { node: 'b', port: 'exec_out' }, to: { node: 'e', port: 'exec_in' }, kind: EXEC },
    ],
  };

  it('counts only real downstream work (excludes the end sentinel)', () => {
    expect(execNonEndSuccessorCount(wf, 'a')).toBe(1); // → b
    expect(execNonEndSuccessorCount(wf, 'b')).toBe(0); // → end only ⇒ terminal
  });
});

describe('measureDivergence', () => {
  it('is 0 for fewer than 2 outputs', () => {
    expect(measureDivergence([])).toBe(0);
    expect(measureDivergence(['only one'])).toBe(0);
  });

  it('is 0 when all outputs agree (after normalisation)', () => {
    expect(measureDivergence(['Yes', 'yes', '  yes '])).toBe(0);
  });

  it('rises toward 1 as outputs diverge', () => {
    expect(measureDivergence(['a', 'a', 'b', 'b'])).toBeCloseTo(0.5, 5); // top bucket 2/4
    expect(measureDivergence(['a', 'b', 'c', 'd'])).toBeCloseTo(0.75, 5); // all distinct
  });

  it('honours a custom bucket-key extractor (e.g. a JSON field)', () => {
    const verdict = (s: string) => (JSON.parse(s).verdict ? 'T' : 'F');
    const out = [
      '{"verdict":true,"why":"x"}',
      '{"verdict":true,"why":"y"}', // different prose, same verdict
      '{"verdict":false,"why":"z"}',
    ];
    // Whole-string buckets would read ~1; keyed on verdict, top bucket 2/3.
    expect(measureDivergence(out, verdict)).toBeCloseTo(1 - 2 / 3, 5);
  });
});

describe('normalizeForBucket', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForBucket('  Hello   World ')).toBe('hello world');
  });
});

describe('consensus settings defaults (adaptive escalation)', () => {
  it('defaults each feature to start=1 / ceiling=1', () => {
    const s = getConsensusSettings();
    expect(s.researchAnglesMin).toBe(1);
    expect(s.researchAnglesMax).toBe(1);
    expect(s.nodeGenCandidatesMin).toBe(1);
    expect(s.nodeGenCandidatesMax).toBe(1);
    expect(s.runtimeVoteSamplesMin).toBe(1);
    expect(s.runtimeVoteSamplesMax).toBe(1);
    expect(s.terminalVoteSamplesMin).toBe(1);
    expect(s.terminalVoteSamplesMax).toBe(1);
  });

  it('defaults complexityScaling to 1 (no scaling) and the master switch OFF', () => {
    const s = getConsensusSettings();
    expect(s.complexityScaling).toBe(1);
    expect(s.adaptiveEscalation).toBe(false);
  });
});
