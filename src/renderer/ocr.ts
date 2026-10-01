// On-device text recognition for scanned PDFs: pdf.js renders each page to a
// canvas and Tesseract (WebAssembly, French + English models bundled with the
// app) reads it. Nothing leaves the Mac.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import { normalizeOcrText } from '../shared/ocrText';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const OCR_MAX_PAGES = 8;

export async function ocrPdf(bytes: Uint8Array, onProgress: (fraction: number, label: string) => void, signal?: AbortSignal): Promise<string> {
  const base = new URL('./ocr/', window.location.href).href;
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true });
  const pdf = await task.promise;
  const pages = Math.min(pdf.numPages, OCR_MAX_PAGES);
  let page = 0;
  const worker = await createWorker(['fra', 'eng'], 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress((page + m.progress) / pages, `Reading page ${page + 1} of ${pages}`);
    },
  });
  try {
    const texts: string[] = [];
    for (page = 0; page < pages; page++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      onProgress(page / pages, `Preparing page ${page + 1} of ${pages}`);
      const p = await pdf.getPage(page + 1);
      const viewport = p.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvas, canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      texts.push(data.text.trim());
      p.cleanup();
    }
    onProgress(1, 'Done');
    return normalizeOcrText(texts.join('\n\n'));
  } finally {
    await worker.terminate();
    await task.destroy();
  }
}
