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

    const s = summarize(result.durations);
    const cpu = summarize(result.stepCpuMs);
    const report = {
      sourceIdentity: sourceIdentity(),
      settings: {
        url: config.url,
        width: config.width,
        height: config.height,
        dpr: config.dpr,
        warmup,
        frames,
      },
      frameMs: s,
      stepCpuMs: cpu,
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
      frameMs: report.frameMs,
      stepCpuMs: report.stepCpuMs,
      longFrames: report.longFrames,
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
