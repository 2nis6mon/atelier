import { describe, expect, it } from 'vitest';
import { AiError } from '../../src/shared/ai/errors';
import { readSse } from '../../src/main/ai/sse';
import { OpenAiResponsesAdapter, compareModelIds, isTextModel, mapOpenAiError } from '../../src/main/ai/openai';
import { CompatibleAdapter } from '../../src/main/ai/compatible';
import { AnthropicAdapter, CLAUDE_MODELS, mapAnthropicError } from '../../src/main/ai/anthropic';
import { TOOL_SCHEMA } from '../../src/shared/ai/prompt';
import { TOOL_OUTPUT, fakeFetch, headerOf, jsonResponse, sseBody, sseResponse } from '../helpers/fakeFetch';

const REQ = {
  system: 'system prompt',
  user: 'user message',
  tool: { name: 'submit_suggestions', description: 'Return suggestions', schema: TOOL_SCHEMA as unknown as Record<string, unknown> },
  model: 'test-model',
  maxOutputTokens: 1000,
};
const signal = () => new AbortController().signal;
const args = JSON.stringify(TOOL_OUTPUT);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AiError ? e.code : `other:${String(e)}`;
  }
}

describe('SSE reader', () => {
  it('parses events, multi-line data, comments and CRLF', async () => {
    const text = ': keep-alive\r\nevent: a\r\ndata: 1\r\ndata: 2\r\n\r\ndata: {"x":1}\n\ndata: tail';
    const body = new Response(text).body!;
    const events = [];
    for await (const e of readSse(body)) events.push(e);
    expect(events).toEqual([
      { event: 'a', data: '1\n2' },
      { event: 'message', data: '{"x":1}' },
      { event: 'message', data: 'tail' },
    ]);
  });

  it('stops when aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const it = readSse(sseBody([{ data: 1 }]), ctrl.signal);
    await expect(it.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('OpenAI Responses adapter (API key)', () => {
  const stream = (extra: Array<{ event?: string; data: unknown }> = []) =>
    sseResponse([
      { event: 'response.created', data: { type: 'response.created' } },
      { data: { type: 'response.output_item.added', item: { type: 'function_call', name: 'submit_suggestions' } } },
      ...args.match(/.{1,20}/g)!.map((d) => ({ data: { type: 'response.function_call_arguments.delta', delta: d } })),
      { data: { type: 'response.function_call_arguments.done', arguments: args } },
      ...extra,
      { data: { type: 'response.completed', response: { model: 'gpt-x', usage: { input_tokens: 10, output_tokens: 20 }, output: [{ type: 'function_call', arguments: args }] } } },
      { data: '[DONE]' },
    ]);

  it('streams a forced function call with store:false and a bearer key', async () => {
    const f = fakeFetch(() => stream());
    const a = new OpenAiResponsesAdapter({ id: 'openai', fetch: f.fn, planMode: false, credential: async () => 'sk-test-123456' });
    const progress: number[] = [];
    const r = await a.complete(REQ, { signal: signal(), onProgress: (n) => progress.push(n) });
    expect(JSON.parse(r.toolInput as string)).toEqual(TOOL_OUTPUT);
    expect(r).toMatchObject({ model: 'gpt-x', usage: { inputTokens: 10, outputTokens: 20 } });
    expect(progress.at(-1)).toBe(args.length);
    const call = f.calls[0];
    expect(call.url).toBe('https://api.openai.com/v1/responses');
    expect(headerOf(call.init, 'Authorization')).toBe('Bearer sk-test-123456');
    expect(call.body).toMatchObject({ stream: true, store: false, tool_choice: { type: 'function', name: 'submit_suggestions' }, instructions: 'system prompt' });
  });

  it('maps HTTP and stream errors without retrying elsewhere', async () => {
    const make = (status: number, code: string) => new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => jsonResponse(status, { error: { code, message: 'x' } })).fn, planMode: false, credential: async () => 'k' });
    expect(await codeOf(make(401, 'invalid_api_key').complete(REQ, { signal: signal() }))).toBe('auth-failed');
    expect(await codeOf(make(429, 'insufficient_quota').complete(REQ, { signal: signal() }))).toBe('quota');
    expect(await codeOf(make(429, 'rate_limit_exceeded').complete(REQ, { signal: signal() }))).toBe('rate-limited');
    expect(await codeOf(make(404, 'model_not_found').complete(REQ, { signal: signal() }))).toBe('unsupported');
    expect(await codeOf(make(503, '').complete(REQ, { signal: signal() }))).toBe('server');
    const failed = new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => sseResponse([{ data: { type: 'response.failed', response: { error: { code: 'server_error', message: 'boom' } } } }])).fn, planMode: false, credential: async () => 'k' });
    expect(await codeOf(failed.complete(REQ, { signal: signal() }))).toBe('server');
    const incomplete = new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => sseResponse([{ data: { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } } }])).fn, planMode: false, credential: async () => 'k' });
    expect(await codeOf(incomplete.complete(REQ, { signal: signal() }))).toBe('too-large');
    const quotaEvent = new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => sseResponse([{ data: { type: 'error', code: 'insufficient_quota', message: 'no credit' } }])).fn, planMode: false, credential: async () => 'k' });
    expect(await codeOf(quotaEvent.complete(REQ, { signal: signal() }))).toBe('quota');
    const early = new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => sseResponse([{ data: 'not json' }])).fn, planMode: false, credential: async () => 'k' });
    expect(await codeOf(early.complete(REQ, { signal: signal() }))).toBe('network');
    const offline = new OpenAiResponsesAdapter({ id: 'openai', fetch: async () => { throw new TypeError('fetch failed'); }, planMode: false, credential: async () => 'k' });
    expect(await codeOf(offline.complete(REQ, { signal: signal() }))).toBe('network');
    const noKey = new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => stream()).fn, planMode: false, credential: async () => { throw new AiError('not-configured'); } });
    expect(await codeOf(noKey.complete(REQ, { signal: signal() }))).toBe('not-configured');
  });

  it('supports cancellation and time-outs mid-stream', async () => {
    const slow = fakeFetch(() => new Response(sseBody([{ data: { type: 'response.function_call_arguments.delta', delta: 'a' } }, { data: { type: 'response.completed', response: {} } }], { delayMs: 50 }), { status: 200 }));
    const a = new OpenAiResponsesAdapter({ id: 'openai', fetch: slow.fn, planMode: false, credential: async () => 'k' });
    const ctrl = new AbortController();
    const p = a.complete(REQ, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    expect(await codeOf(p)).toBe('cancelled');
    const t = new AbortController();
    const p2 = a.complete(REQ, { signal: t.signal });
    setTimeout(() => t.abort(Object.assign(new Error('t'), { name: 'TimeoutError' })), 20);
    expect(await codeOf(p2)).toBe('timeout');
  });

  it('lists text models newest first', async () => {
    const f = fakeFetch(() => jsonResponse(200, { data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3' }, { id: 'gpt-5.5' }, { id: 'gpt-5' }, { id: 'whisper-1' }] }));
    const a = new OpenAiResponsesAdapter({ id: 'openai', fetch: f.fn, planMode: false, credential: async () => 'k' });
    expect(await a.listModels(signal())).toEqual(['gpt-5.5', 'gpt-5', 'gpt-5-mini']);
    expect(isTextModel('o4-mini')).toBe(true);
    expect(isTextModel('gpt-image-1')).toBe(false);
    expect(compareModelIds('gpt-5-nano', 'gpt-5-mini')).toBeGreaterThan(0);
    const bad = new OpenAiResponsesAdapter({ id: 'openai', fetch: fakeFetch(() => jsonResponse(401, {})).fn, planMode: false, credential: async () => 'k' });
    expect(await codeOf(bad.listModels(signal()))).toBe('auth-failed');
    const down = new OpenAiResponsesAdapter({ id: 'openai', fetch: async () => { throw new TypeError('x'); }, planMode: false, credential: async () => 'k' });
    expect(await codeOf(down.listModels(signal()))).toBe('network');
  });
});

describe('ChatGPT plan mode errors', () => {
  it('maps documented subscription_sharing errors', () => {
    expect(mapOpenAiError(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } }, true).code).toBe('plan-limit');
    expect(mapOpenAiError(403, { error: { code: 'subscription_sharing_user_not_eligible' } }, true).code).toBe('not-eligible');
    expect(mapOpenAiError(400, { error: { code: 'subscription_sharing_unsupported_capability' } }, true).code).toBe('unsupported');
    expect(mapOpenAiError(401, {}, true).code).toBe('auth-expired');
    expect(mapOpenAiError(403, {}, true).code).toBe('not-eligible');
    expect(mapOpenAiError(408, {}, true).code).toBe('timeout');
  });

  it('lists the account catalogue (visibility "list", slugs)', async () => {
    const f = fakeFetch(() => jsonResponse(200, { models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] }));
    const a = new OpenAiResponsesAdapter({ id: 'chatgpt', fetch: f.fn, planMode: true, credential: async () => 'access' });
    expect(await a.listModels(signal())).toEqual(['gpt-5.5']);
  });
});

