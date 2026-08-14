import {
  withDevServer,
  launchBrowser,
  newHarnessPage,
  assertNoBrowserErrors,
} from './lib/common.mjs';

function finiteVec(v) {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite);
}

await withDevServer(async () => {
  const browser = await launchBrowser();

  try {
    const { page, context, errors } = await newHarnessPage(browser, {
      shot: 'combat',
      scenario: 'playtest',
    });

    const initial = await page.evaluate(() => window.__COD_HARNESS__.snapshot());

    // Prefer a game-provided deterministic action driver.
    const hasRunAction = await page.evaluate(
      () => typeof window.__COD_HARNESS__.runAction === 'function',
    );

    if (hasRunAction) {
      for (const action of [
        'move_forward',
        'look_right',
        'fire',
        'ads_on',
        'ads_off',
        'reload',
      ]) {
        await page.evaluate(async (name) => {
          await window.__COD_HARNESS__.runAction(name, { frames: 30 });
        }, action);
      }
    } else {
      // Generic browser smoke inputs. The full game should eventually expose runAction.
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(250);
      await page.keyboard.up('KeyW');

      await page.mouse.move(650, 360);
      await page.mouse.down({ button: 'left' });
      await page.waitForTimeout(80);
      await page.mouse.up({ button: 'left' });

      await page.mouse.down({ button: 'right' });
      await page.waitForTimeout(100);
      await page.mouse.up({ button: 'right' });

      await page.keyboard.press('KeyR');

      await page.evaluate(async () => {
        await window.__COD_HARNESS__.stepFrames(120);
      });
    }

    const finalState = await page.evaluate(() => window.__COD_HARNESS__.snapshot());
    assertNoBrowserErrors(errors);

    if (!Number.isFinite(finalState?.frame) || finalState.frame <= (initial?.frame ?? -1)) {
      throw new Error('Simulation frame did not advance during playtest.');
    }

    if (finalState?.player?.position && !finiteVec(finalState.player.position)) {
      throw new Error('Player position contains non-finite values.');
    }

    if (finalState?.player?.health != null && !Number.isFinite(finalState.player.health)) {
      throw new Error('Player health is not finite.');
    }

    if (finalState?.weapon?.ammo != null && (!Number.isFinite(finalState.weapon.ammo) || finalState.weapon.ammo < 0)) {
      throw new Error('Weapon ammo state is invalid.');
    }

    console.log(JSON.stringify({
      ok: true,
      usedDeterministicActions: hasRunAction,
      initial,
      final: finalState,
    }, null, 2));

    await context.close();
  } finally {
    await browser.close();
  }
});
