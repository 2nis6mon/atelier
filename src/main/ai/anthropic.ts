// Claude via the Anthropic API (API key, billed separately to the user's
// Anthropic account). Claude subscriptions cannot be used by third-party apps,
// so there is no subscription sign-in here.
//
// Current models reject forced tool_choice, so the tool is offered with
// tool_choice "auto" and the system prompt requires calling it; the output is
// validated locally in any case. No automatic fallback to another model.

import Anthropic from '@anthropic-ai/sdk';
import { AiError } from '../../shared/ai/errors';
import { networkError } from './openai';
import type { CompletionOptions, CompletionRequest, CompletionResult, FetchFn, ProviderAdapter } from './types';

export const CLAUDE_MODELS: Array<{ id: string; label: string; price: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: '$4 / $20 per million input / output tokens' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: '$2 / $10 per million input / output tokens' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', price: '$1 / $5 per million input / output tokens' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', price: '$10 / $50 per million input / output tokens' },
];
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

export function mapAnthropicError(e: unknown, signal: AbortSignal): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return networkError(e, signal);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout');
  if (e instanceof Anthropic.APIConnectionError) return networkError(e, signal);
  if (e instanceof Anthropic.APIError) {
    const type = (e.error as { error?: { type?: string } } | undefined)?.error?.type ?? '';
    const detail = `${e.status ?? ''} ${type} ${e.message}`.trim();
    if (e.status === 401) return new AiError('auth-failed', detail);
    if (e.status === 402 || type === 'billing_error') return new AiError('quota', detail);
    if (e.status === 403) return new AiError('auth-failed', detail);
    if (e.status === 429) return new AiError('rate-limited', detail);
    if (e.status === 413) return new AiError('too-large', detail);
    if (e.status === 400 || e.status === 404) return new AiError('unsupported', detail);
    return new AiError('server', detail);
  }
  return networkError(e, signal);
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const;

  constructor(
    private readonly apiKey: () => string | null,
    private readonly fetchFn?: FetchFn,
    private readonly maxRetries = 1,
  ) {}

  private client(): Anthropic {
    const key = this.apiKey();
    if (!key) throw new AiError('not-configured');
    return new Anthropic({ apiKey: key, maxRetries: this.maxRetries, timeout: 180_000, ...(this.fetchFn ? { fetch: this.fetchFn as never } : {}) });
  }

  async complete(req: CompletionRequest, { signal, onProgress }: CompletionOptions): Promise<CompletionResult> {
    const client = this.client();
    let received = 0;
    try {
      const stream = client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema as Anthropic.Tool.InputSchema }],
          tool_choice: { type: 'auto' },
        },
        { signal },
      );
      stream.on('inputJson', (delta) => {
        received += delta.length;
        onProgress?.(received);
      });
      stream.on('text', (delta) => {
        received += delta.length;
        onProgress?.(received);
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new AiError('unsupported', 'Claude declined this request.');
      const tool = message.content.find((b) => b.type === 'tool_use');
      if (message.stop_reason === 'max_tokens' && tool) throw new AiError('too-large', 'The answer was cut off.');
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        toolInput: tool && tool.type === 'tool_use' ? tool.input : text.trim().startsWith('{') ? text : null,
        text,
        model: message.model,
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    } catch (e) {
      throw mapAnthropicError(e, signal);
    }
  }

  async listModels(signal: AbortSignal): Promise<string[]> {
    const client = this.client();
    try {
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 }, { signal })) ids.push(m.id);
      return ids;
    } catch (e) {
      throw mapAnthropicError(e, signal);
    }
  }
}
