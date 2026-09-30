import { formatRange } from './dates';
import { stripMarkup } from './markup';
import { BLOCK_ORDER, BLOCK_TITLES, BLOCK_TYPE_LABELS, DEFAULT_STYLE, TEMPLATES, clampStyle } from './templates';
import type {
  Block,
  BlockType,
  Bullet,
  CvDocument,
  CvHeader,
  CvStyle,
  EntryItem,
  Item,
  Lang,
  LibraryRecord,
  PairItem,
  TagsItem,
  TemplateId,
  TextItem,
  Zone,
} from './types';

export const newId = (): string => globalThis.crypto.randomUUID();

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function emptyHeader(): CvHeader {
  return { fullName: '', headline: '', email: '', phone: '', location: '', links: [] };
}

export function createBlock(type: BlockType, lang: Lang, zone: Zone = 'main', title?: string): Block {
  return { id: newId(), type, title: title ?? BLOCK_TITLES[lang][type], zone, hidden: false, items: [] };
}

export function emptyDocument(lang: Lang, template: TemplateId = 'classic'): CvDocument {
  const t = TEMPLATES[template];
  return {
    schema: 1,
    lang,
    header: emptyHeader(),
    blocks: (['profile', 'experience', 'education', 'skills', 'languages'] as BlockType[]).map((type) =>
      createBlock(type, lang, t.defaultZone(type)),
    ),
    template,
    style: { ...DEFAULT_STYLE },
    pageBreaks: [],
  };
}

export function newTextItem(text = '', recordId: string | null = null): TextItem {
  return { id: newId(), kind: 'text', text, recordId };
}

export function newEntryItem(partial: Partial<EntryItem> = {}): EntryItem {
  return {
    id: newId(),
    kind: 'entry',
    title: '',
    org: '',
    location: '',
    start: '',
    end: '',
    current: false,
    text: '',
    bullets: [],
    recordId: null,
    ...partial,
  };
}

export function newBullet(text = ''): Bullet {
  return { id: newId(), text };
}

export function newTagsItem(label = '', tags: string[] = [], recordId: string | null = null): TagsItem {
  return { id: newId(), kind: 'tags', label, tags, recordId };
}

export function newPairItem(name = '', level = '', recordId: string | null = null): PairItem {
  return { id: newId(), kind: 'pair', name, level, recordId };
}

/** The block type a library record belongs in. */
export function blockTypeForRecord(record: LibraryRecord): BlockType | null {
  switch (record.kind) {
    case 'profile':
      return 'profile';
    case 'experience':
      return 'experience';
    case 'project':
      return 'projects';
    case 'education':
      return 'education';
    case 'certification':
      return 'certifications';
    case 'skill':
      return 'skills';
    case 'language':
      return 'languages';
    case 'custom':
      return 'custom';
    default:
      return null;
  }
}

/** Creates a CV item that copies a library record's content (the record itself is never modified). */
export function recordToItem(record: LibraryRecord): Item | null {
  const d = record.data as unknown as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
  switch (record.kind) {
    case 'profile':
      return newTextItem(str('text'), record.id);
    case 'experience':
      return newEntryItem({
        title: str('role'),
        org: str('company'),
        location: str('location'),
        start: str('start'),
        end: str('end'),
        current: Boolean(d.current),
        text: str('description'),
        bullets: [...list('bullets'), ...list('achievements')].map((b) => newBullet(b)),
        recordId: record.id,
      });
    case 'project':
      return newEntryItem({
        title: str('name'),
        org: str('role'),
        start: str('start'),
        end: str('end'),
        text: str('description'),
        bullets: list('bullets').map((b) => newBullet(b)),
        recordId: record.id,
      });
    case 'education':
      return newEntryItem({
        title: [str('degree'), str('field')].filter(Boolean).join(' — '),
        org: str('institution'),
        location: str('location'),
        start: str('start'),
        end: str('end'),
        text: str('description'),
        recordId: record.id,
      });
    case 'certification':
      return newEntryItem({ title: str('name'), org: str('issuer'), end: str('date'), recordId: record.id });
    case 'skill':
      return newTagsItem(str('category'), [str('name')], record.id);
    case 'language':
      return newPairItem(str('name'), str('level'), record.id);
    case 'custom':
      return newEntryItem({
        title: str('title'),
        org: str('subtitle'),
        text: str('text'),
        bullets: list('bullets').map((b) => newBullet(b)),
        recordId: record.id,
      });
    default:
      return null;
  }
}

