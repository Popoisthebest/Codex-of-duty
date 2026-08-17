import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, ensureDir } from './lib/common.mjs';

const outDir = path.join(ARTIFACTS, 'weapon');
ensureDir(outDir);

// Each state is reached by driving production inputs; no viewmodel pose is
// written for the camera. The engine is left paused so the frame captured is
// exactly the frame staged.
const POSES = [
  ['01-hip-idle', { pose: 'hip-idle', frames: 8 }],
  ['02-walk', { pose: 'walk', frames: 40 }],
  ['03-sprint', { pose: 'sprint', frames: 40 }],
  ['04-ads-in', { pose: 'ads-in', frames: 4 }],
  ['05-ads-idle', { pose: 'ads-idle', frames: 40 }],
  ['06-shot', { pose: 'shot', frames: 3 }],
  ['07-burst', { pose: 'burst', frames: 24 }],
  ['08-recovery', { pose: 'recovery', frames: 10 }],
  ['09-ads-shot', { pose: 'ads-shot', frames: 3 }],
  // Reload frames are chosen to land on the staged beats of the 1.95 s cycle:
  // magazine out (~t 0.15), held clear (~t 0.4), charging handle (~t 0.85).
  ['10-reload-magout', { pose: 'reload', frames: 18 }],
  ['11-reload-held', { pose: 'reload', frames: 47 }],
  ['12-reload-rack', { pose: 'reload', frames: 100 }],
  ['13-turn', { pose: 'turn', frames: 10 }],
  ['14-landing', { pose: 'landing', frames: 30 }],
];

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context } = await newHarnessPage(browser, {});
    for (const [name, options] of POSES) {
      const state = await page.evaluate(async (o) => {
        const r = await window.__COD_HARNESS__.runAction('stage_weapon', o);
        return r?.weapon ?? null;
      }, options);
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      console.log(`weapon: ${name}${state ? `  ammo=${state.ammo} reloading=${state.reloading} ads=${(state.adsBlend ?? 0).toFixed(2)}` : ''}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