describe('OpenAI-compatible (local) adapter', () => {
  const chunks = (parts: string[], finish = 'tool_calls') => [
    ...parts.map((p) => ({ data: { model: 'llama', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: p } }] } }] } })),
    { data: { choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 2 } } },
    { data: '[DONE]' },
  ];

  it('streams tool call arguments and accepts JSON text answers', async () => {
    const f = fakeFetch(() => sseResponse(chunks(args.match(/.{1,15}/g)!)));
    const a = new CompatibleAdapter(f.fn, () => 'http://127.0.0.1:11434/v1/', () => null);
    const r = await a.complete(REQ, { signal: signal() });
    expect(JSON.parse(r.toolInput as string)).toEqual(TOOL_OUTPUT);
    expect(f.calls[0].url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(headerOf(f.calls[0].init, 'Authorization')).toBeNull();
    const text = fakeFetch(() => sseResponse([{ data: { choices: [{ delta: { content: args } }] } }, { data: '[DONE]' }]));
    const r2 = await new CompatibleAdapter(text.fn, () => 'http://localhost:1234/v1', () => 'key').complete(REQ, { signal: signal() });
    expect(r2.toolInput).toBe(args);
    expect(headerOf(text.calls[0].init, 'Authorization')).toBe('Bearer key');
    const prose = fakeFetch(() => sseResponse([{ data: { choices: [{ delta: { content: 'Sure!' } }] } }]));
    expect((await new CompatibleAdapter(prose.fn, () => 'http://x/v1', () => null).complete(REQ, { signal: signal() })).toolInput).toBeNull();
  });

  it('reports configuration, length and server errors', async () => {
    const ok = fakeFetch(() => sseResponse(chunks(['{}'], 'length')));
    expect(await codeOf(new CompatibleAdapter(ok.fn, () => 'http://x/v1', () => null).complete(REQ, { signal: signal() }))).toBe('too-large');
    expect(await codeOf(new CompatibleAdapter(ok.fn, () => 'not a url', () => null).complete(REQ, { signal: signal() }))).toBe('not-configured');
    expect(await codeOf(new CompatibleAdapter(ok.fn, () => 'ftp://x', () => null).complete(REQ, { signal: signal() }))).toBe('not-configured');
    const err = fakeFetch(() => sseResponse([{ data: { error: { message: 'model crashed' } } }]));
    expect(await codeOf(new CompatibleAdapter(err.fn, () => 'http://x/v1', () => null).complete(REQ, { signal: signal() }))).toBe('server');
    const http = fakeFetch(() => jsonResponse(404, { error: { message: 'no model' } }));
    expect(await codeOf(new CompatibleAdapter(http.fn, () => 'http://x/v1', () => null).complete(REQ, { signal: signal() }))).toBe('unsupported');
    const down = new CompatibleAdapter(async () => { throw new TypeError('ECONNREFUSED'); }, () => 'http://x/v1', () => null);
    expect(await codeOf(down.complete(REQ, { signal: signal() }))).toBe('network');
    expect(await codeOf(down.listModels(signal()))).toBe('network');
    const models = fakeFetch(() => jsonResponse(200, { data: [{ id: 'llama3.2' }, { id: '' }] }));
    expect(await new CompatibleAdapter(models.fn, () => 'http://x/v1', () => null).listModels(signal())).toEqual(['llama3.2']);
    expect(await codeOf(new CompatibleAdapter(http.fn, () => 'http://x/v1', () => null).listModels(signal()))).toBe('unsupported');
  });
});

