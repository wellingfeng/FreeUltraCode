import { completeGatewayText } from '@/lib/modelGateway/modelGateway';
import type { ResolvedGatewayRoute } from '@/lib/modelGateway/types';
import type { Locale } from '@/lib/i18n';

const MAX_PROMPT_TEXT_CHARS = 3000;
const MAX_GENERATED_TITLE_CHARS = 36;
const TITLE_NAMING_TIMEOUT_SECONDS = 180;
const INTENT_TITLE_NAMING_TIMEOUT_SECONDS = 60;

function stripPathNoise(text: string): string {
  return text
    .replace(/`[^`\r\n]*(?:[\\/]|remote-project:\/\/)[^`\r\n]*`/gi, ' ')
    .replace(/`[^`\r\n]*\.(?:png|apng|jpe?g|gif|webp|bmp|svg|avif|ico)`/gi, ' ')
    .replace(/(?:file:\/\/\/)?[a-z]:[\\/][^\s`"'<>，。！？；：、,;:!?]+/gi, ' ')
    .trim()
    .replace(/^[\s`"'“”‘’「」『』《》【】[\]({（,，。;；:：、!！?？-]+/, '')
    .replace(/\s+/g, ' ');
}

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
    '忽略截图路径、本地文件路径、粘贴图片文件名和冗长日志；如果用户只发图片，请根据图片内容或助手回复概括主题。',
    '要求：10 个词以内；中文优先 6-18 个字；不要标点、引号、Markdown 或解释。',
    '只输出标题本身。',
    localeLine,
  ].join('\n');
}

function sessionTitleNamingPrompt(args: {
  userText: string;
  assistantText?: string;
  userImageCount?: number;
}): string {
  const assistantText = args.assistantText?.trim() ?? '';
  const userText = stripPathNoise(args.userText);
  const imageCount = Math.max(0, args.userImageCount ?? 0);
  const imageLine =
    imageCount > 0 ? `用户附加图片：${imageCount} 张图片或截图。` : '';
  const displayedUserText =
    userText ||
    (imageCount > 0 ? '（用户只上传了图片或截图，未输入文字）' : args.userText);
  if (!assistantText) {
    return [
      '用户输入：',
      clipText(displayedUserText),
      imageLine,
      '',
      '请理解用户意图，输出短标题：',
    ].filter((line) => line !== '').join('\n');
  }
  return [
    '首轮用户消息：',
    clipText(displayedUserText),
    imageLine,
    '',
    '首轮助手回复：',
    clipText(assistantText),
    '',
    '请输出短标题：',
  ].filter((line) => line !== '').join('\n');
}

export async function generateSessionTitle(args: {
  route: ResolvedGatewayRoute;
  userText: string;
  assistantText?: string;
  userImageCount?: number;
  userImages?: string[];
  fallbackTitle: string;
  locale: Locale;
  cwd?: string;
}): Promise<string> {
  const hasAssistantText = !!args.assistantText?.trim();
  const raw = await completeGatewayText({
    route: args.route,
    system: sessionTitleNamingSystem(args.locale, hasAssistantText),
    userContent: sessionTitleNamingPrompt(args),
    userImages: args.userImages,
    maxTokens: 64,
    permission: 'read-only',
    cwd: args.cwd,
    timeoutSeconds: hasAssistantText
      ? TITLE_NAMING_TIMEOUT_SECONDS
      : INTENT_TITLE_NAMING_TIMEOUT_SECONDS,
  });
  return normalizeGeneratedSessionTitle(raw, args.fallbackTitle);
}
