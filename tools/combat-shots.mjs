import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, settle, ensureDir } from './lib/common.mjs';

const outDir = path.join(ARTIFACTS, 'combat');
ensureDir(outDir);

// Drive a real engagement and photograph it over time, so hit reaction and the
// death collapse can be judged as motion rather than as a single pose.
await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context } = await newHarnessPage(browser, {});
    await page.evaluate(async () => {
      await window.__COD_HARNESS__.setShot('combat');
    });
    for (let step = 0; step < 6; step += 1) {
      await page.evaluate(async () => {
        await window.__COD_HARNESS__.runAction('engage_enemy', { frames: 22 });
      });
      await settle(page);
      await page.screenshot({ path: path.join(outDir, `engage-${step}.png`) });
      console.log(`combat: engage-${step}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
