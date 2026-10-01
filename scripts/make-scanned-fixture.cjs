// Generates tests/fixtures/CV_scan.pdf: an image-only PDF (no text layer), like
// a scanned paper CV, to test on-device OCR. Synthetic, fictional content.
// Run with Electron (it renders the page):  npx electron scripts/make-scanned-fixture.cjs
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; width: 1240px; height: 1754px; background: #fbfaf7; color: #1d1d1d; font-family: 'DejaVu Sans', Helvetica, Arial, sans-serif; }
.page { padding: 110px 120px; transform: rotate(-0.4deg); }
h1 { font-size: 58px; margin: 0 0 8px; letter-spacing: 1px; }
h2 { font-size: 30px; margin: 46px 0 14px; border-bottom: 2px solid #333; padding-bottom: 6px; }
p, li { font-size: 27px; line-height: 1.5; margin: 0; }
.muted { color: #333; }
ul { margin: 6px 0 0 0; padding-left: 34px; }
</style></head><body><div class="page">
<h1>Camille Laurent</h1>
<p class="muted">Développeuse Frontend</p>
<p class="muted">Paris, France · camille.laurent@example.com</p>
<h2>PROFIL</h2>
<p>Développeuse frontend passionnée par les interfaces accessibles.</p>
<h2>EXPÉRIENCE PROFESSIONNELLE</h2>
<p><b>Atelier Nova</b> — Paris, France</p>
<p>Développeuse Frontend</p>
<p>2021 – 2023</p>
<ul><li>Interfaces React et TypeScript.</li><li>Tests et documentation des composants.</li></ul>
<h2>FORMATION</h2>
<p><b>Université de Lyon</b></p>
<p>Master Informatique</p>
<p>2019</p>
</div></body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 1754, show: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1240, height: 1754 });
  const png = image.toPNG();
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-01-15T10:00:00Z'));
  pdf.setModificationDate(new Date('2026-01-15T10:00:00Z'));
  pdf.setProducer('Atelier fixtures (scanned)');
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  writeFileSync(join(__dirname, '..', 'tests', 'fixtures', 'CV_scan.pdf'), await pdf.save());
  console.log('wrote tests/fixtures/CV_scan.pdf');
  app.quit();
});
