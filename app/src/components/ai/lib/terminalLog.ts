/**
 * 终端日志流的纯函数：行切分、ANSI 清洗、语义级别推断。
 *
 * 与渲染组件 TerminalLog 分离，方便独立测试与复用（错误流、编译日志、
 * 多智能体状态流等都可走同一套分类规则）。
 */

export type LogLevel = 'error' | 'warn' | 'ok' | 'info' | 'debug' | 'plain';

export interface LogLine {
  level: LogLevel;
  text: string;
}

/** 语义级别 → Tailwind 语义色工具类（均由全局主题令牌驱动）。 */
export const LEVEL_TEXT_CLASS: Record<LogLevel, string> = {
  error: 'text-status-error',
  warn: 'text-status-running',
  ok: 'text-status-success',
  info: 'text-accent',
  debug: 'text-fg-faint',
  plain: 'text-fg-dim',
};

const ESC = String.fromCharCode(27);
const ANSI_ESCAPE_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

/** 去掉 ANSI 转义序列（终端原始输出常携带），只保留可见文本。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

/** 按关键词推断一行日志的语义级别。 */
export function classifyLogLine(text: string): LogLevel {
  const t = text.trim();
  if (!t) return 'plain';
  if (
    /\b(?:error|fatal|fail|exception|TypeError|ReferenceError|SyntaxError|RangeError|AggregateError)/i.test(
      t,
    ) ||
    /[✗✘]/.test(t)
  ) {
    return 'error';
  }
  if (/\b(?:warn(?:ing)?|⚠)\b/i.test(t)) return 'warn';
  if (/\b(?:ok|done|success|✓|✔)\b/i.test(t)) return 'ok';
  if (/^\[[^\]]*\]/.test(t) || /\b(?:context|cache)\s+\d/i.test(t) || /^\s*(?:·|●)\s/.test(t)) {
    return 'info';
  }
  if (/\b(?:debug|dbg|trace)\b/i.test(t)) return 'debug';
  return 'plain';
}

/** 把多行日志文本解析为带级别的行列表（空行保留为 plain，用于间距）。 */
export function parseLogLines(text: string): LogLine[] {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => ({ level: classifyLogLine(line), text: line }));
}
