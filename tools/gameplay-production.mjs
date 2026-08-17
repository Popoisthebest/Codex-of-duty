// Production-rules validation.
//
// The fast gates deliberately shorten the match: `gameplay:check` runs a score
// limit of 12 with a 1.6 s respawn, and the soak raises the limit out of the way
// so the match never ends. Both are correct for what they do, and neither proves
// that the configuration a player actually receives - score limit 50, a 600 s
// clock, a 3.2 s respawn - is winnable, terminates, and restarts cleanly.
//
// This runs the shipped rules untouched across several deterministic seeds. It
// is additive: it does not replace or weaken any existing gate.
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS,
  withDevServer,
  launchBrowser,
  newHarnessPage,
  ensureDir,
  assertNoBrowserErrors,
} from './lib/common.mjs';

const SEEDS = [1337, 2024, 4242, 777, 90210, 31415];

// Expected production configuration. If the game's rules change on purpose,
// this constant changes with them - deliberately, and in a diff.
const EXPECTED_RULES = { scoreLimit: 50, timeLimitSeconds: 600, respawnSeconds: 3.2 };

// Catastrophic-regression floors, not tuning targets. These are set far from the
// measured values so ordinary drift never trips them; only a broken build does.
const FLOORS = {
  minKills: 8,              // a match that produces almost no kills is broken
  maxSpawnDeathPct: 12,     // spawning into unavoidable fire
  maxHumanKillSharePct: 55, // one actor carrying the whole match
  minParticipatingBots: 8,  // of 11, bots that scored at least once across seeds
};

const failures = [];
const runs = [];

function check(condition, message, detail) {
  if (condition) return;
  failures.push(detail === undefined ? message : `${message} ${JSON.stringify(detail)}`);
}

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    // `errors` collects pageerror/console.error. The soak and check gates both
    // assert on it; this gate discarded it, so six ~400-600 s production matches
    // - the longest and most production-realistic runs in the suite - could not
    // fail on a browser-level error.
    const { page, context, errors } = await newHarnessPage(browser, {});

    for (const seed of SEEDS) {
      const result = await page.evaluate(async (s) => {
        const bridge = window.__COD_HARNESS__;
        return bridge.runScenario('tdm-core', { seed: s, production: true });
      }, seed);
      runs.push({ seed, ...result });
      console.log(`production seed ${seed}: end=${result.endReason} `
        + `scores=${JSON.stringify(result.evidence?.finalScores)} `
        + `t=${result.evidence?.simulatedSeconds}s ok=${result.ok}`);

      const rules = result.rulesInEffect ?? {};
      check(rules.scoreLimit === EXPECTED_RULES.scoreLimit,
        `seed ${seed}: score limit is not the production value.`, rules);
      check(rules.timeLimitSeconds === EXPECTED_RULES.timeLimitSeconds,
        `seed ${seed}: time limit is not the production value.`, rules);
      check(rules.respawnSeconds === EXPECTED_RULES.respawnSeconds,
        `seed ${seed}: respawn time is not the production value.`, rules);

      check(result.production === true, `seed ${seed}: scenario did not run in production mode.`);
      check(result.matchStarted, `seed ${seed}: match never left prematch.`);
      check(result.participantsReady, `seed ${seed}: roster was not 1 human + 5 allies vs 6 enemies.`);
      check(result.matchEnded, `seed ${seed}: match did not reach a terminal state.`, {
        endReason: result.endReason, seconds: result.evidence?.simulatedSeconds,
      });
      check(result.winnerDeclared, `seed ${seed}: no winner declared.`);
      check(result.restartReturnedToCleanMatch, `seed ${seed}: restart did not return a clean match.`);
      check(result.scoreboardConsistent, `seed ${seed}: scoreboard does not sum to team score.`);
      check(result.scoreChangedFromKill, `seed ${seed}: score did not come from observed kills.`);
      check(result.deathObserved && result.respawnObserved,
        `seed ${seed}: death/respawn cycle not observed.`);
      check(result.usedProductionDamage, `seed ${seed}: damage did not go through the production pipeline.`);
      check(result.usedProductionScoring, `seed ${seed}: scoring did not go through the production pipeline.`);
      check(result.usedProductionRespawn, `seed ${seed}: respawn did not go through the production pipeline.`);
      check(result.runtimeErrors === 0, `seed ${seed}: runtime errors.`, result.errors);
      check(result.nonFiniteState === false, `seed ${seed}: non-finite state.`, result.nonFiniteFields);

      const scores = result.evidence?.finalScores ?? {};
      const total = (scores.alpha ?? 0) + (scores.bravo ?? 0);
      check(total >= FLOORS.minKills, `seed ${seed}: implausibly few kills in a full match.`, scores);
    }

    // Cross-seed checks: a single seed cannot show these.
    const endedByScore = runs.filter((r) => r.endReason === 'score-limit').length;
    check(endedByScore > 0,
      'No seed reached the score limit; the advertised win condition may be unreachable.',
      runs.map((r) => ({ seed: r.seed, end: r.endReason, t: r.evidence?.simulatedSeconds })));

    const allKills = runs.flatMap((r) => r.participantKills ?? []);
    if (allKills.length) {
      const humanKills = allKills.filter((p) => p.human).reduce((n, p) => n + p.kills, 0);
      const totalKills = allKills.reduce((n, p) => n + p.kills, 0);
      const sharePct = totalKills ? (humanKills * 100) / totalKills : 0;
      check(sharePct <= FLOORS.maxHumanKillSharePct,
        'One participant is carrying the match; the bots are not participating.',
        { humanSharePct: Number(sharePct.toFixed(1)) });

      const botsWhoScored = new Set(allKills.filter((p) => !p.human && p.kills > 0).map((p) => p.id));
      check(botsWhoScored.size >= FLOORS.minParticipatingBots,
        'Too few distinct bots scored across all seeds.',
        { scored: botsWhoScored.size, of: 11 });
    }

    try {
      assertNoBrowserErrors(errors);
    } catch (error) {
      failures.push(`Browser errors during production runs: ${error?.message ?? error}`);
    }

    const winners = runs.map((r) => r.evidence?.finalScores);
    console.log(`\nended by score-limit: ${endedByScore}/${runs.length}`);
    console.log(`final scores: ${JSON.stringify(winners)}`);

    await context.close();
  } finally {
    await browser.close();
  }
});

const outDir = path.join(ARTIFACTS, 'production');
ensureDir(outDir);
const outFile = path.join(outDir, `production-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({ seeds: SEEDS, failures, runs }, null, 2));

if (failures.length) {
  console.error(`\nPRODUCTION VALIDATION FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nproduction validation ok across ${SEEDS.length} seeds -> ${outFile}`);
