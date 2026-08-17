import { describe, expect, it } from 'vitest';
import { failureTitle, parseRunFailure } from './failure';

describe('run failure classification', () => {
  it('classifies Codex thread startup timeout', () => {
    const failure = parseRunFailure('Codex thread/start 响应超时（30s）。');
    expect(failure).toMatchObject({
      code: 'startup_timeout',
      timeoutSeconds: 30,
    });
    expect(failureTitle(failure)).toBe('启动超时');
  });

  it('classifies Codex first-event timeout', () => {
    const failure = parseRunFailure(
      'Codex turn 已启动，但 90s 内未收到模型或工具事件，已终止。',
    );
    expect(failure).toMatchObject({
      code: 'first_event_timeout',
      timeoutSeconds: 90,
    });
    expect(failureTitle(failure)).toBe('首事件超时');
  });

  it('classifies fatal Codex app-server protocol errors', () => {
    const failure = parseRunFailure(
      'Codex ugs-turn-start 失败：invalid params',
    );
    expect(failure.code).toBe('protocol');
    expect(failureTitle(failure)).toBe('协议失败');
  });

  it('classifies empty success (exit 0 with no model output) as exit failure', () => {
    const failure = parseRunFailure(
      'CLI "claude" 未产生任何回复就退出（退出码 0）：CLI 退出但未返回任何内容',
    );
    expect(failure).toMatchObject({
      code: 'exit',
      cli: 'claude',
      exitCode: 0,
    });
    expect(failure.message).toContain('已退出但未返回模型内容');
    expect(failureTitle(failure)).toBe('执行失败');
  });
});
