// Deterministic duel benchmark.
//
// Measures the combat MODEL on both sides under controlled conditions, using
// production combat throughout. Deliberately separate from the scripted-human
// soak: the soak measures how well a handicapped driver plays a match, which is
// the wrong instrument for asking whether being shot at is dangerous.
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, ensureDir, assertNoBrowserErrors } from './lib/common.mjs';

const SEEDS = [1337, 4242, 90210];
const CASES = [
  { mode: 'stationary', range: 5 },
  { mode: 'stationary', range: 20 },
  { mode: 'moving', range: 5 },
  { mode: 'moving', range: 20 },
  { mode: 'crouch', range: 12 },
  { mode: 'breaking-los', range: 5 },
];

// Acceptance derived from the design intent, not from whatever the build does:
//  - an exposed stationary player must die fast enough to respect incoming fire
//  - moving must measurably help
//  - breaking line of sight must work
//  - the player must still beat one bot decisively
const LIMITS = {
  stationaryMaxTtk: 3.0,      // exposed and still: dangerous
  stationaryMinTtk: 0.8,      // but not an instant, unavoidable death
  movingMinAdvantage: 1.15,   // moving must buy at least 15% more life
  losMustSurvive: true,
  maxPlayerBotRatio: 12,      // model-level ratio; a human also pays aim time
};

const rows = [];
const failures = [];

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, {});
    for (const seed of SEEDS) {
      for (const testCase of CASES) {
        const duel = await page.evaluate(async ({ s, c }) => {
          await window.__COD_HARNESS__.reset({ seed: s });
          const r = await window.__COD_HARNESS__.runAction('measure_duel', { ...c, frames: 900 });
          return r?.duel ?? null;
        }, { s: seed, c: testCase });
        if (!duel) { failures.push(`seed ${seed} ${testCase.mode}@${testCase.range}m returned nothing.`); continue; }
        rows.push({ seed, ...duel });
        console.log(`seed ${seed} ${testCase.mode.padEnd(13)} ${String(testCase.range).padStart(2)}m  `
          + `botTTK ${String(duel.botTtk ?? 'survived').padStart(9)}  `
          + `playerTTK ${String(duel.playerTtk ?? 'n/a').padStart(5)}  hpLeft ${duel.healthLeft}`);
      }
    }
    try { assertNoBrowserErrors(errors); } catch (e) { failures.push(`Browser errors: ${e?.message ?? e}`); }
    await context.close();
  } finally { await browser.close(); }
});

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const ttks = (mode, range) => rows.filter((r) => r.mode === mode && r.range === range && r.botTtk != null).map((r) => r.botTtk);

const stat5 = mean(ttks('stationary', 5));
const stat20 = mean(ttks('stationary', 20));
const move5 = mean(ttks('moving', 5));
const playerTtks = rows.map((r) => r.playerTtk).filter((v) => v != null);
const playerMean = mean(playerTtks);

console.log('\n--- summary ---');
console.log(`bot TTK, stationary  5 m : ${stat5?.toFixed(2) ?? 'n/a'} s`);
console.log(`bot TTK, stationary 20 m : ${stat20?.toFixed(2) ?? 'n/a'} s`);
console.log(`bot TTK, moving      5 m : ${move5?.toFixed(2) ?? 'n/a'} s`);
console.log(`player TTK vs bot        : ${playerMean?.toFixed(3) ?? 'n/a'} s`);
if (stat5 && playerMean) console.log(`model ratio              : ${(stat5 / playerMean).toFixed(1)}x`);

if (stat5 == null) failures.push('Stationary exposed player was never killed at 5 m - incoming fire is not a threat.');
else {
  if (stat5 > LIMITS.stationaryMaxTtk) failures.push(`Stationary exposed TTK ${stat5.toFixed(2)}s exceeds ${LIMITS.stationaryMaxTtk}s.`);
  if (stat5 < LIMITS.stationaryMinTtk) failures.push(`Stationary exposed TTK ${stat5.toFixed(2)}s is below ${LIMITS.stationaryMinTtk}s - death is unavoidable.`);
}
if (stat5 && move5 && move5 / stat5 < LIMITS.movingMinAdvantage) {
  failures.push(`Moving bought only ${(move5 / stat5).toFixed(2)}x survival - movement does not matter.`);
}
const losRows = rows.filter((r) => r.mode === 'breaking-los');
if (LIMITS.losMustSurvive && losRows.some((r) => r.botTtk != null)) {
  failures.push('Player died after breaking line of sight - disengaging does not work.');
}
if (stat5 && playerMean && stat5 / playerMean > LIMITS.maxPlayerBotRatio) {
  failures.push(`Model lethality ratio ${(stat5 / playerMean).toFixed(1)}x exceeds ${LIMITS.maxPlayerBotRatio}x.`);
}

const outDir = path.join(ARTIFACTS, 'duel');
ensureDir(outDir);
fs.writeFileSync(path.join(outDir, `duel-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ rows, failures }, null, 2));

if (failures.length) {
  console.error(`\nDUEL BENCHMARK FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nduel benchmark ok');
