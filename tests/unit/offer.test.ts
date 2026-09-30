import { describe, expect, it } from 'vitest';
import { decodeEntities, extractJobFromHtml, extractRequirements, guessOfferMeta, htmlFragmentToText, looksLikeBlockedPage } from '../../src/shared/offer';

const OFFER = `Company: Maison
Role: Frontend Engineer
Location: Paris, France (hybrid)
Language: French

We are looking for a Frontend Engineer with strong experience in React and TypeScript.

Requirements:
- Strong experience with React and TypeScript
- Collaboration with design and product teams
- Focus on accessibility and performance
Nice to have:
- Experience with Next.js and design systems`;

describe('job offers', () => {
  it('guesses metadata from labelled lines', () => {
    expect(guessOfferMeta(OFFER)).toEqual({ company: 'Maison', role: 'Frontend Engineer', location: 'Paris, France (hybrid)', lang: 'fr' });
    expect(guessOfferMeta('Poste : Développeur\nEntreprise : Nova\nLangue : anglais').lang).toBe('en');
    expect(guessOfferMeta('Nous recherchons un développeur pour notre équipe.').lang).toBe('fr');
  });

  it('lists requirement lines as written, without scoring', () => {
    expect(extractRequirements(OFFER)).toEqual([
      'Strong experience with React and TypeScript',
      'Collaboration with design and product teams',
      'Focus on accessibility and performance',
      'Experience with Next.js and design systems',
    ]);
    expect(extractRequirements('Profil recherché :\nAutonome et curieux\n• Vue.js')).toEqual(['Autonome et curieux', 'Vue.js']);
  });

  it('converts HTML and decodes entities', () => {
    expect(decodeEntities('d&eacute;veloppeur &amp; &#233;quipe &#x2019; &unknown;')).toBe('développeur & équipe ’ &unknown;');
    const text = htmlFragmentToText('<h2>Poste</h2><p>Vous d&eacute;veloppez</p><ul><li>React</li><li>TS</li></ul><script>alert(1)</script>');
    expect(text).toBe('Poste\n\nVous développez\n\n• React\n• TS');
  });

  it('prefers schema.org JobPosting data', () => {
    const html = `<html><head><title>Job</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"Frontend Engineer","hiringOrganization":{"name":"Maison"},"jobLocation":{"address":{"addressLocality":"Paris","addressCountry":"FR"}},"description":"<p>We build <b>accessible</b> interfaces with React and TypeScript for our product teams in Paris.</p>"}]}</script></head><body>menu</body></html>`;
    expect(extractJobFromHtml(html)).toMatchObject({ title: 'Frontend Engineer', company: 'Maison', location: 'Paris, FR', structured: true });
  });

  it('falls back to the main content and ignores broken JSON-LD', () => {
    const html = `<html><head><title> Dev   job </title><script type="application/ld+json">{broken</script></head><body><nav>Menu</nav><main><h1>Frontend</h1><p>Texte de l'offre</p></main><footer>x</footer></body></html>`;
    const page = extractJobFromHtml(html);
    expect(page).toMatchObject({ title: 'Dev job', structured: false });
    expect(page.text).toBe("Frontend\n\nTexte de l'offre");
    expect(extractJobFromHtml('<body><p>Only body</p></body>').text).toBe('Only body');
  });

  it('detects login walls and empty pages', () => {
    expect(looksLikeBlockedPage('Please sign in to continue')).toBe(true);
    expect(looksLikeBlockedPage('x'.repeat(300))).toBe(false);
    expect(looksLikeBlockedPage(`Sign in to see more. ${'x'.repeat(300)}`)).toBe(true);
  });
});
