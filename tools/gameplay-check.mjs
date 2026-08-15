import {
  withDevServer,
  launchBrowser,
  newHarnessPage,
  assertNoBrowserErrors,
} from './lib/common.mjs';

function fail(message, details = null) {
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`${message}${suffix}`);
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) fail(`${label} must be a finite number.`, { value });
}

function validateReport(report) {
  if (!report || typeof report !== 'object') fail('getGameplayReport() returned no object.');
  if ((report.version ?? 0) < 3) fail('Gameplay report version must be >= 3.', report);
  if (report.mode !== 'tdm') fail('Primary v3 gameplay mode must report "tdm".', report);

  assertFiniteNumber(report.scoreLimit, 'scoreLimit');
  if (report.scoreLimit < 50) fail('TDM scoreLimit is unexpectedly low.', report);

  assertFiniteNumber(report.timeLimitSeconds, 'timeLimitSeconds');
  if (report.timeLimitSeconds < 300) fail('TDM time limit is unexpectedly short.', report);

  const p = report.participants ?? {};
  if (p.total !== 12 || p.human !== 1 || p.alliedBots !== 5 || p.enemyBots !== 6) {
    fail('Expected a real 6v6 roster: 1 human + 5 allied bots vs 6 enemy bots.', p);
  }

  if (!Array.isArray(report.teams) || report.teams.length !== 2) {
    fail('Expected exactly two authoritative teams.', report.teams);
  }

  for (const [i, team] of report.teams.entries()) {
    if (team.rosterSize !== 6) fail(`Team ${i} must contain six participants.`, team);
    assertFiniteNumber(team.score, `teams[${i}].score`);
  }
}

function validateScenario(result) {
  if (!result || typeof result !== 'object') fail('tdm-core scenario returned no result.');

  const requiredTrue = [
    'ok',
    'matchStarted',
    'participantsReady',
    'scoreChangedFromKill',
    'deathObserved',
    'respawnObserved',
    'scoreboardConsistent',
    'matchEndedByScoreLimit',
    'winnerDeclared',
    'restartReturnedToCleanMatch',
    'usedProductionDamage',
    'usedProductionScoring',
    'usedProductionRespawn',
  ];

  const failed = requiredTrue.filter((key) => result[key] !== true);
  if (failed.length) {
    fail(`tdm-core failed required evidence: ${failed.join(', ')}`, result);
  }

  if ((result.runtimeErrors ?? 0) !== 0) fail('tdm-core reported runtime errors.', result);
  if (result.nonFiniteState !== false) fail('tdm-core must explicitly report nonFiniteState=false.', result);
}

await withDevServer(async () => {
  const browser = await launchBrowser();

  try {
    const { page, context, errors } = await newHarnessPage(browser, {
      scenario: 'gameplay-v3',
      shot: 'combat',
    });

    const capabilities = await page.evaluate(() => ({
      harnessVersion: window.__COD_HARNESS__?.version ?? null,
      hasGameplayReport: typeof window.__COD_HARNESS__?.getGameplayReport === 'function',
      hasRunScenario: typeof window.__COD_HARNESS__?.runScenario === 'function',
    }));

    if (!capabilities.hasGameplayReport || !capabilities.hasRunScenario) {
      fail(
        'Gameplay Harness v3 contract is not implemented. Add getGameplayReport() and runScenario() to window.__COD_HARNESS__ using docs/GAMEPLAY_HARNESS_CONTRACT.md. Do not fake the result.',
        capabilities,
      );
    }

    const before = await page.evaluate(() => window.__COD_HARNESS__.getGameplayReport());
    validateReport(before);

    const result = await page.evaluate(async () => {
      return await window.__COD_HARNESS__.runScenario('tdm-core', {
        deterministic: true,
        accelerated: true,
      });
    });

    validateScenario(result);

    const after = await page.evaluate(() => window.__COD_HARNESS__.getGameplayReport());
    validateReport(after);
    assertNoBrowserErrors(errors);

    console.log(JSON.stringify({
      ok: true,
      contract: 'gameplay-v3',
      capabilities,
      before,
      scenario: result,
      after,
    }, null, 2));

    await context.close();
  } finally {
    await browser.close();
  }
});
