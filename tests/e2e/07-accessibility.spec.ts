// Journey 7 — keyboard, visible focus, menus, dialogs, reduced motion,
// reduced transparency and compact windows.
import { expect, test, type Page } from '@playwright/test';
import { importFiles, launch, openCv } from './harness';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const focusRing = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, ring: cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px') };
  });

const lensAnimations = (win: Page) =>
  win.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target instanceof HTMLElement && ((a.effect as KeyframeEffect).target as HTMLElement).classList.contains('lens')).length);

const noHorizontalOverflow = (win: Page) => win.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test('keyboard, focus, menus and accessibility preferences', async () => {
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx', 'CV_EN.pdf']);

  // Every Tab stop shows a visible focus ring.
  await win.locator('body').click({ position: { x: 5, y: 300 } });
  for (let i = 0; i < 8; i++) {
    await win.keyboard.press('Tab');
    const f = await focusRing(win);
    expect(f, `tab stop ${i}`).not.toBeNull();
    expect(f!.ring, `focus ring on ${f!.tag} (stop ${i})`).toBe(true);
  }

  // Tabs: arrow keys move the single selection lens; shortcuts switch areas.
  await win.getByRole('tab', { name: 'Library' }).focus();
  await win.keyboard.press('ArrowRight');
  await expect(win.getByRole('tab', { name: 'Applications' })).toHaveAttribute('aria-selected', 'true');
  await expect(win.getByTestId('applications')).toBeVisible();
  expect(await lensAnimations(win)).toBeGreaterThan(0); // the lens glides
  await win.keyboard.press(`${MOD}+1`);
  await expect(win.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
  await win.keyboard.press(`${MOD}+,`);
  await expect(win.getByTestId('settings')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('settings')).toHaveCount(0);

  // Menus: open from the keyboard, arrow through items, Escape returns focus to the trigger.
  const trigger = win.locator('.cv-card').first().getByRole('button', { name: /actions/i });
  await trigger.focus();
  await win.keyboard.press('Enter');
  const menu = win.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await win.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
  await s.shot('60-menu-keyboard');
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Dialogs trap focus.
  await win.getByTestId('new-cv').click();
  const dialog = win.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await win.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await win.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Reduced motion and reduced transparency (in-app settings; "Follow macOS" is the default).
  await win.keyboard.press(`${MOD}+,`);
  await win.getByRole('tab', { name: 'Accessibility' }).click();
  await win.getByRole('radiogroup', { name: 'Reduce motion' }).getByRole('radio', { name: 'On' }).click();
  await win.getByRole('radiogroup', { name: 'Reduce transparency' }).getByRole('radio', { name: 'On' }).click();
  await expect(win.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await expect(win.locator('html')).toHaveAttribute('data-transparency', 'reduce');
  await s.shot('61-accessibility-settings');
  await win.keyboard.press('Escape');
  await win.getByRole('tab', { name: 'Applications' }).click();
  expect(await lensAnimations(win)).toBe(0); // the lens jumps without animating
  const glass = await win.locator('.topbar .lens-tabs').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { filter: cs.backdropFilter, bg: cs.backgroundColor };
  });
  expect(glass.filter === 'none' || /blur\(0px\)/.test(glass.filter)).toBe(true);
  expect(glass.bg).toMatch(/^rgb\(/); // opaque colour, no alpha
  await win.getByRole('tab', { name: 'Library' }).click();
  await s.shot('62-reduced-transparency');

  // Compact window: no horizontal scrolling, the editor stays usable.
  await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600));
  await win.waitForTimeout(400);
  expect(await noHorizontalOverflow(win)).toBe(true);
  await s.shot('63-compact-library');
  await openCv(s, 'CV_FR');
  expect(await noHorizontalOverflow(win)).toBe(true);
  await expect(win.locator('.ws-left')).toBeHidden(); // sections panel starts closed when narrow
  await expect(win.getByRole('tablist', { name: 'Workspace mode' })).toBeVisible();
  await expect(win.getByTestId('export')).toBeVisible();
  await s.shot('64-compact-editor');
  await win.getByRole('button', { name: 'Sections' }).click();
  await expect(win.locator('.ws-left')).toBeVisible();
  await s.close();
});
