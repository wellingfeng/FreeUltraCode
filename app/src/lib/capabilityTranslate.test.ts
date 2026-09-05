import { describe, expect, it } from 'vitest';
import {
  buildTranslationPlan,
  capabilityTranslateAgentLabel,
  capabilityTranslateAgents,
  CROSS_AGENT_AGENT_ID,
  supportedTranslateAgentIds,
} from './capabilityTranslate';

describe('capability translate plan', () => {
  it('lists the cross-agent standard first for skills, then all CLI agents', () => {
    const agents = capabilityTranslateAgents('skill');
    expect(agents[0].id).toBe(CROSS_AGENT_AGENT_ID);
    expect(agents.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'claude-code',
        'codex',
        'gemini',
        'kimi',
        'deepseek-harness',
        'zcode',
        'grok',
      ]),
    );
  });

  it('marks claude/codex/gemini/agents as skill-supported and the rest as pending', () => {
    const plan = buildTranslationPlan('skill');
    const byId = Object.fromEntries(plan.agents.map((item) => [item.id, item]));
    expect(byId['claude-code'].supported).toBe(true);
    expect(byId.codex.supported).toBe(true);
    expect(byId.gemini.supported).toBe(true);
    expect(byId[CROSS_AGENT_AGENT_ID].supported).toBe(true);
    expect(byId.kimi.supported).toBe(false);
    expect(byId['deepseek-harness'].supported).toBe(false);
    expect(byId.zcode.supported).toBe(false);
    expect(byId.grok.supported).toBe(true);
  });

  it('defaults MCP translation targets to the three native-config agents', () => {
    expect(supportedTranslateAgentIds('mcp')).toEqual([
      'claude-code',
      'codex',
      'gemini',
    ]);
  });

  it('treats LSP as reuse-only (all agents reuse the same LSP)', () => {
    const plan = buildTranslationPlan('lsp');
    expect(plan.agents.every((item) => item.supported)).toBe(true);
    // LSP never produces a cross-agent entry; it is CLI-only reuse.
    expect(plan.agents.map((item) => item.id)).not.toContain(CROSS_AGENT_AGENT_ID);
  });

  it('resolves agent labels for both CLIs and the cross-agent standard', () => {
    expect(capabilityTranslateAgentLabel('claude-code')).toBe('Claude Code');
    expect(capabilityTranslateAgentLabel(CROSS_AGENT_AGENT_ID)).toBe(
      'Agents (跨 agent 标准)',
    );
    expect(capabilityTranslateAgentLabel('unknown')).toBe('unknown');
  });
});
