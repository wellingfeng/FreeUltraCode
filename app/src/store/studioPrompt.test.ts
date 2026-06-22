import { describe, expect, it } from 'vitest';
import {
  parseStudioPrompt,
  summarizeStudioResult,
  studioAccepted,
  studioModeLabel,
} from './studioPrompt';
import type { StudioRunResult } from '@/lib/tauri';

describe('studio prompt helpers', () => {
  it('parses advanced flags separately from the task request', () => {
    const parsed = parseStudioPrompt(
      '--resume --run-id uc-123 --concurrency 4 --max-retries 0 --max-agent-calls 30 --max-rounds 3 --verify-command "npm run typecheck" --timeout 900 --trace --from-harness "E:\\runs\\harness.json" 修复登录失败',
    );

    expect(parsed.request).toBe('修复登录失败');
    expect(parsed.options).toEqual({
      resume: true,
      runId: 'uc-123',
      concurrency: 4,
      maxRetries: 0,
      maxAgentCalls: 30,
      maxRounds: 3,
      verifyCommand: 'npm run typecheck',
      timeoutSeconds: 900,
      trace: true,
      fromHarness: 'E:\\runs\\harness.json',
    });
    expect(studioModeLabel(parsed.options)).toBe('resume, from-harness, verify, trace');
  });

  it('summarizes ledger, verdict gaps, budget, and resume advice', () => {
    const result: StudioRunResult = {
      exitCode: 1,
      stdout: '',
      stderr: '',
      runId: 'uc-failed',
      runDir: 'E:\\repo\\.ugs-run\\uc-failed',
      resultJson: {
        success: false,
        runId: 'uc-failed',
        runDir: 'E:\\repo\\.ugs-run\\uc-failed',
        durationMs: 12_000,
        failedNodeId: 'n_gate',
        spec: {
          objective: '修复登录失败',
          strategies: ['loop-until-done', 'adversarial-verification'],
          budget: { maxAgentCalls: 20, maxRounds: 2 },
          plan: [
            { id: 'debug', kind: 'agent', title: '定位登录失败' },
            { id: 'verify', kind: 'consensus', title: '验证修复' },
          ],
        },
        budget: {
          maxAgentCalls: 20,
          spentAgentCalls: 20,
          exhausted: true,
        },
        verification: {
          command: 'npm run typecheck',
          exitCode: 1,
          stdout: '',
          stderr: 'TS error',
          durationMs: 1000,
          passed: false,
        },
        artifacts: {
          ledger: {
            tasks: [
              {
                id: 't1',
                title: '定位登录失败',
                status: 'accepted',
                artifact: 'root-cause.md',
                gaps: [],
              },
            ],
          },
          verdict: {
            pass: false,
            evidence: ['npm run typecheck 失败'],
            criteriaCoverage: [
              {
                criterion: '登录流程恢复',
                met: false,
                evidence: '仍有失败断言',
              },
            ],
            gaps: [
              {
                taskId: 't2',
                severity: 'P1',
                reason: '缺少回归验证',
                nextAction: '补跑测试',
              },
            ],
          },
          report: '最终结论：未通过。',
        },
        evidence: [
          {
            id: 'verify-command',
            kind: 'command',
            title: '验证命令',
            status: 'fail',
            summary: 'exitCode=1',
            command: 'npm run typecheck',
          },
          {
            id: 'objective-checks',
            kind: 'check',
            title: '客观检查',
            status: 'fail',
            path: 'E:\\repo\\.ugs-run\\uc-failed\\objective-checks.json',
          },
        ],
      },
    };

    const summary = summarizeStudioResult(result);

    expect(studioAccepted(result)).toBe(false);
    expect(summary).toContain('**运行概览**');
    expect(summary).toContain('预算: agent calls 20/20 · rounds max 2 · 已耗尽');
    expect(summary).toContain('**任务账本**');
    expect(summary).toContain('t1 定位登录失败: accepted');
    expect(summary).toContain('**验收门**');
    expect(summary).toContain('✗ 登录流程恢复');
    expect(summary).toContain('**验证命令**');
    expect(summary).toContain('命令: npm run typecheck');
    expect(summary).toContain('**证据索引**');
    expect(summary).toContain('[command] fail 验证命令');
    expect(summary).toContain('[check] fail 客观检查');
    expect(summary).toContain('建议续跑: /studio --resume --run-id uc-failed --max-agent-calls 30 修复登录失败');
  });
});
