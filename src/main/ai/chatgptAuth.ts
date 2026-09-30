// Sign in with ChatGPT — plan usage for open-source / personal local apps.
// Implements OpenAI's documented flow: authorization code + PKCE (S256),
// fresh state and nonce, loopback redirect http://127.0.0.1:<port>/auth/callback,
// dynamic client registration (client_id=dynamic_agent_client on first sign-in,
// the issued client id reused afterwards with login_hint), scopes including
// chatgpt.tokens.use.direct, 1 h access tokens kept in memory and refreshed
// under a lock, rotating 30-day refresh tokens stored in the Keychain-backed
// secret store, and revocation on disconnect.
//
// No cookies or tokens are ever read from other apps.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AiError } from '../../shared/ai/errors';
import type { SecretStore } from './secrets';
import type { FetchFn } from './types';

export const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const CHATGPT_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const CHATGPT_DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
export const CHATGPT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';

const K = {
  refresh: 'chatgpt.refresh_token',
  clientId: 'chatgpt.client_id',
  account: 'chatgpt.account',
  scope: 'chatgpt.scope',
  hostId: 'chatgpt.host_id',
};

export interface ChatGptAuthDeps {
  fetch: FetchFn;
  secrets: SecretStore;
  openExternal: (url: string) => Promise<void>;
  now?: () => number;
  appName?: string;
  /** Overridable for tests. */
  authorizeUrl?: string;
  tokenUrl?: string;
  discoveryUrl?: string;
  loginTimeoutMs?: number;
}

export interface ChatGptStatus {
  connected: boolean;
  planUsage: boolean;
  account: string;
  lastError: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Display-only decode of an ID token (never used for authorisation decisions). */
export function accountFromIdToken(idToken: string | undefined): string {
  if (!idToken) return '';
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string; name?: string };
    return payload.email ?? payload.name ?? '';
  } catch {
    return '';
  }
}

const CALLBACK_PAGE = (ok: boolean) =>
  `<!doctype html><meta charset="utf-8"><title>Atelier</title><body style="font:16px -apple-system,system-ui,sans-serif;background:#F6F1E9;color:#202B3B;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">${
    ok ? 'You are signed in' : 'Sign-in did not complete'
  }</h1><p>You can close this tab and return to Atelier.</p></div></body>`;

