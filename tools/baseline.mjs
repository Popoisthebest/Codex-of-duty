import fs from 'node:fs';
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
  config,
  sourceIdentity,
} from './lib/common.mjs';

const outDir = process.env.COD_BASELINE_DIR || path.join(ARTIFACTS, 'baseline');
ensureDir(outDir);

await withDevServer(async () => {
  const browser = await launchBrowser();
  const manifest = {
    version: 2,
    seed: config.seed,
    width: config.width,
    height: config.height,
    dpr: config.dpr,
    settleFrames: config.settleFrames,
    sourceIdentity: sourceIdentity(),
    shots: [],
  };

  try {
    for (const shot of canonicalShots) {
      // Fresh context/page for every shot. This is intentional.
      const { page, context, errors } = await newHarnessPage(browser, { shot });
      await settle(page);

      const png = path.join(outDir, `${shot}.png`);
      await page.screenshot({ path: png });

      const evidence = await page.evaluate(() => ({
        snapshot: window.__COD_HARNESS__.snapshot(),
        metrics: window.__COD_HARNESS__.getMetrics(),
      }));

      assertNoBrowserErrors(errors);
      manifest.shots.push({ shot, evidence });
      fs.writeFileSync(
        path.join(outDir, `${shot}.json`),
        JSON.stringify(evidence, null, 2),
      );

      console.log(`baseline: ${shot}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Baseline complete -> ${outDir}`);
});
