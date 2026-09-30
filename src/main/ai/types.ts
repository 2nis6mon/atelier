import type { ProviderId } from '../../shared/types';

export interface CompletionRequest {
  system: string;
  user: string;
  tool: { name: string; description: string; schema: Record<string, unknown> };
  model: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  /** Parsed or raw (string) tool arguments; null when the model answered with text only. */
  toolInput: unknown;
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface CompletionOptions {
  signal: AbortSignal;
  onProgress?: (receivedChars: number) => void;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  complete(req: CompletionRequest, opts: CompletionOptions): Promise<CompletionResult>;
  listModels(signal: AbortSignal): Promise<string[]>;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
