// Provider registry: one common interface, explicit selection only. There is
// never an automatic switch to another provider or to a billed mode: if the
// chosen provider fails, the request fails and the user decides.

import { AiError } from '../../shared/ai/errors';
import type { ProviderId, ProviderStatus, Settings } from '../../shared/types';
import { AnthropicAdapter, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from './anthropic';
import type { ChatGptAuth } from './chatgptAuth';
import { CompatibleAdapter } from './compatible';
import { OpenAiResponsesAdapter } from './openai';
import type { SecretStore } from './secrets';
import type { FetchFn, ProviderAdapter } from './types';

export const PROVIDER_IDS: ProviderId[] = ['chatgpt', 'anthropic', 'openai', 'compatible'];

const INFO: Record<ProviderId, Pick<ProviderStatus, 'label' | 'mode' | 'billingNote' | 'limits'>> = {
  chatgpt: {
    label: 'ChatGPT',
    mode: 'plan',
    billingNote: 'Uses your ChatGPT plan when your account is eligible. No API key, no separate bill.',
    limits: 'Plan limits and a per-app limit you control in ChatGPT settings apply.',
  },
  anthropic: {
    label: 'Claude',
    mode: 'api',
    billingNote: 'Anthropic API key — separate pay-as-you-go billing on your Anthropic account. Claude subscriptions cannot be used by other apps.',
    limits: 'Limits and costs of your Anthropic API account apply.',
  },
  openai: {
    label: 'OpenAI API',
    mode: 'api',
    billingNote: 'OpenAI API key — separate pay-as-you-go billing on your OpenAI API account.',
    limits: 'Limits and costs of your OpenAI API account apply.',
  },
  compatible: {
    label: 'Local model',
    mode: 'local',
    billingNote: 'Runs on the server you configure (for example Ollama on this Mac). Atelier bills nothing.',
    limits: 'Depends on your server.',
  },
};

const keyName = (id: ProviderId) => `${id}.api_key`;

export interface RegistryDeps {
  secrets: SecretStore;
  fetch: FetchFn;
  settings: () => Settings;
  chatgpt: ChatGptAuth;
}

export class ProviderRegistry {
  private readonly models = new Map<ProviderId, string[]>();
  private readonly verified = new Set<ProviderId>();
  private readonly errors = new Map<ProviderId, string>();
  private readonly adapters: Record<ProviderId, ProviderAdapter>;

  constructor(private readonly deps: RegistryDeps) {
    this.adapters = {
      chatgpt: new OpenAiResponsesAdapter({ id: 'chatgpt', fetch: deps.fetch, planMode: true, credential: () => deps.chatgpt.getAccessToken() }),
      openai: new OpenAiResponsesAdapter({
        id: 'openai',
        fetch: deps.fetch,
        planMode: false,
        credential: async () => {
          const k = deps.secrets.get(keyName('openai'));
          if (!k) throw new AiError('not-configured');
          return k;
        },
      }),
      anthropic: new AnthropicAdapter(() => deps.secrets.get(keyName('anthropic')), deps.fetch),
      compatible: new CompatibleAdapter(deps.fetch, () => deps.settings().compatibleBaseUrl, () => deps.secrets.get(keyName('compatible'))),
    };
  }

  adapter(id: ProviderId): ProviderAdapter {
    return this.adapters[id];
  }

  isConnected(id: ProviderId): boolean {
    switch (id) {
      case 'chatgpt':
        return this.deps.chatgpt.status().planUsage;
      case 'compatible':
        return Boolean(this.deps.settings().compatibleBaseUrl.trim()) && Boolean(this.deps.settings().models.compatible);
      default:
        return Boolean(this.deps.secrets.get(keyName(id)));
    }
  }

  status(id: ProviderId): ProviderStatus {
    const info = INFO[id];
    const chat = id === 'chatgpt' ? this.deps.chatgpt.status() : null;
    const models = id === 'anthropic' ? [...new Set([...CLAUDE_MODELS.map((m) => m.id), ...(this.models.get(id) ?? [])])] : (this.models.get(id) ?? []);
    return {
      id,
      ...info,
      connected: this.isConnected(id),
      accountLabel: chat ? (chat.connected ? chat.account || 'Signed in' : '') : '',
      model: this.deps.settings().models[id] ?? (id === 'anthropic' ? DEFAULT_CLAUDE_MODEL : (models[0] ?? '')),
      models,
      lastError: chat?.lastError ?? this.errors.get(id) ?? (chat && chat.connected && !chat.planUsage ? 'Signed in, but ChatGPT plan usage was not granted.' : null),
      verified: this.verified.has(id),
    };
  }

  statuses(): ProviderStatus[] {
    return PROVIDER_IDS.map((id) => this.status(id));
  }

  setApiKey(id: ProviderId, key: string): ProviderStatus {
    if (id === 'chatgpt') throw new AiError('unsupported', 'ChatGPT uses sign-in, not a key.');
    const clean = key.trim();
    if (id !== 'compatible' && (clean.length < 8 || /\s/.test(clean))) throw new AiError('auth-failed', 'This does not look like an API key.');
    if (clean) this.deps.secrets.set(keyName(id), clean);
    else this.deps.secrets.delete(keyName(id));
    this.verified.delete(id);
    this.errors.delete(id);
    return this.status(id);
  }

  removeApiKey(id: ProviderId): ProviderStatus {
    this.deps.secrets.delete(keyName(id));
    this.verified.delete(id);
    this.errors.delete(id);
    this.models.delete(id);
    return this.status(id);
  }

  /** Checks the credential by listing models (no generation, no cost). */
  async verify(id: ProviderId, signal: AbortSignal): Promise<ProviderStatus> {
    try {
      const models = await this.adapters[id].listModels(signal);
      this.models.set(id, models);
      this.verified.add(id);
      this.errors.delete(id);
    } catch (e) {
      this.verified.delete(id);
      this.errors.set(id, e instanceof AiError ? e.message : String(e));
    }
    return this.status(id);
  }

  /** Model to use for a request: the user's choice, or a sensible default for the provider. */
  async resolveModel(id: ProviderId, signal: AbortSignal): Promise<string> {
    const chosen = this.deps.settings().models[id];
    if (chosen) return chosen;
    if (id === 'anthropic') return DEFAULT_CLAUDE_MODEL;
    if (!this.models.get(id)?.length) await this.verify(id, signal);
    const first = this.models.get(id)?.[0];
    if (!first) throw new AiError('not-configured', 'Choose a model in Settings › AI connections.');
    return first;
  }

  recordError(id: ProviderId, message: string | null): void {
    if (message) this.errors.set(id, message);
    else this.errors.delete(id);
  }
}
