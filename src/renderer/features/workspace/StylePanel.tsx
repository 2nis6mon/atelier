import { findBlock, setStyle, togglePageBreak } from '../../../shared/document';
import { FONTS, HEADING_COLORS, STYLE_LIMITS } from '../../../shared/templates';
import type { CvStyle, FontId } from '../../../shared/types';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { applyInlineStyle } from './Canvas';

function scrollToPage(page: number) {
  const el = document.querySelectorAll<HTMLElement>('.ws-canvas .cv-sheet')[page - 1];
  el?.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' });
}

/** Page count, continuing sections and overflow warnings (text is never shrunk automatically). */
export function PageInfo() {
  const layout = useWorkspace((s) => s.layout);
  const doc = useWorkspace(selectDoc)!;
  const edit = useWorkspace((s) => s.edit);
  if (!layout) return null;
  return (
    <div className="col" style={{ gap: 8 }} data-testid="page-info">
      <div className="row">
        <span className="chip">A4</span>
        <strong data-testid="page-count">
          {layout.pageCount} page{layout.pageCount > 1 ? 's' : ''}
        </strong>
        <span className="spacer" />
        <div className="row" style={{ gap: 4 }} role="group" aria-label="Go to page">
          {Array.from({ length: layout.pageCount }, (_, i) => (
            <button key={i} type="button" className="btn btn-sm icon-btn" onClick={() => scrollToPage(i + 1)} aria-label={`Page ${i + 1}`}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>
      {layout.continuations.map((c) => {
        const b = findBlock(doc, c.blockId);
        if (!b) return null;
        return (
          <div key={c.blockId} className="notice warn" data-testid="overflow-alert">
            <Icon name="warning" size={15} />
            <span className="grow col" style={{ gap: 8 }}>
              <span>
                “{b.title}” continues on page {c.pages[c.pages.length - 1]}.
              </span>
              <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => scrollToPage(c.pages[0] + 1)}>
                  Review page break
                </button>
                <button type="button" className="btn btn-sm" onClick={() => edit((d) => togglePageBreak(d, b.id), 'Page break')} title="Start this section on a new page">
                  {doc.pageBreaks.includes(b.id) ? 'Remove break' : 'Start on a new page'}
                </button>
              </span>
            </span>
          </div>
        );
      })}
      {layout.tooTall.length ? (
        <div className="notice err" role="alert">
          <Icon name="warning" size={15} /> A paragraph is taller than a page and would be cut. Shorten it or split it into bullets.
        </div>
      ) : null}
      <p className="small muted">Atelier never shrinks your text to fit. Adjust spacing, margins or content yourself.</p>
    </div>
  );
}

function Slider({ label, value, k, unit, format }: { label: string; value: number; k: keyof typeof STYLE_LIMITS; unit: string; format?: (v: number) => string }) {
  const edit = useWorkspace((s) => s.edit);
  const lim = STYLE_LIMITS[k];
  const id = `style-${k}`;
  return (
    <div className="field">
      <label htmlFor={id} className="row">
        <span className="grow">{label}</span>
        <span className="muted">{format ? format(value) : `${value}${unit}`}</span>
      </label>
      <input
        id={id}
        type="range"
        min={lim.min}
        max={lim.max}
        step={lim.step}
        value={value}
        onChange={(e) => edit((d) => setStyle(d, { [k]: Number(e.target.value) } as Partial<CvStyle>), label, `style:${k}`)}
        className="range"
      />
    </div>
  );
}

export function StylePanel() {
  const doc = useWorkspace(selectDoc)!;
  const edit = useWorkspace((s) => s.edit);
  const s = doc.style;
  const set = (patch: Partial<CvStyle>, label: string) => edit((d) => setStyle(d, patch), label);
  return (
    <div className="assistant" data-testid="style-panel">
      <h2 className="section-title">Style</h2>
      <div className="field">
        <label htmlFor="font-body">Body font</label>
        <select id="font-body" className="select" value={s.bodyFont} onChange={(e) => set({ bodyFont: e.target.value as FontId }, 'Body font')}>
          {Object.values(FONTS).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="font-heading">Heading font</label>
        <select id="font-heading" className="select" value={s.headingFont} onChange={(e) => set({ headingFont: e.target.value as FontId }, 'Heading font')}>
          {Object.values(FONTS).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">Text size</span>
        <div className="row">
          <button type="button" className="btn btn-sm icon-btn" aria-label="Smaller text" onClick={() => set({ fontSize: s.fontSize - STYLE_LIMITS.fontSize.step }, 'Font size')} disabled={s.fontSize <= STYLE_LIMITS.fontSize.min}>
            −
          </button>
          <strong style={{ minWidth: 54, textAlign: 'center' }} data-testid="font-size">
            {s.fontSize} pt
          </strong>
          <button type="button" className="btn btn-sm icon-btn" aria-label="Larger text" onClick={() => set({ fontSize: s.fontSize + STYLE_LIMITS.fontSize.step }, 'Font size')} disabled={s.fontSize >= STYLE_LIMITS.fontSize.max}>
            +
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm icon-btn" title="Bold selected text (⌘B)" aria-label="Bold selected text" onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineStyle('bold')}>
            <Icon name="bold" size={14} />
          </button>
          <button type="button" className="btn btn-sm icon-btn" title="Italic selected text (⌘I)" aria-label="Italic selected text" onMouseDown={(e) => e.preventDefault()} onClick={() => applyInlineStyle('italic')}>
            <Icon name="italic" size={14} />
          </button>
        </div>
      </div>
      <div className="field">
        <span className="label">Heading colour</span>
        <div className="swatches" role="radiogroup" aria-label="Heading colour">
          {HEADING_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={s.headingColor.toLowerCase() === c.toLowerCase()} aria-label={c} className="swatch" style={{ background: c }} onClick={() => set({ headingColor: c }, 'Heading colour')} />
          ))}
          <input type="color" aria-label="Custom heading colour" value={s.headingColor} onChange={(e) => set({ headingColor: e.target.value }, 'Heading colour')} className="swatch-input" />
        </div>
      </div>
      <div className="field">
        <span className="label">Accent colour</span>
        <div className="swatches" role="radiogroup" aria-label="Accent colour">
          {['#A84F36', '#2F5D62', '#4A3F6B', '#7A4A2E', '#1F2A44'].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={s.accentColor.toLowerCase() === c.toLowerCase()} aria-label={c} className="swatch" style={{ background: c }} onClick={() => set({ accentColor: c }, 'Accent colour')} />
          ))}
        </div>
      </div>
      <Slider label="Line spacing" value={s.lineHeight} k="lineHeight" unit="" format={(v) => v.toFixed(2)} />
      <Slider label="Margins" value={s.marginMm} k="marginMm" unit=" mm" />
      <Slider label="Section spacing" value={s.sectionSpacing} k="sectionSpacing" unit="×" format={(v) => `${v.toFixed(1)}×`} />
      {doc.template === 'sidebar' ? <Slider label="Sidebar width" value={s.sidebarWidth} k="sidebarWidth" unit="%" /> : null}
      <div className="divider" />
      <PageInfo />
    </div>
  );
}
