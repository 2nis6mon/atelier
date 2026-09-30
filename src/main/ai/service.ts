// Runs explicit AI actions. The service never modifies a CV: it stores
// proposals for review. Errors, cancellation and exhausted quotas leave the
// draft untouched and are recorded in the conversation.

import { AiError, toErrorInfo, type AiErrorInfo } from '../../shared/ai/errors';
import { buildAiContext } from '../../shared/ai/context';
import { SYSTEM_PROMPT, TOOL_NAME, TOOL_SCHEMA, buildUserMessage } from '../../shared/ai/prompt';
import { type ConsolidationFinding, mapResponse, parseToolInput } from '../../shared/ai/response';
import { emptyDocument, newId } from '../../shared/document';
import { validateDocument } from '../../shared/validation';
import type { AiAction, AiRequestInput, ConversationMessage, CvDocument, Proposal, ProviderId } from '../../shared/types';
import type { Store } from '../db/store';
import type { ProviderRegistry } from './registry';

export interface AiRunInput {
  requestId: string;
  cvId: string;
  document: CvDocument;
  request: AiRequestInput;
}

export interface AiRunResult {
  requestId: string;
  summary: string;
  proposals: Proposal[];
  findings: ConsolidationFinding[];
  dropped: string[];
  contextLabels: string[];
  providerLabel: string;
  model: string;
}

export const ACTION_LABELS: Record<AiAction, string> = {
  adapt: 'Suggest adaptations to the job offer',
  rewrite: 'Rewrite',
  tone: 'Change tone',
  translate: 'Translate',
  recover: 'Find content in my library',
  comment: 'Comment without editing',
  chat: 'Ask AI',
  consolidate: 'Check my library for duplicates and contradictions',
};

const TOOL_DESCRIPTION = 'Return your suggestions for the user to review. Call this exactly once.';
const REQUEST_TIMEOUT_MS = 240_000;

export type ProgressFn = (requestId: string, receivedChars: number) => void;

