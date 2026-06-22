import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __publicTranslationForTests,
  translatePublicText,
} from './publicTranslation';
import {
  normalizeTranslationSettings,
  saveTranslationSettings,
  translationProviderReady,
} from './translationSettings';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('translatePublicText', () => {
  it('calls the public Google translation endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify([[['Hello', '你好']]]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US')).resolves.toBe('Hello');

    const input = fetchMock.mock.calls[0]?.[0];
    if (!input) throw new Error('Missing fetch call');
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      'https://translate.googleapis.com/translate_a/single',
    );
    expect(url.searchParams.get('sl')).toBe('auto');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('q')).toBe('你好');
  });

  it('protects code, urls, and Windows paths before translation', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const q = new URL(String(input)).searchParams.get('q') ?? '';
      expect(q).not.toContain('npm run build');
      expect(q).not.toContain('https://example.com/a');
      expect(q).not.toContain('E:\\UltraGameStudio\\file.ts');
      return new Response(JSON.stringify([[[`Translated ${q}`, q]]]), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const translated = await translatePublicText(
      [
        '运行 `npm run build`。',
        '见 https://example.com/a。',
        '路径 E:\\UltraGameStudio\\file.ts。',
      ].join('\n'),
      'en-US',
    );

    expect(translated).toContain('`npm run build`');
    expect(translated).toContain('https://example.com/a');
    expect(translated).toContain('E:\\UltraGameStudio\\file.ts');
  });

  it('falls back to MyMemory when Google translation fails and source is known', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            responseStatus: 200,
            responseData: { translatedText: 'Hello' },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US', 'zh-CN')).resolves.toBe(
      'Hello',
    );

    const fallbackUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(fallbackUrl.origin + fallbackUrl.pathname).toBe(
      'https://api.mymemory.translated.net/get',
    );
    expect(fallbackUrl.searchParams.get('langpair')).toBe('zh-CN|en-US');
  });

  it('uses the selected MyMemory provider before Google', async () => {
    saveTranslationSettings({
      providerId: 'mymemory',
      baiduAppId: '',
      baiduSecretKey: '',
      libreTranslateBaseUrl: 'https://libretranslate.com',
      libreTranslateApiKey: '',
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          responseStatus: 200,
          responseData: { translatedText: 'Hello' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US', 'zh-CN')).resolves.toBe(
      'Hello',
    );

    const input = fetchMock.mock.calls[0]?.[0];
    if (!input) throw new Error('Missing fetch call');
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      'https://api.mymemory.translated.net/get',
    );
  });

  it('signs Baidu translation requests when selected', async () => {
    saveTranslationSettings({
      providerId: 'baidu',
      baiduAppId: 'app-1',
      baiduSecretKey: 'secret-1',
      libreTranslateBaseUrl: 'https://libretranslate.com',
      libreTranslateApiKey: '',
    });
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ trans_result: [{ dst: 'Hello' }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US', 'zh-CN')).resolves.toBe(
      'Hello',
    );

    const input = fetchMock.mock.calls[0]?.[0];
    if (!input) throw new Error('Missing fetch call');
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      'https://fanyi-api.baidu.com/api/trans/vip/translate',
    );
    expect(url.searchParams.get('appid')).toBe('app-1');
    expect(url.searchParams.get('from')).toBe('zh');
    expect(url.searchParams.get('to')).toBe('en');
    expect(url.searchParams.get('salt')).toBe('12345');
    expect(url.searchParams.get('sign')).toBe(
      __publicTranslationForTests.md5('app-1你好12345secret-1'),
    );
  });

  it('posts to LibreTranslate when selected', async () => {
    saveTranslationSettings({
      providerId: 'libretranslate',
      baiduAppId: '',
      baiduSecretKey: '',
      libreTranslateBaseUrl: 'https://translate.example.test/',
      libreTranslateApiKey: 'key-1',
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ translatedText: 'Hello' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translatePublicText('你好', 'en-US', 'zh-CN')).resolves.toBe(
      'Hello',
    );

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('Missing fetch call');
    const [input, init] = call;
    expect(input).toBe('https://translate.example.test/translate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      q: '你好',
      source: 'zh',
      target: 'en',
      api_key: 'key-1',
    });
  });

  it('parses split Google translation segments', () => {
    expect(
      __publicTranslationForTests.parseGoogleTranslateResponse([
        [
          ['Hello', '你好'],
          [' world', '世界'],
        ],
      ]),
    ).toBe('Hello world');
  });

  it('parses MyMemory translation responses', () => {
    expect(
      __publicTranslationForTests.parseMyMemoryTranslateResponse({
        responseStatus: 200,
        responseData: { translatedText: 'Hello' },
      }),
    ).toBe('Hello');
  });

  it('parses Baidu and LibreTranslate responses', () => {
    expect(
      __publicTranslationForTests.parseBaiduTranslateResponse({
        trans_result: [{ dst: 'Hello' }, { dst: ' world' }],
      }),
    ).toBe('Hello world');
    expect(
      __publicTranslationForTests.parseLibreTranslateResponse({
        translatedText: 'Hello',
      }),
    ).toBe('Hello');
  });

  it('normalizes translation settings and detects provider readiness', () => {
    const settings = normalizeTranslationSettings({
      providerId: 'baidu',
      baiduAppId: ' app ',
      baiduSecretKey: ' secret ',
      libreTranslateBaseUrl: 'https://translate.example.test/',
      libreTranslateApiKey: ' key ',
    });

    expect(settings).toMatchObject({
      providerId: 'baidu',
      baiduAppId: 'app',
      baiduSecretKey: 'secret',
      libreTranslateBaseUrl: 'https://translate.example.test',
      libreTranslateApiKey: 'key',
    });
    expect(translationProviderReady('baidu', settings)).toBe(true);
    expect(
      translationProviderReady('baidu', {
        ...settings,
        baiduSecretKey: '',
      }),
    ).toBe(false);
  });
});
