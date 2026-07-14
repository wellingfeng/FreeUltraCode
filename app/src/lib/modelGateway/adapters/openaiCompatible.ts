import type { GatewayTextRequest } from '../types';
import {
  mergeUsageReports,
  usageReportFromOpenAI,
  type ModelUsageReport,
} from '@/lib/usageMeter';
import { canUseProviderDirectTransport } from '@/lib/apiConfig';

export async function completeOpenAICompatible(
  request: GatewayTextRequest,
): Promise<string> {
  const apiKey = request.route.apiKey?.trim();
  if (!canUseProviderDirectTransport(apiKey, request.route.baseUrl)) {
    throw new Error('NO_API_KEY');
  }
  const model = request.route.model?.trim();
  if (!model) throw new Error('NO_MODEL');

  const endpoint = resolveChatCompletionsEndpoint(request.route.baseUrl);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  let res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(openAICompatibleBody(request, model, true)),
    signal: request.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await safeText(res);
    if (shouldRetryWithoutStreamUsage(res.status, detail)) {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(openAICompatibleBody(request, model, false)),
        signal: request.signal,
      });
      if (res.ok && res.body) {
        return readOpenAICompatibleResponse(res, request);
      }
      const retryDetail = await safeText(res);
      throw new Error(`HTTP ${res.status}: ${retryDetail}`);
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return readOpenAICompatibleResponse(res, request);
}

function openAICompatibleBody(
  request: GatewayTextRequest,
  model: string,
  includeUsage: boolean,
) {
  return {
    model,
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    max_tokens: request.maxTokens ?? 4096,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: openAICompatibleUserContent(request) },
    ],
  };
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Build the OpenAI-compatible user content. Plain string with no images
 * (back-compat); a multimodal parts array when `userImages` are present. Both
 * `data:` and http(s) URLs are passed through as `image_url.url`, which the
 * OpenAI vision schema accepts directly.
 */
function openAICompatibleUserContent(
  request: GatewayTextRequest,
): string | OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = [];
  for (const src of request.userImages ?? []) {
    const trimmed = src?.trim();
    if (!trimmed) continue;
    if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
      parts.push({ type: 'image_url', image_url: { url: trimmed } });
    }
  }
  if (parts.length === 0) return request.userContent;
  return [...parts, { type: 'text', text: request.userContent }];
}

async function readOpenAICompatibleResponse(
  res: Response,
  request: GatewayTextRequest,
): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (/\bjson\b/i.test(contentType)) {
    return readOpenAICompatibleJson(await res.text(), request);
  }
  return readOpenAICompatibleStream(res, request);
}

async function readOpenAICompatibleStream(
  res: Response,
  request: GatewayTextRequest,
): Promise<string> {
  if (!res.body) throw new Error('EMPTY_STREAM_BODY');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let usage: ModelUsageReport | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data) as {
          choices?: Array<OpenAIChoice>;
          usage?: unknown;
        };
        usage = mergeUsageReports(usage, usageReportFromOpenAI(evt.usage));
        full = appendOpenAIText(full, evt.choices?.[0], request);
      } catch {
        /* ignore malformed keep-alive lines */
      }
    }
  }
  if (usage) request.onUsage?.(usage);

  return full;
}

type OpenAIChoice = {
  delta?: { content?: unknown };
  message?: { content?: unknown };
  text?: unknown;
};

function readOpenAICompatibleJson(
  raw: string,
  request: GatewayTextRequest,
): string {
  try {
    const evt = JSON.parse(raw) as {
      choices?: Array<OpenAIChoice>;
      usage?: unknown;
    };
    const usage = usageReportFromOpenAI(evt.usage);
    if (usage) request.onUsage?.(usage);
    return appendOpenAIText('', evt.choices?.[0], request);
  } catch {
    return '';
  }
}

function appendOpenAIText(
  current: string,
  choice: OpenAIChoice | undefined,
  request: GatewayTextRequest,
): string {
  const delta = textFromOpenAIContent(choice?.delta?.content);
  if (delta) {
    request.onDelta?.(delta);
    return current + delta;
  }

  const text = textFromOpenAIContent(choice?.text);
  if (text) {
    request.onDelta?.(text);
    return current + text;
  }

  const message = textFromOpenAIContent(choice?.message?.content);
  if (!message) return current;
  const appended = appendMaybeCumulativeText(current, message);
  const deltaText = appended.slice(current.length);
  if (deltaText) request.onDelta?.(deltaText);
  return appended;
}

function appendMaybeCumulativeText(current: string, next: string): string {
  if (!current || !next.startsWith(current)) return current + next;
  return next;
}

function textFromOpenAIContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type?: unknown }).type === 'text' &&
        'text' in part &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('');
}

function shouldRetryWithoutStreamUsage(status: number, detail: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /stream_options|include_usage|unknown parameter|unrecognized request argument|extra fields/i.test(
    detail,
  );
}

function resolveChatCompletionsEndpoint(baseUrl?: string): string {
  const raw = baseUrl?.trim().replace(/\/+$/, '');
  if (!raw) return 'https://api.openai.com/v1/chat/completions';
  if (raw.endsWith('/chat/completions')) return raw;
  if (/\/(?:v\d+(?:beta)?|openai)$/i.test(raw)) {
    return `${raw}/chat/completions`;
  }
  return `${raw}/v1/chat/completions`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
