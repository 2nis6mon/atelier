import { describe, expect, it } from 'vitest';
import { bulletPath, getText, itemPath, newTextItem, addItem, setText } from '../../src/shared/document';
import {
  applyProposal,
  blockRef,
  checkProposal,
  currentBaseline,
  isActionable,
  itemPlainText,
  itemRef,
  parseRef,
  refreshStaleness,
  typeRef,
} from '../../src/shared/proposals';
import type { EntryItem } from '../../src/shared/types';
import { makeProposal, sampleDocument, sampleRecords } from '../helpers/sample';

const ORIGINAL = 'Je travaille avec les designers.';
const PROPOSED = 'Je développe des interfaces React et TypeScript en collaboration avec les designers.';

function setup() {
  const doc = sampleDocument();
  const exp = doc.blocks[1];
  const entry = exp.items[0] as EntryItem;
  const path = bulletPath(exp.id, entry.id, entry.bullets[1].id);
  return { doc, exp, entry, path };
}

describe('rewrite proposals', () => {
  it('applies an accepted rewrite and leaves the original untouched', () => {
    const { doc, path } = setup();
    const p = makeProposal({ target: path, baseText: ORIGINAL, proposedText: PROPOSED });
    expect(checkProposal(doc, p)).toEqual({ state: 'ok' });
    const res = applyProposal(doc, p);
    expect(res.ok).toBe(true);
    if (res.ok) expect(getText(res.doc, path)).toBe(PROPOSED);
    expect(getText(doc, path)).toBe(ORIGINAL);
  });

  it('applies the user-edited text instead of the proposal', () => {
    const { doc, path } = setup();
    const res = applyProposal(doc, makeProposal({ target: path, baseText: ORIGINAL, proposedText: PROPOSED }), { editedText: 'Édité à la main.' });
    expect(res.ok && getText(res.doc, path)).toBe('Édité à la main.');
    const empty = applyProposal(doc, makeProposal({ target: path, baseText: ORIGINAL, proposedText: PROPOSED }), { editedText: '  ' });
    expect(empty).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('detects a conflict when the base text changed during the request', () => {
    const { doc, path } = setup();
    const changed = setText(doc, path, 'Je travaille étroitement avec les designers.');
    const p = makeProposal({ target: path, baseText: ORIGINAL, proposedText: PROPOSED });
    expect(checkProposal(changed, p)).toMatchObject({ state: 'stale' });
    const res = applyProposal(changed, p);
    expect(res).toMatchObject({ ok: false, reason: 'stale' });
    expect(getText(changed, path)).toBe('Je travaille étroitement avec les designers.');
  });

  it('reports a missing target', () => {
    const { doc, exp, entry } = setup();
    const p = makeProposal({ target: bulletPath(exp.id, entry.id, 'deleted'), baseText: ORIGINAL, proposedText: PROPOSED });
    expect(checkProposal(doc, p).state).toBe('missing');
    expect(applyProposal(doc, p)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('requires explicit confirmation for undocumented facts', () => {
    const { doc, path } = setup();
    const p = makeProposal({ target: path, baseText: ORIGINAL, proposedText: 'Je dirige une équipe de 12 personnes.', unverified: ['12'] });
    expect(applyProposal(doc, p)).toMatchObject({ ok: false, reason: 'needs-confirmation' });
    expect(applyProposal(doc, { ...p, confirmed: true }).ok).toBe(true);
  });

  it('refuses proposals that were already handled or are informational', () => {
    const { doc, path } = setup();
    expect(applyProposal(doc, makeProposal({ target: path, baseText: ORIGINAL, status: 'rejected' }))).toMatchObject({ reason: 'not-pending' });
    expect(applyProposal(doc, makeProposal({ kind: 'comment' }))).toMatchObject({ reason: 'not-applicable' });
    expect(checkProposal(doc, makeProposal({ kind: 'question' }))).toEqual({ state: 'informational' });
    expect(isActionable(makeProposal({ kind: 'comment' }))).toBe(false);
    expect(isActionable(makeProposal({ status: 'stale' }))).toBe(true);
    expect(isActionable(makeProposal({ status: 'accepted' }))).toBe(false);
  });
});

describe('structural proposals', () => {
  it('removes a bullet and an entry explicitly', () => {
    const { doc, exp, entry, path } = setup();
    const r1 = applyProposal(doc, makeProposal({ kind: 'remove', target: path, baseText: ORIGINAL }));
    expect(r1.ok && (r1.doc.blocks[1].items[0] as EntryItem).bullets).toHaveLength(2);
    const second = exp.items[1];
    const r2 = applyProposal(doc, makeProposal({ kind: 'remove', target: itemRef(exp.id, second.id), baseText: itemPlainText(second) }));
    expect(r2.ok && r2.doc.blocks[1].items).toHaveLength(1);
    const stale = applyProposal(doc, makeProposal({ kind: 'remove', target: itemRef(exp.id, second.id), baseText: 'different' }));
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    expect(checkProposal(doc, makeProposal({ kind: 'remove', target: itemRef(exp.id, 'x') })).state).toBe('missing');
    expect(currentBaseline(doc, { kind: 'remove', target: 'garbage' })).toBeNull();
    expect(currentBaseline(doc, { kind: 'insert', target: 'garbage' })).toBeNull();
    expect(entry.bullets).toHaveLength(3);
  });

  it('inserts bullets and paragraphs', () => {
    const { doc, exp, entry } = setup();
    const r = applyProposal(doc, makeProposal({ kind: 'insert', target: itemRef(exp.id, entry.id), afterId: entry.bullets[0].id, proposedText: 'Mentorat de deux développeurs.' }));
    expect(r.ok && (r.doc.blocks[1].items[0] as EntryItem).bullets[1].text).toBe('Mentorat de deux développeurs.');
    const profile = doc.blocks[0];
    const r2 = applyProposal(doc, makeProposal({ kind: 'insert', target: blockRef(profile.id), proposedText: 'Second paragraphe.' }));
    expect(r2.ok && r2.doc.blocks[0].items).toHaveLength(2);
    expect(applyProposal(doc, makeProposal({ kind: 'insert', target: blockRef(profile.id), proposedText: '' }))).toMatchObject({ reason: 'invalid' });
    expect(checkProposal(doc, makeProposal({ kind: 'insert', target: itemRef(exp.id, entry.id), afterId: 'gone' })).state).toBe('stale');
    expect(checkProposal(doc, makeProposal({ kind: 'insert', target: itemRef(exp.id, 'gone') })).state).toBe('missing');
    expect(checkProposal(doc, makeProposal({ kind: 'insert', target: blockRef('gone') })).state).toBe('missing');
    expect(checkProposal(doc, makeProposal({ kind: 'insert', target: blockRef(profile.id), afterId: 'gone' })).state).toBe('stale');
    expect(checkProposal(doc, makeProposal({ kind: 'insert', target: 'weird' })).state).toBe('missing');
  });

  it('reorders only when the order is unchanged since the request', () => {
    const { doc, exp } = setup();
    const ids = exp.items.map((i) => i.id);
    const p = makeProposal({ kind: 'reorder', target: blockRef(exp.id), baseOrder: ids, proposedOrder: [...ids].reverse() });
    const r = applyProposal(doc, p);
    expect(r.ok && r.doc.blocks[1].items.map((i) => i.id)).toEqual([...ids].reverse());
    const changed = addItem(doc, exp.id, newTextItem('x'));
    expect(applyProposal(changed, p)).toMatchObject({ reason: 'stale' });
    expect(checkProposal(doc, makeProposal({ kind: 'reorder', target: blockRef('gone') })).state).toBe('missing');
  });

  it('brings in library content with provenance, never modifying the record', () => {
    const { doc } = setup();
    const records = sampleRecords();
    const expBlock = doc.blocks[1];
    const p = makeProposal({ kind: 'library', target: blockRef(expBlock.id), recordId: 'rec-exp-lumen' });
    const r = applyProposal(doc, p, { records });
    expect(r.ok && r.doc.blocks[1].items.at(-1)).toMatchObject({ org: 'Lumen', recordId: 'rec-exp-lumen' });
    expect(checkProposal(doc, p, [])).toMatchObject({ state: 'missing' });
    // by block type, creating the section when needed
    const noCerts = applyProposal(doc, makeProposal({ kind: 'library', target: typeRef('projects'), recordId: 'rec-exp-lumen' }), { records });
    expect(noCerts.ok && noCerts.doc.blocks.at(-1)?.type).toBe('projects');
    const byRecordType = applyProposal(doc, makeProposal({ kind: 'library', target: 'type:unknown', recordId: 'rec-edu' }), { records });
    expect(byRecordType.ok).toBe(true);
    const personal = applyProposal(doc, makeProposal({ kind: 'library', target: 'x', recordId: 'rec-personal' }), { records });
    expect(personal).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkProposal(doc, makeProposal({ kind: 'library', target: blockRef('gone'), recordId: 'rec-edu' }), records).state).toBe('missing');
    expect(records.find((x) => x.id === 'rec-exp-lumen')?.data).toMatchObject({ company: 'Lumen' });
  });

  it('parses references', () => {
    expect(parseRef('entry:a:b')).toEqual({ type: 'item', blockId: 'a', itemId: 'b' });
    expect(parseRef('block:a')).toEqual({ type: 'block', blockId: 'a' });
    expect(parseRef('type:skills')).toEqual({ type: 'blockType', blockType: 'skills' });
    expect(parseRef('zzz')).toBeNull();
  });

  it('marks proposals stale when the document moves on, and back', () => {
    const { doc, path } = setup();
    const p = makeProposal({ target: path, baseText: ORIGINAL, proposedText: PROPOSED });
    const changed = setText(doc, path, 'Autre');
    const [stale] = refreshStaleness(changed, [p]);
    expect(stale.status).toBe('stale');
    const [again] = refreshStaleness(doc, [stale]);
    expect(again.status).toBe('pending');
    const accepted = { ...p, status: 'accepted' as const };
    expect(refreshStaleness(changed, [accepted])[0]).toBe(accepted);
  });

  it('exposes plain text of every item kind', () => {
    const doc = sampleDocument();
    expect(itemPlainText(doc.blocks[0].items[0])).toContain('Développeuse');
    expect(itemPlainText(doc.blocks[3].items[0])).toBe('Frontend: React, TypeScript, HTML, CSS');
    expect(itemPlainText(doc.blocks[4].items[0])).toBe('Français — Langue maternelle');
    expect(getText(doc, itemPath(doc.blocks[0].id, doc.blocks[0].items[0].id, 'text'))).toBeTruthy();
  });
});
