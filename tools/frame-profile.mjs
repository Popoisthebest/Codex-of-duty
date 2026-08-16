// Profiles the production render loop.
//
// tools/profile.mjs drives the deterministic harness: it awaits a rAF, then runs
// a gameplay frame in a promise continuation afterwards. That measures harness
// scheduling as much as the game. This tool loads the game normally, deploys via
// the real UI, plays with real input, and reads the engine's own per-phase frame
// instrumentation, so the numbers describe the loop players actually run.
import fs from 'node:fs';
import path from 'node:path';
import { withDevServer, launchBrowser, ARTIFACTS, ensureDir, config, sourceIdentity, envNumber } from './lib/common.mjs';

const seconds = envNumber('COD_FRAME_SECONDS', 22);
const outDir = process.env.COD_PROFILE_DIR || path.join(ARTIFACTS, 'frame-profiles');
const label = process.argv[2] ?? 'run';
ensureDir(outDir);

async function acquirePointerLock(page) {
  await page.bringToFront();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('#deploy-button').click();
    try {
      await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas'), null, { timeout: 4000 });
      return true;
    } catch {
      await page.waitForTimeout(120);
    }
  }
  return false;
}

await withDevServer(async () => {
  // Pointer lock is only granted to a headed browser, and deploying through the
  // real UI is the point of this tool.
  const browser = await launchBrowser({ headless: false });
  try {
    const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: config.dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await page.waitForFunction(() => window.__COD_HARNESS__?.ready === true, null, { timeout: config.timeoutMs });
    if (!(await acquirePointerLock(page))) throw new Error('Could not deploy: pointer lock refused.');

    // Fixed synthetic workload with no dependency on game code. Comparing this
    // across sessions separates "our code got slower" from "this host is
    // currently slower", which per-frame numbers alone cannot distinguish.
    const cpuBenchmarkMs = await page.evaluate(() => {
      const run = () => {
        const start = performance.now();
        let acc = 0;
        for (let i = 1; i < 6000000; i += 1) acc += Math.sqrt(i) * Math.sin(i * 0.001);
        return { ms: performance.now() - start, acc };
      };
      run();
      const samples = [run().ms, run().ms, run().ms].sort((a, b) => a - b);
      return Number(samples[1].toFixed(2));
    });
    await page.evaluate(() => window.__COD_HARNESS__.setProfiling(true));
    // Play for real: move, look, fire, reload. Input goes through the same paths
    // a player uses, so the profile covers movement, combat and FX load.
    const deadline = Date.now() + seconds * 1000;
    const loadSamples = [];
    let phase = 0;
    while (Date.now() < deadline) {
      phase += 1;
      await page.keyboard.down('KeyW');
      if (phase % 3 === 0) await page.keyboard.down('ShiftLeft');
      await page.mouse.move(config.width * 0.5 + Math.sin(phase) * 260, config.height * 0.5 + Math.cos(phase * 0.7) * 60, { steps: 4 });
      await page.mouse.down({ button: 'left' });
      await page.waitForTimeout(320);
      await page.mouse.up({ button: 'left' });
      await page.keyboard.up('ShiftLeft');
      if (phase % 4 === 0) { await page.keyboard.press('KeyR'); }
      if (phase % 5 === 0) { await page.keyboard.down('KeyA'); await page.waitForTimeout(200); await page.keyboard.up('KeyA'); }
      await page.waitForTimeout(180);
      await page.keyboard.up('KeyW');
      // Sample render load so the timing result is known to cover real draw work
      // rather than a frame spent facing a wall.
      loadSamples.push(await page.evaluate(() => {
        const m = window.__COD_HARNESS__.getMetrics();
        const s = window.__COD_HARNESS__.snapshot();
        return { calls: m.worldCalls, tris: m.worldTriangles, zone: s.player?.zone ?? null, alive: s.match?.alive ?? null };
      }));
    }
    const profile = await page.evaluate(() => {
      const report = window.__COD_HARNESS__.getFrameProfile();
      window.__COD_HARNESS__.setProfiling(false);
      return { report, metrics: window.__COD_HARNESS__.getMetrics(), snapshot: window.__COD_HARNESS__.snapshot() };
    });

    const record = {
      label,
      sourceIdentity: sourceIdentity(),
      settings: { url: config.url, width: config.width, height: config.height, dpr: config.dpr, seconds },
      cpuBenchmarkMs,
      ...profile,
      loadSamples,
      errors,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(outDir, `frame-${label}-${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify(record, null, 2));

    const r = profile.report;
    console.log(JSON.stringify({
      label,
      frames: r.frames,
      frameMs: r.frameMs,
      cpuMs: r.cpuMs,
      fixedMs: r.fixedMs,
      updateMs: r.updateMs,
      lateUpdateMs: r.lateUpdateMs,
      unaccountedMs: r.unaccountedMs,
      longFrames: r.longFrames,
      longFrameCpuShare: r.longFrameCpuShare,
      heap: r.heap,
      gpu: r.gpu,
      cpuBenchmarkMs,
      worldCalls: profile.metrics?.worldCalls ?? null,
      worldTriangles: profile.metrics?.worldTriangles ?? null,
      load: {
        samples: loadSamples.length,
        callsMedian: loadSamples.length ? [...loadSamples.map((x) => x.calls)].sort((a, b) => a - b)[loadSamples.length >> 1] : null,
        callsMax: loadSamples.length ? Math.max(...loadSamples.map((x) => x.calls)) : null,
        trianglesMax: loadSamples.length ? Math.max(...loadSamples.map((x) => x.tris)) : null,
        zonesVisited: [...new Set(loadSamples.map((x) => x.zone))],
      },
      errors,
    }, null, 2));
    console.log('perSystem (ms/frame):');
    const rows = Object.entries(r.perSystem)
      .map(([name, value]) => ({ name, total: value.fixedMsPerFrame + value.updateMsPerFrame + value.lateMsPerFrame, ...value }))
      .sort((a, b) => b.total - a.total);
    for (const row of rows) {
      console.log(`  ${row.name.padEnd(10)} total ${row.total.toFixed(3)}  fixed ${row.fixedMsPerFrame.toFixed(3)}  update ${row.updateMsPerFrame.toFixed(3)}  late ${row.lateMsPerFrame.toFixed(3)}`);
    }
    console.log(`Saved -> ${out}`);
    await context.close();
  } finally {
    await browser.close();
  }
});
