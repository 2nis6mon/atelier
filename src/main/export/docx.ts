// Simple, editable Word export: real headings, paragraphs and bullet lists,
// real hyperlinks, bold/italic runs. No text boxes, tables or images, so a
// recruiter can copy and edit it easily. It does not imitate the PDF layout.

import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun, type ParagraphChild } from 'docx';
import { formatRange } from '../../shared/dates';
import { blocksInZone } from '../../shared/document';
import { parseInline } from '../../shared/markup';
import { FONTS } from '../../shared/templates';
import type { Block, CvDocument, Item } from '../../shared/types';

const hex = (c: string) => c.replace('#', '').toUpperCase();

function runs(markup: string, extra: { color?: string; size?: number } = {}): TextRun[] {
  return parseInline(markup).map((r) => new TextRun({ text: r.text, bold: r.bold || undefined, italics: r.italic || undefined, ...extra }));
}

export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (/^mailto:/i.test(u) || /^https?:\/\//i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  return `https://${u.replace(/^\/+/, '')}`;
}

function contactLine(doc: CvDocument, color: string): Paragraph | null {
  const h = doc.header;
  const parts: ParagraphChild[] = [];
  const sep = () => parts.length && parts.push(new TextRun({ text: '  ·  ', color }));
  if (h.location) {
    sep();
    parts.push(new TextRun({ text: h.location }));
  }
  if (h.email) {
    sep();
    parts.push(new ExternalHyperlink({ link: normalizeUrl(h.email), children: [new TextRun({ text: h.email, style: 'Hyperlink' })] }));
  }
  if (h.phone) {
    sep();
    parts.push(new TextRun({ text: h.phone }));
  }
  for (const l of h.links) {
    if (!l.url) continue;
    sep();
    parts.push(new ExternalHyperlink({ link: normalizeUrl(l.url), children: [new TextRun({ text: l.url.replace(/^https?:\/\//, ''), style: 'Hyperlink' })] }));
  }
  return parts.length ? new Paragraph({ children: parts, spacing: { after: 200 } }) : null;
}

function itemParagraphs(item: Item, doc: CvDocument, muted: string): Paragraph[] {
  switch (item.kind) {
    case 'text':
      return item.text
        .split(/\n+/)
        .filter((t) => t.trim())
        .map((t) => new Paragraph({ children: runs(t), spacing: { after: 120 } }));
    case 'entry': {
      const out: Paragraph[] = [];
      const titleRuns = runs(item.title);
      const orgRuns = item.org ? [new TextRun({ text: item.title ? ' — ' : '' }), ...runs(item.org)] : [];
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [...titleRuns, ...orgRuns], keepNext: true }));
      const meta = [item.location, formatRange(item.start, item.end, item.current, doc.lang)].filter(Boolean).join(' · ');
      if (meta) out.push(new Paragraph({ children: [new TextRun({ text: meta, italics: true, color: muted })], keepNext: item.bullets.length > 0 || Boolean(item.text), spacing: { after: 80 } }));
      if (item.text.trim()) out.push(new Paragraph({ children: runs(item.text), spacing: { after: 80 } }));
      for (const b of item.bullets) if (b.text.trim()) out.push(new Paragraph({ children: runs(b.text), numbering: { reference: 'cv-bullets', level: 0 } }));
      return out;
    }
    case 'tags':
      if (item.tags.length === 0) return [];
      return [
        new Paragraph({
          children: [...(item.label ? [new TextRun({ text: doc.lang === 'fr' ? `${item.label} : ` : `${item.label}: `, bold: true })] : []), new TextRun({ text: item.tags.join(', ') })],
          spacing: { after: 80 },
        }),
      ];
    case 'pair':
      return [new Paragraph({ children: [new TextRun({ text: item.name, bold: true }), ...(item.level ? [new TextRun({ text: ` — ${item.level}` })] : [])], spacing: { after: 60 } })];
  }
}

/** Reading order: single-column templates follow the document order; Sidebar puts the main zone first. */
export function exportBlocks(doc: CvDocument): Block[] {
  const visible = (b: Block) => !b.hidden && b.items.some((i) => !i.hidden);
  if (doc.template === 'sidebar') return [...blocksInZone(doc, 'main', false), ...blocksInZone(doc, 'side', false)].filter(visible);
  return doc.blocks.filter(visible);
}

export async function buildDocx(doc: CvDocument, title = ''): Promise<Uint8Array> {
  const style = doc.style;
  const body = FONTS[style.bodyFont].docx;
  const heading = FONTS[style.headingFont].docx;
  const lang = doc.lang === 'fr' ? 'fr-FR' : 'en-GB';
  const size = Math.round(style.fontSize * 2);
  const headingColor = hex(style.headingColor);
  const muted = '667080';

  const children: Paragraph[] = [];
  if (doc.header.fullName) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.header.fullName })] }));
  if (doc.header.headline) children.push(new Paragraph({ style: 'Subtitle', children: runs(doc.header.headline) }));
  const contact = contactLine(doc, muted);
  if (contact) children.push(contact);
  for (const block of exportBlocks(doc)) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: block.title })], keepNext: true }));
    for (const item of block.items) if (!item.hidden) children.push(...itemParagraphs(item, doc, muted));
  }

  const document = new Document({
    title: title || doc.header.fullName || 'CV',
    creator: 'Atelier',
    description: 'CV exported from Atelier',
    styles: {
      default: {
        document: { run: { font: body, size, color: hex(style.textColor), language: { value: lang } }, paragraph: { spacing: { line: Math.round(240 * Math.min(style.lineHeight, 1.5)) } } },
        title: { run: { font: heading, size: size * 2 + 8, bold: true, color: headingColor }, paragraph: { spacing: { after: 60 } } },
        heading1: { run: { font: heading, size: size + 6, bold: true, color: headingColor }, paragraph: { spacing: { before: 280, after: 100 } } },
        heading2: { run: { font: body, size: size + 1, bold: true, color: hex(style.textColor) }, paragraph: { spacing: { before: 160, after: 40 } } },
      },
      paragraphStyles: [
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', run: { size: size + 4, color: hex(style.accentColor) }, paragraph: { spacing: { after: 80 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'cv-bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 in twips
            margin: { top: Math.round(style.marginMm * 56.7), bottom: Math.round(style.marginMm * 56.7), left: Math.round(style.marginMm * 56.7), right: Math.round(style.marginMm * 56.7) },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
