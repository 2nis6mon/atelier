import type { Lang } from './types';

const FR = new Set(
  "le la les des du de et en un une pour avec dans sur au aux par est sont nous vous je j'ai mon ma mes notre votre qui que ce cette ces ses son sa leur plus chez depuis entre sous où être avoir équipe développement expérience compétences formation langues".split(
    ' ',
  ),
);
const EN = new Set(
  'the and of to in for with on at by is are we you i my our your who that this these their more from since between under where be have team development experience skills education languages work'.split(
    ' ',
  ),
);

/** Very small stop-word based language guess between French and English. */
export function detectLang(text: string, fallback: Lang = 'fr'): Lang {
  const words = text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^a-zàâäçéèêëîïôöùûüÿœæ']+/)
    .filter(Boolean);
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FR.has(w)) fr++;
    if (EN.has(w)) en++;
  }
  if (/[éèêàùçœ]/.test(text)) fr += 2;
  if (fr === en) return fallback;
  return fr > en ? 'fr' : 'en';
}

/** Lower-case, accent-free, punctuation-free form used for matching. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
