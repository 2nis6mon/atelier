import { navigate } from '../../router';
import { LensTabs } from '../../ui/LensTabs';
import { CvsTab } from './CvsTab';
import { ExperienceTab } from './ExperienceTab';
import { SourcesTab } from './SourcesTab';

export function LibraryView({ tab, onNewCv }: { tab: 'cvs' | 'experience' | 'sources'; onNewCv: () => void }) {
  return (
    <div className="page" data-testid="library">
      <div className="page-head">
        <div className="grow">
          <h1 className="display page-title">{tab === 'experience' ? 'Build your professional library.' : 'A place for every opportunity.'}</h1>
          <p className="page-sub">{tab === 'experience' ? 'Reusable experiences, education, skills and more.' : 'Your CVs, applications and sent versions, together.'}</p>
        </div>
        <LensTabs
          label="Library sections"
          value={tab}
          onChange={(t) => navigate({ name: 'library', tab: t })}
          options={[
            { id: 'cvs', label: 'CVs' },
            { id: 'experience', label: 'Experience' },
            { id: 'sources', label: 'Sources' },
          ]}
        />
      </div>
      {tab === 'cvs' ? <CvsTab onNewCv={onNewCv} /> : null}
      {tab === 'experience' ? <ExperienceTab /> : null}
      {tab === 'sources' ? <SourcesTab /> : null}
    </div>
  );
}
