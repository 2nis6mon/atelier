import type { AtelierApi, Result } from '../shared/api';

declare global {
  interface Window {
    atelier: AtelierApi;
  }
}

export const api = (): AtelierApi => window.atelier;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Unwraps a Result, throwing an ApiError with the user-facing message on failure. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (r.ok) return r.value;
  throw new ApiError(r.error.code, r.error.message, r.error.detail);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message ?? String(e);
}
