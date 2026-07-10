import { completeGatewayText } from '@/lib/modelGateway/modelGateway';
import type { ResolvedGatewayRoute } from '@/lib/modelGateway/types';
import type { Locale } from '@/lib/i18n';

const MAX_PROMPT_TEXT_CHARS = 3000;
const MAX_GENERATED_TITLE_CHARS = 36;
const TITLE_NAMING_TIMEOUT_SECONDS = 180;
const INTENT_TITLE_NAMING_TIMEOUT_SECONDS = 60;

function clipText(text: string, maxChars = MAX_PROMPT_TEXT_CHARS): string {
  const chars = Array.from(text.trim());
  if (chars.length <= maxChars) return chars.join('');
  return `${chars.slice(0, maxChars).join('')}\n...`;
}

export function normalizeGeneratedSessionTitle(
  raw: string,
  fallback: string,
): string {
  const firstLine =
    raw
      .replace(/^```[a-z0-9_-]*\s*/i, '')
      .replace(/```\s*$/i, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('```')) ?? '';

  let title = firstLine
    .replace(/^\s*(?:[-*•]\s*|\d+[.)、]\s*)/, '')
    .replace(/^(?:标题|会话标题|话题标题|Title)\s*[:：]\s*/i, '')
    .trim();

  for (;;) {
    const next = title
      .replace(/^[\s"'`“”‘’「」『』《》【】[\]({（]+/, '')
      .replace(/[\s"'`“”‘’「」『』《》【】[\])}）.。!！?？,，;；:：、…]+$/, '')
      .trim();
    if (next === title) break;
    title = next;
  }

  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return fallback;

  const chars = Array.from(title);
  return chars.length > MAX_GENERATED_TITLE_CHARS
    ? chars.slice(0, MAX_GENERATED_TITLE_CHARS).join('').trim()
    : title;
}

function sessionTitleNamingSystem(locale: Locale, hasAssistantText: boolean): string {
  const localeLine =
    locale === 'en-US'
      ? 'Prefer the language used by the user.'
      : '优先使用用户输入的语言。';
  return [
    '你是对话命名模型，只负责给聊天会话起短标题。',
    hasAssistantText
      ? '根据首轮用户消息和首轮助手回复生成标题。'
      : '根据首条用户消息推断用户意图并生成标题，不需要等待助手回复。',
    '忽略截图路径、本地文件路径、粘贴图片文件名和冗长日志，聚焦用户真正要解决的问题。',
    '要求：10 个词以内；中文优先 6-18 个字；不要标点、引号、Markdown 或解释。',
    '只输出标题本身。',
    localeLine,
  ].join('\n');
}

function sessionTitleNamingPrompt(args: {
  userText: string;
  assistantText?: string;
}): string {
  const assistantText = args.assistantText?.trim() ?? '';
  if (!assistantText) {
    return [
      '用户输入：',
      clipText(args.userText),
      '',
      '请理解用户意图，输出短标题：',
    ].join('\n');
  }
  return [
    '首轮用户消息：',
    clipText(args.userText),
    '',
    '首轮助手回复：',
    clipText(assistantText),
    '',
    '请输出短标题：',
  ].join('\n');
}

export async function generateSessionTitle(args: {
  route: ResolvedGatewayRoute;
  userText: string;
  assistantText?: string;
  fallbackTitle: string;
  locale: Locale;
  cwd?: string;
}): Promise<string> {
  const hasAssistantText = !!args.assistantText?.trim();
  const raw = await completeGatewayText({
    route: args.route,
    system: sessionTitleNamingSystem(args.locale, hasAssistantText),
    userContent: sessionTitleNamingPrompt(args),
    maxTokens: 64,
    permission: 'read-only',
    cwd: args.cwd,
    timeoutSeconds: hasAssistantText
      ? TITLE_NAMING_TIMEOUT_SECONDS
      : INTENT_TITLE_NAMING_TIMEOUT_SECONDS,
  });
  return normalizeGeneratedSessionTitle(raw, args.fallbackTitle);
}
