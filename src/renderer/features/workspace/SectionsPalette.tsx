import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { addBlock, blocksInZone, createBlock, moveBlock, moveBlockBy, removeBlock, setBlockHidden, togglePageBreak } from '../../../shared/document';
import { BLOCK_TITLES, BLOCK_TYPE_LABELS, TEMPLATES } from '../../../shared/templates';
import type { Block, BlockType, Zone } from '../../../shared/types';
import type { WorkspaceMode } from '../../router';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { MenuButton, type MenuEntry } from '../../ui/Menu';
import { AddFromLibraryDialog } from './AddFromLibrary';

const TYPE_ICON: Record<BlockType, string> = {
  profile: 'content',
  experience: 'briefcase',
  education: 'library',
  skills: 'sparkle',
  languages: 'translate',
  certifications: 'check',
  projects: 'layout',
  custom: 'plus',
};

function scrollToBlock(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-block="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'center' });
}

export function SectionsPalette({ mode, onClose }: { mode: WorkspaceMode; onClose: () => void }) {
  const doc = useWorkspace(selectDoc)!;
  const edit = useWorkspace((s) => s.edit);
  const setHighlight = useWorkspace((s) => s.setHighlight);
  const highlight = useWorkspace((s) => s.highlightBlock);
  const [library, setLibrary] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ zone: Zone; index: number } | null>(null);
  const zones: Zone[] = TEMPLATES[doc.template].zones;
  const layout = mode === 'layout';

  const addSection = (type: BlockType) => {
    const b = createBlock(type, doc.lang, TEMPLATES[doc.template].defaultZone(type), type === 'custom' ? (doc.lang === 'fr' ? 'Nouvelle section' : 'New section') : BLOCK_TITLES[doc.lang][type]);
    edit((d) => addBlock(d, b), 'Add section');
    setHighlight(b.id);
  };

  const blockMenu = (b: Block, zone: Zone, index: number, count: number): MenuEntry[] => [
    { label: 'Move up', icon: 'up', disabled: index === 0, onSelect: () => edit((d) => moveBlockBy(d, b.id, -1), 'Move section') },
    { label: 'Move down', icon: 'down', disabled: index === count - 1, onSelect: () => edit((d) => moveBlockBy(d, b.id, 1), 'Move section') },
    ...(zones.length > 1
      ? [{ label: zone === 'main' ? 'Move to sidebar' : 'Move to main column', icon: zone === 'main' ? 'right' : 'left', onSelect: () => edit((d) => moveBlock(d, b.id, zone === 'main' ? 'side' : 'main', 999), 'Move section') }]
      : []),
    { label: doc.pageBreaks.includes(b.id) ? 'Remove page break before' : 'Start on a new page', icon: 'doc', onSelect: () => edit((d) => togglePageBreak(d, b.id), 'Page break') },
    { label: b.hidden ? 'Show in CV' : 'Hide from CV', icon: b.hidden ? 'eye' : 'eyeOff', onSelect: () => edit((d) => setBlockHidden(d, b.id, !b.hidden), b.hidden ? 'Show section' : 'Hide section') },
    { kind: 'separator' },
    { label: 'Remove section from this CV', icon: 'trash', danger: true, onSelect: () => edit((d) => removeBlock(d, b.id), 'Remove section') },
  ];

  const onKey = (e: KeyboardEvent, b: Block, zone: Zone) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      edit((d) => moveBlockBy(d, b.id, e.key === 'ArrowUp' ? -1 : 1), 'Move section');
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && zones.length > 1) {
      e.preventDefault();
      const to: Zone = e.key === 'ArrowRight' ? 'side' : 'main';
      if (to !== zone) edit((d) => moveBlock(d, b.id, to, 999), 'Move section');
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-palette-block="${b.id}"]`)?.focus());
  };

  const onDrop = (e: DragEvent, zone: Zone, index: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/atelier-block') || dragId;
    setDropAt(null);
    setDragId(null);
    if (id) edit((d) => moveBlock(d, id, zone, index), 'Move section');
  };

  const renderList = (zone: Zone) => {
    const list = layout ? blocksInZone(doc, zone) : doc.blocks;
    return (
      <div
        className="palette-list"
        role="list"
        aria-label={zone === 'side' ? 'Sidebar sections' : 'Sections'}
        onDragOver={(e) => {
          if (!layout) return;
          e.preventDefault();
          if (!dropAt || dropAt.zone !== zone) setDropAt({ zone, index: list.length });
        }}
        onDrop={(e) => layout && onDrop(e, zone, dropAt?.zone === zone ? dropAt.index : list.length)}
      >
        {list.map((b, i) => (
          <div key={b.id} role="listitem">
            {layout && dropAt?.zone === zone && dropAt.index === i ? <div className="drop-line" aria-hidden="true" /> : null}
            <div
              className={`palette-item ${highlight === b.id ? 'active' : ''} ${b.hidden ? 'is-hidden' : ''}`}
              draggable={layout}
              tabIndex={0}
              data-palette-block={b.id}
              data-testid="palette-item"
              aria-label={`${b.title || BLOCK_TYPE_LABELS[b.type]}${b.hidden ? ', hidden' : ''}${layout ? '. Alt and arrow keys to move.' : ''}`}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/atelier-block', b.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragId(b.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              onDragOver={(e) => {
                if (!layout) return;
                e.preventDefault();
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDropAt({ zone, index: e.clientY < r.top + r.height / 2 ? i : i + 1 });
              }}
              onDrop={(e) => {
                if (!layout) return;
                e.stopPropagation();
                onDrop(e, zone, dropAt?.zone === zone ? dropAt.index : i);
              }}
              onClick={() => {
                setHighlight(b.id);
                scrollToBlock(b.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setHighlight(b.id);
                  scrollToBlock(b.id);
                }
                if (layout) onKey(e, b, zone);
              }}
            >
              {layout ? <Icon name="grip" size={14} className="grip" /> : <Icon name={TYPE_ICON[b.type]} size={15} />}
              <span className="grow ellipsis">{b.title || BLOCK_TYPE_LABELS[b.type]}</span>
              {doc.pageBreaks.includes(b.id) ? <span className="chip" title="Starts on a new page">⤓</span> : null}
              <button
                type="button"
                className="btn btn-quiet btn-sm icon-btn"
                aria-label={b.hidden ? `Show ${b.title}` : `Hide ${b.title}`}
                title={b.hidden ? 'Hidden — not exported. Show it.' : 'Hide from this CV (content is kept)'}
                onClick={(e) => {
                  e.stopPropagation();
                  edit((d) => setBlockHidden(d, b.id, !b.hidden), b.hidden ? 'Show section' : 'Hide section');
                }}
                data-testid="toggle-visibility"
              >
                <Icon name={b.hidden ? 'eyeOff' : 'eye'} size={14} />
              </button>
              <span onClick={(e) => e.stopPropagation()}>
                <MenuButton label={`Actions for ${b.title}`} entries={blockMenu(b, zone, i, list.length)} />
              </span>
            </div>
          </div>
        ))}
        {layout && dropAt?.zone === zone && dropAt.index >= list.length ? <div className="drop-line" aria-hidden="true" /> : null}
        {layout && list.length === 0 ? <div className="palette-empty small muted">Drop a section here</div> : null}
      </div>
    );
  };

  const missing = (Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).filter((t) => t === 'custom' || !doc.blocks.some((b) => b.type === t));

  return (
    <div className="palette" data-testid="sections-palette">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="section-title grow">{layout ? 'Arrange sections' : 'Sections'}</h2>
        <button type="button" className="btn btn-quiet btn-sm icon-btn" aria-label="Hide sections panel" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      {layout && zones.length > 1 ? (
        <>
          <div className="zone-label">Main column</div>
          {renderList('main')}
          <div className="zone-label">Sidebar</div>
          {renderList('side')}
        </>
      ) : (
        renderList('main')
      )}
      <div className="col" style={{ gap: 6, marginTop: 10 }}>
        <MenuButton
          label="Add a section"
          className="btn btn-sm"
          entries={missing.map((t) => ({ label: BLOCK_TYPE_LABELS[t], icon: TYPE_ICON[t], onSelect: () => addSection(t) }))}
        >
          <Icon name="plus" size={13} /> Add section
        </MenuButton>
        <button type="button" className="btn btn-sm" onClick={() => setLibrary(true)} data-testid="add-from-library">
          <Icon name="library" size={13} /> Add from library
        </button>
      </div>
      {layout ? <p className="small muted" style={{ marginTop: 10 }}>Drag sections, or focus one and press ⌥↑ ⌥↓ (order) and ⌥← ⌥→ (column).</p> : null}
      {library ? <AddFromLibraryDialog onClose={() => setLibrary(false)} /> : null}
    </div>
  );
}
