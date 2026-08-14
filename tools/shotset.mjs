import path from 'node:path';
import {
  ARTIFACTS,
  canonicalShots,
  withDevServer,
  launchBrowser,
  newHarnessPage,
  settle,
  ensureDir,
  assertNoBrowserErrors,
} from './lib/common.mjs';

const outDir = process.env.COD_SHOTSET_DIR || path.join(ARTIFACTS, 'shotset');
ensureDir(outDir);

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, { shot: canonicalShots[0] });

    for (const shot of canonicalShots) {
      await page.evaluate(async (name) => {
        await window.__COD_HARNESS__.setShot(name);
      }, shot);
      await settle(page);
      await page.screenshot({ path: path.join(outDir, `${shot}.png`) });
      console.log(`shotset: ${shot}`);
    }

    assertNoBrowserErrors(errors);
    await context.close();
  } finally {
    await browser.close();
  }
});
