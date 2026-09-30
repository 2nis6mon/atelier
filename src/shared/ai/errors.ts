export type AiErrorCode =
  | 'not-configured'
  | 'auth-expired'
  | 'auth-failed'
  | 'quota'
  | 'plan-limit'
  | 'not-eligible'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'bad-response'
  | 'unsupported'
  | 'server'
  | 'too-large';

const MESSAGES: Record<AiErrorCode, string> = {
  'not-configured': 'No AI connection is set up. Open Settings › AI connections.',
  'auth-expired': 'Your AI sign-in expired. Reconnect in Settings › AI connections.',
  'auth-failed': 'The AI provider rejected the credentials. Check them in Settings › AI connections.',
  quota: 'The AI account has no remaining quota or credit.',
  'plan-limit': 'Your ChatGPT plan limit for this app is reached. Manage usage in ChatGPT settings.',
  'not-eligible': 'This ChatGPT account is not eligible to use its plan in other apps.',
  'rate-limited': 'Too many requests right now. Wait a moment and retry.',
  network: 'Could not reach the AI provider. Check your internet connection.',
  timeout: 'The AI provider took too long to answer.',
  cancelled: 'Request cancelled.',
  'bad-response': 'The AI answer could not be understood, so nothing was changed.',
  unsupported: 'This request is not supported by the selected connection.',
  server: 'The AI provider had a problem. Try again later.',
  'too-large': 'The request is too large. Narrow the scope (selection or one section).',
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly detail: string;
  readonly retryable: boolean;

  constructor(code: AiErrorCode, detail = '') {
    super(MESSAGES[code]);
    this.name = 'AiError';
    this.code = code;
    this.detail = detail;
    this.retryable = code === 'rate-limited' || code === 'network' || code === 'timeout' || code === 'server' || code === 'bad-response';
  }
}

export function aiErrorMessage(code: AiErrorCode): string {
  return MESSAGES[code];
}

/** Serialisable form sent over IPC. */
export interface AiErrorInfo {
  code: AiErrorCode;
  message: string;
  detail: string;
  retryable: boolean;
}

export function toErrorInfo(e: unknown): AiErrorInfo {
  if (e instanceof AiError) return { code: e.code, message: e.message, detail: e.detail, retryable: e.retryable };
  const err = e as Error;
  if (err?.name === 'AbortError') return toErrorInfo(new AiError('cancelled'));
  return { code: 'server', message: MESSAGES.server, detail: String(err?.message ?? e), retryable: true };
}