/** Builds a first CV from library records in the given language. */
export function buildDocumentFromLibrary(
  records: LibraryRecord[],
  lang: Lang,
  template: TemplateId = 'classic',
): CvDocument {
  const doc = emptyDocument(lang, template);
  const pick = records.filter((r) => r.lang === lang);
  const pool = pick.length > 0 ? pick : records;
  const personal = pool.find((r) => r.kind === 'personal') ?? records.find((r) => r.kind === 'personal');
  if (personal && personal.kind === 'personal') {
    const p = personal.data as LibraryRecord<'personal'>['data'];
    doc.header = { ...p, links: p.links.map((l) => ({ ...l })) };
  }
  const blockOf = (type: BlockType): Block => {
    let b = doc.blocks.find((x) => x.type === type);
    if (!b) {
      b = createBlock(type, lang, TEMPLATES[template].defaultZone(type));
      doc.blocks.push(b);
    }
    return b;
  };
  const profile = pool.find((r) => r.kind === 'profile');
  if (profile) blockOf('profile').items.push(recordToItem(profile)!);
  const byDateDesc = (a: LibraryRecord, b: LibraryRecord) => {
    const da = a.data as unknown as { start?: string; end?: string; current?: boolean };
    const db = b.data as unknown as { start?: string; end?: string; current?: boolean };
    return (db.start ?? '').localeCompare(da.start ?? '');
  };
  for (const kind of ['experience', 'project', 'education', 'certification'] as const) {
    const recs = pool.filter((r) => r.kind === kind).sort(byDateDesc);
    if (recs.length === 0) continue;
    const block = blockOf(blockTypeForRecord(recs[0])!);
    for (const r of recs) block.items.push(recordToItem(r)!);
  }
  const skills = pool.filter((r) => r.kind === 'skill') as LibraryRecord<'skill'>[];
  if (skills.length) {
    const groups = new Map<string, string[]>();
    for (const s of skills) {
      const key = s.data.category || '';
      groups.set(key, [...(groups.get(key) ?? []), s.data.name]);
    }
    const block = blockOf('skills');
    for (const [label, tags] of groups) block.items.push(newTagsItem(label, tags));
  }
  const langs = pool.filter((r) => r.kind === 'language');
  if (langs.length) {
    const block = blockOf('languages');
    for (const r of langs) block.items.push(recordToItem(r)!);
  }
  // Order blocks by the conventional order, custom at the end.
  doc.blocks.sort((a, b) => orderIndex(a.type) - orderIndex(b.type));
  return doc;
}

function orderIndex(t: BlockType): number {
  const i = BLOCK_ORDER.indexOf(t);
  return i === -1 ? 99 : i;
}

// ---------------------------------------------------------------------------
// Field paths
// ---------------------------------------------------------------------------

export type HeaderField = 'fullName' | 'headline' | 'email' | 'phone' | 'location';
export type ItemField = 'text' | 'title' | 'org' | 'location' | 'label' | 'name' | 'level' | 'tags';

export type ParsedPath =
  | { type: 'header'; field: HeaderField }
  | { type: 'blockTitle'; blockId: string }
  | { type: 'item'; blockId: string; itemId: string; field: ItemField }
  | { type: 'bullet'; blockId: string; itemId: string; bulletId: string };

const HEADER_FIELDS: HeaderField[] = ['fullName', 'headline', 'email', 'phone', 'location'];
const ITEM_FIELDS: ItemField[] = ['text', 'title', 'org', 'location', 'label', 'name', 'level', 'tags'];

export const headerPath = (field: HeaderField) => `header.${field}`;
export const blockTitlePath = (blockId: string) => `block:${blockId}.title`;
export const itemPath = (blockId: string, itemId: string, field: ItemField) => `item:${blockId}:${itemId}.${field}`;
export const bulletPath = (blockId: string, itemId: string, bulletId: string) =>
  `bullet:${blockId}:${itemId}:${bulletId}`;

