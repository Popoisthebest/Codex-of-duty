import {
  withDevServer,
  launchBrowser,
  newHarnessPage,
  assertNoBrowserErrors,
} from './lib/common.mjs';

const floors = {
  playableWidthM: 80,
  playableDepthM: 80,
  playableAreaM2: 7000,
  zones: 5,
  primaryRoutes: 3,
  routeLoops: 2,
  verticalLevels: 2,
  spawnPoints: 12,
  landmarks: 4,
  indoorZones: 2,
  outdoorZones: 2,
  indoorOutdoorTransitions: 2,
};

function fail(message, details = null) {
  throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

await withDevServer(async () => {
  const browser = await launchBrowser();

  try {
    const { page, context, errors } = await newHarnessPage(browser, {
      scenario: 'map-audit-v3',
      shot: 'overview',
    });

    const hasReport = await page.evaluate(
      () => typeof window.__COD_HARNESS__?.getGameplayReport === 'function',
    );
    if (!hasReport) {
      fail('getGameplayReport() is missing. Implement the v3 gameplay harness contract first.');
    }

    const report = await page.evaluate(() => window.__COD_HARNESS__.getGameplayReport());
    const world = report?.world;

    if (!world || typeof world !== 'object') {
      fail('Gameplay report must include world map metadata.', report);
    }

    const failures = [];
    for (const [key, minimum] of Object.entries(floors)) {
      const value = Number(world[key]);
      if (!Number.isFinite(value) || value < minimum) {
        failures.push({ key, value: world[key] ?? null, minimum });
      }
    }

    assertNoBrowserErrors(errors);

    if (failures.length) {
      fail(
        'Map fails the v3 anti-tech-demo scale/structure floor. Do not pad empty space or fabricate metadata; improve the actual playable map and report real values.',
        { failures, world },
      );
    }

    console.log(JSON.stringify({
      ok: true,
      contract: 'gameplay-map-v3',
      floors,
      world,
      note: 'Numeric floors reject tiny/simple arenas but do not prove good level design. Independent map review is still required.',
    }, null, 2));

    await context.close();
  } finally {
    await browser.close();
  }
});
