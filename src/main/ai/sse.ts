// Minimal Server-Sent Events reader for streamed HTTP responses.

export interface SseEvent {
  event: string;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  const flush = (): SseEvent | null => {
    if (data.length === 0) {
      event = 'message';
      return null;
    }
    const out = { event, data: data.join('\n') };
    event = 'message';
    data = [];
    return out;
  };
  try {
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1));
        if (line === '') {
          const ev = flush();
          if (ev) yield ev;
        } else if (line.startsWith(':')) {
          continue;
        } else {
          const idx = line.indexOf(':');
          const field = idx >= 0 ? line.slice(0, idx) : line;
          const value = idx >= 0 ? line.slice(idx + 1).replace(/^ /, '') : '';
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
