// OpenAI-compatible Chat Completions adapter for local or self-hosted models
// (e.g. Ollama, LM Studio). Nothing is billed by Atelier; costs depend on the
// server the user configures.

import { AiError } from '../../shared/ai/errors';
import { mapOpenAiError, networkError } from './openai';
import { readSse } from './sse';
import type { CompletionOptions, CompletionRequest, CompletionResult, FetchFn, ProviderAdapter } from './types';

export class CompatibleAdapter implements ProviderAdapter {
  readonly id = 'compatible' as const;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly baseUrl: () => string,
    private readonly apiKey: () => string | null,
  ) {}

  private url(path: string): string {
    const base = this.baseUrl().trim().replace(/\/$/, '');
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new AiError('not-configured', 'The custom endpoint address is not valid.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new AiError('not-configured', 'Use an http(s) address.');
    return `${base}${path}`;
  }

  private headers(): Record<string, string> {
    const key = this.apiKey();
    return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  }

  async complete(req: CompletionRequest, { signal, onProgress }: CompletionOptions): Promise<CompletionResult> {
    const body = {
      model: req.model,
      stream: true,
      max_tokens: req.maxOutputTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      tools: [{ type: 'function', function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.schema } }],
      tool_choice: { type: 'function', function: { name: req.tool.name } },
    };
    let res: Response;
    try {
      res = await this.fetchFn(this.url('/chat/completions'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw networkError(e, signal);
    }
    if (!res.ok || !res.body) throw mapOpenAiError(res.status, (await res.json().catch(() => ({}))) as never, false);
    let args = '';
    let text = '';
    let model = req.model;
    let usage: CompletionResult['usage'] = null;
    let finish: string | null = null;
    try {
      for await (const ev of readSse(res.body, signal)) {
        if (ev.data === '[DONE]') break;
        let chunk: {
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
          choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ function?: { arguments?: string } }> }; finish_reason?: string | null }>;
        };
        try {
          chunk = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (chunk.error) throw new AiError('server', chunk.error.message ?? 'error');
        if (chunk.model) model = chunk.model;
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
        const choice = chunk.choices?.[0];
        for (const call of choice?.delta?.tool_calls ?? []) args += call.function?.arguments ?? '';
        if (choice?.delta?.content) text += choice.delta.content;
        if (choice?.finish_reason) finish = choice.finish_reason;
        onProgress?.(args.length + text.length);
      }
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw networkError(e, signal);
    }
    if (finish === 'length') throw new AiError('too-large', 'The model reached its output limit.');
    // Some local models answer with plain JSON text instead of a tool call.
    return { toolInput: args || (text.trim().startsWith('{') || text.includes('```') ? text : null), text, model, usage };
  }

  async listModels(signal: AbortSignal): Promise<string[]> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url('/models'), { headers: this.headers(), signal });
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw networkError(e, signal);
    }
    if (!res.ok) throw mapOpenAiError(res.status, (await res.json().catch(() => ({}))) as never, false);
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
  }
}