export class AiService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly store: Store,
    private readonly registry: ProviderRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private provider(): ProviderId {
    const id = this.store.getSettings().defaultProvider;
    if (!id) throw new AiError('not-configured');
    if (!this.registry.isConnected(id)) {
      throw new AiError(id === 'chatgpt' ? 'auth-expired' : 'not-configured', `${id} is not connected`);
    }
    return id;
  }

  cancel(requestId: string): boolean {
    const c = this.running.get(requestId);
    if (!c) return false;
    c.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    return true;
  }

  isRunning(requestId: string): boolean {
    return this.running.has(requestId);
  }

  private async call(providerId: ProviderId, userMessage: string, requestId: string, onProgress?: ProgressFn) {
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    const timeout = setTimeout(() => ctrl.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), REQUEST_TIMEOUT_MS);
    try {
      const model = await this.registry.resolveModel(providerId, ctrl.signal);
      const result = await this.registry.adapter(providerId).complete(
        { system: SYSTEM_PROMPT, user: userMessage, tool: { name: TOOL_NAME, description: TOOL_DESCRIPTION, schema: TOOL_SCHEMA as unknown as Record<string, unknown> }, model, maxOutputTokens: 16_000 },
        { signal: ctrl.signal, onProgress: (n) => onProgress?.(requestId, n) },
      );
      if (result.toolInput === null) throw new AiError('bad-response', 'The model answered without suggestions.');
      this.registry.recordError(providerId, null);
      return { raw: parseToolInput(result.toolInput), model: result.model };
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('server', String((e as Error)?.message ?? e));
      if (err.code === 'auth-expired' || err.code === 'auth-failed' || err.code === 'not-eligible') this.registry.recordError(providerId, err.message);
      throw err;
    } finally {
      clearTimeout(timeout);
      this.running.delete(requestId);
    }
  }

  /** Runs an action on a CV. Proposals are stored as pending; the document is not modified. */
  async run(input: AiRunInput, onProgress?: ProgressFn): Promise<AiRunResult> {
    const cv = this.store.getCv(input.cvId);
    if (!cv) throw new AiError('unsupported', 'CV not found');
    const doc = validateDocument(input.document);
    const records = this.store.listRecords();
    const app = cv.applicationId ? this.store.getApplication(cv.applicationId) : null;
    const offer = app ? { company: app.company, role: app.role, text: app.offerText, notes: app.notes } : null;
    const ctx = buildAiContext({ doc, request: input.request, records, offer });
    const providerId = this.provider();
    const providerLabel = this.registry.status(providerId).label;

    const userMsg: ConversationMessage = {
      id: newId(),
      cvId: cv.id,
      role: 'user',
      text: input.request.instructions.trim() || ACTION_LABELS[input.request.action],
      requestId: input.requestId,
      action: input.request.action,
      providerLabel,
      status: 'pending',
      proposalIds: [],
      contextLabels: ctx.labels,
      createdAt: this.now(),
    };
    this.store.addMessage(userMsg);
    try {
      const { raw, model } = await this.call(providerId, buildUserMessage(ctx), input.requestId, onProgress);
      const mapped = mapResponse(ctx, raw, { cvId: cv.id, requestId: input.requestId, now: this.now(), newId, doc });
      this.store.saveProposals(mapped.proposals);
      this.store.updateMessage({ ...userMsg, status: 'ok' });
      this.store.addMessage({
        id: newId(),
        cvId: cv.id,
        role: 'assistant',
        text: mapped.summary || (mapped.proposals.length ? `${mapped.proposals.length} suggestion(s) to review.` : 'No change suggested.'),
        requestId: input.requestId,
        action: input.request.action,
        providerLabel: `${providerLabel} · ${model}`,
        status: 'ok',
        proposalIds: mapped.proposals.map((p) => p.id),
        contextLabels: ctx.labels,
        createdAt: this.now(),
      });
      return {
        requestId: input.requestId,
        summary: mapped.summary,
        proposals: mapped.proposals,
        findings: mapped.findings,
        dropped: mapped.dropped,
        contextLabels: ctx.labels,
        providerLabel,
        model,
      };
    } catch (e) {
      const info: AiErrorInfo = toErrorInfo(e);
      this.store.updateMessage({ ...userMsg, status: info.code === 'cancelled' ? 'cancelled' : 'error' });
      this.store.addMessage({
        id: newId(),
        cvId: cv.id,
        role: 'notice',
        text: `${info.message} Your draft is unchanged.`,
        requestId: input.requestId,
        action: input.request.action,
        providerLabel,
        status: info.code === 'cancelled' ? 'cancelled' : 'error',
        proposalIds: [],
        contextLabels: [],
        createdAt: this.now(),
      });
      throw e;
    }
  }

  /** Library-level check for duplicates and contradictions (explicit request only). */
  async consolidate(requestId: string, recordIds: string[], onProgress?: ProgressFn): Promise<{ summary: string; findings: ConsolidationFinding[]; dropped: string[] }> {
    if (recordIds.length < 2) throw new AiError('unsupported', 'Select at least two records.');
    const records = this.store.listRecords();
    const request: AiRequestInput = {
      action: 'consolidate',
      scope: { type: 'cv', target: null, selectionText: '' },
      tone: null,
      targetLang: null,
      instructions: '',
      includeOffer: false,
      libraryRecordIds: recordIds,
    };
    const doc = emptyDocument('fr');
    doc.blocks = [];
    const ctx = buildAiContext({ doc, request, records, offer: null });
    const providerId = this.provider();
    const { raw } = await this.call(providerId, buildUserMessage(ctx), requestId, onProgress);
    const mapped = mapResponse(ctx, raw, { cvId: '', requestId, now: this.now(), newId, doc });
    return { summary: mapped.summary, findings: mapped.findings, dropped: mapped.dropped };
  }
}
