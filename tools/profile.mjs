import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS,
  withDevServer,
  launchBrowser,
  newHarnessPage,
  ensureDir,
  assertNoBrowserErrors,
  envNumber,
  summarize,
  config,
} from './lib/common.mjs';

const frames = envNumber('COD_PROFILE_FRAMES', 900);
const warmup = envNumber('COD_PROFILE_WARMUP', 120);
const outDir = process.env.COD_PROFILE_DIR || path.join(ARTIFACTS, 'profiles');
ensureDir(outDir);

await withDevServer(async () => {
  const browser = await launchBrowser();

  try {
    const { page, context, errors } = await newHarnessPage(browser, {
      shot: 'combat',
      scenario: 'profile',
    });

    const result = await page.evaluate(async ({ warmup, frames }) => {
      const h = window.__COD_HARNESS__;

      if (typeof h.runAction === 'function') {
        await h.runAction('profile_motion_start', { frames: warmup });
      } else {
        await h.stepFrames(warmup);
      }

      const durations = [];
      const metricsSamples = [];
      let previous = performance.now();

      for (let i = 0; i < frames; i += 1) {
        await new Promise((resolve) => requestAnimationFrame((now) => {
          durations.push(now - previous);
          previous = now;
          resolve();
        }));

        if (typeof h.runAction === 'function' && i % 120 === 0) {
          await h.runAction('profile_pulse', { frames: 1, index: i });
        }

        if (i % 30 === 0) {
          metricsSamples.push({
            frame: i,
            metrics: h.getMetrics(),
          });
        }
      }

      return {
        durations,
        metricsSamples,
        finalMetrics: h.getMetrics(),
        snapshot: h.snapshot(),
      };
    }, { warmup, frames });

    assertNoBrowserErrors(errors);

    const s = summarize(result.durations);
    const report = {
      settings: {
        url: config.url,
        width: config.width,
        height: config.height,
        dpr: config.dpr,
        warmup,
        frames,
      },
      frameMs: s,
      approxFps: {
        p50: s.p50 ? 1000 / s.p50 : null,
        p95FrameEquivalent: s.p95 ? 1000 / s.p95 : null,
        p99FrameEquivalent: s.p99 ? 1000 / s.p99 : null,
      },
      longFrames: {
        over33_3ms: result.durations.filter((x) => x > 33.3).length,
        over50ms: result.durations.filter((x) => x > 50).length,
        over100ms: result.durations.filter((x) => x > 100).length,
      },
      finalMetrics: result.finalMetrics,
      metricsSamples: result.metricsSamples,
      snapshot: result.snapshot,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(outDir, `profile-${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));

    console.log(JSON.stringify(report, null, 2));
    console.log(`Profile saved -> ${out}`);

    await context.close();
  } finally {
    await browser.close();
  }
});
