import { describe, expect, it } from 'vitest';
import {
  PathError,
  addBlock,
  addBullet,
  addItem,
  blockTitlePath,
  blocksInZone,
  buildDocumentFromLibrary,
  bulletPath,
  cloneDocument,
  createBlock,
  describePath,
  documentHash,
  documentToPlainText,
  emptyDocument,
  getText,
  hashString,
  headerPath,
  itemPath,
  itemTitle,
  listTextFields,
  moveBlock,
  moveBlockBy,
  moveBulletBy,
  moveItemBy,
  newBullet,
  newEntryItem,
  newPairItem,
  newTagsItem,
  newTextItem,
  parsePath,
  recordToItem,
  removeBlock,
  removeBullet,
  removeItem,
  reorderItems,
  setBlockHidden,
  setHeaderLinks,
  setItemHidden,
  setStyle,
  setTemplate,
  setText,
  splitTags,
  stableStringify,
  togglePageBreak,
  updateEntry,
} from '../../src/shared/document';
import type { EntryItem } from '../../src/shared/types';
import { sampleDocument, sampleRecords } from '../helpers/sample';

describe('document paths', () => {
  it('parses and reads every path type', () => {
    const doc = sampleDocument();
    const exp = doc.blocks[1];
    const entry = exp.items[0] as EntryItem;
    expect(parsePath(headerPath('fullName'))).toEqual({ type: 'header', field: 'fullName' });
    expect(parsePath('header.bogus')).toBeNull();
    expect(parsePath('item:a:b.bogus')).toBeNull();
    expect(parsePath('nope')).toBeNull();
    expect(getText(doc, headerPath('fullName'))).toBe('Camille Laurent');
    expect(getText(doc, blockTitlePath(exp.id))).toBe('Expérience professionnelle');
    expect(getText(doc, itemPath(exp.id, entry.id, 'org'))).toBe('Atelier Nova');
    expect(getText(doc, bulletPath(exp.id, entry.id, entry.bullets[1].id))).toBe('Je travaille avec les designers.');
    expect(getText(doc, itemPath(exp.id, entry.id, 'label'))).toBeNull();
    expect(getText(doc, itemPath('missing', entry.id, 'org'))).toBeNull();
    expect(getText(doc, itemPath(exp.id, 'missing', 'org'))).toBeNull();
    expect(getText(doc, bulletPath(doc.blocks[0].id, doc.blocks[0].items[0].id, 'x'))).toBeNull();
    const skills = doc.blocks[3];
    expect(getText(doc, itemPath(skills.id, skills.items[0].id, 'tags'))).toBe('React, TypeScript, HTML, CSS');
    const langs = doc.blocks[4];
    expect(getText(doc, itemPath(langs.id, langs.items[1].id, 'level'))).toBe('Courant (C1)');
    expect(getText(doc, itemPath(langs.id, langs.items[1].id, 'text'))).toBeNull();
    expect(getText(doc, itemPath(skills.id, skills.items[0].id, 'text'))).toBeNull();
  });

  it('sets text immutably and rejects missing targets', () => {
    const doc = sampleDocument();
    const exp = doc.blocks[1];
    const entry = exp.items[0] as EntryItem;
    const path = bulletPath(exp.id, entry.id, entry.bullets[0].id);
    const next = setText(doc, path, 'Nouveau texte');
    expect(getText(next, path)).toBe('Nouveau texte');
    expect(getText(doc, path)).toBe('Je développe des interfaces avec React et TypeScript.');
    expect(setText(doc, headerPath('headline'), 'Lead').header.headline).toBe('Lead');
    expect(setText(doc, blockTitlePath(exp.id), 'Parcours').blocks[1].title).toBe('Parcours');
    const skills = doc.blocks[3];
    const tagged = setText(doc, itemPath(skills.id, skills.items[0].id, 'tags'), 'React; Vue ,  Svelte');
    expect((tagged.blocks[3].items[0] as { tags: string[] }).tags).toEqual(['React', 'Vue', 'Svelte']);
    expect(() => setText(doc, bulletPath(exp.id, entry.id, 'gone'), 'x')).toThrow(PathError);
    expect(() => setText(doc, 'garbage', 'x')).toThrow(PathError);
    expect(splitTags('a,\nb;;c')).toEqual(['a', 'b', 'c']);
  });

  it('describes and lists fields', () => {
    const doc = sampleDocument();
    const exp = doc.blocks[1];
    const entry = exp.items[0] as EntryItem;
    expect(describePath(doc, bulletPath(exp.id, entry.id, entry.bullets[1].id))).toBe(
      'Expérience professionnelle › Atelier Nova · Développeuse Frontend › bullet 2',
    );
    expect(describePath(doc, headerPath('email'))).toBe('Header › Email');
    expect(describePath(doc, blockTitlePath('zzz'))).toBe('Removed section › Title');
    expect(describePath(doc, 'bad')).toBe('Unknown');
    expect(describePath(doc, itemPath(exp.id, 'zz', 'text'))).toBe('Expérience professionnelle › Removed entry');
    const fields = listTextFields(doc);
    expect(fields.some((f) => f.text === 'Je travaille avec les designers.')).toBe(true);
    const hidden = setBlockHidden(doc, exp.id, true);
    expect(listTextFields(hidden).some((f) => f.blockId === exp.id)).toBe(false);
    expect(listTextFields(hidden, true).filter((f) => f.blockId === exp.id).every((f) => f.hidden)).toBe(true);
    expect(itemTitle(newTextItem('x'.repeat(40)))).toHaveLength(33);
    expect(itemTitle(newTagsItem('', ['a', 'b']))).toBe('a, b');
    expect(itemTitle(newPairItem('Anglais', 'C1'))).toBe('Anglais');
  });
});