export function parsePath(path: string): ParsedPath | null {
  let m = /^header\.(\w+)$/.exec(path);
  if (m) return HEADER_FIELDS.includes(m[1] as HeaderField) ? { type: 'header', field: m[1] as HeaderField } : null;
  m = /^block:([\w-]+)\.title$/.exec(path);
  if (m) return { type: 'blockTitle', blockId: m[1] };
  m = /^item:([\w-]+):([\w-]+)\.(\w+)$/.exec(path);
  if (m)
    return ITEM_FIELDS.includes(m[3] as ItemField)
      ? { type: 'item', blockId: m[1], itemId: m[2], field: m[3] as ItemField }
      : null;
  m = /^bullet:([\w-]+):([\w-]+):([\w-]+)$/.exec(path);
  if (m) return { type: 'bullet', blockId: m[1], itemId: m[2], bulletId: m[3] };
  return null;
}

export function findBlock(doc: CvDocument, blockId: string): Block | undefined {
  return doc.blocks.find((b) => b.id === blockId);
}

export function findItem(doc: CvDocument, blockId: string, itemId: string): Item | undefined {
  return findBlock(doc, blockId)?.items.find((i) => i.id === itemId);
}

function itemFieldValue(item: Item, field: ItemField): string | null {
  switch (item.kind) {
    case 'text':
      return field === 'text' ? item.text : null;
    case 'entry':
      if (field === 'text' || field === 'title' || field === 'org' || field === 'location') return item[field];
      return null;
    case 'tags':
      if (field === 'label') return item.label;
      if (field === 'tags') return item.tags.join(', ');
      return null;
    case 'pair':
      if (field === 'name' || field === 'level') return item[field];
      return null;
  }
}

/** Returns the text at a path, or null when the path does not exist in this document. */
export function getText(doc: CvDocument, path: string): string | null {
  const p = parsePath(path);
  if (!p) return null;
  if (p.type === 'header') return doc.header[p.field];
  const block = findBlock(doc, p.blockId);
  if (!block) return null;
  if (p.type === 'blockTitle') return block.title;
  const item = block.items.find((i) => i.id === p.itemId);
  if (!item) return null;
  if (p.type === 'item') return itemFieldValue(item, p.field);
  if (item.kind !== 'entry') return null;
  return item.bullets.find((b) => b.id === p.bulletId)?.text ?? null;
}

export class PathError extends Error {
  constructor(path: string) {
    super(`The target "${path}" no longer exists in this CV.`);
    this.name = 'PathError';
  }
}