describe('Claude adapter (Anthropic SDK over a simulated transport)', () => {
  const messageStream = (stopReason = 'tool_use', withTool = true) =>
    sseResponse([
      { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } } },
      ...(withTool
        ? [
            { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'submit_suggestions', input: {} } } },
            ...args.match(/.{1,25}/g)!.map((p) => ({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: p } } })),
            { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
          ]
        : [
            { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
            { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I cannot help with that.' } } },
            { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
          ]),
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 42 } } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);

  it('streams the tool input and sends a standard API request (auto tool choice, no forced fallback)', async () => {
    const f = fakeFetch(() => messageStream());
    const a = new AnthropicAdapter(() => 'sk-ant-test', f.fn, 0);
    const progress: number[] = [];
    const r = await a.complete({ ...REQ, model: 'claude-opus-5-5' }, { signal: signal(), onProgress: (n) => progress.push(n) });
    expect(r.toolInput).toEqual(TOOL_OUTPUT);
    expect(r).toMatchObject({ model: 'claude-opus-5-5', usage: { inputTokens: 12, outputTokens: 42 } });
    expect(progress.at(-1)).toBe(args.length);
    const call = f.calls[0];
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(headerOf(call.init, 'x-api-key')).toBe('sk-ant-test');
    expect(headerOf(call.init, 'anthropic-version')).toBeTruthy();
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, tool_choice: { type: 'auto' }, system: 'system prompt' });
    expect(call.body).not.toHaveProperty('fallbacks');
    expect(CLAUDE_MODELS[0].id).toBe('claude-opus-5-5');
  });

  it('maps refusals, truncation and HTTP errors', async () => {
    expect(await codeOf(new AnthropicAdapter(() => 'k', fakeFetch(() => messageStream('refusal', false)).fn, 0).complete(REQ, { signal: signal() }))).toBe('unsupported');
    expect(await codeOf(new AnthropicAdapter(() => 'k', fakeFetch(() => messageStream('max_tokens')).fn, 0).complete(REQ, { signal: signal() }))).toBe('too-large');
    const text = await new AnthropicAdapter(() => 'k', fakeFetch(() => messageStream('end_turn', false)).fn, 0).complete(REQ, { signal: signal() });
    expect(text.toolInput).toBeNull();
    const err = (status: number, type: string) => new AnthropicAdapter(() => 'k', fakeFetch(() => jsonResponse(status, { type: 'error', error: { type, message: 'm' } })).fn, 0);
    expect(await codeOf(err(401, 'authentication_error').complete(REQ, { signal: signal() }))).toBe('auth-failed');
    expect(await codeOf(err(402, 'billing_error').complete(REQ, { signal: signal() }))).toBe('quota');
    expect(await codeOf(err(403, 'permission_error').complete(REQ, { signal: signal() }))).toBe('auth-failed');
    expect(await codeOf(err(429, 'rate_limit_error').complete(REQ, { signal: signal() }))).toBe('rate-limited');
    expect(await codeOf(err(529, 'overloaded_error').complete(REQ, { signal: signal() }))).toBe('server');
    expect(await codeOf(err(400, 'invalid_request_error').complete(REQ, { signal: signal() }))).toBe('unsupported');
    expect(await codeOf(err(413, 'request_too_large').complete(REQ, { signal: signal() }))).toBe('too-large');
    expect(await codeOf(new AnthropicAdapter(() => null, fakeFetch(() => messageStream()).fn, 0).complete(REQ, { signal: signal() }))).toBe('not-configured');
    expect(await codeOf(new AnthropicAdapter(() => 'k', async () => { throw new TypeError('fetch failed'); }, 0).complete(REQ, { signal: signal() }))).toBe('network');
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await codeOf(new AnthropicAdapter(() => 'k', fakeFetch(() => messageStream()).fn, 0).complete(REQ, { signal: ctrl.signal }))).toBe('cancelled');
    expect(mapAnthropicError(new AiError('quota'), signal()).code).toBe('quota');
  });

  it('lists models', async () => {
    const f = fakeFetch(() => jsonResponse(200, { data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01' }], has_more: false, first_id: 'a', last_id: 'a' }));
    expect(await new AnthropicAdapter(() => 'k', f.fn, 0).listModels(signal())).toEqual(['claude-opus-5-5']);
    expect(await codeOf(new AnthropicAdapter(() => 'k', fakeFetch(() => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'x' } })).fn, 0).listModels(signal()))).toBe('auth-failed');
  });
});