describe('structural operations', () => {
  it('adds, removes and reorders items and bullets', () => {
    let doc = sampleDocument();
    const exp = doc.blocks[1];
    const [first, second] = exp.items;
    doc = addItem(doc, exp.id, newEntryItem({ org: 'Lumen' }), first.id);
    expect(doc.blocks[1].items.map((i) => (i as EntryItem).org)).toEqual(['Atelier Nova', 'Lumen', 'Studio Forma']);
    doc = moveItemBy(doc, exp.id, second.id, -5);
    expect((doc.blocks[1].items[0] as EntryItem).org).toBe('Studio Forma');
    expect(moveItemBy(doc, exp.id, 'missing', 1)).toEqual(doc);
    doc = removeItem(doc, exp.id, second.id);
    expect(doc.blocks[1].items).toHaveLength(2);
    expect(() => removeItem(doc, exp.id, second.id)).toThrow(PathError);
    const b = newBullet('Nouveau');
    doc = addBullet(doc, exp.id, first.id, b, (first as EntryItem).bullets[0].id);
    const bullets = (doc.blocks[1].items.find((i) => i.id === first.id) as EntryItem).bullets;
    expect(bullets[1].text).toBe('Nouveau');
    doc = moveBulletBy(doc, exp.id, first.id, b.id, -1);
    expect((doc.blocks[1].items.find((i) => i.id === first.id) as EntryItem).bullets[0].id).toBe(b.id);
    doc = removeBullet(doc, exp.id, first.id, b.id);
    expect(() => removeBullet(doc, exp.id, first.id, b.id)).toThrow(PathError);
    expect(() => addBullet(doc, doc.blocks[0].id, doc.blocks[0].items[0].id, newBullet('x'))).toThrow(PathError);
    doc = updateEntry(doc, exp.id, first.id, { location: 'Lyon' });
    expect((doc.blocks[1].items.find((i) => i.id === first.id) as EntryItem).location).toBe('Lyon');
    doc = setItemHidden(doc, exp.id, first.id, true);
    expect(doc.blocks[1].items.find((i) => i.id === first.id)?.hidden).toBe(true);
    const ids = doc.blocks[1].items.map((i) => i.id).reverse();
    expect(reorderItems(doc, exp.id, ids).blocks[1].items.map((i) => i.id)).toEqual(ids);
    expect(() => reorderItems(doc, exp.id, ['x'])).toThrow();
  });

  it('moves blocks between zones and within a zone', () => {
    let doc = setTemplate(sampleDocument(), 'sidebar');
    expect(blocksInZone(doc, 'side').map((b) => b.type)).toEqual(['skills', 'languages']);
    const profile = doc.blocks[0];
    doc = moveBlock(doc, profile.id, 'side', 1);
    expect(blocksInZone(doc, 'side').map((b) => b.type)).toEqual(['skills', 'profile', 'languages']);
    doc = moveBlock(doc, profile.id, 'main', 99);
    expect(blocksInZone(doc, 'main').map((b) => b.type)).toEqual(['experience', 'education', 'profile']);
    doc = moveBlockBy(doc, profile.id, -1);
    expect(blocksInZone(doc, 'main').map((b) => b.type)).toEqual(['experience', 'profile', 'education']);
    expect(moveBlockBy(doc, doc.blocks.find((b) => b.type === 'experience')!.id, -1)).toBe(doc);
    expect(() => moveBlock(doc, 'nope', 'main', 0)).toThrow(PathError);
    expect(() => moveBlockBy(doc, 'nope', 1)).toThrow(PathError);
    // single-column templates ignore zones
    const classic = setTemplate(doc, 'classic');
    expect(blocksInZone(classic, 'side')).toHaveLength(0);
    // an empty zone accepts a block
    const allMain = { ...doc, blocks: doc.blocks.map((b) => ({ ...b, zone: 'main' as const })) };
    expect(blocksInZone(moveBlock(allMain, profile.id, 'side', 0), 'side').map((b) => b.id)).toEqual([profile.id]);
  });

  it('switches templates keeping user zones', () => {
    const doc = sampleDocument();
    const side = setTemplate(doc, 'sidebar');
    const moved = moveBlock(side, side.blocks[0].id, 'side', 0);
    const again = setTemplate(setTemplate(moved, 'compact'), 'sidebar');
    expect(again.blocks.find((b) => b.id === side.blocks[0].id)?.zone).toBe('side');
    expect(() => setTemplate(doc, 'nope' as never)).toThrow();
  });

  it('adds/removes blocks, page breaks, style and links', () => {
    let doc = sampleDocument();
    const block = createBlock('custom', 'en', 'main', 'Volunteering');
    doc = addBlock(doc, block, 0);
    expect(doc.blocks[0].title).toBe('Volunteering');
    doc = togglePageBreak(doc, block.id);
    expect(doc.pageBreaks).toEqual([block.id]);
    expect(togglePageBreak(doc, block.id).pageBreaks).toEqual([]);
    doc = removeBlock(doc, block.id);
    expect(doc.pageBreaks).toEqual([]);
    expect(() => removeBlock(doc, block.id)).toThrow(PathError);
    expect(() => togglePageBreak(doc, 'x')).toThrow(PathError);
    doc = setStyle(doc, { fontSize: 99, headingColor: 'red', marginMm: 5 });
    expect(doc.style.fontSize).toBe(13);
    expect(doc.style.marginMm).toBe(10);
    expect(doc.style.headingColor).toBe('#1F2A44');
    expect(setStyle(doc, { bodyFont: 'bogus' as never, lineHeight: Number.NaN }).style.bodyFont).toBe('inter');
    doc = setHeaderLinks(doc, [{ label: 'Site', url: 'https://x.dev' }]);
    expect(doc.header.links).toEqual([{ label: 'Site', url: 'https://x.dev' }]);
  });
});

