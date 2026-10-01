import { BLOCK_TITLES } from '../../../shared/templates';
import type { AiRequestInput, BlockType, Cv, CvDocument, Lang } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { navigate } from '../../router';
import { toast, toastError } from '../../state/app';
import { useWorkspace } from '../../state/workspace';

/** Standard section titles switch language deterministically; custom titles are kept. */
export function translateStandardTitles(doc: CvDocument, to: Lang): CvDocument {
  const from = doc.lang;
  return {
    ...doc,
    lang: to,
    blocks: doc.blocks.map((b) => (b.title === BLOCK_TITLES[from][b.type as BlockType] ? { ...b, title: BLOCK_TITLES[to][b.type as BlockType] } : b)),
  };
}

/**
 * Creates a separate CV in the other language (the original is untouched),
 * then asks the AI to propose translations for review.
 */
export async function createTranslatedVersion(cv: Cv, doc: CvDocument, runAi: (r: AiRequestInput) => Promise<void>) {
  const to: Lang = doc.lang === 'fr' ? 'en' : 'fr';
  try {
    await useWorkspace.getState().flush();
    // A translated copy of an application's CV stays attached to that application.
    const copy = await unwrap(api().cvs.duplicate(cv.id, `${cv.name} (${to.toUpperCase()})`, true));
    await unwrap(api().cvs.updateMeta(copy.id, { lang: to }));
    await unwrap(api().cvs.save(copy.id, translateStandardTitles(copy.document, to), copy.revision));
    navigate({ name: 'workspace', id: copy.id, mode: 'content' });
    toast({ kind: 'info', text: `Created “${copy.name}”. Translation suggestions will appear for review; nothing is changed until you accept.` });
    setTimeout(() => {
      if (useWorkspace.getState().cvId === copy.id) {
        void runAi({ action: 'translate', scope: { type: 'cv', target: null, selectionText: '' }, tone: null, targetLang: to, instructions: '', includeOffer: false, libraryRecordIds: [] });
      }
    }, 600);
  } catch (e) {
    toastError(e);
  }
}
