import { useState } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import type { ToolEvent } from './lib/toolEvent';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import ToolIcon from './ToolIcon';
import { scanFileRefs } from './lib/fileScan';
import FileChip, { type OpenFileFn } from './FileChip';
import { compactToolSubject, toolSubjectAllowsFileRefs } from './lib/toolDisplay';
import RawCodeBlock from './RawCodeBlock';
import TerminalLog from './TerminalLog';
import { inferToolCodeLanguage, type ToolCodePanel } from './lib/toolCode';

/** Format a duration in ms as a compact human string. */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function StatusGlyph({ status }: { status: ToolEvent['status'] }) {
  if (status === 'running')
    return <Loader2 size={11} className="animate-spin text-status-running" />;
  if (status === 'error') return <X size={11} className="text-status-error" />;
  return <Check size={11} className="ai-tool-status-done" />;
}

function isPlainTextLanguage(language: string): boolean {
  return (
    language === '' ||
    language === 'text' ||
    language === 'txt' ||
    language === 'plain' ||
    language === 'plaintext'
  );
}

/** Render a tool's args/result body with the same code chrome as AI code blocks. */
function Panel({
  label,
  body,
  language,
  onOpenFile,
  cwd,
  linkify = false,
  streaming = false,
}: {
  label: string;
  body: string;
  language: string;
  onOpenFile?: OpenFileFn;
  cwd?: string;
  linkify?: boolean;
  streaming?: boolean;
}) {
  const shouldLinkify = linkify && isPlainTextLanguage(language.toLowerCase());
  return (
    <div className="mt-1">
      <div className="ai-tool-label mb-0.5 font-mono text-[10px] uppercase tracking-wider">
        {label}
      </div>
      {shouldLinkify ? (
        <div className="ai-tool-panel rounded-sm border border-[var(--code-border)] bg-[var(--code-bg)] p-2.5 text-[12.5px] leading-relaxed text-fg">
          {scanFileRefs(body).map((p, i) =>
            typeof p === 'string' ? (
              <span key={i}>{p}</span>
            ) : (
              <FileChip key={i} refData={p} onOpenFile={onOpenFile} cwd={cwd} />
            ),
          )}
        </div>
      ) : language === 'log' ? (
        // 日志/错误流以终端信息流风格渲染：逐行语义色、流式光标、自动滚底。
        <TerminalLog text={body} streaming={streaming} className="ai-tool-panel" />
      ) : (
        <RawCodeBlock
          raw={body}
          language={language}
          compact
          className="ai-tool-panel"
          maxLines={14}
        />
      )}
    </div>
  );
}

/**
 * A structured tool-call card (wave-2): per-tool icon + name + subject, a status
 * glyph, a duration, and a chevron that expands the args + result panels. Quiet
 * read-only successful calls render as a slim dimmed row; writer/errored/running
 * calls render as full cards. Sub-agent (`task`) children nest recursively.
 */
export default function ToolCard({
  event,
  childrenEvents,
  onOpenFile,
  depth = 0,
  cwd,
}: {
  event: ToolEvent;
  childrenEvents?: ToolEvent[];
  onOpenFile?: OpenFileFn;
  depth?: number;
  cwd?: string;
}) {
  const [open, setOpen] = useState(false);
  const locale = useStore((s) => s.locale);

  const subject = event.subject ?? '';
  const collapsedSubject = compactToolSubject(event.name, subject);
  const subjectCompacted =
    !!subject && collapsedSubject !== subject.replace(/[\r\n]+/g, ' ').trim();
  const linkFileRefs = toolSubjectAllowsFileRefs(event.name);
  const renderSubject = (text: string) => {
    if (!text) return null;
    if (!linkFileRefs) return text;
    const parts = scanFileRefs(text);
    return parts.map((p, i) =>
      typeof p === 'string' ? (
        <span key={i}>{p}</span>
      ) : (
        <FileChip key={i} refData={p} onOpenFile={onOpenFile} cwd={cwd} />
      ),
    );
  };

  const argsIsJson = event.args !== undefined && event.args !== null && typeof event.args !== 'string';
  const argsBody =
    event.args === undefined || event.args === null
      ? ''
      : typeof event.args === 'string'
        ? event.args
        : safeJson(event.args);
  const hasBody =
    (event.args !== undefined && event.args !== null) ||
    (event.result != null && event.result !== '') ||
    (childrenEvents?.length ?? 0) > 0 ||
    (subjectCompacted && !argsBody);
  const toolLanguage = (
    panel: ToolCodePanel,
    body: string,
    bodyFromJson = false,
  ) => inferToolCodeLanguage(event, panel, body, bodyFromJson);

  return (
    <div
      className="ai-tool-card my-1 rounded-[4px]"
      data-open={open ? 'true' : 'false'}
      data-status={event.status}
      style={depth ? { marginLeft: depth * 14 } : undefined}
    >
      <div className="flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] leading-snug">
        {hasBody ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? t(locale, 'chat.collapse') : t(locale, 'chat.expand')}
            className="ai-tool-toggle -ml-0.5 flex shrink-0 items-center transition-colors"
          >
            <ChevronRight
              size={11}
              className={'transition-transform ' + (open ? 'rotate-90' : '')}
            />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <ToolIcon name={event.name} size={11} className="ai-tool-icon shrink-0" />
        <span className="ai-tool-name shrink-0 font-medium">{event.name}</span>
        {collapsedSubject && (
          <span className="ai-tool-subject min-w-0 flex-1 truncate">
            {renderSubject(collapsedSubject)}
          </span>
        )}
        {!collapsedSubject && <span className="flex-1" />}
        {event.durationMs != null && (
          <span className="ai-tool-meta shrink-0 tabular-nums">
            {fmtDuration(event.durationMs)}
          </span>
        )}
        <StatusGlyph status={event.status} />
      </div>

      {open && hasBody && (
        <div className="ai-tool-body px-2.5 py-1.5">
          {subjectCompacted && !argsBody && (
            <Panel
              label={t(locale, 'chat.details')}
              body={subject}
              language={toolLanguage('details', subject)}
            />
          )}
          {argsBody && (
            <Panel
              label={t(locale, 'chat.request')}
              body={argsBody}
              language={toolLanguage('request', argsBody, argsIsJson)}
            />
          )}
          {event.result != null && event.result !== '' && (
            <Panel
              label={event.truncated ? t(locale, 'chat.responseTruncated') : t(locale, 'chat.response')}
              body={event.result}
              language={toolLanguage('response', event.result)}
              onOpenFile={onOpenFile}
              cwd={cwd}
              linkify
              streaming={event.status === 'running'}
            />
          )}
          {childrenEvents?.map((child) => (
            <ToolCard
              key={child.id}
              event={child}
              onOpenFile={onOpenFile}
              depth={depth + 1}
              cwd={cwd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
