import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiError } from '../../src/shared/ai/errors';
import { ChatGptAuth, PLAN_SCOPE, accountFromIdToken, pkcePair } from '../../src/main/ai/chatgptAuth';
import { EncryptedFileSecretStore, MemorySecretStore, SecretStoreUnavailableError } from '../../src/main/ai/secrets';
import { ProviderRegistry } from '../../src/main/ai/registry';
import { AiService } from '../../src/main/ai/service';
import type { Store } from '../../src/main/db/store';
import { bulletPath } from '../../src/shared/document';
import type { AiRequestInput, EntryItem } from '../../src/shared/types';
import { TOOL_OUTPUT, fakeFetch, jsonResponse, sseBody, sseResponse, type Call } from '../helpers/fakeFetch';
import { sampleDocument } from '../helpers/sample';
import { openStore } from '../helpers/store';
import { tempDir } from '../helpers/tempdir';

const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

/** Simulates the user's browser following the authorize URL and OpenAI redirecting back. */
function browser(opts: { issueClient?: string; tamperState?: boolean; error?: string } = {}) {
  const opened: URL[] = [];
  const openExternal = async (raw: string) => {
    const url = new URL(raw);
    opened.push(url);
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    if (opts.error) redirect.searchParams.set('error', opts.error);
    else redirect.searchParams.set('code', 'auth-code-1');
    redirect.searchParams.set('state', opts.tamperState ? 'evil' : url.searchParams.get('state')!);
    if (opts.issueClient) redirect.searchParams.set('client_id', opts.issueClient);
    setTimeout(() => get(redirect.toString(), (res) => res.resume()), 5);
  };
  return { opened, openExternal };
}

