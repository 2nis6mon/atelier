import { useEffect, useMemo, useState } from 'react';
import { guessOfferMeta } from '../../../shared/offer';
import type { CvSummary, Lang } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { navigate } from '../../router';
import { toastError } from '../../state/app';
import { Icon } from '../../ui/Icon';
import { LensTabs } from '../../ui/LensTabs';

type Source = 'text' | 'link' | 'file';

export function NewApplication({ baseCvId }: { baseCvId: string | null }) {
  const [source, setSource] = useState<Source>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [fileInfo, setFileInfo] = useState<{ name: string; path: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [lang, setLang] = useState<Lang>('fr');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [cvs, setCvs] = useState<CvSummary[]>([]);
  const [base, setBase] = useState<string>(baseCvId ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api()
      .cvs.list()
      .then((list) => {
        setCvs(list);
        if (!baseCvId) setBase(list.find((c) => !c.applicationId)?.id ?? list[0]?.id ?? '');
      });
  }, [baseCvId]);

  // Pre-fill from labelled lines in the offer, without overriding what the user typed.
  useEffect(() => {
    if (!text.trim()) return;
    const m = guessOfferMeta(text);
    if (!touched.company && m.company) setCompany(m.company);
    if (!touched.role && m.role) setRole(m.role);
    if (!touched.location && m.location) setLocation(m.location);
    if (!touched.lang) setLang(m.lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const fetchLink = async () => {
    setFetching(true);
    setLinkError(null);
    try {
      const r = await api().applications.fetchOffer(url);
      if (!r.ok) {
        setLinkError(r.message);
        return;
      }
      setText(r.text);
      if (r.company && !touched.company) setCompany(r.company);
      if (r.title && !touched.role) setRole(r.title);
      if (r.location && !touched.location) setLocation(r.location);
    } finally {
      setFetching(false);
    }
  };

  const pickFile = async () => {
    try {
      const r = await unwrap(api().applications.pickOfferFile());
      if (r) {
        setFileInfo({ name: r.name, path: r.path });
        setText(r.text);
      }
    } catch (e) {
      toastError(e);
    }
  };

  const baseCv = useMemo(() => cvs.find((c) => c.id === base), [cvs, base]);
  const step = !text.trim() ? 1 : !base ? 2 : 3;
  const canCreate = Boolean(text.trim() && base && (company.trim() || role.trim()));

  const create = async () => {
    setBusy(true);
    try {
      const app = await unwrap(api().applications.create({ company, role, location, lang, offerText: text, offerUrl: source === 'link' ? url : '', offerFileName: fileInfo?.name ?? '', notes: '' }));
      if (fileInfo) await unwrap(api().applications.attachOfferFile(app.id, fileInfo.path));
      const cv = await unwrap(api().applications.createDraft(app.id, base));
      navigate({ name: 'workspace', id: cv.id, mode: 'content' });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  return (
    <div className="page wizard" data-testid="new-application">
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <h1 className="display page-title">Create a new application</h1>
        <p className="page-sub">Start from a job offer and a base CV to create a tailored draft.</p>
        <ol className="steps" style={{ justifyContent: 'center', listStyle: 'none', padding: 0, margin: '18px 0 0' }} aria-label="Progress">
          {['Opportunity', 'Starting CV', 'Ready'].map((l, i) => (
            <li key={l} className="step" data-state={i + 1 === step ? 'current' : i + 1 < step ? 'done' : 'todo'} aria-current={i + 1 === step ? 'step' : undefined}>
              {i > 0 ? <span className="step-line" aria-hidden="true" /> : null}
              <span className="dot">{i + 1}</span>
              {l}
            </li>
          ))}
        </ol>
      </div>

      <div className="two-col">
        <section className="card surface" aria-label="Job offer">
          <h3 className="display" style={{ fontSize: 20 }}>Job offer</h3>
          <p className="small muted" style={{ marginBottom: 10 }}>Paste the offer text, add a link, or import a file.</p>
          <LensTabs
            label="Offer source"
            value={source}
            onChange={setSource}
            options={[
              { id: 'text', label: 'Paste text', icon: 'content' },
              { id: 'link', label: 'Link', icon: 'link' },
              { id: 'file', label: 'File', icon: 'file' },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            {source === 'link' ? (
              <div className="col" style={{ marginBottom: 10 }}>
                <div className="row">
                  <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Offer link" onKeyDown={(e) => e.key === 'Enter' && void fetchLink()} />
                  <button type="button" className="btn" onClick={() => void fetchLink()} disabled={!url.trim() || fetching}>
                    {fetching ? <span className="spinner" /> : 'Load'}
                  </button>
                </div>
                {linkError ? (
                  <div className="notice err" role="alert" data-testid="link-error">
                    <Icon name="warning" size={15} />
                    <span className="grow">{linkError}</span>
                    <button type="button" className="btn btn-sm" onClick={() => setSource('text')}>
                      Paste text instead
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {source === 'file' ? (
              <div className="row" style={{ marginBottom: 10 }}>
                <button type="button" className="btn" onClick={() => void pickFile()}>
                  <Icon name="file" size={14} /> Choose PDF, Word or text file…
                </button>
                {fileInfo ? <span className="small muted">{fileInfo.name}</span> : null}
              </div>
            ) : null}
            <textarea
              className="textarea"
              style={{ minHeight: 240 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={source === 'text' ? 'Paste the job offer here…' : 'The extracted offer text appears here. Check it and correct it if needed.'}
              aria-label="Job offer text"
              data-testid="offer-text"
            />
            <div className="small muted" style={{ textAlign: 'right', marginTop: 4 }}>
              {text.length} characters
            </div>
          </div>
        </section>

        <div className="col" style={{ gap: 16 }}>
          <section className="card surface" aria-label="Base CV">
            <h3 className="display" style={{ fontSize: 20 }}>Base CV</h3>
            <p className="small muted" style={{ marginBottom: 10 }}>Select a CV from your library as a starting point.</p>
            {cvs.length === 0 ? (
              <div className="notice warn">
                <Icon name="info" size={15} /> Create or import a CV first.
              </div>
            ) : (
              <select className="select" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base CV" data-testid="base-cv">
                {cvs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.description ? `— ${c.description}` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="notice peach" style={{ marginTop: 10 }}>
              <Icon name="info" size={15} />
              <span>
                <strong>Creates a new draft.</strong> {baseCv ? `“${baseCv.name}” remains unchanged.` : 'Your original CV remains unchanged.'} No AI runs until you ask.
              </span>
            </div>
          </section>
          <section className="card surface" aria-label="Details">
            <h3 className="display" style={{ fontSize: 20, marginBottom: 10 }}>Details</h3>
            <div className="form-grid">
              <label htmlFor="na-company">Company</label>
              <input id="na-company" className="input" value={company} onChange={(e) => { setCompany(e.target.value); touch('company'); }} data-testid="na-company" />
              <label htmlFor="na-role">Role</label>
              <input id="na-role" className="input" value={role} onChange={(e) => { setRole(e.target.value); touch('role'); }} data-testid="na-role" />
              <label htmlFor="na-loc">Location</label>
              <input id="na-loc" className="input" value={location} onChange={(e) => { setLocation(e.target.value); touch('location'); }} />
              <label htmlFor="na-lang">Language</label>
              <select id="na-lang" className="select" value={lang} onChange={(e) => { setLang(e.target.value as Lang); touch('lang'); }}>
                <option value="fr">French</option>
                <option value="en">English</option>
              </select>
            </div>
          </section>
          <div className="row">
            <span className="spacer" />
            <button type="button" className="btn btn-lg" onClick={() => navigate({ name: 'applications' })}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-lg" disabled={!canCreate || busy} onClick={() => void create()} data-testid="create-draft">
              {busy ? <span className="spinner" /> : null} Create draft <Icon name="forward" size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
