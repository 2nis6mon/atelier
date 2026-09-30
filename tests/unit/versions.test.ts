import { describe, expect, it } from 'vitest';
import { addBlock, createBlock, documentHash, moveBlock, removeItem, setBlockHidden, setItemHidden, setStyle, setTemplate, setText, headerPath, reorderItems, addItem, newTextItem } from '../../src/shared/document';
import { ImmutableVersionError, assertMutable, compareDocuments, nextVersionNumber, verifySnapshot, versionLabel } from '../../src/shared/versions';
import { sampleDocument } from '../helpers/sample';

describe('versions', () => {
  it('numbers and labels versions', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1, 4, 2])).toBe(5);
    expect(versionLabel('sent', 3)).toBe('Sent v3');
    expect(versionLabel('checkpoint', 2)).toBe('Saved v2');
  });

  it('refuses to mutate locked (sent) versions', () => {
    expect(() => assertMutable({ locked: true })).toThrow(ImmutableVersionError);
    expect(() => assertMutable({ locked: false })).not.toThrow();
  });

  it('verifies snapshot integrity', () => {
    const doc = sampleDocument();
    const v = { document: doc, docHash: documentHash(doc) };
    expect(verifySnapshot(v)).toBe(true);
    expect(verifySnapshot({ ...v, document: setText(doc, headerPath('fullName'), 'X') })).toBe(false);
  });

  it('lists meaningful differences between two versions', () => {
    const a = sampleDocument();
    let b = setTemplate(a, 'sidebar');
    b = setStyle(b, { fontSize: 11 });
    b = setText(b, headerPath('headline'), 'Lead Frontend');
    b = setBlockHidden(b, b.blocks[4].id, true);
    b = setItemHidden(b, b.blocks[1].id, b.blocks[1].items[1].id, true);
    b = addBlock(b, createBlock('custom', 'fr', 'main', 'Bénévolat'));
    b = removeItem(b, b.blocks[3].id, b.blocks[3].items[0].id);
    b = moveBlock(b, b.blocks[0].id, 'side', 0);
    const expBlock = b.blocks.find((x) => x.type === 'experience')!;
    b = reorderItems(b, expBlock.id, [...expBlock.items.map((i) => i.id)].reverse());
    b = addItem(b, b.blocks.find((x) => x.type === 'profile')!.id, newTextItem('Nouveau'));
    const changes = compareDocuments(a, b);
    const kinds = changes.map((c) => `${c.kind}:${c.label}`);
    expect(kinds).toContain('layout:Template');
    expect(kinds).toContain('style:Font size');
    expect(changes.find((c) => c.label === 'Header › Headline')).toMatchObject({ before: 'Développeuse Frontend', after: 'Lead Frontend' });
    expect(kinds.some((k) => k.startsWith('hidden:Section “Langues”'))).toBe(true);
    expect(kinds.some((k) => k.startsWith('hidden:Expérience professionnelle › Studio Forma'))).toBe(true);
    expect(kinds).toContain('added:Section “Bénévolat”');
    expect(kinds.some((k) => k.startsWith('removed:Compétences'))).toBe(true);
    expect(kinds.some((k) => k.startsWith('moved:Section “Profil”'))).toBe(true);
    expect(kinds).toContain('moved:Expérience professionnelle › order of entries');
    expect(kinds.some((k) => k.startsWith('added:Profil'))).toBe(true);
    const back = compareDocuments(b, a);
    expect(back.some((c) => c.kind === 'removed' && c.label === 'Section “Bénévolat”')).toBe(true);
    expect(back.some((c) => c.kind === 'shown')).toBe(true);
    const reordered = { ...a, blocks: [...a.blocks].reverse() };
    expect(compareDocuments(a, reordered).map((c) => c.label)).toContain('Order of sections');
    expect(compareDocuments(a, a)).toEqual([]);
  });
});
