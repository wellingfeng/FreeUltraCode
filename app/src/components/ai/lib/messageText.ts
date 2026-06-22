import { segmentMessage } from './segmenter';
import { extractToolSentinels, hasToolSentinel } from './toolEvent';

const ROUTE_LINE_RE =
  /^⚙ (?:(?:路由：(?<route>.*?)(?: · 模型：(?<model>.*))?)|(?:模型：(?<modelOnly>.*)))$/m;

export function routeLabelFromText(text: string): string {
  const match = text.match(ROUTE_LINE_RE);
  const groups = match?.groups;
  if (!groups) return '';
  const route = groups.route?.trim() ?? '';
  const model = (groups.model ?? groups.modelOnly ?? '').trim();
  return [route, model].filter(Boolean).join(' · ');
}

export function stripRouteLine(text: string): string {
  return text.replace(ROUTE_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trimStart();
}

/**
 * Strip inline tool sentinels (`<<UGS_TOOL>>...`) from a message's text so
 * search indexes and plain fallbacks never show raw protocol JSON.
 */
export function cleanMessageText(text: string): string {
  const visible = hasToolSentinel(text) ? extractToolSentinels(text).text : text;
  return stripRouteLine(visible);
}

export function renderMessageText(text: string): string {
  return stripRouteLine(text);
}

/**
 * Text payload for per-answer actions. Keeps answer prose only: no route/timing
 * chrome, reasoning, legacy tool lines, or structured tool cards.
 */
export function answerActionText(text: string): string {
  const visible = stripRouteLine(text).replace(/^⏱[^\n]*\n/u, '');
  return segmentMessage(visible, false)
    .filter((segment) => segment.type === 'answer')
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
