// Generates deterministic, synthetic test fixtures (fictional person).
// Run: node scripts/make-fixtures.mjs   (the scanned PDF is produced by
// scripts/make-scanned-fixture.cjs, which needs Electron to render text).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';

const out = new URL('../tests/fixtures/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const FIXED_DATE = new Date('2026-01-15T10:00:00Z');

// ---------------------------------------------------------------- DOCX (FR)
const bullet = (text) => new Paragraph({ text, numbering: { reference: 'bullets', level: 0 } });
const tabbed = (left, right) =>
  new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
    children: [new TextRun({ text: left, bold: true }), new TextRun({ text: `\t${right}` })],
  });

const docx = new Document({
  creator: 'Atelier fixtures',
  title: 'CV Camille Laurent',
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }] }],
  },
  sections: [
    {
      children: [
        new Paragraph({ text: 'Camille Laurent', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'Développeuse Frontend' }),
        new Paragraph({ text: 'Paris, France · camille.laurent@example.com · +33 6 12 34 56 78 · linkedin.com/in/camille-laurent-demo' }),
        new Paragraph({ text: 'Profil', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          text: "Développeuse frontend passionnée par la création d'interfaces web modernes, accessibles et performantes. J'aime transformer des idées en expériences simples et élégantes.",
        }),
        new Paragraph({ text: 'Expérience professionnelle', heading: HeadingLevel.HEADING_1 }),
        tabbed('Atelier Nova', 'Paris, France'),
        new Paragraph({ text: 'Développeuse Frontend' }),
        new Paragraph({ text: "2022 – aujourd'hui" }),
        bullet('Je développe des interfaces avec React et TypeScript.'),
        bullet('Je travaille avec les designers.'),
        bullet("Amélioration des performances et de l'accessibilité."),
        tabbed('Studio Forma', 'Lyon, France'),
        new Paragraph({ text: 'Développeuse Frontend' }),
        new Paragraph({ text: '2019 – 2021' }),
        bullet("Intégration d'interfaces à partir de maquettes Figma."),
        bullet('Développement de composants réutilisables.'),
        new Paragraph({ text: 'Formation', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Master Informatique — Université de Lyon' }),
        new Paragraph({ text: '2019' }),
        new Paragraph({ text: 'Compétences', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Frontend : React, TypeScript, HTML, CSS' }),
        new Paragraph({ text: 'Outils : Git, Figma' }),
        new Paragraph({ text: 'Langues', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Français : langue maternelle' }),
        new Paragraph({ text: 'Anglais : courant (C1)' }),
      ],
    },
  ],
});
const docxBuf = await Packer.toBuffer(docx);
// Normalise zip timestamps for determinism.
writeFileSync(join(out, 'CV_FR.docx'), docxBuf);

// ----------------------------------------------------------- PDF (text, FR)
async function textPdf(lines, file, title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  for (const l of lines) {
    const [text, opts = {}] = Array.isArray(l) ? l : [l];
    if (y < 60) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
    if (text === '') {
      y -= 10;
      continue;
    }
    const size = opts.size ?? 10.5;
    page.drawText(text, { x: 56, y, size, font: opts.bold ? bold : font, color: rgb(0.12, 0.16, 0.23) });
    if (opts.right) page.drawText(opts.right, { x: 400, y, size, font, color: rgb(0.3, 0.3, 0.35) });
    y -= size + 6;
  }
  writeFileSync(join(out, file), await pdf.save({ useObjectStreams: false }));
}

await textPdf(
  [
    ['Camille Laurent', { size: 20, bold: true }],
    'Développeuse Frontend',
    'Paris, France · camille.laurent@example.com · +33 6 12 34 56 78',
    '',
    ['PROFIL', { bold: true }],
    "Développeuse frontend passionnée par la création d'interfaces web modernes, accessibles",
    'et performantes.',
    '',
    ['EXPÉRIENCE PROFESSIONNELLE', { bold: true }],
    ['Atelier Nova', { bold: true, right: 'Paris, France' }],
    'Développeuse Frontend',
    "2021 – aujourd'hui",
    '• Je développe des interfaces avec React et TypeScript pour des produits web',
    'modernes.',
    '• Collaboration étroite avec les équipes design et produit.',
    ['Lumen', { bold: true, right: 'Paris, France' }],
    'Développeuse Web',
    '2017 – 2019',
    '• Je collabore avec les designers pour développer des interfaces modernes et accessibles.',
    '',
    ['FORMATION', { bold: true }],
    'Master Informatique — Université de Lyon',
    '2019',
    '',
    ['COMPÉTENCES', { bold: true }],
    'React, TypeScript, Vue.js, Git',
  ],
  'CV_2024.pdf',
  'CV 2024',
);

await textPdf(
  [
    ['Camille Laurent', { size: 20, bold: true }],
    'Frontend Developer',
    'Paris, France | camille.laurent@example.com',
    '',
    ['EXPERIENCE', { bold: true }],
    'Frontend Developer at Atelier Nova',
    'Sep 2022 – Present',
    '- Build product interfaces with React and TypeScript.',
    '- Collaborate closely with design and product teams.',
    '',
    ['SKILLS', { bold: true }],
    'React, TypeScript, Next.js, Git',
    '',
    ['LANGUAGES', { bold: true }],
    'French (native), English (fluent)',
  ],
  'CV_EN.pdf',
  'CV EN',
);

// A PDF without any text layer is produced by make-scanned-fixture.cjs.

// ------------------------------------------------ Pages (older, with preview)
const preview = readFileSync(join(out, 'CV_2024.pdf'));
writeFileSync(
  join(out, 'CV_2015.pages'),
  zipSync({
    'Index/Document.iwa': new Uint8Array([0, 0, 0, 0]),
    'QuickLook/Preview.pdf': new Uint8Array(preview),
    'Metadata/Properties.plist': strToU8('<plist></plist>'),
  }, { mtime: FIXED_DATE }),
);

// ------------------------------------ Pages (IWA, synthetic, no preview PDF)
// Built from the published IWA structure: Snappy-framed chunks containing
// ArchiveInfo/MessageInfo headers followed by protobuf payloads. Used to test
// Atelier's experimental reader; NOT a file produced by Apple Pages.
function varint(n) {
  const b = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    b.push(byte);
  } while (v > 0n);
  return b;
}
function field(num, wire, payload) {
  const key = varint((num << 3) | wire);
  if (wire === 0) return [...key, ...varint(payload)];
  return [...key, ...varint(payload.length), ...payload];
}
const enc = (s) => [...Buffer.from(s, 'utf8')];
function storageArchive(text) {
  return [...field(1, 0, 0), ...field(3, 2, enc(text))];
}
function archive(id, type, payload) {
  const messageInfo = [...field(1, 0, type), ...field(2, 0, 1), ...field(3, 0, payload.length)];
  const info = [...field(1, 0, id), ...field(2, 2, messageInfo)];
  return [...varint(info.length), ...info, ...payload];
}
function snappyLiteral(data) {
  // Snappy raw block made only of literals (valid Snappy).
  const outb = [...varint(data.length)];
  for (let i = 0; i < data.length; i += 60) {
    const chunk = data.slice(i, i + 60);
    outb.push((chunk.length - 1) << 2, ...chunk);
  }
  return outb;
}
const body = `Camille Laurent\nDéveloppeuse Frontend\ncamille.laurent@example.com\n\nEXPÉRIENCE\nAtelier Nova\nDéveloppeuse Frontend\n2021 – aujourd'hui\n• Interfaces React et TypeScript.\n\nCOMPÉTENCES\nReact, TypeScript`;
const stream = [...archive(1, 1, [...field(1, 0, 7)]), ...archive(2, 2001, storageArchive(body)), ...archive(3, 3002, [...field(1, 2, enc('Body'))])];
const compressed = snappyLiteral(stream);
const chunk = [0, compressed.length & 0xff, (compressed.length >> 8) & 0xff, (compressed.length >> 16) & 0xff, ...compressed];
writeFileSync(
  join(out, 'CV_Synthetic_IWA.pages'),
  zipSync({ 'Index/Document.iwa': new Uint8Array(chunk), 'preview.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }, { mtime: FIXED_DATE }),
);

// -------------------------------------------------------------- Job offer HTML
writeFileSync(
  join(out, 'offer-maison.html'),
  `<!doctype html><html><head><title>Frontend Engineer — Maison</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Frontend Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Maison' },
    jobLocation: { '@type': 'Place', address: { addressLocality: 'Paris', addressCountry: 'FR' } },
    description:
      '<p>We are looking for a Frontend Engineer with strong experience in React and TypeScript to build modern web interfaces, in close collaboration with design and product teams.</p><p><b>Requirements</b></p><ul><li>Strong experience with React and TypeScript</li><li>Collaboration with design and product teams</li><li>Focus on accessibility and performance</li><li>Nice to have: experience with Next.js and design systems</li></ul>',
  })}</script></head><body><nav>Jobs</nav><main><h1>Frontend Engineer</h1><p>Apply now</p></main></body></html>`,
);

console.log('fixtures written to', out, existsSync(join(out, 'CV_FR.docx')));
