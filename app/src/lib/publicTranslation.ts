import type { Locale } from '@/lib/i18n';
import {
  loadTranslationSettings,
  translationProviderReady,
  type TranslationProviderId,
  type TranslationSettings,
} from '@/lib/translationSettings';

const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const BAIDU_TRANSLATE_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
const TRANSLATE_TIMEOUT_MS = 15_000;
const MAX_QUERY_CHARS = 4_500;
const TOKEN_PREFIX = 'UGSXLT';

const GOOGLE_LANG_BY_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  'en-US': 'en',
  'fr-FR': 'fr',
  'ru-RU': 'ru',
  'es-ES': 'es',
  'hi-IN': 'hi',
  'ar-SA': 'ar',
  'pt-BR': 'pt',
  'ja-JP': 'ja',
  'de-DE': 'de',
  'ko-KR': 'ko',
};

const MYMEMORY_LANG_BY_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  'en-US': 'en-US',
  'fr-FR': 'fr-FR',
  'ru-RU': 'ru-RU',
  'es-ES': 'es-ES',
  'hi-IN': 'hi-IN',
  'ar-SA': 'ar-SA',
  'pt-BR': 'pt-BR',
  'ja-JP': 'ja-JP',
  'de-DE': 'de-DE',
  'ko-KR': 'ko-KR',
};

const BAIDU_LANG_BY_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh',
  'en-US': 'en',
  'fr-FR': 'fra',
  'ru-RU': 'ru',
  'es-ES': 'spa',
  'hi-IN': 'hi',
  'ar-SA': 'ara',
  'pt-BR': 'pt',
  'ja-JP': 'jp',
  'de-DE': 'de',
  'ko-KR': 'kor',
};

const LIBRE_LANG_BY_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh',
  'en-US': 'en',
  'fr-FR': 'fr',
  'ru-RU': 'ru',
  'es-ES': 'es',
  'hi-IN': 'hi',
  'ar-SA': 'ar',
  'pt-BR': 'pt',
  'ja-JP': 'ja',
  'de-DE': 'de',
  'ko-KR': 'ko',
};

const PROTECTED_MARKDOWN =
  /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s)]+|(?:[A-Za-z]:\\|\\\\)[^\s"'`<>|?*\r\n]*/g;

const MD5_SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
);

interface ProtectedText {
  text: string;
  values: string[];
}

export async function translatePublicText(
  text: string,
  target: Locale,
  sourceLocale?: Locale,
): Promise<string> {
  const source = text.trim();
  if (!source) return '';

  const settings = loadTranslationSettings();
  const protectedText = protectUntranslatedMarkdown(source);
  const chunks = splitForTranslate(protectedText.text, MAX_QUERY_CHARS);
  const translatedChunks = await Promise.all(
    chunks.map((chunk) =>
      translatePublicChunk(chunk, target, sourceLocale, settings),
    ),
  );

  return restoreProtectedMarkdown(
    translatedChunks.join(''),
    protectedText.values,
  ).trim();
}

async function translatePublicChunk(
  text: string,
  target: Locale,
  source: Locale | undefined,
  settings: TranslationSettings,
): Promise<string> {
  const providers = translationProviderOrder(settings);
  let firstError: unknown = null;

  for (const providerId of providers) {
    if (!translationProviderReady(providerId, settings)) continue;
    if (providerId === 'mymemory' && (!source || source === target)) continue;
    try {
      return await translateProviderChunk(providerId, text, target, source, settings);
    } catch (err) {
      firstError ??= err;
    }
  }

  throw firstError instanceof Error
    ? firstError
    : new Error('公共翻译请求失败');
}

function translationProviderOrder(
  settings: TranslationSettings,
): TranslationProviderId[] {
  const fallbacks: TranslationProviderId[] =
    settings.providerId === 'google'
      ? ['baidu', 'mymemory', 'libretranslate']
      : ['mymemory', 'google', 'libretranslate'];
  return uniqueProviders([settings.providerId, ...fallbacks]);
}

function uniqueProviders(
  providers: TranslationProviderId[],
): TranslationProviderId[] {
  const seen = new Set<TranslationProviderId>();
  return providers.filter((providerId) => {
    if (seen.has(providerId)) return false;
    seen.add(providerId);
    return true;
  });
}

async function translateProviderChunk(
  providerId: TranslationProviderId,
  text: string,
  target: Locale,
  source: Locale | undefined,
  settings: TranslationSettings,
): Promise<string> {
  switch (providerId) {
    case 'google':
      return translateGoogleChunk(text, target);
    case 'baidu':
      return translateBaiduChunk(text, target, source, settings);
    case 'mymemory':
      if (!source) throw new Error('MyMemory 翻译需要已知源语言');
      return translateMyMemoryChunk(text, source, target);
    case 'libretranslate':
      return translateLibreTranslateChunk(text, target, source, settings);
    default:
      providerId satisfies never;
      throw new Error('未知翻译服务');
  }
}

function protectUntranslatedMarkdown(text: string): ProtectedText {
  const values: string[] = [];
  const masked = text.replace(PROTECTED_MARKDOWN, (value) => {
    const index = values.push(value) - 1;
    return `${TOKEN_PREFIX}${index}X`;
  });
  return { text: masked, values };
}

function restoreProtectedMarkdown(text: string, values: string[]): string {
  return text.replace(
    new RegExp(`${TOKEN_PREFIX}(\\d+)X`, 'g'),
    (match, index: string) => values[Number(index)] ?? match,
  );
}

