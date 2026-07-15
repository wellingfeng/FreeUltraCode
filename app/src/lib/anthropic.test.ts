import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTAIN_LOOP_GUIDANCE,
  SIMPLE_CHAT_SYSTEM,
  UNIFIED_SYSTEM,
  streamAnthropic,
} from './anthropic';

function mockAnthropicStream(text: string): Response {
  const sse =
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n` +
    'data: [DONE]\n\n';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function mockAnthropicUsageStream(text: string): Response {
  const sse =
    'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"cache_read_input_tokens":800,"cache_creation_input_tokens":80}}}\n\n' +
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n` +
    'data: {"type":"message_delta","usage":{"output_tokens":40}}\n\n' +
    'data: [DONE]\n\n';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * Captain-loop guidance — the generation-layer accuracy lever. These tests pin
 * that the guidance is present, names the concrete primitives the model must
 * emit, and is actually wired into the unified system prompt (a guidance string
 * defined but never injected would silently do nothing).
 */
describe('CAPTAIN_LOOP_GUIDANCE', () => {
  it('names the captain-loop primitives', () => {
    expect(CAPTAIN_LOOP_GUIDANCE).toContain('TASK_LEDGER');
    expect(CAPTAIN_LOOP_GUIDANCE).toContain('VERDICT');
    expect(CAPTAIN_LOOP_GUIDANCE).toContain('adversarial');
    expect(CAPTAIN_LOOP_GUIDANCE).toContain('workflow-manager');
    expect(CAPTAIN_LOOP_GUIDANCE).toContain('队长闭环');
  });

  it('scopes when to use it (complex) and when not (simple)', () => {
    // Mentions the gating signal and the "don't over-apply" guard.
    expect(CAPTAIN_LOOP_GUIDANCE).toMatch(/复杂|可拆|高风险/);
    expect(CAPTAIN_LOOP_GUIDANCE).toMatch(/简单|单步|低风险/);
  });

  it('is injected into UNIFIED_SYSTEM', () => {
    expect(UNIFIED_SYSTEM).toContain(CAPTAIN_LOOP_GUIDANCE);
  });
});

describe('SIMPLE_CHAT_SYSTEM', () => {
  it('forbids silently switching a user-specified target or tool', () => {
    expect(SIMPLE_CHAT_SYSTEM).toContain('不得自行切换到替代目标');
    expect(SIMPLE_CHAT_SYSTEM).toContain('指定目标不可用');
    expect(SIMPLE_CHAT_SYSTEM).toContain('必须先停止并用下方交互协议询问用户是否允许切换');
  });
});

describe('streamAnthropic multimodal content', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  }

  it('sends a plain string content when no images are attached', async () => {
    const fetchMock = vi.fn(async () => mockAnthropicStream('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await streamAnthropic({ apiKey: 'k', system: 's', userContent: 'hello' });
    expect(bodyOf(fetchMock).messages[0].content).toBe('hello');
  });

  it('allows keyless localhost proxies without sending x-api-key', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockAnthropicStream('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await streamAnthropic({
      baseUrl: 'http://127.0.0.1:8045',
      model: 'gemini-3-flash',
      system: 's',
      userContent: 'hello',
    });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('Missing fetch call');
    const init = call[1] as RequestInit;
    expect(call[0]).toBe('http://127.0.0.1:8045/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBeUndefined();
  });

  it('still rejects keyless official Anthropic calls', async () => {
    const fetchMock = vi.fn(async () => mockAnthropicStream('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      streamAnthropic({ system: 's', userContent: 'hello' }),
    ).rejects.toThrow('NO_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits an image block for data URLs and keeps the text block', async () => {
    const fetchMock = vi.fn(async () => mockAnthropicStream('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await streamAnthropic({
      apiKey: 'k',
      system: 's',
      userContent: 'judge this',
      userImages: ['data:image/png;base64,AAAA'],
    });
    const content = bodyOf(fetchMock).messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(content[1]).toEqual({ type: 'text', text: 'judge this' });
  });

  it('emits a url image block for http(s) sources', async () => {
    const fetchMock = vi.fn(async () => mockAnthropicStream('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await streamAnthropic({
      apiKey: 'k',
      system: 's',
      userContent: 't',
      userImages: ['https://example.com/a.png', 'not-an-image'],
    });
    const content = bodyOf(fetchMock).messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/a.png' },
    });
  });

  it('reports Anthropic cache reads as hits and cache creation as visible input', async () => {
    const fetchMock = vi.fn(async () => mockAnthropicUsageStream('ok'));
    const onUsage = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await streamAnthropic({
      apiKey: 'k',
      system: 's',
      userContent: 'hello',
      onUsage,
    });

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 1000,
      outputTokens: 40,
      totalTokens: 1040,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 80,
    });
  });
});
