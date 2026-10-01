import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConsolidationFinding } from '../../../shared/ai/response';
import { isValidPartialDate } from '../../../shared/dates';
import { newId } from '../../../shared/document';
import type { Lang, LibraryRecord, RecordKind } from '../../../shared/types';
import { RECORD_KINDS } from '../../../shared/types';
import { api, errorMessage, unwrap } from '../../api';
import { navigate } from '../../router';
import { toast, toastError, useApp } from '../../state/app';
import { Confirm, Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { MenuButton } from '../../ui/Menu';
import { FIELDS, KIND_LABELS, emptyData, recordDates, recordSubtitle, recordTitle, type FieldDef } from './recordFields';
import { MergeDialog } from './MergeDialog';

export function ExperienceTab() {
  const [records, setRecords] = useState<LibraryRecord[] | null>(null);
  const [kind, setKind] = useState<RecordKind>('experience');
  const [selected, setSelected] = useState<string | null>(null);
  const [usage, setUsage] = useState<Array<{ cvId: string; name: string; updatedAt: string }>>([]);
  const [remove, setRemove] = useState<LibraryRecord | null>(null);
  const [mergeIds, setMergeIds] = useState<string[] | null>(null);
  const [findings, setFindings] = useState<ConsolidationFinding[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const importOpen = useApp((s) => s.importOpen);
  const dataVersion = useApp((s) => s.dataVersion);

  const load = useCallback(async () => setRecords(await api().library.records()), []);
  useEffect(() => {
    void load();
  }, [load, importOpen, dataVersion]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of records ?? []) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [records]);
  const list = useMemo(() => (records ?? []).filter((r) => r.kind === kind), [records, kind]);
  const current = list.find((r) => r.id === selected) ?? list[0] ?? null;

  useEffect(() => {
    if (!current) return setUsage([]);
    void api().library.usage(current.id).then(setUsage);
  }, [current]);

  const addRecord = async () => {
    try {
      const lang: Lang = current?.lang ?? 'fr';
      const r = await unwrap(api().library.createRecord({ kind, lang, data: emptyData(kind) }));
      await load();
      setSelected(r.id);
    } catch (e) {
      toastError(e);
    }
  };

  const checkDuplicates = async () => {
    const ids = list.slice(0, 40).map((r) => r.id);
    if (ids.length < 2) return toast({ kind: 'info', text: 'You need at least two records of this kind to compare.' });
    const rid = newId();
    setChecking(rid);
    try {
      const r = await unwrap(api().ai.consolidate(rid, ids));
      setFindings(r.findings);
      if (r.findings.length === 0) toast({ kind: 'ok', text: r.summary || 'No duplicates or contradictions found.' });
    } catch (e) {
      toast({ kind: 'err', text: `${errorMessage(e)} Nothing was changed.`, action: { label: 'AI settings', run: () => useApp.getState().openSettings('ai') } });
    } finally {
      setChecking(null);
    }
  };

  if (!records) return <div className="empty"><div className="spinner" /></div>;

  return (
    <div className="xp" data-testid="experience-library">
      <nav className="xp-pane glass" aria-label="Record kinds">
        <div className="section-title" style={{ padding: '4px 8px 10px' }}>Library</div>
        <div className="nav-list">
          {RECORD_KINDS.map((k) => (
            <button key={k} type="button" className="nav-item" aria-current={k === kind} onClick={() => { setKind(k); setSelected(null); }}>
              <Icon name={KIND_LABELS[k].icon} size={15} />
              <span className="grow">{KIND_LABELS[k].many}</span>
              <span className="count">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
      </nav>

      <section className="xp-pane surface" aria-label={KIND_LABELS[kind].many}>
        <div className="row" style={{ padding: '2px 4px 10px' }}>
          <h3 className="section-title grow">
            {KIND_LABELS[kind].many} <span className="count">{list.length}</span>
          </h3>
          <MenuButton
            label="Library actions"
            entries={[
              { label: checking ? 'Checking…' : 'Check for duplicates with AI', icon: 'sparkles', disabled: Boolean(checking), onSelect: () => void checkDuplicates() },
            ]}
          />
          <button type="button" className="btn btn-sm icon-btn" onClick={() => void addRecord()} aria-label={`Add ${KIND_LABELS[kind].one.toLowerCase()}`} title={`Add ${KIND_LABELS[kind].one.toLowerCase()}`} data-testid="add-record">
            <Icon name="plus" size={15} />
          </button>
        </div>
        {checking ? (
          <div className="notice" style={{ marginBottom: 8 }}>
            <div className="spinner" /> Checking with AI… nothing is changed until you decide.
            <button type="button" className="link-btn" onClick={() => void api().ai.cancel(checking)}>Cancel</button>
          </div>
        ) : null}
        <div className="col" style={{ gap: 2 }} role="listbox" aria-label={KIND_LABELS[kind].many}>
          {list.length === 0 ? <p className="muted small" style={{ padding: 8 }}>Nothing here yet. Import a CV or add one manually.</p> : null}
          {list.map((r) => (
            <button key={r.id} type="button" role="option" className="record-item" aria-selected={current?.id === r.id} onClick={() => setSelected(r.id)} data-testid="record-item">
              <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{recordTitle(r).slice(0, 1).toUpperCase()}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{recordTitle(r)}</span>
                <span className="ellipsis small muted" style={{ display: 'block' }}>{recordSubtitle(r)}</span>
                {recordDates(r) ? <span className="small muted">{recordDates(r)}</span> : null}
              </span>
              <span className="chip">{r.lang.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="xp-pane surface" aria-label="Record details">
        {current ? (
          <RecordEditor
            key={current.id}
            record={current}
            onSaved={(r) => setRecords((all) => (all ?? []).map((x) => (x.id === r.id ? r : x)))}
            onDelete={() => setRemove(current)}
            onMerge={() => {
              const others = list.filter((r) => r.id !== current.id);
              if (others.length === 0) return toast({ kind: 'info', text: 'There is no other record of this kind to merge with.' });
              setMergeIds([current.id]);
            }}
          />
        ) : (
          <div className="empty">Select a record to see and edit its details.</div>
        )}
      </section>

      <aside className="xp-pane glass xp-usage" aria-label="Usage">
        <h3 className="section-title" style={{ marginBottom: 10 }}>
          Used in {usage.length} CV{usage.length === 1 ? '' : 's'}
        </h3>
        <div className="col" style={{ gap: 6 }}>
          {usage.map((u) => (
            <button key={u.cvId} type="button" className="start-card" onClick={() => navigate({ name: 'workspace', id: u.cvId, mode: 'content' })}>
              <Icon name="doc" size={18} />
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5 }}>{u.name}</span>
                <span className="small muted">Last updated {new Date(u.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="notice" style={{ marginTop: 12 }}>
          <Icon name="info" size={15} />
          <span>
            This record is a reusable source. CVs keep their own copy: removing it from a CV never deletes it here, and deleting it here never changes a CV.
          </span>
        </div>
      </aside>

      {remove ? (
        <Confirm
          title={`Delete “${recordTitle(remove)}”?`}
          message={`It is removed from your library only. ${usage.length ? `The ${usage.length} CV(s) using it keep their own copy.` : ''}`}
          confirmLabel="Delete record"
          danger
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            try {
              await unwrap(api().library.deleteRecord(remove.id));
              setSelected(null);
              await load();
            } catch (e) {
              toastError(e);
            }
            setRemove(null);
          }}
        />
      ) : null}
      {findings && findings.length ? (
        <Dialog title="Possible duplicates and contradictions" subtitle="Suggested by AI. Nothing is merged unless you choose the values yourself." onClose={() => setFindings(null)} testId="findings">
          <div className="col" style={{ gap: 10 }}>
            {findings.map((f, i) => (
              <div key={i} className="group-card">
                <div className="row">
                  <span className={`chip ${f.type === 'contradiction' ? 'warn' : 'info'}`}>{f.type === 'contradiction' ? 'Contradiction' : 'Duplicate'}</span>
                  {f.field ? <span className="small muted">Field: {f.field}</span> : null}
                </div>
                <p style={{ margin: '6px 0' }}>{f.explanation}</p>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {f.recordIds.map((rid) => {
                    const r = records.find((x) => x.id === rid);
                    return r ? <span key={rid} className="chip outline">{recordTitle(r)} · {recordSubtitle(r)} {recordDates(r)}</span> : null;
                  })}
                  <span className="spacer" />
                  <button type="button" className="btn btn-sm" onClick={() => setMergeIds(f.recordIds)}>
                    Review and merge…
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      ) : null}
      {mergeIds ? (
        <MergeDialog
          records={records}
          initialIds={mergeIds}
          onClose={() => setMergeIds(null)}
          onMerged={async (keepId) => {
            setMergeIds(null);
            setFindings(null);
            await load();
            setSelected(keepId);
          }}
        />
      ) : null}
    </div>
  );
}

function provenance(record: LibraryRecord, key: string): string | null {
  const src = record.fieldSources[key];
  if (!src) return null;
  if ('user' in src) return 'edited by you';
  return `from ${src.label}`;
}

function RecordEditor({ record, onSaved, onDelete, onMerge }: { record: LibraryRecord; onSaved: (r: LibraryRecord) => void; onDelete: () => void; onMerge: () => void }) {
  const [data, setData] = useState<Record<string, unknown>>(record.data as unknown as Record<string, unknown>);
  const [lang, setLang] = useState<Lang>(record.lang);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const save = async (patch: Record<string, unknown>, nextLang?: Lang) => {
    for (const [k, v] of Object.entries(patch)) {
      const def = FIELDS[record.kind].find((f) => f.key === k);
      if (def?.type === 'date' && typeof v === 'string' && !isValidPartialDate(v)) {
        setErrors((e) => ({ ...e, [k]: 'Use YYYY or YYYY-MM' }));
        return;
      }
    }
    setErrors({});
    try {
      const r = await unwrap(api().library.updateRecord(record.id, patch, nextLang));
      onSaved(r);
      setDirty(new Set());
    } catch (e) {
      toastError(e, 'Not saved: ');
    }
  };

  const set = (k: string, v: unknown) => {
    setData((d) => ({ ...d, [k]: v }));
    setDirty((s) => new Set(s).add(k));
  };
  const commit = (k: string) => {
    if (dirty.has(k)) void save({ [k]: data[k] });
  };

  return (
    <div className="col" style={{ gap: 12 }} data-testid="record-editor">
      <div className="row">
        <h3 className="section-title grow">{KIND_LABELS[record.kind].one} details</h3>
        <select className="select" style={{ width: 110 }} value={lang} aria-label="Content language" onChange={(e) => { setLang(e.target.value as Lang); void save({}, e.target.value as Lang); }}>
          <option value="fr">French</option>
          <option value="en">English</option>
        </select>
        <MenuButton
          label="Record actions"
          entries={[
            { label: 'Merge with another record…', icon: 'duplicate', onSelect: onMerge },
            { kind: 'separator' },
            { label: 'Delete from library…', icon: 'trash', danger: true, onSelect: onDelete },
          ]}
        />
      </div>
      <div className="form-grid">
        {FIELDS[record.kind].map((f) => (
          <FieldRow key={f.key} def={f} value={data[f.key]} error={errors[f.key]} prov={provenance(record, f.key)} onChange={(v) => set(f.key, v)} onCommit={() => commit(f.key)} onImmediate={(v) => { set(f.key, v); void save({ [f.key]: v }); }} />
        ))}
      </div>
      <div>
        <div className="label" style={{ marginBottom: 6 }}>Source files</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {record.sources.length === 0 ? <span className="small muted">Added manually</span> : null}
          {record.sources.map((s) => (
            <span key={s.sourceId} className="chip outline" data-testid="record-source">
              <Icon name="file" size={12} /> {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ def, value, error, prov, onChange, onCommit, onImmediate }: { def: FieldDef; value: unknown; error?: string; prov: string | null; onChange: (v: unknown) => void; onCommit: () => void; onImmediate: (v: unknown) => void }) {
  const id = `f-${def.key}`;
  const label = (
    <label htmlFor={id}>
      {def.label}
      {prov ? <span className="prov" style={{ display: 'block' }}>{prov}</span> : null}
    </label>
  );
  switch (def.type) {
    case 'textarea':
      return (
        <>
          {label}
          <textarea id={id} className="textarea" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} />
        </>
      );
    case 'bool':
      return (
        <>
          {label}
          <label className="checkbox">
            <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onImmediate(e.target.checked)} /> Current position
          </label>
        </>
      );
    case 'list': {
      const items = (value as string[] | undefined) ?? [];
      return (
        <>
          {label}
          <div className="col" style={{ gap: 5 }}>
            {items.map((it, i) => (
              <div key={i} className="bullet-edit">
                <Icon name="grip" size={13} />
                <input
                  aria-label={`${def.label} ${i + 1}`}
                  value={it}
                  onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                  onBlur={onCommit}
                />
                <button type="button" className="btn btn-quiet btn-sm icon-btn" aria-label={`Remove ${def.label.toLowerCase()} ${i + 1}`} onClick={() => onImmediate(items.filter((_, j) => j !== i))}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...items, ''])}>
              <Icon name="plus" size={12} /> Add
            </button>
          </div>
        </>
      );
    }
    case 'tags':
      return (
        <>
          {label}
          <input
            id={id}
            className="input"
            value={((value as string[] | undefined) ?? []).join(', ')}
            placeholder="Separate with commas"
            onChange={(e) => onChange(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            onBlur={onCommit}
          />
        </>
      );
    case 'links': {
      const links = (value as Array<{ label: string; url: string }> | undefined) ?? [];
      return (
        <>
          {label}
          <div className="col" style={{ gap: 5 }}>
            {links.map((l, i) => (
              <div key={i} className="row">
                <input className="input" style={{ width: 110 }} aria-label="Link label" value={l.label} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} onBlur={onCommit} />
                <input className="input" aria-label="Link address" value={l.url} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} onBlur={onCommit} />
              </div>
            ))}
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...links, { label: 'Website', url: '' }])}>
              <Icon name="plus" size={12} /> Add link
            </button>
          </div>
        </>
      );
    }
    default:
      return (
        <>
          {label}
          <div className="col" style={{ gap: 3 }}>
            <input
              id={id}
              className={`input ${error ? 'warn' : ''}`}
              value={String(value ?? '')}
              placeholder={def.type === 'date' ? 'YYYY or YYYY-MM' : def.placeholder}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onCommit}
              onKeyDown={(e) => e.key === 'Enter' && onCommit()}
              aria-invalid={Boolean(error)}
            />
            {error ? <span className="small" style={{ color: 'var(--danger)' }}>{error}</span> : null}
          </div>
        </>
      );
  }
}

export { errorMessage };
