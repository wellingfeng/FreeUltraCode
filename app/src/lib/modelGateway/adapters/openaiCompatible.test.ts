import { afterEach, describe, expect, it, vi } from 'vitest';

import { completeOpenAICompatible } from './openaiCompatible';

function mockOpenAIStream(text: string): Response {
  const sse =
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n` +
    'data: [DONE]\n\n';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function mockOpenAIStreamWithMessageContent(text: string): Response {
  const sse =
    `data: {"choices":[{"message":{"content":${JSON.stringify(text)}}}]}\n\n` +
    'data: [DONE]\n\n';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function mockOpenAIJson(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('completeOpenAICompatible', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows keyless localhost proxies without sending authorization', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockOpenAIStream('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeOpenAICompatible({
        route: {
          selection: { adapter: 'codex', modelClass: 'gpt-oss' },
          adapter: 'codex',
          modelClass: 'gpt-oss',
          model: 'gpt-oss',
          transport: 'openai-compatible',
          mode: 'direct',
          baseUrl: 'http://localhost:1234/v1',
          label: 'Local OpenAI-compatible',
          source: 'global',
        },
        system: 's',
        userContent: 'hello',
      }),
    ).resolves.toBe('ok');

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('Missing fetch call');
    const init = call[1] as RequestInit;
    expect(call[0]).toBe('http://localhost:1234/v1/chat/completions');
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it.each([
    [
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    ],
    [
      'https://ark.cn-beijing.volces.com/api/v3',
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    ],
    [
      'https://qianfan.baidubce.com/v2',
      'https://qianfan.baidubce.com/v2/chat/completions',
    ],
  ])('preserves versioned OpenAI-compatible bases: %s', async (baseUrl, endpoint) => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockOpenAIStream('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await completeOpenAICompatible({
      route: {
        selection: { adapter: 'codex', modelClass: 'vision-model' },
        adapter: 'codex',
        modelClass: 'vision-model',
        model: 'vision-model',
        transport: 'openai-compatible',
        mode: 'direct',
        apiKey: 'key',
        baseUrl,
        label: 'Vision',
        source: 'global',
      },
      system: 's',
      userContent: 'describe',
      userImages: ['data:image/png;base64,AAAA'],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(endpoint);
  });

  it('still rejects keyless official OpenAI-compatible calls', async () => {
    const fetchMock = vi.fn(async () => mockOpenAIStream('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeOpenAICompatible({
        route: {
          selection: { adapter: 'codex', modelClass: 'gpt-oss' },
          adapter: 'codex',
          modelClass: 'gpt-oss',
          model: 'gpt-oss',
          transport: 'openai-compatible',
          mode: 'direct',
          label: 'OpenAI-compatible',
          source: 'global',
        },
        system: 's',
        userContent: 'hello',
      }),
    ).rejects.toThrow('NO_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads GLM-style streamed message content chunks', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockOpenAIStreamWithMessageContent('GLM标题'),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeOpenAICompatible({
        route: {
          selection: { adapter: 'codex', modelClass: 'gpt-oss' },
          adapter: 'codex',
          modelClass: 'gpt-oss',
          model: 'glm-5.2',
          transport: 'openai-compatible',
          mode: 'direct',
          apiKey: 'test-key',
          baseUrl: 'https://example.com/v1',
          label: 'GLM',
          source: 'global',
        },
        system: 's',
        userContent: 'hello',
      }),
    ).resolves.toBe('GLM标题');
  });

  it('reads non-streaming OpenAI-compatible JSON replies', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockOpenAIJson('JSON标题'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeOpenAICompatible({
        route: {
          selection: { adapter: 'codex', modelClass: 'gpt-oss' },
          adapter: 'codex',
          modelClass: 'gpt-oss',
          model: 'glm-5.2',
          transport: 'openai-compatible',
          mode: 'direct',
          apiKey: 'test-key',
          baseUrl: 'https://example.com/v1',
          label: 'GLM',
          source: 'global',
        },
        system: 's',
        userContent: 'hello',
      }),
    ).resolves.toBe('JSON标题');
  });
});
