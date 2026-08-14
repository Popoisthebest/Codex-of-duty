import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS,
  withDevServer,
  launchBrowser,
  newHarnessPage,
  settle,
  ensureDir,
  assertNoBrowserErrors,
} from './lib/common.mjs';

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const shot = arg('shot', 'overview');
const out = arg('out', path.join(ARTIFACTS, 'captures', `${shot}.png`));
const scenario = arg('scenario', 'default');

ensureDir(path.dirname(out));

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, { shot, scenario });
    await settle(page);

    await page.screenshot({ path: out, fullPage: false });
    const state = await page.evaluate(() => ({
      snapshot: window.__COD_HARNESS__.snapshot(),
      metrics: window.__COD_HARNESS__.getMetrics(),
    }));

    assertNoBrowserErrors(errors);
    fs.writeFileSync(out.replace(/\.png$/i, '.json'), JSON.stringify(state, null, 2));
    console.log(`Captured ${shot} -> ${out}`);

    await context.close();
  } finally {
    await browser.close();
  }
});
