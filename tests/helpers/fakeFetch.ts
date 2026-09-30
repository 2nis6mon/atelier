// Simulated HTTP transport for provider adapter tests (no network, no credentials).
export interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
}

export function sseBody(events: Array<{ event?: string; data: unknown }>, opts: { delayMs?: number; chunk?: number } = {}): ReadableStream<Uint8Array> {
  const text = events.map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const size = opts.chunk ?? 37;
  let pos = 0;
  return new ReadableStream({
    async pull(controller) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (pos >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(pos, pos + size));
      pos += size;
    },
  });
}

export function sseResponse(events: Array<{ event?: string; data: unknown }>, opts: { delayMs?: number } = {}): Response {
  return new Response(sseBody(events, opts), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function fakeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = init.body;
    if (input instanceof Request && body === undefined) body = await input.text();
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // form-encoded or text
      }
    }
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const call = { url, init: { ...init, headers: init.headers ?? (input instanceof Request ? input.headers : undefined) }, body };
    calls.push(call);
    return handler(call);
  };
  return { fn, calls };
}

export function headerOf(init: RequestInit, name: string): string | null {
  const h = init.headers;
  if (!h) return null;
  if (h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? null;
  const rec = h as Record<string, string>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? rec[key] : null;
}

/** A valid tool payload the model would send back. */
export const TOOL_OUTPUT = {
  summary: 'One rewrite.',
  suggestions: [{ type: 'rewrite', target: 'T1', text: 'Je développe des interfaces React et TypeScript en collaboration avec les designers.', explanation: 'Plus concis.', evidence: ['T1'] }],
};