export function splitTags(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Immutable update of the text at a path. Throws PathError if the path is gone. */
export function setText(doc: CvDocument, path: string, value: string): CvDocument {
  const p = parsePath(path);
  if (!p || getText(doc, path) === null) throw new PathError(path);
  if (p.type === 'header') return { ...doc, header: { ...doc.header, [p.field]: value } };
  if (p.type === 'blockTitle') return updateBlock(doc, p.blockId, (b) => ({ ...b, title: value }));
  if (p.type === 'item') {
    return updateItem(doc, p.blockId, p.itemId, (item) => {
      if (p.field === 'tags' && item.kind === 'tags') return { ...item, tags: splitTags(value) };
      return { ...item, [p.field]: value } as Item;
    });
  }
  return updateItem(doc, p.blockId, p.itemId, (item) =>
    item.kind === 'entry'
      ? { ...item, bullets: item.bullets.map((b) => (b.id === p.bulletId ? { ...b, text: value } : b)) }
      : item,
  );
}

export interface TextField {
  path: string;
  text: string;
  label: string;
  blockId: string | null;
  hidden: boolean;
}

/** Human readable description of where a path points to. */
export function describePath(doc: CvDocument, path: string): string {
  const p = parsePath(path);
  if (!p) return 'Unknown';
  if (p.type === 'header') {
    const names: Record<HeaderField, string> = {
      fullName: 'Name',
      headline: 'Headline',
      email: 'Email',
      phone: 'Phone',
      location: 'Location',
    };
    return `Header › ${names[p.field]}`;
  }
  const block = findBlock(doc, p.blockId);
  const blockLabel = block ? block.title || BLOCK_TYPE_LABELS[block.type] : 'Removed section';
  if (p.type === 'blockTitle') return `${blockLabel} › Title`;
  const item = block?.items.find((i) => i.id === p.itemId);
  const itemLabel = item ? itemTitle(item) : 'Removed entry';
  if (p.type === 'item') return itemLabel ? `${blockLabel} › ${itemLabel}` : blockLabel;
  const idx = item && item.kind === 'entry' ? item.bullets.findIndex((b) => b.id === p.bulletId) : -1;
  return `${blockLabel} › ${itemLabel}${idx >= 0 ? ` › bullet ${idx + 1}` : ''}`;
}

export function itemTitle(item: Item): string {
  switch (item.kind) {
    case 'text': {
      const t = stripMarkup(item.text);
      return t.length > 32 ? `${t.slice(0, 32)}…` : t;
    }
    case 'entry':
      return [item.org, item.title].filter(Boolean).join(' · ');
    case 'tags':
      return item.label || item.tags.slice(0, 3).join(', ');
    case 'pair':
      return item.name;
  }
}

/** All editable text fields in reading order. */
export function listTextFields(doc: CvDocument, includeHidden = false): TextField[] {
  const out: TextField[] = [];
  for (const field of HEADER_FIELDS) {
    out.push({ path: headerPath(field), text: doc.header[field], label: describePath(doc, headerPath(field)), blockId: null, hidden: false });
  }
  for (const block of doc.blocks) {
    if (block.hidden && !includeHidden) continue;
    out.push({ path: blockTitlePath(block.id), text: block.title, label: `${block.title} › Title`, blockId: block.id, hidden: block.hidden });
    for (const item of block.items) {
      if (item.hidden && !includeHidden) continue;
      const hidden = block.hidden || Boolean(item.hidden);
      const add = (path: string) =>
        out.push({ path, text: getText(doc, path) ?? '', label: describePath(doc, path), blockId: block.id, hidden });
      switch (item.kind) {
        case 'text':
          add(itemPath(block.id, item.id, 'text'));
          break;
        case 'entry':
          add(itemPath(block.id, item.id, 'title'));
          add(itemPath(block.id, item.id, 'org'));
          add(itemPath(block.id, item.id, 'location'));
          add(itemPath(block.id, item.id, 'text'));
          for (const b of item.bullets) add(bulletPath(block.id, item.id, b.id));
          break;
        case 'tags':
          add(itemPath(block.id, item.id, 'label'));
          add(itemPath(block.id, item.id, 'tags'));
          break;
        case 'pair':
          add(itemPath(block.id, item.id, 'name'));
          add(itemPath(block.id, item.id, 'level'));
          break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural operations (all immutable)
// ---------------------------------------------------------------------------

export function updateBlock(doc: CvDocument, blockId: string, fn: (b: Block) => Block): CvDocument {
  let found = false;
  const blocks = doc.blocks.map((b) => {
    if (b.id !== blockId) return b;
    found = true;
    return fn(b);
  });
  if (!found) throw new PathError(`block:${blockId}`);
  return { ...doc, blocks };
}

export function updateItem(doc: CvDocument, blockId: string, itemId: string, fn: (i: Item) => Item): CvDocument {
  return updateBlock(doc, blockId, (b) => {
    let found = false;
    const items = b.items.map((i) => {
      if (i.id !== itemId) return i;
      found = true;
      return fn(i);
    });
    if (!found) throw new PathError(`item:${blockId}:${itemId}`);
    return { ...b, items };
  });
}

export function setHeaderLinks(doc: CvDocument, links: CvHeader['links']): CvDocument {
  return { ...doc, header: { ...doc.header, links: links.map((l) => ({ ...l })) } };
}

export function addBlock(doc: CvDocument, block: Block, index?: number): CvDocument {
  const blocks = [...doc.blocks];
  blocks.splice(index ?? blocks.length, 0, block);
  return { ...doc, blocks };
}

export function removeBlock(doc: CvDocument, blockId: string): CvDocument {
  if (!findBlock(doc, blockId)) throw new PathError(`block:${blockId}`);
  return {
    ...doc,
    blocks: doc.blocks.filter((b) => b.id !== blockId),
    pageBreaks: doc.pageBreaks.filter((id) => id !== blockId),
  };
}

export function setBlockHidden(doc: CvDocument, blockId: string, hidden: boolean): CvDocument {
  return updateBlock(doc, blockId, (b) => ({ ...b, hidden }));
}

/** Zone a block is rendered in with the current template. */
export function effectiveZone(doc: CvDocument, block: Block): Zone {
  return TEMPLATES[doc.template].zones.includes(block.zone) ? block.zone : 'main';
}

export function blocksInZone(doc: CvDocument, zone: Zone, includeHidden = true): Block[] {
  return doc.blocks.filter((b) => effectiveZone(doc, b) === zone && (includeHidden || !b.hidden));
}

/**
 * Moves a block to `zone` at position `index` among that zone's blocks.
 * The global order of blocks in other zones is preserved.
 */
export function moveBlock(doc: CvDocument, blockId: string, zone: Zone, index: number): CvDocument {
  const block = findBlock(doc, blockId);
  if (!block) throw new PathError(`block:${blockId}`);
  const moved: Block = { ...block, zone };
  const rest = doc.blocks.filter((b) => b.id !== blockId);
  const zoneBlocks = rest.filter((b) => effectiveZone(doc, b) === zone);
  const clamped = Math.max(0, Math.min(index, zoneBlocks.length));
  let globalIndex: number;
  if (zoneBlocks.length === 0) globalIndex = rest.length;
  else if (clamped >= zoneBlocks.length) globalIndex = rest.indexOf(zoneBlocks[zoneBlocks.length - 1]) + 1;
  else globalIndex = rest.indexOf(zoneBlocks[clamped]);
  rest.splice(globalIndex, 0, moved);
  return { ...doc, blocks: rest };
}

/** Keyboard/menu alternative to drag & drop: move up (-1) or down (+1) within the zone. */
export function moveBlockBy(doc: CvDocument, blockId: string, delta: number): CvDocument {
  const block = findBlock(doc, blockId);
  if (!block) throw new PathError(`block:${blockId}`);
  const zone = effectiveZone(doc, block);
  const zoneBlocks = blocksInZone(doc, zone);
  const idx = zoneBlocks.findIndex((b) => b.id === blockId);
  const target = Math.max(0, Math.min(zoneBlocks.length - 1, idx + delta));
  if (target === idx) return doc;
  return moveBlock(doc, blockId, zone, target);
}

export function addItem(doc: CvDocument, blockId: string, item: Item, afterItemId: string | null = null): CvDocument {
  return updateBlock(doc, blockId, (b) => {
    const items = [...b.items];
    const idx = afterItemId ? items.findIndex((i) => i.id === afterItemId) : -1;
    items.splice(idx >= 0 ? idx + 1 : items.length, 0, item);
    return { ...b, items };
  });
}

export function removeItem(doc: CvDocument, blockId: string, itemId: string): CvDocument {
  return updateBlock(doc, blockId, (b) => {
    if (!b.items.some((i) => i.id === itemId)) throw new PathError(`item:${blockId}:${itemId}`);
    return { ...b, items: b.items.filter((i) => i.id !== itemId) };
  });
}

function moveInArray<T extends { id: string }>(arr: T[], id: string, delta: number): T[] {
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) return arr;
  const target = Math.max(0, Math.min(arr.length - 1, idx + delta));
  if (target === idx) return arr;
  const copy = [...arr];
  const [x] = copy.splice(idx, 1);
  copy.splice(target, 0, x);
  return copy;
}

export function moveItemBy(doc: CvDocument, blockId: string, itemId: string, delta: number): CvDocument {
  return updateBlock(doc, blockId, (b) => ({ ...b, items: moveInArray(b.items, itemId, delta) }));
}

/** Reorders a block's items to exactly `order` (must be a permutation of current ids). */
export function reorderItems(doc: CvDocument, blockId: string, order: string[]): CvDocument {
  return updateBlock(doc, blockId, (b) => {
    const ids = b.items.map((i) => i.id);
    if (order.length !== ids.length || !order.every((id) => ids.includes(id))) {
      throw new Error('Reorder does not match the current entries of this section.');
    }
    return { ...b, items: order.map((id) => b.items.find((i) => i.id === id)!) };
  });
}

export function setItemHidden(doc: CvDocument, blockId: string, itemId: string, hidden: boolean): CvDocument {
  return updateItem(doc, blockId, itemId, (i) => ({ ...i, hidden }));
}

export function updateEntry(doc: CvDocument, blockId: string, itemId: string, patch: Partial<EntryItem>): CvDocument {
  return updateItem(doc, blockId, itemId, (i) => (i.kind === 'entry' ? { ...i, ...patch, id: i.id, kind: 'entry' } : i));
}

export function addBullet(
  doc: CvDocument,
  blockId: string,
  itemId: string,
  bullet: Bullet,
  afterBulletId: string | null = null,
): CvDocument {
  return updateItem(doc, blockId, itemId, (i) => {
    if (i.kind !== 'entry') throw new PathError(`item:${blockId}:${itemId}`);
    const bullets = [...i.bullets];
    const idx = afterBulletId ? bullets.findIndex((b) => b.id === afterBulletId) : -1;
    bullets.splice(idx >= 0 ? idx + 1 : bullets.length, 0, bullet);
    return { ...i, bullets };
  });
}

export function removeBullet(doc: CvDocument, blockId: string, itemId: string, bulletId: string): CvDocument {
  return updateItem(doc, blockId, itemId, (i) => {
    if (i.kind !== 'entry' || !i.bullets.some((b) => b.id === bulletId)) {
      throw new PathError(bulletPath(blockId, itemId, bulletId));
    }
    return { ...i, bullets: i.bullets.filter((b) => b.id !== bulletId) };
  });
}

export function moveBulletBy(doc: CvDocument, blockId: string, itemId: string, bulletId: string, delta: number): CvDocument {
  return updateItem(doc, blockId, itemId, (i) =>
    i.kind === 'entry' ? { ...i, bullets: moveInArray(i.bullets, bulletId, delta) } : i,
  );
}

/**
 * Switches template. Blocks keep their zone; when switching to Sidebar and no
 * block has ever been placed in the side zone, the template's default zones
 * are applied (skills, languages, certifications go to the side column).
 */
export function setTemplate(doc: CvDocument, template: TemplateId): CvDocument {
  if (!TEMPLATES[template]) throw new Error(`Unknown template ${template}`);
  let blocks = doc.blocks;
  if (template === 'sidebar' && !doc.blocks.some((b) => b.zone === 'side')) {
    blocks = doc.blocks.map((b) => ({ ...b, zone: TEMPLATES.sidebar.defaultZone(b.type) }));
  }
  return { ...doc, template, blocks };
}

export function setStyle(doc: CvDocument, patch: Partial<CvStyle>): CvDocument {
  return { ...doc, style: clampStyle({ ...doc.style, ...patch }) };
}

export function togglePageBreak(doc: CvDocument, blockId: string): CvDocument {
  if (!findBlock(doc, blockId)) throw new PathError(`block:${blockId}`);
  const has = doc.pageBreaks.includes(blockId);
  return { ...doc, pageBreaks: has ? doc.pageBreaks.filter((b) => b !== blockId) : [...doc.pageBreaks, blockId] };
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** Fast non-cryptographic 53-bit hash (cyrb53), hex encoded. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function documentHash(doc: CvDocument): string {
  return hashString(stableStringify(doc));
}

/** Plain-text rendering of the visible CV (used for AI context and version comparison). */
export function documentToPlainText(doc: CvDocument, includeHidden = false): string {
  const lines: string[] = [];
  const h = doc.header;
  if (h.fullName) lines.push(h.fullName);
  if (h.headline) lines.push(h.headline);
  const contact = [h.location, h.email, h.phone, ...h.links.map((l) => l.url)].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  for (const block of doc.blocks) {
    if (block.hidden && !includeHidden) continue;
    lines.push('', block.title.toUpperCase());
    for (const item of block.items) {
      if (item.hidden && !includeHidden) continue;
      switch (item.kind) {
        case 'text':
          lines.push(stripMarkup(item.text));
          break;
        case 'entry': {
          const dates = formatRange(item.start, item.end, item.current, doc.lang);
          lines.push([stripMarkup(item.title), stripMarkup(item.org), item.location, dates].filter(Boolean).join(' — '));
          if (item.text) lines.push(stripMarkup(item.text));
          for (const b of item.bullets) lines.push(`• ${stripMarkup(b.text)}`);
          break;
        }
        case 'tags':
          lines.push(`${item.label ? `${item.label}: ` : ''}${item.tags.join(', ')}`);
          break;
        case 'pair':
          lines.push(`${item.name}${item.level ? ` — ${item.level}` : ''}`);
          break;
      }
    }
  }
  return lines.join('\n').trim();
}

export function cloneDocument(doc: CvDocument): CvDocument {
  return JSON.parse(JSON.stringify(doc)) as CvDocument;
}