export class ChatGptAuth {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;
  private lastError: string | null = null;
  private revocationEndpoint: string | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: ChatGptAuthDeps) {
    this.now = deps.now ?? Date.now;
  }

  status(): ChatGptStatus {
    const refresh = this.deps.secrets.get(K.refresh);
    const scope = this.deps.secrets.get(K.scope) ?? '';
    return {
      connected: Boolean(refresh),
      planUsage: Boolean(refresh) && scope.split(' ').includes(PLAN_SCOPE),
      account: this.deps.secrets.get(K.account) ?? '',
      lastError: this.lastError,
    };
  }

  private hostId(): string {
    let id = this.deps.secrets.get(K.hostId);
    if (!id) {
      id = b64url(randomBytes(16));
      this.deps.secrets.set(K.hostId, id);
    }
    return id;
  }

  private async post(url: string, form: Record<string, string>, signal?: AbortSignal): Promise<{ status: number; body: TokenResponse }> {
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(form).toString(),
        signal,
      });
    } catch (e) {
      throw new AiError('network', String((e as Error).message));
    }
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    return { status: res.status, body };
  }

  private store(tokens: TokenResponse, clientId: string): void {
    if (!tokens.access_token || !tokens.refresh_token) throw new AiError('auth-failed', 'Incomplete token response');
    this.accessToken = tokens.access_token;
    this.expiresAt = this.now() + (tokens.expires_in ?? 3600) * 1000;
    this.deps.secrets.set(K.refresh, tokens.refresh_token);
    this.deps.secrets.set(K.clientId, clientId);
    if (tokens.scope !== undefined) this.deps.secrets.set(K.scope, tokens.scope);
    const account = accountFromIdToken(tokens.id_token);
    if (account) this.deps.secrets.set(K.account, account);
  }

  /** Runs the browser sign-in. Resolves when the callback has been handled. */
  async signIn(signal?: AbortSignal): Promise<ChatGptStatus> {
    if (!this.deps.secrets.available()) throw new AiError('not-configured', 'Secure storage is unavailable.');
    const { verifier, challenge } = pkcePair();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const savedClient = this.deps.secrets.get(K.clientId);
    const account = this.deps.secrets.get(K.account);

    let server: Server | null = null;
    try {
      const callback = await new Promise<{ code: string; clientId: string; redirectUri: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new AiError('timeout', 'Sign-in was not completed in time.')), this.deps.loginTimeoutMs ?? 300_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new AiError('cancelled'));
        });
        let redirectUri = '';
        server = createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/auth/callback') {
            res.writeHead(404).end();
            return;
          }
          const ok = url.searchParams.get('state') === state && Boolean(url.searchParams.get('code'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CALLBACK_PAGE(ok));
          clearTimeout(timer);
          if (url.searchParams.get('state') !== state) return reject(new AiError('auth-failed', 'State mismatch'));
          const error = url.searchParams.get('error');
          if (error) return reject(new AiError(error === 'access_denied' ? 'cancelled' : 'auth-failed', error));
          const code = url.searchParams.get('code');
          if (!code) return reject(new AiError('auth-failed', 'No authorization code'));
          resolve({ code, clientId: url.searchParams.get('client_id') ?? savedClient ?? '', redirectUri });
        });
        server.listen(0, '127.0.0.1', () => {
          const port = (server!.address() as AddressInfo).port;
          redirectUri = `http://127.0.0.1:${port}/auth/callback`;
          const params = new URLSearchParams({
            response_type: 'code',
            client_id: savedClient ?? 'dynamic_agent_client',
            redirect_uri: redirectUri,
            scope: CHATGPT_SCOPES,
            resource: CHATGPT_RESOURCE,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
            nonce,
          });
          if (!savedClient) {
            params.set('agent_name_hint', this.deps.appName ?? 'Atelier');
            params.set('ext_agent_host_id', this.hostId());
          } else if (account) {
            params.set('login_hint', account);
          }
          this.deps.openExternal(`${this.deps.authorizeUrl ?? CHATGPT_AUTHORIZE_URL}?${params.toString()}`).catch((e) => reject(e));
        });
        server.on('error', (e) => reject(new AiError('network', String(e))));
      });
      if (!callback.clientId) throw new AiError('auth-failed', 'No client id was issued.');
      const { status, body } = await this.post(
        this.deps.tokenUrl ?? CHATGPT_TOKEN_URL,
        { grant_type: 'authorization_code', code: callback.code, redirect_uri: callback.redirectUri, client_id: callback.clientId, code_verifier: verifier },
        signal,
      );
      if (status !== 200) throw new AiError('auth-failed', `${status} ${body.error ?? ''}`);
      this.store(body, callback.clientId);
      this.lastError = null;
      return this.status();
    } catch (e) {
      this.lastError = e instanceof AiError ? e.message : String(e);
      throw e instanceof AiError ? e : new AiError('auth-failed', String(e));
    } finally {
      (server as Server | null)?.close();
    }
  }

  /** Returns a valid access token, refreshing it (once, under a lock) when it expires within 60 s. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt - 60_000) return this.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const refreshToken = this.deps.secrets.get(K.refresh);
    const clientId = this.deps.secrets.get(K.clientId);
    if (!refreshToken || !clientId) throw new AiError('not-configured');
    const { status, body } = await this.post(this.deps.tokenUrl ?? CHATGPT_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
    if (status !== 200 || !body.access_token) {
      if (status === 400 || status === 401) {
        // Expired or revoked: forget tokens (keep the registered client id for the next sign-in).
        this.deps.secrets.delete(K.refresh);
        this.accessToken = null;
        this.lastError = 'Your ChatGPT sign-in expired. Sign in again.';
        throw new AiError('auth-expired', `${status} ${body.error ?? ''}`);
      }
      throw new AiError('server', `${status} ${body.error ?? ''}`);
    }
    this.store({ ...body, refresh_token: body.refresh_token ?? refreshToken }, clientId);
    return this.accessToken!;
  }

  private async revocationUrl(): Promise<string | null> {
    if (this.revocationEndpoint) return this.revocationEndpoint;
    try {
      const res = await this.deps.fetch(this.deps.discoveryUrl ?? CHATGPT_DISCOVERY_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const doc = (await res.json()) as { revocation_endpoint?: string };
      this.revocationEndpoint = doc.revocation_endpoint ?? null;
      return this.revocationEndpoint;
    } catch {
      return null;
    }
  }

  /** Revokes the refresh token (best effort) and forgets everything, including the client id. */
  async disconnect(): Promise<{ revoked: boolean }> {
    const refreshToken = this.deps.secrets.get(K.refresh);
    const clientId = this.deps.secrets.get(K.clientId);
    let revoked = false;
    if (refreshToken && clientId) {
      const url = await this.revocationUrl();
      if (url) {
        try {
          const { status } = await this.post(url, { token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId });
          revoked = status === 200;
        } catch {
          revoked = false;
        }
      }
    }
    for (const key of [K.refresh, K.clientId, K.account, K.scope]) this.deps.secrets.delete(key);
    this.accessToken = null;
    this.expiresAt = 0;
    this.lastError = null;
    return { revoked };
  }
}
