import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, ensureDir } from './lib/common.mjs';

const outDir = path.join(ARTIFACTS, 'character');
ensureDir(outDir);

// Every frame here is the production character reacting through the production
// damage and movement systems. `frames` selects how far into the reaction the
// shutter opens; nothing is posed directly.
const POSES = [
  ['01-stand', { pose: 'stand', frames: 6 }],
  ['02-walk', { pose: 'walk', frames: 34 }],
  ['03-run', { pose: 'run', frames: 34 }],
  ['04-aim', { pose: 'aim', frames: 14 }],
  ['04b-fire', { pose: 'fire', frames: 4 }],
  ['04c-aim-move', { pose: 'aim-move', frames: 30 }],
  ['04d-decel', { pose: 'decel', frames: 12 }],
  ['04e-hit-torso', { pose: 'hit', frames: 3 }],
  ['05-hit-head', { pose: 'headshot', frames: 3 }],
  ['06-collapse-early', { pose: 'collapse', frames: 6 }],
  ['07-collapse-mid', { pose: 'collapse', frames: 18 }],
  ['08-dead-final', { pose: 'dead', frames: 60 }],
];

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context } = await newHarnessPage(browser, {});
    for (const [name, options] of POSES) {
      const state = await page.evaluate(async (o) => {
        const r = await window.__COD_HARNESS__.runAction('stage_character', o);
        return r?.subject ?? null;
      }, options);
      // No settle: the engine is left paused by the action so the frame captured
      // is exactly the frame that was staged.
      if (state) console.log(`  pose rotZ=${state.rotZ} rotX=${state.rotX} y=${state.y} speed=${state.speed} alive=${state.alive}`);
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      console.log(`character: ${name}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
