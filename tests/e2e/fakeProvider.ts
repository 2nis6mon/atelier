// Test-only AI provider: a local OpenAI-compatible server (Chat Completions,
// streamed tool calls). The app talks to it through its regular "local model"
// connection, so no real account, credential or billed call is involved.
// It is never shipped with the app.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeMode = 'rewrite' | 'quota' | 'slow' | 'invalid' | 'unverified' | 'mixed';

export interface FakeProvider {
  url: string;
  model: string;
  mode: FakeMode;
  requests: Array<{ system: string; user: string }>;
  close(): Promise<void>;
}

const MODEL = 'atelier-test-model';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

interface Parsed {
  sections: Array<{ id: string; type: string; entries: Array<{ id: string; bullets: string[] }> }>;
  library: Array<{ id: string; kind: string; label: string }>;
}

/** Reads the identifiers the app put in the request (S# sections, E# entries, T# texts, L# library records). */
function parse(user: string): Parsed {
  const sections: Parsed['sections'] = [];
  for (const line of user.split('\n')) {
    const sec = /^(S\d+) section \[(\w+)\]/.exec(line);
    if (sec) sections.push({ id: sec[1], type: sec[2], entries: [] });
    const ent = /^\s+(E\d+) (entry|item):/.exec(line);
    if (ent && sections.length) sections[sections.length - 1].entries.push({ id: ent[1], bullets: [] });
    const bul = /^\s+(T\d+) bullet:/.exec(line);
    const cur = sections[sections.length - 1]?.entries.at(-1);
    if (bul && cur) cur.bullets.push(bul[1]);
  }
  const library = [...user.matchAll(/^(L\d+) \[(\w+)\] (.+)$/gm)].map((m) => ({ id: m[1], kind: m[2], label: m[3] }));
  return { sections, library };
}

/** One suggestion of every kind the review screen handles. */
function mixed(user: string) {
  const { sections, library } = parse(user);
  const xp = sections.find((s) => s.type === 'experience');
  const first = xp?.entries[0];
  const bullets = [...user.matchAll(/^\s+(T\d+) bullet: (.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
  const out: Array<Record<string, unknown>> = [];
  if (bullets[0]) out.push({ type: 'rewrite', target: bullets[0].id, text: bullets[0].text.replace(/^Je /, 'Au quotidien, je '), explanation: 'More direct.', evidence: [bullets[0].id] });
  if (first) out.push({ type: 'add_bullet', entry: first.id, after: first.bullets[0], text: 'Je documente les composants React et TypeScript.', explanation: 'Uses skills already listed.', evidence: [first.id] });
  if (first && first.bullets.length > 1) out.push({ type: 'remove', target: first.bullets[first.bullets.length - 1], explanation: 'Less relevant for this offer.' });
  if (xp && xp.entries.length > 1) out.push({ type: 'reorder', section: xp.id, order: [...xp.entries].reverse().map((e) => e.id), explanation: 'Most relevant first.' });
  const lib = library.find((l) => l.kind === 'skill') ?? library[0];
  if (lib) out.push({ type: 'add_from_library', record: lib.id, section: sections.find((s) => s.type === 'skills')?.id, explanation: 'Relevant skill from your library.', evidence: [lib.id] });
  out.push({ type: 'question', text: 'Avez-vous mené un projet de design system ?', explanation: 'The offer asks for it; nothing in your documents says so.' });
  if (bullets[1]) out.push({ type: 'comment', target: bullets[1].id, text: 'Ce point pourrait préciser le contexte.', explanation: '' });
  return { summary: `${out.length} suggestions of different kinds.`, suggestions: out };
}

/** Library check: reports records sharing the same first word as possible duplicates/contradictions. */
function consolidation(user: string) {
  const { library } = parse(user);
  const groups = new Map<string, string[]>();
  for (const l of library) {
    const key = l.label.split(/[\s·—(]/)[0].toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), l.id]);
  }
  const suggestions = [...groups.values()]
    .filter((ids) => ids.length > 1)
    .flatMap((ids) => [
      { type: 'duplicate', records: ids, explanation: 'These records look like the same position.' },
      { type: 'contradiction', records: ids, field: 'start', explanation: 'The start dates differ.' },
    ]);
  return { summary: `${suggestions.length} findings.`, suggestions };
}

/** Deterministic rewrites for the first bullets found in the request (no new facts). */
export function suggestionsFor(user: string, mode: FakeMode) {
  if (user.includes('Review the LIBRARY records for duplicates')) return consolidation(user);
  if (mode === 'mixed') return mixed(user);
  const bullets = [...user.matchAll(/^\s+(T\d+) bullet: (.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
  const fields = [...user.matchAll(/^\s+(T\d+) field: (.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
  const pool = bullets.length ? bullets : fields;
  const reword = (t: string) => {
    const base = t.replace(/[.\s]+$/, '');
    return /^Je /.test(base) ? `Au quotidien, je ${base.slice(3)}.` : /^I /.test(base) ? `Day to day, I ${base.slice(2)}.` : `${base} — au quotidien.`;
  };
  if (mode === 'unverified' && pool[0]) {
    return {
      summary: 'One suggestion mentions a skill that is not in your documents.',
      suggestions: [{ type: 'rewrite', target: pool[0].id, text: `${pool[0].text.replace(/[.\s]+$/, '')} avec Kubernetes.`, explanation: 'Matches the offer.', evidence: [pool[0].id] }],
    };
  }
  return {
    summary: `${Math.min(2, pool.length)} wording suggestions.`,
    suggestions: pool.slice(0, 2).map((t, i) => ({
      type: 'rewrite',
      target: t.id,
      text: i === 0 ? reword(t.text) : `${t.text.replace(/[.\s]+$/, '')}, de façon continue.`,
      explanation: i === 0 ? 'More direct opening.' : 'Adds rhythm without adding facts.',
      evidence: [t.id],
    })),
  };
}

function sse(res: ServerResponse, chunks: string[], delayMs: number): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (res.destroyed) return resolve();
      if (i >= chunks.length) {
        res.write('data: [DONE]\n\n');
        res.end();
        return resolve();
      }
      res.write(`data: ${chunks[i++]}\n\n`);
      setTimeout(tick, delayMs);
    };
    tick();
  });
}

export async function startFakeProvider(initial: FakeMode = 'rewrite'): Promise<FakeProvider> {
  const state = { mode: initial };
  const requests: FakeProvider['requests'] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = JSON.parse(await readBody(req)) as { messages: Array<{ role: string; content: string }> };
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
      requests.push({ system, user });
      if (state.mode === 'quota') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', code: 'insufficient_quota' } }));
        return;
      }
      const args = state.mode === 'invalid' ? '{"summary": "broken", "suggestions": [{"type": "rewrite", "target": ' : JSON.stringify(suggestionsFor(user, state.mode));
      const pieces = args.match(/.{1,40}/gs) ?? [];
      const chunks = [
        ...pieces.map((p) => JSON.stringify({ model: MODEL, choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: p } }] }, finish_reason: null }] })),
        JSON.stringify({ model: MODEL, choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }),
      ];
      await sse(res, chunks, state.mode === 'slow' ? 400 : 5);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    model: MODEL,
    get mode() {
      return state.mode;
    },
    set mode(m: FakeMode) {
      state.mode = m;
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
