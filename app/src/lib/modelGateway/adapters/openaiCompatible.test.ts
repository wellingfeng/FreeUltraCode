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
});
