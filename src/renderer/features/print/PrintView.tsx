import { useCallback, useEffect, useRef, useState } from 'react';
import type { CvDocument } from '../../../shared/types';
import { api } from '../../api';
import { CvPages, type LayoutInfo } from '../../cv/CvPages';

/** Hidden window used by the main process to print the CV to PDF. */
export function PrintView({ token }: { token: string }) {
  const [doc, setDoc] = useState<CvDocument | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add('printing');
    void api()
      .print.payload(token)
      .then((p) => setDoc(p?.document ?? null));
  }, [token]);

  const onLayout = useCallback(
    (info: LayoutInfo) => {
      if (sent.current || !info.ready) return;
      // Wait one frame so the final spacers are painted before printing.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (sent.current) return;
          sent.current = true;
          api().print.ready(token, { pageCount: info.pageCount, tooTall: info.tooTall.length });
        }),
      );
    },
    [token],
  );

  if (!doc) return null;
  return (
    <div className="print-root">
      <CvPages doc={doc} print onLayout={onLayout} />
    </div>
  );
}
