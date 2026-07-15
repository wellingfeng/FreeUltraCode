/**
 * CONTRACT: pure node-failure classification + formatting. No host coupling.
 *
 * Moved verbatim from store/useStore.ts. The desktop GUI re-exports these
 * (`describeRunFailure`/`isRetryableFailure`/…) so its existing call sites stay
 * unchanged; the Node CLI consumes them directly.
 */
import type { IRNode } from '../core/ir';
import type { RunFailure, RunFailureCode } from './types';

const RUN_ERROR_PREVIEW_LIMIT = 1200;

function compactRunError(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= RUN_ERROR_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, RUN_ERROR_PREVIEW_LIMIT)}\n...（错误信息已截断）`;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** Classify an arbitrary thrown error into a {@link RunFailure}. */
export function parseRunFailure(err: unknown): RunFailure {
  const raw = compactRunError(errorText(err));

  if (raw === 'NO_BACKEND') {
    return {
      code: 'backend',
      raw,
      message: '当前不在 Tauri 桌面壳，无法调用本地 CLI。',
    };
  }

  const timeout = /CLI "([^"]+)" 超时[（(](\d+)s[）)]已终止/u.exec(raw);
  if (timeout) {
    const seconds = Number(timeout[2]);
    return {
      code: 'timeout',
      raw,
      cli: timeout[1],
      timeoutSeconds: seconds,
      message: `CLI "${timeout[1]}" 超过 ${seconds}s 未完成，已终止。可通过 ULTRAGAMESTUDIO_AI_CLI_TIMEOUT_SECS 调整上限。`,
    };
  }

  const idleTimeout =
    /CLI "([^"]+)" 空转超过 (\d+)s 未产生输出，已终止/u.exec(raw);
  if (idleTimeout) {
    const seconds = Number(idleTimeout[2]);
    return {
      code: 'idle_timeout',
      raw,
      cli: idleTimeout[1],
      idleTimeoutSeconds: seconds,
      message: `CLI "${idleTimeout[1]}" 超过 ${seconds}s 没有新的输出或结果文件更新，已终止。可通过 ULTRAGAMESTUDIO_AI_CLI_IDLE_TIMEOUT_SECS 调整。`,
    };
  }

  const startupTimeout =
    /Codex (thread\/start|turn\/start) 响应超时[（(](\d+)s[）)]/u.exec(raw);
  if (startupTimeout) {
    const seconds = Number(startupTimeout[2]);
    return {
      code: 'startup_timeout',
      raw,
      timeoutSeconds: seconds,
      message: `Codex ${startupTimeout[1]} 在 ${seconds}s 内未响应，已终止。`,
    };
  }

  const firstEventTimeout =
    /Codex turn 已启动，但 (\d+)s 内未收到模型或工具事件，已终止/u.exec(raw);
  if (firstEventTimeout) {
    const seconds = Number(firstEventTimeout[1]);
    return {
      code: 'first_event_timeout',
      raw,
      timeoutSeconds: seconds,
      message: `Codex turn 已启动，但 ${seconds}s 内没有模型或工具事件，已终止。`,
    };
  }

  if (
    /Codex (?:initialize|initialized|thread\/start|turn\/start) 写入失败/u.test(raw) ||
    /Codex ugs-(?:init|thread-start|turn-start) 失败/u.test(raw)
  ) {
    return {
      code: 'protocol',
      raw,
      message: raw,
    };
  }

  const interrupted = /CLI "([^"]+)" 已由用户中断/u.exec(raw);
  if (interrupted) {
    return {
      code: 'interrupted',
      raw,
      cli: interrupted[1],
      message: `CLI "${interrupted[1]}" 已由用户中断。`,
    };
  }

  const exit = /CLI "([^"]+)" 退出码 (-?\d+):\s*([\s\S]*)/u.exec(raw);
  if (exit) {
    const detail = exit[3]?.trim();
    return {
      code: 'exit',
      raw,
      cli: exit[1],
      exitCode: Number(exit[2]),
      message: `CLI "${exit[1]}" 退出码 ${exit[2]}${
        detail ? `: ${detail}` : ''
      }`,
    };
  }

  const spawn = /启动 CLI "([^"]+)" 失败:\s*([\s\S]*)/u.exec(raw);
  if (spawn) {
    return {
      code: 'spawn',
      raw,
      cli: spawn[1],
      message: `无法启动 CLI "${spawn[1]}"：${spawn[2].trim()}`,
    };
  }

  const wait = /等待 CLI "([^"]+)" 失败:\s*([\s\S]*)/u.exec(raw);
  if (wait) {
    return {
      code: 'wait',
      raw,
      cli: wait[1],
      message: `等待 CLI "${wait[1]}" 结束失败：${wait[2].trim()}`,
    };
  }

  return { code: 'unknown', raw, message: raw || '未知错误' };
}

/**
 * Failure codes worth re-attempting automatically. These are transient or
 * non-deterministic. User interruptions, a missing desktop backend, and
 * unresolvable launch errors are NOT retried.
 */
export const RETRYABLE_FAILURE_CODES: ReadonlySet<RunFailureCode> = new Set([
  'timeout',
  'idle_timeout',
  'startup_timeout',
  'first_event_timeout',
  'exit',
  'wait',
  'unknown',
]);

export function isRetryable(failure: RunFailure): boolean {
  return RETRYABLE_FAILURE_CODES.has(failure.code);
}

export function failureTitle(failure: RunFailure): string {
  switch (failure.code) {
    case 'timeout':
      return '超时';
    case 'idle_timeout':
      return '空转超时';
    case 'startup_timeout':
      return '启动超时';
    case 'first_event_timeout':
      return '首事件超时';
    case 'protocol':
      return '协议失败';
    case 'interrupted':
      return '已中断';
    case 'exit':
      return '执行失败';
    case 'spawn':
      return '启动失败';
    case 'backend':
      return '后端不可用';
    case 'wait':
      return '等待失败';
    default:
      return '失败';
  }
}

export function formatFailureLine(label: string, failure: RunFailure): string {
  return `✗ ${label} ${failureTitle(failure)}: ${failure.message}`;
}

export function runFailureMeta(
  node: IRNode,
  adapter: string,
  failure: RunFailure,
): Record<string, unknown> {
  return {
    code: failure.code,
    message: failure.message,
    raw: failure.raw,
    adapter,
    nodeId: node.id,
    nodeLabel: node.label ?? node.type,
    nodeType: node.type,
    occurredAt: Date.now(),
    ...(failure.cli ? { cli: failure.cli } : {}),
    ...(failure.exitCode == null ? {} : { exitCode: failure.exitCode }),
    ...(failure.timeoutSeconds == null
      ? {}
      : { timeoutSeconds: failure.timeoutSeconds }),
    ...(failure.idleTimeoutSeconds == null
      ? {}
      : { idleTimeoutSeconds: failure.idleTimeoutSeconds }),
  };
}
