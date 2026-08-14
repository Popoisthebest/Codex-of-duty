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
      await h.reset({ seed: 7331, scenario: 'determinism-check' });
      await h.runAction?.('move_forward', { frames: 24 });
      await h.runAction?.('look_right', { frames: 3 });
      const deterministicA = h.snapshot();
      await h.reset({ seed: 7331, scenario: 'determinism-check' });
      await h.runAction?.('move_forward', { frames: 24 });
      await h.runAction?.('look_right', { frames: 3 });
      const deterministicB = h.snapshot();
      await h.setShot('overview');
      await h.stepFrames(4);
      const metrics = h.getMetrics();
      const resourceSamples = [];
      for (let i = 0; i < 5; i += 1) {
        await h.reset({ seed: 9000 + i, scenario: 'resource-stability' });
        await h.setShot('overview');
        await h.stepFrames(4);
        resourceSamples.push(h.getMetrics());
      }

      return {
        version: h?.version,
        ready: h?.ready,
        missing,
        before: a,
        after: b,
        deterministicA,
        deterministicB,
        deterministicEqual: JSON.stringify(deterministicA) === JSON.stringify(deterministicB),
        metrics,
        resourceSamples,
      };
    });

    await page.evaluate(async () => {
      const h = window.__COD_HARNESS__;
      await h.setShot('hud');
      await h.stepFrames(8);
      await h.reset({ seed: 4242, scenario: 'reset-history' });
      await h.stepFrames(4);
    });
    const resetHistoryA = await page.screenshot();
    contract.resetStateA = await page.evaluate(() => ({
      snapshot: window.__COD_HARNESS__.snapshot(),
      hudDisplay: getComputedStyle(document.querySelector('.hud-root')).display,
      deathHidden: document.querySelector('#death-screen').hidden,
    }));
    await page.evaluate(async () => {
      const h = window.__COD_HARNESS__;
      await h.setShot('enemy');
      await h.stepFrames(8);
      await h.reset({ seed: 4242, scenario: 'reset-history' });
      await h.stepFrames(4);
    });
    const resetHistoryB = await page.screenshot();
    contract.resetStateB = await page.evaluate(() => ({
      snapshot: window.__COD_HARNESS__.snapshot(),
      hudDisplay: getComputedStyle(document.querySelector('.hud-root')).display,
      deathHidden: document.querySelector('#death-screen').hidden,
    }));
    contract.resetHistoryEqual = resetHistoryA.equals(resetHistoryB)
      && JSON.stringify(contract.resetStateA) === JSON.stringify(contract.resetStateB);

    await page.evaluate(async () => {
      await window.__COD_HARNESS__.setShot('hud');
      await window.__COD_HARNESS__.stepFrames(4);
    });
    contract.resizeBaseline = await page.evaluate(() => window.__COD_HARNESS__.getMetrics());
    contract.resizeMetrics = [];
    for (const viewport of [{ width: 640, height: 720 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await settle(page, 3);
      const layout = await page.evaluate(() => Object.fromEntries(
        ['.hud-objective', '.hud-compass', '.hud-health', '.hud-ammo'].map((selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return [selector, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
        }),
      ));
      contract.resizeMetrics.push({ viewport, layout, metrics: await page.evaluate(() => window.__COD_HARNESS__.getMetrics()) });
    }

    await settle(page, 2);
    assertNoBrowserErrors(errors);

    if (contract.version !== 2 || !contract.ready || contract.missing.length) {
      throw new Error(`Harness contract invalid: ${JSON.stringify(contract, null, 2)}`);
    }

    if (!Number.isFinite(contract.after?.frame)) {
      throw new Error('Harness snapshot.frame must be finite.');
    }

    if (!contract.deterministicEqual) {
      throw new Error(`Same-seed deterministic action sequence diverged: ${JSON.stringify(contract, null, 2)}`);
    }
    if (!contract.resetHistoryEqual || contract.resetStateA.snapshot.shot !== 'overview' || contract.resetStateA.hudDisplay !== 'none' || !contract.resetStateA.deathHidden) {
      throw new Error(`Reset remained dependent on prior shot state: ${JSON.stringify({ a: contract.resetStateA, b: contract.resetStateB, pixelsEqual: resetHistoryA.equals(resetHistoryB) }, null, 2)}`);
    }

    for (const key of ['programs', 'textures', 'geometries']) {
      const values = contract.resourceSamples.map((sample) => sample[key]);
      if (!values.every(Number.isFinite) || new Set(values).size !== 1) {
        throw new Error(`Renderer ${key} changed across deterministic resets: ${values.join(', ')}`);
      }
      const resized = contract.resizeMetrics.map((sample) => sample.metrics[key]);
      if (resized.some((value) => value > contract.resizeBaseline[key])) {
        throw new Error(`Renderer ${key} grew after resize: baseline=${contract.resizeBaseline[key]} resize=${resized.join(', ')}`);
      }
    }
    for (const { viewport, layout } of contract.resizeMetrics) {
      for (const [selector, rect] of Object.entries(layout)) {
        if (rect.right <= rect.left || rect.bottom <= rect.top || rect.left < 0 || rect.top < 0 || rect.right > viewport.width || rect.bottom > viewport.height) {
          throw new Error(`${selector} leaves the ${viewport.width}x${viewport.height} viewport: ${JSON.stringify(rect)}`);
        }
      }
      const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (overlaps(layout['.hud-objective'], layout['.hud-compass'])) throw new Error(`Objective overlaps compass at ${viewport.width}x${viewport.height}.`);
      if (overlaps(layout['.hud-health'], layout['.hud-ammo'])) throw new Error(`Health overlaps ammo at ${viewport.width}x${viewport.height}.`);
    }

    console.log(JSON.stringify({ ok: true, ...contract }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
});
