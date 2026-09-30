// Runtime validation of data crossing a trust boundary (renderer → main,
// backups, AI output mapped into documents). Missing optional fields get
// defaults; wrong types are rejected.

import { z } from 'zod';
import { isValidPartialDate } from './dates';
import { clampStyle } from './templates';
import type { CvDocument, RecordDataMap, RecordKind } from './types';

const id = z.string().min(1).max(80).regex(/^[\w-]+$/);
const text = (max = 20000) => z.string().max(max);
const pdate = z
  .string()
  .max(7)
  .refine((v) => isValidPartialDate(v), 'Invalid date (use YYYY or YYYY-MM)');
const lang = z.enum(['fr', 'en']);
const link = z.object({ label: text(80), url: text(500) });

const bullet = z.object({ id, text: text(4000) });
const itemBase = { id, hidden: z.boolean().optional(), recordId: z.string().max(80).nullable().optional() };
const item = z.discriminatedUnion('kind', [
  z.object({ ...itemBase, kind: z.literal('text'), text: text(8000) }),
  z.object({
    ...itemBase,
    kind: z.literal('entry'),
    title: text(300),
    org: text(300),
    location: text(200),
    start: pdate,
    end: pdate,
    current: z.boolean(),
    text: text(8000),
    bullets: z.array(bullet).max(100),
  }),
  z.object({ ...itemBase, kind: z.literal('tags'), label: text(200), tags: z.array(text(120)).max(200) }),
  z.object({ ...itemBase, kind: z.literal('pair'), name: text(200), level: text(200) }),
]);

const block = z.object({
  id,
  type: z.enum(['profile', 'experience', 'education', 'skills', 'languages', 'certifications', 'projects', 'custom']),
  title: text(200),
  zone: z.enum(['main', 'side']),
  hidden: z.boolean(),
  items: z.array(item).max(200),
});

const style = z.object({
  bodyFont: z.enum(['source-serif', 'inter', 'lora', 'plex-sans']),
  headingFont: z.enum(['source-serif', 'inter', 'lora', 'plex-sans']),
  fontSize: z.number(),
  lineHeight: z.number(),
  headingColor: text(20),
  accentColor: text(20),
  textColor: text(20),
  marginMm: z.number(),
  sectionSpacing: z.number(),
  sidebarWidth: z.number(),
});

export const DocumentSchema = z.object({
  schema: z.literal(1),
  lang,
  header: z.object({
    fullName: text(200),
    headline: text(300),
    email: text(200),
    phone: text(80),
    location: text(200),
    links: z.array(link).max(10),
  }),
  blocks: z.array(block).max(50),
  template: z.enum(['classic', 'sidebar', 'compact']),
  style,
  pageBreaks: z.array(z.string().max(80)).max(50),
});

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(prefix: string, error: z.ZodError): never {
  throw new ValidationError(`${prefix}: ${error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
}

export function validateDocument(input: unknown): CvDocument {
  const r = DocumentSchema.safeParse(input);
  if (!r.success) fail('Invalid CV document', r.error);
  const doc = r.data as CvDocument;
  const blockIds = new Set(doc.blocks.map((b) => b.id));
  if (blockIds.size !== doc.blocks.length) throw new ValidationError('Invalid CV document: duplicate section ids');
  return { ...doc, style: clampStyle(doc.style), pageBreaks: doc.pageBreaks.filter((b) => blockIds.has(b)) };
}

const s = (max = 2000) => z.string().max(max).default('');
const list = (max = 2000) => z.array(z.string().max(max)).max(200).default([]);
const d = pdate.default('');

const RECORD_SCHEMAS: { [K in RecordKind]: z.ZodType<RecordDataMap[K]> } = {
  personal: z.object({ fullName: s(200), headline: s(300), email: s(200), phone: s(80), location: s(200), links: z.array(link).max(10).default([]) }),
  profile: z.object({ title: s(200), text: s(8000) }),
  experience: z.object({
    company: s(300),
    role: s(300),
    location: s(200),
    start: d,
    end: d,
    current: z.boolean().default(false),
    description: s(8000),
    bullets: list(4000),
    achievements: list(4000),
    technologies: list(120),
  }),
  project: z.object({ name: s(300), role: s(300), start: d, end: d, description: s(8000), bullets: list(4000), technologies: list(120), url: s(500) }),
  education: z.object({ institution: s(300), degree: s(300), field: s(300), location: s(200), start: d, end: d, description: s(8000) }),
  certification: z.object({ name: s(300), issuer: s(300), date: d, url: s(500) }),
  skill: z.object({ name: z.string().min(1).max(120), category: s(120), level: s(120) }),
  language: z.object({ name: z.string().min(1).max(120), level: s(200) }),
  custom: z.object({ section: s(200), title: s(300), subtitle: s(300), date: s(60), text: s(8000), bullets: list(4000) }),
} as never;

export function validateRecordData<K extends RecordKind>(kind: K, data: unknown): RecordDataMap[K] {
  const schema = RECORD_SCHEMAS[kind];
  if (!schema) throw new ValidationError(`Unknown record kind ${String(kind)}`);
  const r = schema.safeParse(data);
  if (!r.success) fail('Invalid record', r.error);
  return r.data;
}
