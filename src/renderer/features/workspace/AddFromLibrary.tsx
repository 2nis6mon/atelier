import { useMemo, useState } from 'react';
import { addBlock, addItem, blockTypeForRecord, createBlock, recordToItem } from '../../../shared/document';
import { TEMPLATES } from '../../../shared/templates';
import type { CvDocument, LibraryRecord, RecordKind } from '../../../shared/types';
import { RECORD_KINDS } from '../../../shared/types';
import { toast } from '../../state/app';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Dialog } from '../../ui/Dialog';
import { KIND_LABELS, recordDates, recordSubtitle, recordTitle } from '../library/recordFields';

export function insertRecords(doc: CvDocument, records: LibraryRecord[]): CvDocument {
  let d = doc;
  for (const r of records) {
    const item = recordToItem(r);
    const type = blockTypeForRecord(r);
    if (!item || !type) continue;
    let block = d.blocks.find((b) => b.type === type);
    if (!block) {
      block = createBlock(type, d.lang, TEMPLATES[d.template].defaultZone(type));
      d = addBlock(d, block);
    }
    d = addItem(d, block.id, item);
  }
  return d;
}

/** Manual "recover from my library": copies records into this CV (the records are not modified). */
export function AddFromLibraryDialog({ onClose }: { onClose: () => void }) {
  const records = useWorkspace((s) => s.records);
  const doc = useWorkspace(selectDoc)!;
  const edit = useWorkspace((s) => s.edit);
  const [kind, setKind] = useState<RecordKind>('experience');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const inCv = useMemo(() => new Set(doc.blocks.flatMap((b) => b.items.map((i) => i.recordId).filter(Boolean) as string[])), [doc]);
  const list = records.filter((r) => r.kind === kind && r.kind !== 'personal');

  const add = () => {
    const chosen = records.filter((r) => picked.has(r.id));
    edit((d) => insertRecords(d, chosen), 'Add from library');
    toast({ kind: 'ok', text: `${chosen.length} item${chosen.length > 1 ? 's' : ''} added. Your library is unchanged.` });
    onClose();
  };

  return (
    <Dialog
      title="Add from your library"
      subtitle="The CV gets its own copy; editing it here never changes the library."
      onClose={onClose}
      testId="add-from-library-dialog"
      footer={
        <>
          <span className="small muted">{picked.size} selected</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={picked.size === 0} onClick={add} data-testid="add-selected">
            Add to CV
          </button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {RECORD_KINDS.filter((k) => k !== 'personal').map((k) => (
          <button key={k} type="button" className="filter-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {KIND_LABELS[k].many} <span className="count">{records.filter((r) => r.kind === k).length}</span>
          </button>
        ))}
      </div>
      <div className="col" style={{ gap: 6 }}>
        {list.length === 0 ? <p className="muted">No {KIND_LABELS[kind].many.toLowerCase()} in your library.</p> : null}
        {list.map((r) => (
          <label key={r.id} className="source-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
            <span className="grow">
              <strong>{recordTitle(r)}</strong> <span className="muted">{recordSubtitle(r)}</span>
              <span className="small muted" style={{ display: 'block' }}>
                {recordDates(r)} {r.sources.length ? `· from ${r.sources.map((s) => s.label).join(', ')}` : ''}
              </span>
            </span>
            {inCv.has(r.id) ? <span className="chip">Already in this CV</span> : null}
            <span className="chip">{r.lang.toUpperCase()}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
