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
});
