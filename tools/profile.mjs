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
  sourceIdentity,
} from './lib/common.mjs';

const frames = envNumber('COD_PROFILE_FRAMES', 900);
const warmup = envNumber('COD_PROFILE_WARMUP', 120);
const headed = process.env.COD_PROFILE_HEADED === '1';
const outDir = process.env.COD_PROFILE_DIR || path.join(ARTIFACTS, 'profiles');
ensureDir(outDir);

await withDevServer(async () => {
  const browser = await launchBrowser({ headless: !headed });

  try {
    const { page, context, errors } = await newHarnessPage(browser, {
      shot: 'combat',
      scenario: 'profile',
    });
    if (headed) await page.bringToFront();

    const result = await page.evaluate(async ({ warmup, frames }) => {
      const h = window.__COD_HARNESS__;
      const navigation = performance.getEntriesByType('navigation')[0];
      const boot = {
        harnessReadyMs: performance.now(),
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
        loadEventMs: navigation?.loadEventEnd ?? null,
      };

      if (typeof h.runAction === 'function') {
        await h.runAction('profile_motion_start', { frames: warmup });
      } else {
        await h.stepFrames(warmup);
      }

      const durations = [];
      const stepCpuMs = [];
      const frameRecords = [];
      const metricsSamples = [];
      const actionMarkers = [{ frame: 0, action: 'sprint' }];
      // Prime several RAFs after synchronous warmup. Headless Chromium can defer
      // the first callback while it presents the warmup batch; recording that
      // boundary would attribute host scheduling time to gameplay frame zero.
      let previous = performance.now();
      for (let i = 0; i < 4; i += 1) previous = await new Promise((resolve) => requestAnimationFrame(resolve));

      for (let i = 0; i < frames; i += 1) {
        if (typeof h.runAction === 'function') {
          if (i === Math.floor(frames * 0.25)) {
            await h.runAction('profile_combat_start', { frames: 1 });
            actionMarkers.push({ frame: i, action: 'ads_fire' });
          } else if (i === Math.floor(frames * 0.5)) {
            await h.runAction('profile_reload', { frames: 1 });
            actionMarkers.push({ frame: i, action: 'reload' });
          } else if (i === Math.floor(frames * 0.75)) {
            await h.runAction('profile_ai_only', { frames: 1 });
            actionMarkers.push({ frame: i, action: 'ai_only' });
          }
        }

        let rafMs = 0;
        await new Promise((resolve) => requestAnimationFrame((now) => {
          rafMs = now - previous;
          durations.push(rafMs);
          previous = now;
          resolve();
        }));

        // Harness mode intentionally has no autonomous simulation loop. Advance one
        // deterministic gameplay frame per measured RAF so the profile includes real
        // movement, AI, weapon, FX, HUD, and rendering work rather than compositor idle.
        const cpuStart = performance.now();
        await h.stepFrames(1);
        const cpuMs = performance.now() - cpuStart;
        stepCpuMs.push(cpuMs);
        frameRecords.push({ frame: i, rafMs, stepCpuMs: cpuMs });

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
        boot,
        durations,
        stepCpuMs,
        frameRecords,
        actionMarkers,
        metricsSamples,
        finalMetrics: h.getMetrics(),
        snapshot: h.snapshot(),
      };
    }, { warmup, frames });

    assertNoBrowserErrors(errors);

    // IMPORTANT: this tool drives the deterministic harness. It awaits a rAF and
    // then runs a gameplay frame in a promise continuation *after* the callback
    // returns, so the interval between callbacks includes promise scheduling and
    // whole vsync intervals missed by the harness driver, not by the game. Those
    // deltas are reported as `harnessRafDeltaMs` and must not be read as frame
    // time. For production frame time use `npm run harness:frame`, which measures
    // the real Engine.start() loop and reported 0 frames over 25 ms where this
    // tool reported a p95 of ~34 ms on the same build.
    const s = summarize(result.durations);
    const cpu = summarize(result.stepCpuMs);
    const report = {
      sourceIdentity: sourceIdentity(),
      settings: {
        url: config.url,
        width: config.width,
        height: config.height,
        dpr: config.dpr,
        headed,
        warmup,
        frames,
      },
      harnessRafDeltaMs: s,
      stepCpuMs: cpu,
      note: 'harnessRafDeltaMs measures the harness stepping loop, not production frame time. Use npm run harness:frame for that.',
      longHarnessDeltas: {
        over33_3ms: result.durations.filter((x) => x > 33.3).length,
        over50ms: result.durations.filter((x) => x > 50).length,
        over100ms: result.durations.filter((x) => x > 100).length,
      },
      finalMetrics: result.finalMetrics,
      boot: result.boot,
      actionMarkers: result.actionMarkers,
      frameRecords: result.frameRecords,
      metricsSamples: result.metricsSamples,
      snapshot: result.snapshot,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(outDir, `profile-${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
      settings: report.settings,
      harnessRafDeltaMs: report.harnessRafDeltaMs,
      stepCpuMs: report.stepCpuMs,
      longHarnessDeltas: report.longHarnessDeltas,
      note: report.note,
      finalMetrics: report.finalMetrics,
      boot: report.boot,
      actionMarkers: report.actionMarkers,
      snapshot: report.snapshot,
    }, null, 2));
    console.log(`Profile saved -> ${out}`);

    await context.close();
  } finally {
    await browser.close();
  }
});
