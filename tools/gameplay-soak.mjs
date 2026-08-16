// Multi-seed, multi-match soak.
//
// A single 120 s match is far too small a sample to tune from: earlier passes
// drew conclusions from ~28-46 kill runs where one unlucky seed moves a zone
// share by 15 points. This runs the same production scenario across several
// seeds and reports the spread, so a change has to move the distribution rather
// than one run.
import fs from 'node:fs';
import path from 'node:path';
import { withDevServer, launchBrowser, newHarnessPage, ARTIFACTS, ensureDir, assertNoBrowserErrors, envNumber } from './lib/common.mjs';

const seeds = (process.env.COD_SOAK_SEEDS ?? '1337,2024,4242,777,90210,31415')
  .split(',').map((value) => Number(value.trim())).filter(Number.isFinite);
const seconds = envNumber('COD_SOAK_SECONDS', 150);
const outDir = path.join(ARTIFACTS, 'soaks');
ensureDir(outDir);

const num = (values) => {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance = sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / sorted.length;
  return {
    n: sorted.length,
    mean: Number(mean.toFixed(2)),
    sd: Number(Math.sqrt(variance).toFixed(2)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
};

// Zone shares are compared as fractions of that run's kills, so a run with more
// kills does not dominate the average.
const shareOf = (counts) => {
  const total = Object.values(counts ?? {}).reduce((sum, value) => sum + value, 0);
  if (!total) return {};
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value / total]));
};

await withDevServer(async () => {
  const browser = await launchBrowser();
  const runs = [];
  try {
    const { page, context, errors } = await newHarnessPage(browser, { scenario: 'combat-soak', shot: 'combat' });
    for (const seed of seeds) {
      const started = Date.now();
      const result = await page.evaluate(
        async ({ seed: s, seconds: secs }) => window.__COD_HARNESS__.runScenario('combat-soak', { seed: s, seconds: secs }),
        { seed, seconds },
      );
      runs.push({ seed, wallSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), ...result });
      console.log(`seed ${seed}: kills ${result.kills} spawnDeaths ${result.spawnDeaths} stuck ${result.stuckRecoveries} ok=${result.ok}`);
    }
    assertNoBrowserErrors(errors);
    await context.close();
  } finally {
    await browser.close();
  }

  const zoneKeys = [...new Set(runs.flatMap((run) => Object.keys(run.killsByZone ?? {})))];
  const occupancyKeys = [...new Set(runs.flatMap((run) => Object.keys(run.zoneOccupancy ?? {})))];
  const summary = {
    seeds, secondsPerRun: seconds, runs: runs.length,
    allOk: runs.every((run) => run.ok),
    runtimeErrors: runs.reduce((total, run) => total + run.runtimeErrors, 0),
    nonFinite: runs.some((run) => run.nonFiniteState),
    kills: num(runs.map((run) => run.kills)),
    deaths: num(runs.map((run) => run.deaths)),
    respawns: num(runs.map((run) => run.respawns)),
    // Spawn deaths are the headline safety metric, so it is reported as a rate.
    spawnDeathRatePct: num(runs.map((run) => (run.deaths ? (run.spawnDeaths * 100) / run.deaths : 0))),
    alphaKillSharePct: num(runs.map((run) => {
      const a = run.killsByTeam?.alpha ?? 0; const b = run.killsByTeam?.bravo ?? 0;
      return a + b ? (a * 100) / (a + b) : 50;
    })),
    firstContactSeconds: num(runs.map((run) => run.firstContactSeconds)),
    respawnToContactSeconds: num(runs.map((run) => run.averageRespawnToContactSeconds)),
    lifetimeP50: num(runs.map((run) => run.lifetimeSeconds?.p50)),
    lifetimeMean: num(runs.map((run) => run.lifetimeSeconds?.mean)),
    killerDistanceP50: num(runs.map((run) => run.killerDistanceM?.p50)),
    killerDistanceMean: num(runs.map((run) => run.killerDistanceM?.mean)),
    stuckRecoveries: num(runs.map((run) => run.stuckRecoveries)),
    stuckPerThousandPathAdvances: num(runs.map((run) => run.stuckPerThousandPathAdvances)),
    maxStuckSeconds: num(runs.map((run) => run.maxStuckSeconds)),
    elevatedOccupancyTotal: num(runs.map((run) => Object.values(run.elevatedOccupancy ?? {}).reduce((s, v) => s + v, 0))),
    killShareByZonePct: Object.fromEntries(zoneKeys.map((zone) => [
      zone, num(runs.map((run) => (shareOf(run.killsByZone)[zone] ?? 0) * 100)),
    ])),
    occupancyShareByZonePct: Object.fromEntries(occupancyKeys.map((zone) => [
      zone, num(runs.map((run) => (shareOf(run.zoneOccupancy)[zone] ?? 0) * 100)),
    ])),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(outDir, `soak-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ summary, runs }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved -> ${out}`);
});
