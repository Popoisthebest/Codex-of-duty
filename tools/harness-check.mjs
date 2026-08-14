import { withDevServer, launchBrowser, newHarnessPage, settle, assertNoBrowserErrors } from './lib/common.mjs';

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, { shot: 'overview' });

    const contract = await page.evaluate(async () => {
      const h = window.__COD_HARNESS__;
      const required = ['reset', 'setShot', 'stepFrames', 'snapshot', 'getMetrics'];
      const missing = required.filter((k) => typeof h?.[k] !== 'function');

      const a = await h.reset({ seed: 1337, scenario: 'contract-check' });
      await h.stepFrames(10);
      const b = h.snapshot();
      const metrics = h.getMetrics();

      return {
        version: h?.version,
        ready: h?.ready,
        missing,
        before: a,
        after: b,
        metrics,
      };
    });

    await settle(page, 2);
    assertNoBrowserErrors(errors);

    if (contract.version !== 2 || !contract.ready || contract.missing.length) {
      throw new Error(`Harness contract invalid: ${JSON.stringify(contract, null, 2)}`);
    }

    if (!Number.isFinite(contract.after?.frame)) {
      throw new Error('Harness snapshot.frame must be finite.');
    }

    console.log(JSON.stringify({ ok: true, ...contract }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
});
