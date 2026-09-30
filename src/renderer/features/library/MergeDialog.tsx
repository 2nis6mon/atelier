import { useMemo, useState } from 'react';
import { buildGroup } from '../../../shared/dedupe';
import type { LibraryRecord } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { toast, toastError } from '../../state/app';
import { Dialog } from '../../ui/Dialog';
import { recordDates, recordSubtitle, recordTitle } from './recordFields';

/** Merge duplicate library records: the user picks every differing value. */
export function MergeDialog({ records, initialIds, onClose, onMerged }: { records: LibraryRecord[]; initialIds: string[]; onClose: () => void; onMerged: (keepId: string) => void }) {
  const first = records.find((r) => r.id === initialIds[0])!;
  const candidates = records.filter((r) => r.kind === first.kind && r.id !== first.id);
  const [ids, setIds] = useState<string[]>(initialIds.length > 1 ? initialIds : [first.id]);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const members = ids.map((id) => records.find((r) => r.id === id)).filter(Boolean) as LibraryRecord[];
  const group = useMemo(
    () =>
      buildGroup(
        'merge',
        first.kind,
        first.lang,
        members.map((r) => ({ key: r.id, origin: 'existing' as const, data: r.data as unknown as Record<string, unknown>, sources: r.sources.length ? r.sources : [{ sourceId: r.id, label: recordTitle(r) }], label: recordTitle(r) })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join('|')],
  );
  const unresolved = group.conflicts.filter((c) => choices[c.field] === undefined);

  const merge = async () => {
    const data: Record<string, unknown> = { ...group.base };
    const fieldSources: Record<string, { sourceId: string; label: string }> = {};
    for (const c of group.conflicts) {
      const opt = c.options[choices[c.field]];
      let v = opt.value;
      if (c.field === 'end' && v === '__present__') {
        v = '';
        data.current = true;
      } else if (c.field === 'end') data.current = false;
      data[c.field] = v;
      fieldSources[c.field] = opt.sources[0];
    }
    try {
      const kept = await unwrap(api().library.mergeRecords(ids[0], ids.slice(1), data, fieldSources));
      toast({ kind: 'ok', text: 'Records merged. Their sources are kept.' });
      onMerged(kept.id);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Dialog
      title="Merge records"
      subtitle="Choose the correct value for every difference. Values are never picked for you."
      onClose={onClose}
      testId="merge-dialog"
      footer={
        <>
          <span className="small muted">{unresolved.length ? `${unresolved.length} difference(s) to resolve` : 'Ready to merge'}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Keep separate
          </button>
          <button type="button" className="btn btn-primary" disabled={ids.length < 2 || unresolved.length > 0} onClick={() => void merge()} data-testid="confirm-merge">
            Merge
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="label">Records</span>
          {members.map((r) => (
            <span key={r.id} className="chip outline" style={{ alignSelf: 'flex-start' }}>
              {recordTitle(r)} · {recordSubtitle(r)} {recordDates(r)}
            </span>
          ))}
          {ids.length < 2 ? (
            <select className="select" aria-label="Merge with" defaultValue="" onChange={(e) => e.target.value && setIds([first.id, e.target.value])}>
              <option value="">Choose a record to merge with…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {recordTitle(c)} — {recordSubtitle(c)} {recordDates(c)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {ids.length >= 2 && group.conflicts.length === 0 ? <div className="notice ok">These records agree on every field.</div> : null}
        {group.conflicts.map((c) => (
          <fieldset key={c.field} className="conflict">
            <legend className="section-title">{c.label} differs</legend>
            {c.options.map((o, i) => (
              <label key={i} className="conflict-option">
                <input type="radio" name={`m-${c.field}`} checked={choices[c.field] === i} onChange={() => setChoices((ch) => ({ ...ch, [c.field]: i }))} />
                <strong>{o.display}</strong>
                <span className="muted small">(from {o.sources.map((s) => s.label).join(', ')})</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
