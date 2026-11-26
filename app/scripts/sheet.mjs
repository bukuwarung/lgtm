// The review sheet: every Settings preview, every scene and the main screens, light and dark, side by side on one page
// to scan for what looks off (review-sheet/index.html, opened in your browser). Local only, git ignores it: the live
// screens show your PRs. Needs a running LGTM (LGTM_PORT, else 4517) and Playwright's WebKit, the Mac app's engine.
// SHEET_PR: a PR to include ("owner/repo/pull/n"), else the list's first. Only opens menus and panels; sends nothing.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright-core';

const ORIGIN = `http://127.0.0.1:${process.env.LGTM_PORT ?? 4517}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'review-sheet');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'img'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = new Map(); // "group|name" -> { light, dark }
const keep = (group, name, theme, file) => {
  const k = `${group}|${name}`;
  shots.set(k, { ...(shots.get(k) ?? {}), [theme]: file });
};

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${ORIGIN}/#/demo/_keys`);
  await page.evaluate(() => (localStorage.setItem('setupSeen', '1'), localStorage.setItem('seenVersion', '9.9.9'), localStorage.removeItem('theme')));
  await page.goto(`${ORIGIN}/?k#/demo/_keys`);
  const { demos, scenes } = JSON.parse(await page.locator('#demo-keys').textContent());
  let n = 0;
  const shoot = async (group, name, theme, target) => {
    const file = `img/${++n}.png`;
    await (target ?? page).screenshot({ path: join(OUT, file) });
    keep(group, name, theme, file);
  };
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const k of demos) {
      await page.goto(`${ORIGIN}/?${theme}#/demo/${k}/${theme}`);
      await sleep(500);
      await shoot('Settings previews', k, theme, page.locator('.demo-page'));
    }
    for (const k of scenes) {
      await page.goto(`${ORIGIN}/?${theme}#/demo/scene-${k}/${theme}`);
      await sleep(600);
      await shoot('Scenes', k, theme, page.locator('.demo-page'));
    }
    // The app itself, as you use it.
    await page.goto(`${ORIGIN}/?${theme}live#/`);
    await page.waitForSelector('.pr-item, .empty', { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    for (const [name, route] of [['Start page', '#/'], ['Inbox', '#/inbox'], ['Your reviews', '#/history'], ['Settings', '#/settings']]) {
      await page.evaluate((r) => (location.hash = r), route);
      await sleep(3500);
      await shoot('Screens', name, theme);
    }
    const pr = process.env.SHEET_PR ?? (await page.evaluate(() => document.querySelector('a.pr-item')?.getAttribute('href')?.replace(/^#\//, '')));
    if (pr) {
      await page.evaluate((r) => (location.hash = '/' + r), pr);
      await page.waitForSelector('.file, .conversation', { timeout: 30000 }).catch(() => {});
      await sleep(2500);
      await shoot('Screens', 'A PR', theme);
      // Its menus and panels, opened only.
      for (const [name, re] of [['A PR: ⋯ menu', 'Close, reopen'], ['A PR: Finish review', '^(Finish review|Comment|Approve)']]) {
        const ok = await page.evaluate((re) => { const b = [...document.querySelectorAll('.bar button')].find((x) => new RegExp(re).test(x.title || '') || new RegExp(re).test(x.textContent.trim())); if (!b) return false; b.click(); return true; }, re);
        if (!ok) continue;
        await sleep(500);
        await shoot('Screens', name, theme);
        await page.keyboard.press('Escape');
        await sleep(300);
      }
    }
  }
} finally {
  await browser.close();
}

const groups = [...new Set([...shots.keys()].map((k) => k.split('|')[0]))];
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>LGTM review sheet</title>
<style>
body { margin: 24px; font: 14px/1.4 -apple-system, system-ui, sans-serif; background: #f3f4f6; color: #1f2328; }
h1 { margin: 0 0 4px; font-size: 22px; } h2 { margin: 32px 0 12px; font-size: 16px; }
p { margin: 0 0 16px; color: #59636e; }
nav a { margin-right: 12px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.name { grid-column: 1 / -1; font-weight: 600; font-family: ui-monospace, monospace; font-size: 12px; }
img { width: 100%; border: 1px solid #d1d9e0; border-radius: 6px; background: #fff; }
.dark img { background: #000; }
</style>
<h1>LGTM review sheet</h1>
<p>${new Date().toLocaleString()} · light on the left, dark on the right · ${shots.size} screens</p>
<nav>${groups.map((g) => `<a href="#${esc(g)}">${esc(g)}</a>`).join('')}</nav>
${groups.map((g) => `<h2 id="${esc(g)}">${esc(g)}</h2>${[...shots].filter(([k]) => k.startsWith(g + '|')).map(([k, v]) => `<div class="row"><div class="name">${esc(k.split('|')[1])}</div><div>${v.light ? `<img loading="lazy" src="${v.light}">` : ''}</div><div class="dark">${v.dark ? `<img loading="lazy" src="${v.dark}">` : ''}</div></div>`).join('')}`).join('')}
`);
console.log(`review-sheet/index.html: ${shots.size} screens`);
