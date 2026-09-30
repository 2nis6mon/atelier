// Deterministic synthetic data used across unit, integration and E2E tests.
// The person and companies are fictional.
import { newBullet, newEntryItem, newPairItem, newTagsItem, newTextItem, createBlock, emptyDocument } from '../../src/shared/document';
import type { CvDocument, LibraryRecord, Proposal } from '../../src/shared/types';

export const SAMPLE_FR_CV_TEXT = `Camille Laurent
Développeuse Frontend
Paris, France · camille.laurent@example.com · +33 6 12 34 56 78 · linkedin.com/in/camille-laurent-demo

PROFIL
Développeuse frontend passionnée par la création d'interfaces web modernes, accessibles et performantes.
J'aime transformer des idées en expériences simples et élégantes.

EXPÉRIENCE PROFESSIONNELLE
Atelier Nova\tParis, France
Développeuse Frontend
2021 – aujourd'hui
• Je développe des interfaces avec React et TypeScript.
• Je travaille avec les designers.
• Amélioration des performances et de l'accessibilité.

Studio Forma\tLyon, France
Développeuse Frontend
2019 – 2021
• Intégration d'interfaces à partir de maquettes Figma.
• Développement de composants réutilisables.

FORMATION
Master Informatique — Université de Lyon
2019

COMPÉTENCES
Frontend : React, TypeScript, HTML, CSS
Outils : Git, Figma

LANGUES
Français : langue maternelle
Anglais : courant (C1)
`;

export const SAMPLE_EN_CV_TEXT = `Camille Laurent
Frontend Developer
Paris, France | camille.laurent@example.com | +33 6 12 34 56 78

SUMMARY
Frontend developer focused on accessible, fast web interfaces built with React and TypeScript.

EXPERIENCE
Frontend Developer at Atelier Nova
Sep 2022 – Present
- Build product interfaces with React and TypeScript.
- Collaborate closely with design and product teams.

EDUCATION
MSc Computer Science, University of Lyon
2019

SKILLS
React, TypeScript, Next.js, Git

LANGUAGES
French (native), English (fluent)
`;

export function sampleDocument(): CvDocument {
  const doc = emptyDocument('fr', 'classic');
  doc.header = {
    fullName: 'Camille Laurent',
    headline: 'Développeuse Frontend',
    email: 'camille.laurent@example.com',
    phone: '+33 6 12 34 56 78',
    location: 'Paris, France',
    links: [{ label: 'LinkedIn', url: 'https://linkedin.com/in/camille-laurent-demo' }],
  };
  const [profile, experience, education, skills, languages] = doc.blocks;
  profile.items.push(
    newTextItem("Développeuse frontend passionnée par la création d'interfaces web modernes, accessibles et performantes."),
  );
  experience.items.push(
    newEntryItem({
      title: 'Développeuse Frontend',
      org: 'Atelier Nova',
      location: 'Paris, France',
      start: '2021',
      current: true,
      bullets: [
        newBullet('Je développe des interfaces avec React et TypeScript.'),
        newBullet('Je travaille avec les designers.'),
        newBullet("Amélioration des performances et de l'accessibilité."),
      ],
    }),
    newEntryItem({
      title: 'Développeuse Frontend',
      org: 'Studio Forma',
      location: 'Lyon, France',
      start: '2019',
      end: '2021',
      bullets: [newBullet("Intégration d'interfaces à partir de maquettes Figma.")],
    }),
  );
  education.items.push(newEntryItem({ title: 'Master Informatique', org: 'Université de Lyon', end: '2019' }));
  skills.items.push(newTagsItem('Frontend', ['React', 'TypeScript', 'HTML', 'CSS']));
  languages.items.push(newPairItem('Français', 'Langue maternelle'), newPairItem('Anglais', 'Courant (C1)'));
  return doc;
}

export function extraBlock(doc: CvDocument) {
  const block = createBlock('certifications', 'fr', 'main');
  block.items.push(newEntryItem({ title: 'Certified Scrum Developer', org: 'Scrum Alliance', end: '2020' }));
  return { ...doc, blocks: [...doc.blocks, block] };
}

const NOW = '2026-01-01T00:00:00.000Z';

export function sampleRecords(): LibraryRecord[] {
  return [
    {
      id: 'rec-personal',
      kind: 'personal',
      lang: 'fr',
      data: {
        fullName: 'Camille Laurent',
        headline: 'Développeuse Frontend',
        email: 'camille.laurent@example.com',
        phone: '+33 6 12 34 56 78',
        location: 'Paris, France',
        links: [{ label: 'LinkedIn', url: 'https://linkedin.com/in/camille-laurent-demo' }],
      },
      sources: [{ sourceId: 's1', label: 'CV_FR.docx' }],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'rec-exp-nova',
      kind: 'experience',
      lang: 'fr',
      data: {
        company: 'Atelier Nova',
        role: 'Développeuse Frontend',
        location: 'Paris, France',
        start: '2021',
        end: '',
        current: true,
        description: '',
        bullets: ['Je développe des interfaces avec React et TypeScript.'],
        achievements: [],
        technologies: ['React', 'TypeScript'],
      },
      sources: [{ sourceId: 's1', label: 'CV_FR.docx' }],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'rec-exp-lumen',
      kind: 'experience',
      lang: 'fr',
      data: {
        company: 'Lumen',
        role: 'Développeuse Web',
        location: 'Paris, France',
        start: '2017',
        end: '2019',
        current: false,
        description: '',
        bullets: ["Je collabore avec les designers pour développer des interfaces modernes et accessibles."],
        achievements: [],
        technologies: ['Vue.js'],
      },
      sources: [{ sourceId: 's2', label: 'CV_2024.pdf' }],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'rec-skill-react',
      kind: 'skill',
      lang: 'fr',
      data: { name: 'React', category: 'Frontend', level: '' },
      sources: [],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'rec-lang-fr',
      kind: 'language',
      lang: 'fr',
      data: { name: 'Français', level: 'Langue maternelle' },
      sources: [],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'rec-profile',
      kind: 'profile',
      lang: 'fr',
      data: { title: 'Profil général', text: 'Développeuse frontend orientée accessibilité.' },
      sources: [],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'rec-edu',
      kind: 'education',
      lang: 'fr',
      data: { institution: 'Université de Lyon', degree: 'Master', field: 'Informatique', location: 'Lyon', start: '2017', end: '2019', description: '' },
      sources: [],
      fieldSources: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
}

export function makeProposal(partial: Partial<Proposal>): Proposal {
  return {
    id: partial.id ?? 'p1',
    cvId: 'cv1',
    requestId: 'r1',
    kind: 'rewrite',
    target: '',
    baseText: '',
    proposedText: '',
    baseOrder: [],
    proposedOrder: [],
    recordId: null,
    afterId: null,
    explanation: '',
    citations: [],
    unverified: [],
    confirmed: false,
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}
