import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, settle, ensureDir } from './lib/common.mjs';

const outDir = path.join(ARTIFACTS, 'boundary');
ensureDir(outDir);

// Both sides of every opening added to the market/east-terrace boundary, from
// player eye height, plus the approach views a player actually gets.
const EAST = -Math.PI / 2;   // forward = +x
const WEST = Math.PI / 2;    // forward = -x
const SHOTS = [
  // Looking from the gate line back into the yard, which is where the rear
  // staging reads; standing against the back wall only frames the wall.
  ['zone-alpha-yard-mid', -2, 0, 22, Math.PI - 0.12],
  ['zone-alpha-yard-bay', 12, 0, 26, Math.PI - 0.5],
  ['zone-perimeter-west', -44, 0, 10, Math.PI / 2],
  ['zone-bravo-mast', 6, 0, -47, 0.35],
  ['zone-north-junction', 0, 0, -32, 0],
  ['zone-north-junction-open', 0, 0, -28, Math.PI],
  ['zone-market-spine', 0, 0, 8, 0],
  ['zone-east-terrace-deck', 22, 1.5, 2, Math.PI / 2],
  ['zone-depot-interior', -30, 0, 0, -Math.PI / 2],
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
