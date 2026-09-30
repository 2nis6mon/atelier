import { describe, expect, it } from 'vitest';
import { detectHeading, joinWrappedLines, parseCvText } from '../../src/shared/cvparse';
import { detectLang, normalizeForMatch } from '../../src/shared/lang';
import { SAMPLE_EN_CV_TEXT, SAMPLE_FR_CV_TEXT } from '../helpers/sample';

const byKind = (cv: ReturnType<typeof parseCvText>, kind: string) => cv.candidates.filter((c) => c.kind === kind).map((c) => c.data as unknown as Record<string, unknown>);

describe('language detection', () => {
  it('distinguishes French and English', () => {
    expect(detectLang(SAMPLE_FR_CV_TEXT)).toBe('fr');
    expect(detectLang(SAMPLE_EN_CV_TEXT)).toBe('en');
    expect(detectLang('', 'en')).toBe('en');
    expect(normalizeForMatch("  Développeuse d’interfaces  ")).toBe('developpeuse d interfaces');
  });
});

describe('section headings', () => {
  it('recognises French/English headings and ignores content lines', () => {
    expect(detectHeading('EXPÉRIENCE PROFESSIONNELLE')?.kind).toBe('experience');
    expect(detectHeading('Compétences :')?.kind).toBe('skills');
    expect(detectHeading('Work Experience')?.kind).toBe('experience');
    expect(detectHeading('CENTRES D’INTÉRÊT')?.kind).toBe('custom');
    expect(detectHeading('BÉNÉVOLAT ET ASSOCIATIONS')?.kind).toBe('custom');
    expect(detectHeading('• React')).toBeNull();
    expect(detectHeading('2019 – 2021')).toBeNull();
    expect(detectHeading('camille@example.com')).toBeNull();
    expect(detectHeading('Je développe des interfaces avec React et TypeScript pour des produits web.')).toBeNull();
  });

  it('joins lines wrapped by PDF extraction', () => {
    expect(joinWrappedLines(['• Je développe des interfaces', 'avec React.', '• Suite'])).toEqual(['• Je développe des interfaces avec React.', '• Suite']);
    expect(joinWrappedLines(['Titre.', 'suite', '', 'x'])).toEqual(['Titre.', 'suite', '', 'x']);
  });
});

describe('French CV', () => {
  const cv = parseCvText(SAMPLE_FR_CV_TEXT);

  it('extracts personal details', () => {
    const [p] = byKind(cv, 'personal');
    expect(p).toMatchObject({ fullName: 'Camille Laurent', headline: 'Développeuse Frontend', email: 'camille.laurent@example.com', location: 'Paris, France' });
    expect(p.phone).toBe('+33 6 12 34 56 78');
    expect((p.links as Array<{ url: string }>)[0].url).toBe('linkedin.com/in/camille-laurent-demo');
  });

  it('extracts the profile paragraph', () => {
    expect(byKind(cv, 'profile')[0].text).toContain("création d'interfaces web modernes");
  });

  it('extracts experiences with dates, locations and bullets', () => {
    const exps = byKind(cv, 'experience');
    expect(exps).toHaveLength(2);
    expect(exps[0]).toMatchObject({ company: 'Atelier Nova', role: 'Développeuse Frontend', location: 'Paris, France', start: '2021', current: true });
    expect(exps[0].bullets).toEqual([
      'Je développe des interfaces avec React et TypeScript.',
      'Je travaille avec les designers.',
      "Amélioration des performances et de l'accessibilité.",
    ]);
    expect(exps[1]).toMatchObject({ company: 'Studio Forma', start: '2019', end: '2021', current: false, location: 'Lyon, France' });
  });

  it('extracts education, skills and languages', () => {
    expect(byKind(cv, 'education')[0]).toMatchObject({ degree: 'Master Informatique', institution: 'Université de Lyon', end: '2019' });
    const skills = byKind(cv, 'skill');
    expect(skills.map((s) => s.name)).toEqual(['React', 'TypeScript', 'HTML', 'CSS', 'Git', 'Figma']);
    expect(skills[0].category).toBe('Frontend');
    expect(byKind(cv, 'language')).toEqual([
      { name: 'Français', level: 'langue maternelle' },
      { name: 'Anglais', level: 'courant (C1)' },
    ]);
    expect(cv.lang).toBe('fr');
  });
});

describe('English CV', () => {
  const cv = parseCvText(SAMPLE_EN_CV_TEXT);

  it('extracts role "at" company and month dates', () => {
    const [exp] = byKind(cv, 'experience');
    expect(exp).toMatchObject({ role: 'Frontend Developer', company: 'Atelier Nova', start: '2022-09', current: true });
    expect(exp.bullets).toHaveLength(2);
  });

  it('extracts comma separated education, skills and languages', () => {
    expect(byKind(cv, 'education')[0]).toMatchObject({ degree: 'MSc Computer Science', institution: 'University of Lyon' });
    expect(byKind(cv, 'skill').map((s) => s.name)).toEqual(['React', 'TypeScript', 'Next.js', 'Git']);
    expect(byKind(cv, 'language')).toEqual([
      { name: 'French', level: 'native' },
      { name: 'English', level: 'fluent' },
    ]);
    expect(byKind(cv, 'profile')[0].text).toContain('accessible');
  });
});

describe('robustness', () => {
  it('handles entries without dates, certifications, projects and custom sections', () => {
    const text = `Jean Test
Chef de projet

EXPERIENCE
Consultant chez Nova Conseil
• Audit de sites.

PROJETS
Atelier CLI
• Outil en ligne de commande.

CERTIFICATIONS
AWS Certified Developer, Amazon (2021)

CENTRES D'INTÉRÊT
Randonnée, photographie.
`;
    const cv = parseCvText(text);
    expect(byKind(cv, 'experience')[0]).toMatchObject({ role: 'Consultant', company: 'Nova Conseil' });
    expect(cv.candidates.find((c) => c.kind === 'experience')?.issues).toContain('Dates not found.');
    expect(byKind(cv, 'project')[0]).toMatchObject({ name: 'Atelier CLI' });
    expect(byKind(cv, 'certification')[0]).toMatchObject({ name: 'AWS Certified Developer', issuer: 'Amazon', date: '2021' });
    expect(byKind(cv, 'custom')[0].text).toContain('Randonnée');
  });

  it('never throws on empty or unstructured text', () => {
    expect(parseCvText('').candidates).toEqual([]);
    const cv = parseCvText('just some words without any structure at all');
    expect(Array.isArray(cv.candidates)).toBe(true);
  });

  it('flags uncertain company/title assignment', () => {
    const cv = parseCvText('EXPÉRIENCE\nNova\nAlpha Beta\n2020 – 2021\n• x');
    const exp = cv.candidates.find((c) => c.kind === 'experience')!;
    expect(exp.confidence).not.toBe('high');
  });
});
