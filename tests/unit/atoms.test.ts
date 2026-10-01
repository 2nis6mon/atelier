import { describe, expect, it } from 'vitest';
import { HEADER_ATOM, buildAtoms, computeSpacers } from '../../src/shared/atoms';
import { createBlock, emptyDocument, newBullet, newEntryItem, newPairItem, newTagsItem, newTextItem } from '../../src/shared/document';

function doc() {
  const d = emptyDocument('fr', 'sidebar');
  const profile = createBlock('profile', 'fr', 'main');
  profile.items.push(newTextItem('Profil'));
  const xp = createBlock('experience', 'fr', 'main');
  const withBullets = newEntryItem({ title: 'Dev', org: 'Nova', text: 'Intro', bullets: [newBullet('a'), newBullet('b')] });
  const bare = newEntryItem({ title: 'Stage', org: 'Lumen' });
  const hidden = newEntryItem({ title: 'Hidden' });
  hidden.hidden = true;
  xp.items.push(withBullets, bare, hidden);
  const skills = createBlock('skills', 'fr', 'side');
  skills.items.push(newTagsItem('Frontend', ['React']));
  const langs = createBlock('languages', 'fr', 'side');
  langs.items.push(newPairItem('Anglais', 'C1'));
  const empty = createBlock('projects', 'fr', 'main');
  const hiddenBlock = createBlock('certifications', 'fr', 'main');
  hiddenBlock.items.push(newTextItem('x'));
  hiddenBlock.hidden = true;
  d.blocks = [profile, xp, skills, langs, empty, hiddenBlock];
  d.pageBreaks = [xp.id];
  return { d, xp, withBullets, bare };
}

describe('atoms', () => {
  it('splits the CV into units that keep headings with what follows', () => {
    const { d, xp, withBullets, bare } = doc();
    const atoms = buildAtoms(d, { headerInFlow: true });
    expect(atoms[0]).toMatchObject({ id: HEADER_ATOM, kind: 'header' });
    const kinds = atoms.map((a) => a.kind);
    expect(kinds).toEqual(['header', 'blockTitle', 'text', 'blockTitle', 'entryHead', 'entryText', 'bullet', 'bullet', 'entryHead', 'blockTitle', 'tags', 'blockTitle', 'pair']);
    const title = atoms.find((a) => a.id === `t:${xp.id}`)!;
    expect(title).toMatchObject({ keepWithNext: true, breakBefore: true, firstInBlock: true });
    expect(atoms.find((a) => a.id === `e:${withBullets.id}`)).toMatchObject({ keepWithNext: true, lastInItem: false });
    expect(atoms.find((a) => a.id === `d:${withBullets.id}`)).toMatchObject({ lastInItem: false });
    expect(atoms.filter((a) => a.kind === 'bullet').map((a) => a.lastInItem)).toEqual([false, true]);
    expect(atoms.find((a) => a.id === `e:${bare.id}`)).toMatchObject({ keepWithNext: false, lastInItem: true });
    expect(atoms.filter((a) => a.zone === 'side').map((a) => a.kind)).toEqual(['blockTitle', 'tags', 'blockTitle', 'pair']);
    // empty and hidden sections produce nothing; the header can be outside the flow
    expect(buildAtoms(d, { headerInFlow: false })[0].kind).toBe('blockTitle');
  });

  it('computes the spacing that moves atoms to their pages, per column', () => {
    const atoms = [
      { id: 'a', zone: 'main' as const, height: 100 },
      { id: 'b', zone: 'main' as const, height: 50 },
      { id: 'c', zone: 'main' as const, height: 40 },
      { id: 's1', zone: 'side' as const, height: 30 },
    ];
    const pages: Record<string, number> = { a: 1, b: 1, c: 2, s1: 0 };
    const spacers = computeSpacers(atoms, (id) => pages[id], { stride: 1000, top: (zone, page) => (zone === 'main' && page === 1 ? 200 : 60) });
    expect(spacers).toEqual({ a: 200, b: 0, c: 1060 - 350, s1: 60 });
  });
});
