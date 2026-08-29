import { memo, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import { LEVEL_TEXT_CLASS, parseLogLines } from './lib/terminalLog';

/**
 * 终端日志流（信息流风格）渲染。
 *
 * 把一段多行日志文本按行切分，按内容关键词推断每行的语义级别并用终端
 * 语义色着色（error/ok/warn/info/debug/plain），整块以等宽字体、终端底
 * 色面板呈现，支持 streaming 时自动滚底并显示闪烁光标。样式全部走主题
 * 令牌（var(--code-bg)/var(--status-*)），不写死颜色，跟随外观预设。
 */

export interface TerminalLogProps {
  text: string;
  /** 实时流式输出时开启：自动滚底 + 行尾闪烁光标。 */
  streaming?: boolean;
  className?: string;
  'aria-label'?: string;
}

function TerminalLogImpl({
  text,
  streaming = false,
  className,
  'aria-label': ariaLabel,
}: TerminalLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => parseLogLines(text), [text]);

  // 流式期间保持滚动吸附到底部，模拟终端持续输出的效果。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && streaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines.length, streaming]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live={streaming ? 'polite' : 'off'}
      aria-label={ariaLabel}
      className={cn(
        'overflow-auto rounded-sm border border-[var(--code-border)] bg-[var(--code-bg)] p-2.5 font-mono text-[12px] leading-relaxed',
        className,
      )}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn('whitespace-pre-wrap break-words', LEVEL_TEXT_CLASS[line.level])}
        >
          {line.text || '\u00a0'}
        </div>
      ))}
      {streaming && <span className="ai-caret ai-caret--trailing" aria-hidden />}
    </div>
  );
}

const TerminalLog = memo(TerminalLogImpl);
export default TerminalLog;
