import { useEffect, useState } from 'react';
import type { Lang, TemplateId } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { navigate } from '../../router';
import { toastError } from '../../state/app';
import { Dialog } from '../../ui/Dialog';
import { LensTabs } from '../../ui/LensTabs';

export function NewCvDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('General CV');
  const [lang, setLang] = useState<Lang>('fr');
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [fromLibrary, setFromLibrary] = useState(true);
  const [recordCount, setRecordCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api()
      .library.records()
      .then((r) => {
        setRecordCount(r.length);
        if (r.length === 0) setFromLibrary(false);
      });
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const cv = await unwrap(api().cvs.create({ name, lang, template, fromLibrary }));
      onClose();
      navigate({ name: 'workspace', id: cv.id, mode: 'content' });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New CV"
      subtitle="A CV holds its own copy of your content. Editing it never changes your library."
      onClose={onClose}
      narrow
      testId="new-cv-dialog"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim()} data-testid="create-cv">
            Create CV
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="new-cv-name">Name</label>
          <input id="new-cv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </div>
        <div className="field">
          <span className="label" id="lang-label">Language</span>
          <LensTabs role="radio" label="Language" value={lang} onChange={setLang} options={[{ id: 'fr', label: 'French' }, { id: 'en', label: 'English' }]} />
        </div>
        <div className="field">
          <span className="label">Template</span>
          <LensTabs role="radio" label="Template" value={template} onChange={setTemplate} options={[{ id: 'classic', label: 'Classic' }, { id: 'sidebar', label: 'Sidebar' }, { id: 'compact', label: 'Compact' }]} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={fromLibrary} disabled={recordCount === 0} onChange={(e) => setFromLibrary(e.target.checked)} />
          Start with my library content ({recordCount} record{recordCount === 1 ? '' : 's'})
        </label>
      </div>
    </Dialog>
  );
}
