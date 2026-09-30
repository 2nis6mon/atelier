import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HEADER_ATOM, buildAtoms, computeSpacers, type AtomSpec } from '../../shared/atoms';
import { formatRange } from '../../shared/dates';
import { bulletPath, headerPath, itemPath, blockTitlePath } from '../../shared/document';
import { markupToHtml } from '../../shared/markup';
import { paginate, type PaginationResult } from '../../shared/pagination';
import { A4, FONTS, TEMPLATES, mmToPx } from '../../shared/templates';
import type { Block, CvDocument, EntryItem, Item, Zone } from '../../shared/types';
import { Editable } from './Editable';

export const PAGE_W = mmToPx(A4.widthMm);
export const PAGE_H = mmToPx(A4.heightMm);
export const PAGE_GAP = 28;
const GUTTER = 26;

export interface LayoutInfo {
  pageCount: number;
  continuations: PaginationResult['continuations'];
  tooTall: string[];
  ready: boolean;
}

export interface CvPagesProps {
  doc: CvDocument;
  editable?: boolean;
  print?: boolean;
  onFieldChange?: (path: string, value: string) => void;
  onEnter?: (path: string) => void;
  onBackspaceEmpty?: (path: string) => void;
  onLayout?: (info: LayoutInfo) => void;
  highlightBlockId?: string | null;
  /** Renders outlines & zone labels (Layout mode). */
  showZones?: boolean;
}