function splitForTranslate(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const parts = text.split(/(\n{2,})/);
  let current = '';

  for (const part of parts) {
    if (!part) continue;
    if (current && current.length + part.length > maxChars) {
      chunks.push(current);
      current = '';
    }

    if (part.length <= maxChars) {
      current += part;
      continue;
    }

    for (let start = 0; start < part.length; start += maxChars) {
      const slice = part.slice(start, start + maxChars);
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(slice);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function translateGoogleChunk(
  text: string,
  target: Locale,
): Promise<string> {
  const url = new URL(GOOGLE_TRANSLATE_URL);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', GOOGLE_LANG_BY_LOCALE[target]);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  return parseGoogleTranslateResponse(await fetchJsonWithTimeout(url));
}

async function translateMyMemoryChunk(
  text: string,
  source: Locale,
  target: Locale,
): Promise<string> {
  const url = new URL(MYMEMORY_TRANSLATE_URL);
  url.searchParams.set('q', text);
  url.searchParams.set(
    'langpair',
    `${MYMEMORY_LANG_BY_LOCALE[source]}|${MYMEMORY_LANG_BY_LOCALE[target]}`,
  );

  return parseMyMemoryTranslateResponse(await fetchJsonWithTimeout(url));
}

async function translateBaiduChunk(
  text: string,
  target: Locale,
  source: Locale | undefined,
  settings: TranslationSettings,
): Promise<string> {
  if (!settings.baiduAppId || !settings.baiduSecretKey) {
    throw new Error('百度翻译需要先配置 APP ID 和密钥');
  }

  const salt = String(Date.now());
  const url = new URL(BAIDU_TRANSLATE_URL);
  url.searchParams.set('q', text);
  url.searchParams.set(
    'from',
    source ? BAIDU_LANG_BY_LOCALE[source] : 'auto',
  );
  url.searchParams.set('to', BAIDU_LANG_BY_LOCALE[target]);
  url.searchParams.set('appid', settings.baiduAppId);
  url.searchParams.set('salt', salt);
  url.searchParams.set(
    'sign',
    md5(`${settings.baiduAppId}${text}${salt}${settings.baiduSecretKey}`),
  );

  return parseBaiduTranslateResponse(await fetchJsonWithTimeout(url));
}

async function translateLibreTranslateChunk(
  text: string,
  target: Locale,
  source: Locale | undefined,
  settings: TranslationSettings,
): Promise<string> {
  const baseUrl = settings.libreTranslateBaseUrl.replace(/\/+$/u, '');
  if (!baseUrl) throw new Error('LibreTranslate Base URL 不能为空');

  const body: Record<string, string> = {
    q: text,
    source: source ? LIBRE_LANG_BY_LOCALE[source] : 'auto',
    target: LIBRE_LANG_BY_LOCALE[target],
    format: 'text',
  };
  if (settings.libreTranslateApiKey) {
    body.api_key = settings.libreTranslateApiKey;
  }

  return parseLibreTranslateResponse(
    await fetchJsonWithTimeout(new URL(`${baseUrl}/translate`), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
}

async function fetchJsonWithTimeout(
  url: URL,
  init?: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseGoogleTranslateResponse(body: unknown): string {
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw new Error('公共翻译返回格式异常');
  }

  const translated = body[0]
    .map((segment) => {
      if (!Array.isArray(segment)) return '';
      return typeof segment[0] === 'string' ? segment[0] : '';
    })
    .join('');

  if (!translated.trim()) {
    throw new Error('公共翻译返回空结果');
  }
  return translated;
}

function parseMyMemoryTranslateResponse(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('公共翻译返回格式异常');
  }
  const record = body as {
    responseStatus?: number | string;
    responseDetails?: string;
    responseData?: { translatedText?: unknown };
  };
  if (Number(record.responseStatus) !== 200) {
    throw new Error(record.responseDetails || '公共翻译请求失败');
  }
  const translated = record.responseData?.translatedText;
  if (typeof translated !== 'string' || !translated.trim()) {
    throw new Error('公共翻译返回空结果');
  }
  return translated;
}

function parseBaiduTranslateResponse(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('公共翻译返回格式异常');
  }
  const record = body as {
    error_code?: string;
    error_msg?: string;
    trans_result?: Array<{ dst?: unknown }>;
  };
  if (record.error_code) {
    throw new Error(record.error_msg || `百度翻译请求失败: ${record.error_code}`);
  }
  const translated = record.trans_result
    ?.map((item) => (typeof item.dst === 'string' ? item.dst : ''))
    .join('');
  if (!translated?.trim()) {
    throw new Error('公共翻译返回空结果');
  }
  return translated;
}

function parseLibreTranslateResponse(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('公共翻译返回格式异常');
  }
  const translated = (body as { translatedText?: unknown }).translatedText;
  if (typeof translated !== 'string' || !translated.trim()) {
    throw new Error('公共翻译返回空结果');
  }
  return translated;
}

function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x1_0000_0000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) =>
      view.getUint32(offset + index * 4, true),
    );
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      const previousD = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + MD5_K[index] + words[g]) | 0, MD5_SHIFT_AMOUNTS[index])) | 0;
      a = previousD;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0].map(wordToLittleEndianHex).join('');
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function wordToLittleEndianHex(word: number): string {
  let result = '';
  for (let index = 0; index < 4; index += 1) {
    result += ((word >>> (index * 8)) & 0xff)
      .toString(16)
      .padStart(2, '0');
  }
  return result;
}

export const __publicTranslationForTests = {
  protectUntranslatedMarkdown,
  restoreProtectedMarkdown,
  splitForTranslate,
  parseGoogleTranslateResponse,
  parseMyMemoryTranslateResponse,
  parseBaiduTranslateResponse,
  parseLibreTranslateResponse,
  md5,
};
