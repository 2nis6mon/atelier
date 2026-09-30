import { memo } from 'react';
import type { CvDocument } from '../../shared/types';
import { CvPages, PAGE_H, PAGE_W } from './CvPages';

/** Real render of the first page, scaled down (no screenshots, no images). */
export const CvThumb = memo(function CvThumb({ doc, width = 160 }: { doc: CvDocument; width?: number }) {
  const scale = width / PAGE_W;
  return (
    <div className="cv-thumb" aria-hidden="true">
      <div style={{ width, height: PAGE_H * scale, overflow: 'hidden', borderRadius: 3, boxShadow: 'var(--shadow-card)' }}>
        <div className="cv-thumb-inner" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_W }}>
          <CvPages doc={doc} print />
        </div>
      </div>
    </div>
  );
});
