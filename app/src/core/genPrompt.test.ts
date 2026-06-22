/**
 * Unit coverage for the extracted-from-store pure helpers in genPrompt.ts.
 * These were lifted out of useStore.ts so the headless CLI (`ugs gen`) can reuse
 * them without importing zustand; the store now re-imports them unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_DIRECT_EDIT_CONTRACT,
  prepareGraphEdit,
  replyIncludesIRGraph,
  strictBlueprintRetryAppendix,
} from './genPrompt';
import { defaultBlueprint } from './defaultBlueprint';
import { EXEC, type IRGraph } from './ir';

describe('replyIncludesIRGraph', () => {
  it('detects a fenced ```json IRGraph block', () => {
    const reply = '说明在此\n```json\n{"version":1,"meta":{"name":"x"},"nodes":[],"edges":[]}\n```';
    expect(replyIncludesIRGraph(reply)).toBe(true);
  });

  it('detects a bare {...} IRGraph object', () => {
    expect(replyIncludesIRGraph('{"nodes":[],"edges":[]}')).toBe(true);
  });

  it('rejects prose / plans with no graph', () => {
    expect(replyIncludesIRGraph('我建议你先做需求分析，再实现。')).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(replyIncludesIRGraph('```json\n{ not json ]\n```')).toBe(false);
  });

  it('rejects JSON lacking nodes/edges arrays', () => {
    expect(replyIncludesIRGraph('{"nodes":{}, "edges":1}')).toBe(false);
  });
});

describe('strictBlueprintRetryAppendix', () => {
  it('quotes the previous reply and demands a single json block', () => {
    const app = strictBlueprintRetryAppendix('上一轮是个 Markdown 计划');
    expect(app).toContain('上一轮是个 Markdown 计划');
    expect(app).toContain('IRGraph');
    expect(app).toContain('json');
  });

  it('truncates a very long previous reply to 4000 chars', () => {
    const huge = 'x'.repeat(10000);
    const app = strictBlueprintRetryAppendix(huge);
    expect(app).toContain('x'.repeat(4000));
    expect(app).not.toContain('x'.repeat(4001));
  });
});

describe('BLUEPRINT_DIRECT_EDIT_CONTRACT', () => {
  it('is a non-empty string instructing a single json block', () => {
    expect(typeof BLUEPRINT_DIRECT_EDIT_CONTRACT).toBe('string');
    expect(BLUEPRINT_DIRECT_EDIT_CONTRACT).toContain('IRGraph');
  });
});

describe('prepareGraphEdit', () => {
  it('merges a new IR into the current graph and keeps it valid', () => {
    const current = defaultBlueprint();
    const ir: IRGraph = {
      version: 1,
      meta: { name: 'edited', adapter: 'claude-code' },
      nodes: [
        { id: 'n_start', type: 'start', label: 'Start', params: { userInputs: [] } },
        { id: 'n_a', type: 'agent', label: 'A', params: { prompt: 'do A' } },
        { id: 'n_b', type: 'agent', label: 'B', params: { prompt: 'do B' } },
        { id: 'n_end', type: 'end', label: 'End', params: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'n_start', port: 'exec_out' }, to: { node: 'n_a', port: 'exec_in' }, kind: EXEC },
        { id: 'e2', from: { node: 'n_a', port: 'exec_out' }, to: { node: 'n_b', port: 'exec_in' }, kind: EXEC },
        { id: 'e3', from: { node: 'n_b', port: 'exec_out' }, to: { node: 'n_end', port: 'exec_in' }, kind: EXEC },
      ],
    };
    const merged = prepareGraphEdit(current, ir);
    expect(merged.nodes.map((n) => n.id)).toEqual(['n_start', 'n_a', 'n_b', 'n_end']);
    // Layout is assigned for every node after a structural change.
    expect(Object.keys(merged.layout ?? {}).sort()).toEqual(['n_a', 'n_b', 'n_end', 'n_start']);
  });

  it('inherits the current graph gateway defaults when the new IR omits them', () => {
    const current = defaultBlueprint(); // has meta.gateway.defaults
    const ir: IRGraph = {
      version: 1,
      meta: { name: 'no-gateway' },
      nodes: [
        { id: 'n_start', type: 'start', label: 'Start', params: { userInputs: [] } },
        { id: 'n_a', type: 'agent', label: 'A', params: { prompt: 'do A' } },
        { id: 'n_end', type: 'end', label: 'End', params: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'n_start', port: 'exec_out' }, to: { node: 'n_a', port: 'exec_in' }, kind: EXEC },
        { id: 'e2', from: { node: 'n_a', port: 'exec_out' }, to: { node: 'n_end', port: 'exec_in' }, kind: EXEC },
      ],
    };
    const merged = prepareGraphEdit(current, ir);
    expect(merged.meta.gateway?.defaults).toBeTruthy();
  });

  it('strips any run-state snapshot from the merged graph', () => {
    const current = defaultBlueprint();
    const ir: IRGraph = {
      ...current,
      meta: { ...current.meta, run: { status: 'success', nodeStates: {}, outputs: {}, failedNodeId: null, error: null, updatedAt: 1 } },
    };
    const merged = prepareGraphEdit(current, ir);
    expect(merged.meta.run).toBeUndefined();
  });
});
