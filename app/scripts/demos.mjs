// Captures each feature example (src/demos.tsx) as docs/features/<key>-<theme>.png for the README.
// Needs a running lgtm (LGTM_PORT if not 4517) and Google Chrome. Talks to Chrome over its DevTools protocol with
// Node's built-in WebSocket, so there's nothing to install. Chrome runs headless on a throwaway profile, then quits.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = `http://127.0.0.1:${process.env.LGTM_PORT ?? 4517}`;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEYS = ['sinceFirst', 'foldImports', 'hideGenerated', 'hideNoDiff', 'collapseDeleted', 'dimMoved', 'wordDiff', 'ignoreWs', 'richMarkdown', 'renderDocs', 'previewImages', 'foldBots', 'scene-queue', 'scene-review', 'scene-comment', 'scene-claude', 'scene-merge', 'scene-themes', 'scene-app'];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'features');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'lgtm-demos-'));
const PORT = 9333;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--window-size=1460,900', 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) pending.get(m.id)(m.result), pending.delete(m.id);
  });
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

  for (const theme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    for (const k of KEYS) {
      await send('Page.navigate', { url: `${ORIGIN}/#/demo/${k}/${theme}` });
      await sleep(900);
      const box = await evaluate(`(() => { const r = document.querySelector('.demo-page').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, captureBeyondViewport: true });
      writeFileSync(join(OUT, `${k}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`docs/features/${k}-${theme}.png`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