function tokenServer(scope = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`) {
  let n = 0;
  return fakeFetch((call: Call) => {
    if (call.url.includes('openid-configuration')) return jsonResponse(200, { revocation_endpoint: 'https://auth.test/revoke' });
    if (call.url.includes('revoke')) return jsonResponse(200, {});
    const form = new URLSearchParams(String(call.init.body));
    if (form.get('grant_type') === 'refresh_token') {
      if (form.get('refresh_token') === 'dead') return jsonResponse(400, { error: 'invalid_grant' });
      n++;
      return jsonResponse(200, { access_token: `access-${n + 1}`, refresh_token: `refresh-${n + 1}`, expires_in: 3600, scope });
    }
    return jsonResponse(200, { access_token: 'access-1', refresh_token: 'refresh-1', id_token: idToken('camille@example.com'), expires_in: 3600, scope });
  });
}

describe('Sign in with ChatGPT', () => {
  it('runs the documented loopback + PKCE flow and registers the client', async () => {
    const secrets = new MemorySecretStore();
    const t = tokenServer();
    const b = browser({ issueClient: 'oaiapp_123' });
    let now = 1_000_000;
    const auth = new ChatGptAuth({ fetch: t.fn, secrets, openExternal: b.openExternal, now: () => now, tokenUrl: 'https://auth.test/token', discoveryUrl: 'https://auth.test/.well-known/openid-configuration' });
    const status = await auth.signIn();
    expect(status).toEqual({ connected: true, planUsage: true, account: 'camille@example.com', lastError: null });
    const q = b.opened[0].searchParams;
    expect(b.opened[0].origin + b.opened[0].pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(q.get('client_id')).toBe('dynamic_agent_client');
    expect(q.get('agent_name_hint')).toBe('Atelier');
    expect(q.get('ext_agent_host_id')).toBeTruthy();
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')).toContain(PLAN_SCOPE);
    expect(q.get('resource')).toBe('https://api.openai.com/v1');
    expect(q.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(q.get('nonce')).toBeTruthy();
    const exchange = new URLSearchParams(String(t.calls[0].init.body));
    expect(exchange.get('client_id')).toBe('oaiapp_123');
    const challenge = createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url');
    expect(challenge).toBe(q.get('code_challenge'));
    expect(secrets.get('chatgpt.refresh_token')).toBe('refresh-1');

    // access token cached; refreshed once under a lock close to expiry; refresh token rotates
    expect(await auth.getAccessToken()).toBe('access-1');
    now += 3600 * 1000 - 30_000;
    const [a, c] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect(a).toBe('access-2');
    expect(c).toBe('access-2');
    expect(t.calls.filter((x) => String(x.init.body).includes('refresh_token')).length).toBe(1);
    expect(secrets.get('chatgpt.refresh_token')).toBe('refresh-2');

    // second sign-in reuses the registered client with a login hint
    const b2 = browser();
    const auth2 = new ChatGptAuth({ fetch: t.fn, secrets, openExternal: b2.openExternal, tokenUrl: 'https://auth.test/token' });
    await auth2.signIn();
    expect(b2.opened[0].searchParams.get('client_id')).toBe('oaiapp_123');
    expect(b2.opened[0].searchParams.get('login_hint')).toBe('camille@example.com');
    expect(b2.opened[0].searchParams.get('agent_name_hint')).toBeNull();

    // disconnect revokes and forgets
    const r = await auth.disconnect();
    expect(r.revoked).toBe(true);
    expect(t.calls.some((x) => x.url === 'https://auth.test/revoke')).toBe(true);
    expect(auth.status().connected).toBe(false);
    expect(secrets.get('chatgpt.client_id')).toBeNull();
  });

  it('does not enable plan usage without the plan scope', async () => {
    const auth = new ChatGptAuth({ fetch: tokenServer('openid email offline_access').fn, secrets: new MemorySecretStore(), openExternal: browser({ issueClient: 'oaiapp_x' }).openExternal, tokenUrl: 'https://auth.test/token' });
    expect(await auth.signIn()).toMatchObject({ connected: true, planUsage: false });
  });

  it('rejects state mismatches, denials, timeouts and cancellation', async () => {
    const mk = (b: ReturnType<typeof browser>, extra = {}) => new ChatGptAuth({ fetch: tokenServer().fn, secrets: new MemorySecretStore(), openExternal: b.openExternal, tokenUrl: 'https://auth.test/token', ...extra });
    await expect(mk(browser({ tamperState: true })).signIn()).rejects.toMatchObject({ code: 'auth-failed' });
    await expect(mk(browser({ error: 'access_denied' })).signIn()).rejects.toMatchObject({ code: 'cancelled' });
    await expect(mk(browser({ error: 'server_error' })).signIn()).rejects.toMatchObject({ code: 'auth-failed' });
    await expect(mk(browser()).signIn()).rejects.toMatchObject({ code: 'auth-failed' }); // no client id issued
    await expect(mk({ opened: [], openExternal: async () => undefined }, { loginTimeoutMs: 30 }).signIn()).rejects.toMatchObject({ code: 'timeout' });
    const ctrl = new AbortController();
    const p = mk({ opened: [], openExternal: async () => undefined }).signIn(ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    const failing = new ChatGptAuth({ fetch: fakeFetch(() => jsonResponse(500, {})).fn, secrets: new MemorySecretStore(), openExternal: browser({ issueClient: 'c' }).openExternal, tokenUrl: 'https://auth.test/token' });
    await expect(failing.signIn()).rejects.toMatchObject({ code: 'auth-failed' });
    expect(failing.status().lastError).toBeTruthy();
    await expect(new ChatGptAuth({ fetch: tokenServer().fn, secrets: new MemorySecretStore(false), openExternal: async () => undefined }).signIn()).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('expires the session when the refresh token is refused', async () => {
    const secrets = new MemorySecretStore();
    secrets.set('chatgpt.refresh_token', 'dead');
    secrets.set('chatgpt.client_id', 'oaiapp_1');
    secrets.set('chatgpt.scope', PLAN_SCOPE);
    const auth = new ChatGptAuth({ fetch: tokenServer().fn, secrets, openExternal: async () => undefined, tokenUrl: 'https://auth.test/token' });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'auth-expired' });
    expect(auth.status()).toMatchObject({ connected: false, lastError: 'Your ChatGPT sign-in expired. Sign in again.' });
    expect(secrets.get('chatgpt.client_id')).toBe('oaiapp_1');
    await expect(new ChatGptAuth({ fetch: tokenServer().fn, secrets: new MemorySecretStore(), openExternal: async () => undefined }).getAccessToken()).rejects.toMatchObject({ code: 'not-configured' });
    const s2 = new MemorySecretStore();
    s2.set('chatgpt.refresh_token', 'x');
    s2.set('chatgpt.client_id', 'c');
    const down = new ChatGptAuth({ fetch: fakeFetch(() => jsonResponse(503, {})).fn, secrets: s2, openExternal: async () => undefined });
    await expect(down.getAccessToken()).rejects.toMatchObject({ code: 'server' });
    const offline = new ChatGptAuth({ fetch: async () => { throw new TypeError('offline'); }, secrets: s2, openExternal: async () => undefined });
    await expect(offline.getAccessToken()).rejects.toMatchObject({ code: 'network' });
    expect(await offline.disconnect()).toEqual({ revoked: false });
  });

  it('helpers', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(accountFromIdToken(idToken('a@b.c'))).toBe('a@b.c');
    expect(accountFromIdToken('garbage')).toBe('');
    expect(accountFromIdToken(undefined)).toBe('');
  });
});

describe('secret storage', () => {
  const cipher = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(s.split('').reverse().join(''), 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (s === 'corrupt') throw new Error('bad');
      return s.split('').reverse().join('');
    },
  });

  it('stores only ciphertext with owner-only permissions', () => {
    const d = tempDir();
    const p = join(d.path, 'secrets.json');
    const s = new EncryptedFileSecretStore(p, cipher());
    s.set('anthropic.api_key', 'sk-ant-SECRET');
    expect(readFileSync(p, 'utf8')).not.toContain('sk-ant-SECRET');
    expect(statSync(p).mode & 0o077).toBe(0);
    expect(new EncryptedFileSecretStore(p, cipher()).get('anthropic.api_key')).toBe('sk-ant-SECRET');
    s.delete('anthropic.api_key');
    s.delete('none');
    expect(s.get('anthropic.api_key')).toBeNull();
    expect(new EncryptedFileSecretStore(p, cipher(false)).get('x')).toBeNull();
    expect(() => new EncryptedFileSecretStore(p, cipher(false)).set('k', 'v')).toThrow(SecretStoreUnavailableError);
    writeFileSync(p, '{bad json');
    expect(new EncryptedFileSecretStore(p, cipher()).get('k')).toBeNull();
    writeFileSync(p, JSON.stringify({ k: Buffer.from('corrupt').toString('base64') }));
    expect(new EncryptedFileSecretStore(p, cipher()).get('k')).toBeNull();
    d.cleanup();
  });
});

describe('provider registry and AI service', () => {
  let dir: ReturnType<typeof tempDir>;
  let store: Store;
  let secrets: MemorySecretStore;

  beforeEach(() => {
    dir = tempDir();
    store = openStore(join(dir.path, 'data'));
    secrets = new MemorySecretStore();
  });
  afterEach(() => {
    store.db.close();
    dir.cleanup();
  });

  function setup(handler: (c: Call) => Response | Promise<Response>) {
    const f = fakeFetch(handler);
    const chatgpt = new ChatGptAuth({ fetch: f.fn, secrets, openExternal: async () => undefined });
    const registry = new ProviderRegistry({ secrets, fetch: f.fn, settings: () => store.getSettings(), chatgpt });
    const service = new AiService(store, registry, () => '2026-01-15T10:00:00.000Z');
    return { f, registry, service };
  }

  const toolStream = (payload: unknown = TOOL_OUTPUT, delayMs = 0) =>
    new Response(sseBody([{ data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(payload) } }] } }] } }, { data: '[DONE]' }], { delayMs }), { status: 200 });

  function cvWithSelection() {
    const doc = sampleDocument();
    const cv = store.createCv({ name: 'CV', lang: 'fr', document: doc });
    const exp = doc.blocks[1];
    const entry = exp.items[0] as EntryItem;
    const path = bulletPath(exp.id, entry.id, entry.bullets[1].id);
    const request: AiRequestInput = { action: 'rewrite', scope: { type: 'selection', target: path, selectionText: '' }, tone: 'concise', targetLang: null, instructions: '', includeOffer: false, libraryRecordIds: [] };
    return { cv, doc, path, request };
  }

  it('describes every provider honestly', () => {
    const { registry } = setup(() => jsonResponse(200, {}));
    const s = registry.statuses();
    expect(s.map((x) => [x.id, x.mode, x.connected])).toEqual([
      ['chatgpt', 'plan', false],
      ['anthropic', 'api', false],
      ['openai', 'api', false],
      ['compatible', 'local', false],
    ]);
    expect(s.find((x) => x.id === 'anthropic')?.billingNote).toMatch(/separate/i);
    expect(s.find((x) => x.id === 'anthropic')?.model).toBe('claude-opus-5-5');
    expect(() => registry.setApiKey('chatgpt', 'x')).toThrow(AiError);
    expect(() => registry.setApiKey('openai', 'short')).toThrow(AiError);
    expect(registry.setApiKey('openai', 'sk-proj-abcdefgh').connected).toBe(true);
    expect(registry.removeApiKey('openai').connected).toBe(false);
    expect(registry.setApiKey('compatible', '').connected).toBe(false);
  });

  it('verifies credentials by listing models and resolves default models', async () => {
    const { registry } = setup((c) => (c.url.endsWith('/models') ? jsonResponse(200, { data: [{ id: 'gpt-5' }, { id: 'gpt-5.5' }] }) : jsonResponse(500, {})));
    registry.setApiKey('openai', 'sk-proj-abcdefgh');
    const v = await registry.verify('openai', new AbortController().signal);
    expect(v).toMatchObject({ verified: true, models: ['gpt-5.5', 'gpt-5'], model: 'gpt-5.5' });
    expect(await registry.resolveModel('anthropic', new AbortController().signal)).toBe('claude-opus-5-5');
    store.updateSettings({ models: { openai: 'gpt-5' } });
    expect(await registry.resolveModel('openai', new AbortController().signal)).toBe('gpt-5');
    const { registry: bad } = setup(() => jsonResponse(401, {}));
    bad.setApiKey('openai', 'sk-proj-abcdefgh');
    store.updateSettings({ models: {} });
    expect((await bad.verify('openai', new AbortController().signal)).lastError).toMatch(/rejected/);
    await expect(bad.resolveModel('openai', new AbortController().signal)).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('turns an AI answer into pending proposals without changing the CV', async () => {
    store.updateSettings({ defaultProvider: 'compatible', compatibleBaseUrl: 'http://127.0.0.1:9/v1', models: { compatible: 'llama' } });
    const { service } = setup(() => toolStream());
    const { cv, doc, path, request } = cvWithSelection();
    const progress: number[] = [];
    const result = await service.run({ requestId: 'r1', cvId: cv.id, document: doc, request }, (_id, n) => progress.push(n));
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ kind: 'rewrite', target: path, baseText: 'Je travaille avec les designers.', status: 'pending' });
    expect(result.contextLabels).toEqual(['Selected paragraph']);
    expect(progress.length).toBeGreaterThan(0);
    expect(store.getCv(cv.id)!.document).toEqual(cv.document);
    expect(store.getCv(cv.id)!.revision).toBe(1);
    expect(store.listProposals(cv.id, ['pending'])).toHaveLength(1);
    const msgs = store.listMessages(cv.id);
    expect(msgs.map((m) => [m.role, m.status])).toEqual([
      ['user', 'ok'],
      ['assistant', 'ok'],
    ]);
    expect(msgs[1].providerLabel).toContain('Local model');
  });

  it('never falls back to another provider', async () => {
    store.updateSettings({ defaultProvider: 'anthropic', compatibleBaseUrl: 'http://127.0.0.1:9/v1', models: { compatible: 'llama' } });
    const { service, f } = setup(() => toolStream());
    const { cv, doc, request } = cvWithSelection();
    await expect(service.run({ requestId: 'r1', cvId: cv.id, document: doc, request })).rejects.toMatchObject({ code: 'not-configured' });
    expect(f.calls).toHaveLength(0);
    store.updateSettings({ defaultProvider: null });
    await expect(service.run({ requestId: 'r2', cvId: cv.id, document: doc, request })).rejects.toMatchObject({ code: 'not-configured' });
    store.updateSettings({ defaultProvider: 'chatgpt' });
    await expect(service.run({ requestId: 'r3', cvId: cv.id, document: doc, request })).rejects.toMatchObject({ code: 'auth-expired' });
    expect(f.calls).toHaveLength(0);
  });

  it('keeps the draft unchanged on cancellation, quota and malformed answers', async () => {
    store.updateSettings({ defaultProvider: 'compatible', compatibleBaseUrl: 'http://127.0.0.1:9/v1', models: { compatible: 'llama' } });
    const { cv, doc, request } = cvWithSelection();
    const slow = setup(() => toolStream(TOOL_OUTPUT, 40));
    const p = slow.service.run({ requestId: 'rc', cvId: cv.id, document: doc, request });
    await new Promise((r) => setTimeout(r, 15));
    expect(slow.service.isRunning('rc')).toBe(true);
    expect(slow.service.cancel('rc')).toBe(true);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    expect(slow.service.cancel('rc')).toBe(false);
    const quota = setup(() => jsonResponse(429, { error: { code: 'insufficient_quota', message: 'no credit' } }));
    await expect(quota.service.run({ requestId: 'rq', cvId: cv.id, document: doc, request })).rejects.toMatchObject({ code: 'quota' });
    const junk = setup(() => sseResponse([{ data: { choices: [{ delta: { tool_calls: [{ function: { arguments: '{"summary": 3' } }] } }] } }]));
    await expect(junk.service.run({ requestId: 'rb', cvId: cv.id, document: doc, request })).rejects.toMatchObject({ code: 'bad-response' });
    const prose = setup(() => sseResponse([{ data: { choices: [{ delta: { content: 'Hello' } }] } }]));
    await expect(prose.service.run({ requestId: 'rp', cvId: cv.id, document: doc, request })).rejects.toMatchObject({ code: 'bad-response' });
    expect(store.getCv(cv.id)!.document).toEqual(cv.document);
    expect(store.listProposals(cv.id)).toHaveLength(0);
    const notices = store.listMessages(cv.id).filter((m) => m.role === 'notice');
    expect(notices.map((m) => m.status)).toEqual(['cancelled', 'error', 'error', 'error']);
    expect(notices.every((m) => m.text.endsWith('Your draft is unchanged.'))).toBe(true);
    await expect(prose.service.run({ requestId: 'rx', cvId: 'none', document: doc, request })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('checks the library for duplicates and contradictions on request', async () => {
    store.updateSettings({ defaultProvider: 'compatible', compatibleBaseUrl: 'http://127.0.0.1:9/v1', models: { compatible: 'llama' } });
    const a = store.createRecord({ kind: 'experience', lang: 'fr', data: { company: 'Nova', role: 'Dev', start: '2021' } });
    const b = store.createRecord({ kind: 'experience', lang: 'fr', data: { company: 'Nova', role: 'Dev', start: '2022' } });
    const { service } = setup(() => toolStream({ summary: 'One contradiction.', suggestions: [{ type: 'contradiction', records: ['L1', 'L2'], field: 'start', explanation: 'Start dates differ.' }] }));
    const r = await service.consolidate('rk', [a.id, b.id]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ type: 'contradiction', field: 'start', explanation: 'Start dates differ.' });
    expect([...r.findings[0].recordIds].sort()).toEqual([a.id, b.id].sort());
    await expect(service.consolidate('rk2', [a.id])).rejects.toMatchObject({ code: 'unsupported' });
    expect(store.getRecord(a.id)?.data).toMatchObject({ start: '2021' });
  });
});
