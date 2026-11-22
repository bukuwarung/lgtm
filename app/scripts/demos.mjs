// Captures each feature example (src/demos.tsx) as docs/features/<key>-<theme>.png for the README.
// Needs a running lgtm (LGTM_PORT if not 4517) and Playwright's WebKit, the Mac app's engine (npx playwright-core install
// webkit). Give keys to capture only those (node scripts/demos.mjs scene-claude).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright-core';

const ORIGIN = `http://127.0.0.1:${process.env.LGTM_PORT ?? 4517}`;
const KEYS = ['sinceFirst', 'foldImports', 'hideGenerated', 'hideNoDiff', 'collapseDeleted', 'dimMoved', 'wordDiff', 'ignoreWs', 'richMarkdown', 'renderDocs', 'previewImages', 'foldBots', 'readingOrder', 'agentReview', 'agentThreads', 'scene-queue', 'scene-review', 'scene-comment', 'scene-claude', 'scene-merge', 'scene-themes', 'scene-reviewmode', 'scene-specs', 'scene-strings', 'scene-inbox', 'scene-app'];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'features');
mkdirSync(OUT, { recursive: true });

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1460, height: 900 } });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const k of process.argv.length > 2 ? process.argv.slice(2) : KEYS) {
      await page.goto(`${ORIGIN}/#/demo/${k}/${theme}`);
      await page.waitForTimeout(900);
      await page.locator('.demo-page').screenshot({ path: join(OUT, `${k}-${theme}.png`) });
      console.log(`docs/features/${k}-${theme}.png`);
    }
  }
} finally {
  await browser.close();
}
