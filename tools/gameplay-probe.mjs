// Ad-hoc gameplay probe: boots the game in harness mode and prints the live
// gameplay report plus a short soak so map/AI numbers can be inspected quickly.
import { withDevServer, launchBrowser, newHarnessPage, assertNoBrowserErrors } from './lib/common.mjs';

const scenario = process.argv[2] ?? 'report';

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, { scenario: 'probe', shot: 'combat' });
    const report = await page.evaluate(() => window.__COD_HARNESS__.getGameplayReport());
    console.log('=== gameplay report ===');
    console.log(JSON.stringify(report, null, 2));

    if (scenario !== 'report') {
      const started = Date.now();
      const result = await page.evaluate(async (name) => window.__COD_HARNESS__.runScenario(name, {}), scenario);
      console.log(`=== scenario ${scenario} (${((Date.now() - started) / 1000).toFixed(1)}s wall) ===`);
      console.log(JSON.stringify(result, null, 2));
    }
    if (errors.length) console.log('=== browser errors ===\n' + errors.join('\n'));
    assertNoBrowserErrors(errors);
    await context.close();
  } finally {
    await browser.close();
  }
});
