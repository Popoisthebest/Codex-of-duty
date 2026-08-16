// Captures a live 6v6 match from several positions across the district so map,
// visual and pacing review is done against real gameplay frames rather than
// staged showcase shots.
import fs from 'node:fs';
import path from 'node:path';
import { withDevServer, launchBrowser, newHarnessPage, ARTIFACTS, ensureDir } from './lib/common.mjs';

const OUT = path.join(ARTIFACTS, process.argv[2] ?? 'gameplay-capture');

// [name, position, yaw, pitch, warmup seconds]
const VIEWS = [
  ['alpha-staging', [0, 0, 34], Math.PI, -0.08, 4],
  // Visual-critic repro points for the shadow-cascade seam: two cameras 8 m
  // apart in the junction, and a staging walk that showed a hard lighting edge.
  ['seam-junction-a', [0, 0, -30], 0, -0.02, 5],
  ['seam-junction-b', [0, 0, -38], 0, -0.02, 6],
  ['seam-staging', [-30, 0, 28], Math.PI, -0.04, 7],
  ['seam-perimeter', [-44, 0, 0], -Math.PI / 2, 0.0, 8],
  // Visual-critic symptom report: "floating blue-grey slats" and a hard dark
  // trapezoid with no geometry behind it.
  ['westyard-south', [-35, 0, -30], Math.PI, 0.02, 9],
  ['westyard-containers', [-24, 0, -33], -Math.PI / 2, 0.03, 10],
  ['market-spine-north', [0, 0, 14], Math.PI, 0.0, 6],
  ['market-spine-south', [0, 0, -8], 0, 0.0, 8],
  ['market-arch', [0, 0, -16], 0, 0.05, 10],
  ['arcade-interior', [5.1, 0, -2], 0, 0.0, 12],
  ['tea-shop', [8.6, 0, 6.2], -Math.PI / 2, 0.0, 14],
  ['west-underpass', [-9, 0, -2.5], -Math.PI / 2, 0.0, 16],
  ['freight-yard', [-19, 0, 8], Math.PI, 0.02, 20],
  ['freight-yard-depot', [-19, 0, -2], Math.PI / 2, 0.0, 22],
  ['market-rear-west', [-16, 0, -8], Math.PI / 2 + 0.5, 0.06, 23],
  ['freight-catwalk', [-25, 3.5, 19.5], Math.PI / 2, -0.16, 24],
  ['depot-interior', [-33, 0, 1], Math.PI / 2, 0.0, 28],
  ['depot-mezzanine', [-35, 3.5, 6], -Math.PI / 2, -0.14, 32],
  ['east-underpass', [9, 0, -2.5], Math.PI / 2, 0.0, 36],
  ['terrace-low', [24, 1.5, 2], Math.PI / 2, -0.02, 40],
  ['terrace-high', [41, 3.6, 3], -Math.PI / 2, -0.08, 44],
  ['bureau-upper', [24, 5.0, -3], Math.PI / 2, -0.05, 48],
  ['north-junction', [0, 0, -28], 0, 0.02, 52],
  ['junction-overpass', [0, 4.6, -39], Math.PI, -0.14, 56],
  ['bravo-staging', [0, 0, -46], 0, -0.06, 60],
];

ensureDir(OUT);

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, { scenario: 'combat-soak', shot: 'combat' });
    await page.evaluate(async () => {
      const h = window.__COD_HARNESS__;
      await h.reset({ seed: 1337, scenario: 'combat-soak' });
      await h.enterMatchMode();
      await h.stepFrames(120);
    });
    const summary = [];
    let elapsed = 0;
    for (const [name, position, yaw, pitch, atSeconds] of VIEWS) {
      const advance = Math.max(0, Math.round((atSeconds - elapsed) * 60));
      elapsed = atSeconds;
      const state = await page.evaluate(async ({ position: pos, yaw: y, pitch: p, advance: frames }) => {
        const h = window.__COD_HARNESS__;
        // Let the live match run, then park the camera to look at what the
        // twelve combatants are actually doing in that part of the map.
        if (frames > 0) await h.stepFrames(frames);
        return h.stagePlayerView({ position: pos, yaw: y, pitch: p });
      }, { position, yaw, pitch, advance });
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      summary.push({ name, position, seconds: atSeconds, zone: state?.player?.zone ?? null, match: state?.match ?? null });
    }
    const report = await page.evaluate(() => window.__COD_HARNESS__.getGameplayReport());
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ views: summary, report, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, out: OUT, views: summary.length, telemetry: report.telemetry, errors }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
});
