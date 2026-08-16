import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, settle, ensureDir } from './lib/common.mjs';

const outDir = path.join(ARTIFACTS, 'boundary');
ensureDir(outDir);

// Both sides of every opening added to the market/east-terrace boundary, from
// player eye height, plus the approach views a player actually gets.
const EAST = -Math.PI / 2;   // forward = +x
const WEST = Math.PI / 2;    // forward = -x
const SHOTS = [
  ['breach-market-approach', 4.0, 0, -14.3, EAST],
  ['breach-terrace-side', 14.5, 0, -14.3, WEST],
  ['breach-mouth', 9.35, 0, -14.3, EAST],
  ['window-slot-market', 5.0, 0, -9.7, EAST],
  ['window-slot-terrace', 14.0, 0, -9.7, WEST],
  ['north-steps-market', 11.0, 0, 11.5, EAST],
  ['north-steps-deck', 17.0, 1.5, 11.5, WEST],
  ['deck-overlook-market', 16.5, 1.5, 4.0, WEST],
  ['offices-band-terrace', 16.0, 1.5, -5.0, EAST],
];

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context } = await newHarnessPage(browser, {});
    for (const [name, x, y, z, yaw] of SHOTS) {
      await page.evaluate(async (o) => {
        await window.__COD_HARNESS__.runAction('inspect_from', o);
      }, { x, y, z, yaw, frames: 12 });
      await settle(page);
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      console.log(`boundary: ${name}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
