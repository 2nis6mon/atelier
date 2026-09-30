// OpenAI Responses API adapter. Used with a standard API key (billed to the
// user's OpenAI API account) and with Sign in with ChatGPT access tokens
// (plan usage). Requests are streamed and sent with store:false.

import { AiError } from '../../shared/ai/errors';
import type { ProviderId } from '../../shared/types';
import { readSse } from './sse';
import type { CompletionOptions, CompletionRequest, CompletionResult, FetchFn, ProviderAdapter } from './types';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

interface OpenAiErrorBody {
  error?: { message?: string; type?: string; code?: string | null };
}

/** Maps an HTTP error from OpenAI (API key or ChatGPT plan) to an AiError. */
export function mapOpenAiError(status: number, body: OpenAiErrorBody, planMode: boolean): AiError {
  const code = body.error?.code ?? body.error?.type ?? '';
  const detail = `${status} ${code} ${body.error?.message ?? ''}`.trim();
  if (code === 'subscription_sharing_usage_limit_exceeded') return new AiError('plan-limit', detail);
  if (code === 'subscription_sharing_user_not_eligible') return new AiError('not-eligible', detail);
  if (code === 'subscription_sharing_unsupported_capability') return new AiError('unsupported', detail);
  if (code === 'insufficient_quota') return new AiError('quota', detail);
  if (status === 401) return new AiError(planMode ? 'auth-expired' : 'auth-failed', detail);
  if (status === 403) return new AiError(planMode ? 'not-eligible' : 'auth-failed', detail);
  if (status === 429) return new AiError('rate-limited', detail);
  if (status === 400 || status === 404 || status === 422) return new AiError('unsupported', detail);
  if (status === 408) return new AiError('timeout', detail);
  return new AiError('server', detail);
}

export function isAbort(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
}

export function networkError(e: unknown, signal: AbortSignal): AiError {
  if (signal.aborted) {
    const reason = signal.reason as { name?: string } | undefined;
    return new AiError(reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled');
  }
  if (isAbort(e)) return new AiError('cancelled');
  return new AiError('network', String((e as Error)?.message ?? e));
}

export interface OpenAiAdapterOptions {
  id: ProviderId;
  fetch: FetchFn;
  baseUrl?: string;
  /** Returns the bearer credential (API key or fresh OAuth access token). */
  credential: () => Promise<string>;
  planMode: boolean;
}

export class OpenAiResponsesAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  private readonly base: string;

  constructor(private readonly opts: OpenAiAdapterOptions) {
    this.id = opts.id;
    this.base = (opts.baseUrl ?? OPENAI_BASE_URL).replace(/\/$/, '');
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.opts.credential()}`, 'Content-Type': 'application/json' };
  }

  async complete(req: CompletionRequest, { signal, onProgress }: CompletionOptions): Promise<CompletionResult> {
    const body = {
      model: req.model,
      instructions: req.system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: req.user }] }],
      tools: [{ type: 'function', name: req.tool.name, description: req.tool.description, parameters: req.tool.schema, strict: false }],
      tool_choice: { type: 'function', name: req.tool.name },
      max_output_tokens: req.maxOutputTokens,
      stream: true,
      store: false,
    };
    let res: Response;
    try {
      res = await this.opts.fetch(`${this.base}/responses`, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw networkError(e, signal);
    }
    if (!res.ok || !res.body) {
      const errBody = (await res.json().catch(() => ({}))) as OpenAiErrorBody;
      throw mapOpenAiError(res.status, errBody, this.opts.planMode);
    }
    let args = '';
    let text = '';
    let model = req.model;
    let usage: CompletionResult['usage'] = null;
    let completed = false;
    try {
      for await (const ev of readSse(res.body, signal)) {
        if (ev.data === '[DONE]') break;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(ev.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = String(payload.type ?? ev.event);
        switch (type) {
          case 'response.function_call_arguments.delta':
            args += String(payload.delta ?? '');
            onProgress?.(args.length + text.length);
            break;
          case 'response.function_call_arguments.done':
            args = String(payload.arguments ?? args);
            break;
          case 'response.output_text.delta':
            text += String(payload.delta ?? '');
            onProgress?.(args.length + text.length);
            break;
          case 'response.completed': {
            completed = true;
            const r = payload.response as { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; output?: Array<Record<string, unknown>> } | undefined;
            if (r?.model) model = r.model;
            if (r?.usage) usage = { inputTokens: r.usage.input_tokens ?? 0, outputTokens: r.usage.output_tokens ?? 0 };
            const call = r?.output?.find((o) => o.type === 'function_call');
            if (call && typeof call.arguments === 'string' && call.arguments.length >= args.length) args = call.arguments;
            break;
          }
          case 'response.incomplete': {
            const r = payload.response as { incomplete_details?: { reason?: string } } | undefined;
            throw new AiError(r?.incomplete_details?.reason === 'max_output_tokens' ? 'too-large' : 'bad-response', r?.incomplete_details?.reason ?? 'incomplete');
          }
          case 'response.failed':
          case 'error': {
            const err = ((payload.response as { error?: OpenAiErrorBody['error'] } | undefined)?.error ?? (payload.error as OpenAiErrorBody['error']) ?? payload) as OpenAiErrorBody['error'];
            const code = err?.code ?? '';
            const status = code === 'rate_limit_exceeded' || code === 'subscription_sharing_usage_limit_exceeded' || code === 'insufficient_quota' ? 429 : 500;
            throw mapOpenAiError(status, { error: err }, this.opts.planMode);
          }
        }
      }
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw networkError(e, signal);
    }
    if (!completed && !args) throw new AiError('network', 'The answer stream ended early.');
    return { toolInput: args || null, text, model, usage };
  }

  /** Lists models available to this credential (plan catalogues expose display names and slugs). */
  async listModels(signal: AbortSignal): Promise<string[]> {
    let res: Response;
    try {
      res = await this.opts.fetch(`${this.base}/models`, { headers: await this.headers(), signal });
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw networkError(e, signal);
    }
    if (!res.ok) throw mapOpenAiError(res.status, (await res.json().catch(() => ({}))) as OpenAiErrorBody, this.opts.planMode);
    const json = (await res.json()) as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> };
    const entries = json.data ?? json.models ?? [];
    const ids = entries
      .filter((m) => m.visibility === undefined || m.visibility === 'list')
      .map((m) => String(m.slug ?? m.id ?? ''))
      .filter((id) => id && (this.opts.planMode || isTextModel(id)));
    return [...new Set(ids)].sort(compareModelIds);
  }
}

const NON_TEXT = /(embedding|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|search|davinci|babbage|codex-mini|computer-use)/i;

export function isTextModel(id: string): boolean {
  return /^(gpt-|o\d|chatgpt-)/.test(id) && !NON_TEXT.test(id);
}

/** Newest-looking models first (gpt-5.5 before gpt-5, full before mini/nano). */
export function compareModelIds(a: string, b: string): number {
  const ver = (s: string) => Number(/(\d+(?:\.\d+)?)/.exec(s)?.[1] ?? 0);
  const size = (s: string) => (/nano/.test(s) ? 2 : /mini/.test(s) ? 1 : 0);
  return ver(b) - ver(a) || size(a) - size(b) || a.localeCompare(b);
}