describe('library → CV', () => {
  it('copies records into items linked by recordId', () => {
    const records = sampleRecords();
    const doc = buildDocumentFromLibrary(records, 'fr', 'classic');
    expect(doc.header.fullName).toBe('Camille Laurent');
    const exp = doc.blocks.find((b) => b.type === 'experience')!;
    expect(exp.items.map((i) => (i as EntryItem).org)).toEqual(['Atelier Nova', 'Lumen']);
    expect(exp.items[0].recordId).toBe('rec-exp-nova');
    expect(doc.blocks.find((b) => b.type === 'skills')!.items[0]).toMatchObject({ kind: 'tags', label: 'Frontend', tags: ['React'] });
    expect(doc.blocks.map((b) => b.type)).toEqual(['profile', 'experience', 'education', 'skills', 'languages']);
    // English CV falls back to the whole library when no English records exist
    expect(buildDocumentFromLibrary(records, 'en').header.fullName).toBe('Camille Laurent');
  });

  it('converts each record kind', () => {
    const base = { sources: [], fieldSources: {}, createdAt: '', updatedAt: '', lang: 'fr' as const };
    expect(recordToItem({ ...base, id: 'p', kind: 'project', data: { name: 'Atelier', role: 'Solo', start: '', end: '', description: 'd', bullets: ['b'], technologies: [], url: '' } })).toMatchObject({ kind: 'entry', title: 'Atelier' });
    expect(recordToItem({ ...base, id: 'c', kind: 'certification', data: { name: 'AWS', issuer: 'Amazon', date: '2020', url: '' } })).toMatchObject({ title: 'AWS', end: '2020' });
    expect(recordToItem({ ...base, id: 'x', kind: 'custom', data: { section: 'S', title: 'T', subtitle: 'U', date: '', text: '', bullets: [] } })).toMatchObject({ title: 'T', org: 'U' });
    expect(recordToItem({ ...base, id: 'e', kind: 'personal', data: { fullName: '', headline: '', email: '', phone: '', location: '', links: [] } })).toBeNull();
  });
});

describe('hashing and plain text', () => {
  it('is stable regardless of key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    const doc = sampleDocument();
    expect(documentHash(doc)).toBe(documentHash(cloneDocument(doc)));
    expect(stableStringify(undefined)).toBe('null');
  });

  it('renders visible content as plain text', () => {
    const doc = sampleDocument();
    const text = documentToPlainText(doc);
    expect(text).toContain('EXPÉRIENCE PROFESSIONNELLE');
    expect(text).toContain("Développeuse Frontend — Atelier Nova — Paris, France — 2021 – aujourd'hui");
    expect(text).toContain('• Je travaille avec les designers.');
    expect(text).toContain('Frontend: React, TypeScript, HTML, CSS');
    expect(text).toContain('Anglais — Courant (C1)');
    const hidden = setBlockHidden(doc, doc.blocks[1].id, true);
    expect(documentToPlainText(hidden)).not.toContain('Atelier Nova');
    expect(documentToPlainText(hidden, true)).toContain('Atelier Nova');
    expect(emptyDocument('en').blocks[0].title).toBe('Profile');
  });
});