function normalizeHref(url: string): string {
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[^\s@]+@[^\s@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

function Rich({ value, className }: { value: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: markupToHtml(value) }} />;
}

interface FieldProps {
  value: string;
  path: string;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  label: string;
  ctx: Ctx;
}

interface Ctx {
  editable: boolean;
  onFieldChange?: (path: string, value: string) => void;
  onEnter?: (path: string) => void;
  onBackspaceEmpty?: (path: string) => void;
}

function Field({ value, path, placeholder, className, multiline, label, ctx }: FieldProps) {
  if (!ctx.editable) return value ? <Rich value={value} className={className} /> : null;
  return (
    <Editable
      value={value}
      path={path}
      editable
      multiline={multiline}
      placeholder={placeholder}
      className={className}
      ariaLabel={label}
      onChange={(v, p) => ctx.onFieldChange?.(p, v)}
      onEnter={ctx.onEnter}
      onBackspaceEmpty={ctx.onBackspaceEmpty}
    />
  );
}

function Header({ doc, ctx, print }: { doc: CvDocument; ctx: Ctx; print: boolean }) {
  const h = doc.header;
  const contact: ReactNode[] = [];
  const item = (key: string, node: ReactNode) => contact.push(<span key={key} className="cv-contact-item">{node}</span>);
  if (ctx.editable) {
    item('loc', <Field value={h.location} path={headerPath('location')} placeholder="City, Country" label="Location" ctx={ctx} />);
    item('email', <Field value={h.email} path={headerPath('email')} placeholder="email@example.com" label="Email" ctx={ctx} />);
    item('phone', <Field value={h.phone} path={headerPath('phone')} placeholder="Phone" label="Phone" ctx={ctx} />);
    h.links.forEach((l, i) => item(`l${i}`, <span className="cv-link">{l.url}</span>));
  } else {
    if (h.location) item('loc', h.location);
    if (h.email) item('email', print ? <a href={normalizeHref(h.email)}>{h.email}</a> : h.email);
    if (h.phone) item('phone', h.phone);
    h.links.forEach((l, i) => l.url && item(`l${i}`, print ? <a href={normalizeHref(l.url)}>{l.url.replace(/^https?:\/\//, '')}</a> : l.url.replace(/^https?:\/\//, '')));
  }
  return (
    <div className="cv-header">
      <div className="cv-header-main">
        <Field value={h.fullName} path={headerPath('fullName')} placeholder="Your name" className="cv-name" label="Name" ctx={ctx} />
        <Field value={h.headline} path={headerPath('headline')} placeholder="Headline" className="cv-headline" label="Headline" ctx={ctx} />
      </div>
      <div className="cv-contact">{contact}</div>
    </div>
  );
}

function AtomView({ atom, doc, block, item, ctx, print }: { atom: AtomSpec; doc: CvDocument; block: Block | null; item: Item | null; ctx: Ctx; print: boolean }) {
  switch (atom.kind) {
    case 'header':
      return <Header doc={doc} ctx={ctx} print={print} />;
    case 'blockTitle':
      return <Field value={block!.title} path={blockTitlePath(block!.id)} className="cv-block-title" label={`${block!.title} section title`} ctx={ctx} />;
    case 'text':
      return <Field value={(item as Extract<Item, { kind: 'text' }>).text} path={itemPath(block!.id, item!.id, 'text')} multiline placeholder="Write a short paragraph…" className="cv-text" label="Paragraph" ctx={ctx} />;
    case 'entryHead': {
      const e = item as EntryItem;
      const dates = formatRange(e.start, e.end, e.current, doc.lang);
      return (
        <div className="cv-entry-head">
          <span className="cv-dates">{dates}</span>
          <div className="cv-entry-lines">
            <div className="cv-entry-line1">
              <Field value={e.org} path={itemPath(block!.id, e.id, 'org')} placeholder="Organisation" className="cv-org" label="Organisation" ctx={ctx} />
              <Field value={e.location} path={itemPath(block!.id, e.id, 'location')} placeholder="Location" className="cv-location" label="Location" ctx={ctx} />
            </div>
            <Field value={e.title} path={itemPath(block!.id, e.id, 'title')} placeholder="Title" className="cv-role" label="Title" ctx={ctx} />
          </div>
        </div>
      );
    }
    case 'entryText': {
      const e = item as EntryItem;
      return <Field value={e.text} path={itemPath(block!.id, e.id, 'text')} multiline className="cv-entry-text" label="Description" ctx={ctx} />;
    }
    case 'bullet': {
      const e = item as EntryItem;
      const b = e.bullets.find((x) => x.id === atom.bulletId)!;
      return (
        <div className="cv-bullet">
          <span className="cv-bullet-mark" aria-hidden="true">•</span>
          <Field value={b.text} path={bulletPath(block!.id, e.id, b.id)} multiline placeholder="Describe a responsibility or result" className="cv-bullet-text" label="Bullet" ctx={ctx} />
        </div>
      );
    }
    case 'tags': {
      const t = item as Extract<Item, { kind: 'tags' }>;
      return (
        <div className="cv-tags">
          {t.label ? <span className="cv-tags-label">{t.label}</span> : null}
          {ctx.editable ? (
            <Field value={t.tags.join(', ')} path={itemPath(block!.id, t.id, 'tags')} placeholder="Skill, skill, skill" className="cv-tags-edit" label="Skills, separated by commas" ctx={ctx} />
          ) : (
            <span className="cv-chips">
              {t.tags.map((tag, i) => (
                <span key={i} className="cv-chip">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </div>
      );
    }
    case 'pair': {
      const p = item as Extract<Item, { kind: 'pair' }>;
      return (
        <div className="cv-pair">
          <Field value={p.name} path={itemPath(block!.id, p.id, 'name')} placeholder="Language" className="cv-pair-name" label="Name" ctx={ctx} />
          <Field value={p.level} path={itemPath(block!.id, p.id, 'level')} placeholder="Level" className="cv-pair-level" label="Level" ctx={ctx} />
        </div>
      );
    }
  }
}

const MemoAtom = memo(AtomView);

export function CvPages({ doc, editable = false, print = false, onFieldChange, onEnter, onBackspaceEmpty, onLayout, highlightBlockId, showZones }: CvPagesProps) {
  const sidebar = doc.template === 'sidebar';
  const compact = doc.template === 'compact';
  const margin = mmToPx(doc.style.marginMm);
  const contentW = PAGE_W - 2 * margin;
  const sideW = sidebar ? Math.round((contentW * doc.style.sidebarWidth) / 100) : 0;
  const mainW = sidebar ? contentW - sideW - GUTTER : contentW;
  const stride = print ? PAGE_H : PAGE_H + PAGE_GAP;
  const atoms = useMemo(() => buildAtoms(doc, { headerInFlow: !sidebar }), [doc, sidebar]);

  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ key: string; spacers: Record<string, number>; pages: number; result: PaginationResult | null }>({ key: '', spacers: {}, pages: 1, result: null });
  const [fontsTick, setFontsTick] = useState(0);

  const blocks = useMemo(() => new Map(doc.blocks.map((b) => [b.id, b])), [doc.blocks]);
  const ctx: Ctx = useMemo(() => ({ editable, onFieldChange, onEnter, onBackspaceEmpty }), [editable, onFieldChange, onEnter, onBackspaceEmpty]);

  const relayout = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const heights = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('[data-atom]').forEach((n) => heights.set(n.dataset.atom!, n.offsetHeight));
    const headerH = sidebar ? (el.querySelector<HTMLElement>('.cv-fixed-header')?.offsetHeight ?? 0) : 0;
    const contentH = PAGE_H - 2 * margin;
    const measured = atoms.map((a) => ({ ...a, height: heights.get(a.id) ?? 0 }));
    const result = paginate(measured, (_zone: Zone, page: number) => contentH - (sidebar && page === 0 ? headerH : 0));
    const pageOf = (id: string) => result.pages.findIndex((p) => p.main.includes(id) || p.side.includes(id)) + 1;
    const spacers = computeSpacers(measured, pageOf, { stride, top: (_z, p) => margin + (sidebar && p === 1 ? headerH : 0) });
    const key = JSON.stringify([spacers, result.pageCount]);
    setLayout((prev) => (prev.key === key ? prev : { key, spacers, pages: result.pageCount, result }));
  }, [atoms, margin, sidebar, stride]);

  useLayoutEffect(() => {
    relayout();
  });

  useLayoutEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsTick((t) => t + 1));
    const onLoad = () => alive && setFontsTick((t) => t + 1);
    document.fonts?.addEventListener?.('loadingdone', onLoad);
    return () => {
      alive = false;
      document.fonts?.removeEventListener?.('loadingdone', onLoad);
    };
  }, []);

  useLayoutEffect(() => {
    if (layout.result && onLayout) {
      onLayout({ pageCount: layout.pages, continuations: layout.result.continuations, tooTall: layout.result.tooTall, ready: fontsTick > 0 || !document.fonts });
    }
  }, [layout, onLayout, fontsTick]);

  const style = {
    '--cv-body-font': FONTS[doc.style.bodyFont].css,
    '--cv-heading-font': FONTS[doc.style.headingFont].css,
    '--cv-size': `${doc.style.fontSize}pt`,
    '--cv-line': doc.style.lineHeight,
    '--cv-heading': doc.style.headingColor,
    '--cv-accent': doc.style.accentColor,
    '--cv-text': doc.style.textColor,
    '--cv-space': doc.style.sectionSpacing * TEMPLATES[doc.template].density,
    '--cv-date-col': compact || sidebar ? '0px' : '112px',
    width: PAGE_W,
    height: layout.pages * stride - (print ? 0 : PAGE_GAP),
  } as CSSProperties;

  const renderZone = (zone: Zone, width: number, left: number) => (
    <div className={`cv-col cv-col-${zone}`} style={{ left, width }} data-zone={zone}>
      {atoms
        .filter((a) => a.zone === zone)
        .map((a) => {
          const block = a.blockId === HEADER_ATOM ? null : (blocks.get(a.blockId) ?? null);
          const item = block && a.itemId ? (block.items.find((i) => i.id === a.itemId) ?? null) : null;
          return (
            <div
              key={a.id}
              data-atom={a.id}
              data-block={a.blockId}
              className={`cv-atom cv-atom-${a.kind}${a.firstInBlock && a.kind === 'blockTitle' ? ' first' : ''}${a.lastInItem ? ' last-in-item' : ''}${highlightBlockId === a.blockId ? ' highlight' : ''}`}
              style={{ marginTop: layout.spacers[a.id] ?? 0 }}
            >
              <MemoAtom atom={a} doc={doc} block={block} item={item} ctx={ctx} print={print} />
            </div>
          );
        })}
    </div>
  );

  return (
    <div ref={root} className={`cv-pages template-${doc.template}${print ? ' print' : ''}${showZones ? ' show-zones' : ''}`} style={style} lang={doc.lang} data-pages={layout.pages}>
      {Array.from({ length: layout.pages }, (_, i) => (
        <div key={i} className="cv-sheet" style={{ top: i * stride, height: PAGE_H }} aria-hidden="true">
          {sidebar ? <div className="cv-side-band" style={{ right: margin - 12, width: sideW + 24, top: 0, bottom: 0 }} /> : null}
          {!print ? <span className="cv-page-number">{i + 1}</span> : null}
        </div>
      ))}
      {sidebar ? (
        <div className="cv-fixed-header" style={{ top: margin, left: margin, width: contentW }}>
          <Header doc={doc} ctx={ctx} print={print} />
        </div>
      ) : null}
      {renderZone('main', mainW, margin)}
      {sidebar ? renderZone('side', sideW, margin + mainW + GUTTER) : null}
    </div>
  );
}
