import { setTemplate } from '../../../shared/document';
import { TEMPLATES } from '../../../shared/templates';
import type { TemplateId } from '../../../shared/types';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { PageInfo } from './StylePanel';

function TemplatePreview({ id }: { id: TemplateId }) {
  return (
    <svg viewBox="0 0 60 80" width="54" height="72" aria-hidden="true">
      <rect x="1" y="1" width="58" height="78" rx="3" fill="#fffdfa" stroke="rgba(32,43,59,.2)" />
      <rect x="7" y="7" width="26" height="4" rx="1" fill="#1f2a44" />
      <rect x="7" y="13" width="18" height="2" rx="1" fill="#a84f36" />
      {id === 'sidebar' ? (
        <>
          <rect x="38" y="20" width="16" height="54" rx="2" fill="#f6e3d6" />
          {[22, 30, 38, 46].map((y) => (
            <rect key={y} x="7" y={y} width="27" height="3" rx="1" fill="rgba(32,43,59,.3)" />
          ))}
        </>
      ) : (
        [20, 27, 34, 41, 48, 55, 62].map((y) => <rect key={y} x={id === 'classic' ? 16 : 7} y={y} width={id === 'classic' ? 37 : 46} height={id === 'compact' ? 2.5 : 3} rx="1" fill="rgba(32,43,59,.3)" />)
      )}
    </svg>
  );
}

export function LayoutPanel() {
  const doc = useWorkspace(selectDoc)!;
  const edit = useWorkspace((s) => s.edit);
  return (
    <div className="assistant" data-testid="layout-panel">
      <h2 className="section-title">Templates</h2>
      <div className="templates" role="radiogroup" aria-label="Template">
        {(Object.keys(TEMPLATES) as TemplateId[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={doc.template === t}
            className={`template-card ${doc.template === t ? 'on' : ''}`}
            onClick={() => edit((d) => setTemplate(d, t), `Template: ${TEMPLATES[t].label}`)}
            data-testid={`template-${t}`}
          >
            <TemplatePreview id={t} />
            <span>
              <strong style={{ display: 'block' }}>{TEMPLATES[t].label}</strong>
              <span className="small muted">{TEMPLATES[t].description}</span>
            </span>
            {doc.template === t ? <Icon name="check" size={15} /> : null}
          </button>
        ))}
      </div>
      <div className="notice">
        <Icon name="info" size={15} />
        <span>Arrange sections in the left panel: drag them, or use ⌥ + arrows. Hidden sections stay in this CV but are not exported.</span>
      </div>
      <PageInfo />
    </div>
  );
}
