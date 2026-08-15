import {
  withDevServer,
  launchBrowser,
  newHarnessPage,
  assertNoBrowserErrors,
  config,
} from './lib/common.mjs';

function finiteVec(v) {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite);
}

async function acquirePointerLock(page, trigger = '#deploy-button') {
  await page.bringToFront();
  await page.evaluate(() => {
    if (window.__COD_POINTER_LOCK_ERROR_HANDLER__) {
      document.removeEventListener('pointerlockerror', window.__COD_POINTER_LOCK_ERROR_HANDLER__);
    }
    window.__COD_POINTER_LOCK_ERRORS__ = 0;
    window.__COD_POINTER_LOCK_REJECTIONS__ = [];
    window.__COD_POINTER_LOCK_ERROR_HANDLER__ = () => { window.__COD_POINTER_LOCK_ERRORS__ += 1; };
    document.addEventListener('pointerlockerror', window.__COD_POINTER_LOCK_ERROR_HANDLER__);
    const canvas = document.querySelector('canvas');
    if (!window.__COD_POINTER_LOCK_ORIGINAL__) {
      window.__COD_POINTER_LOCK_ORIGINAL__ = canvas.requestPointerLock.bind(canvas);
      canvas.requestPointerLock = (...args) => {
        const request = window.__COD_POINTER_LOCK_ORIGINAL__(...args);
        request?.catch?.((error) => window.__COD_POINTER_LOCK_REJECTIONS__.push({ name: error.name, message: error.message }));
        return request;
      };
    }
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator(trigger).click();
    try {
      await page.waitForFunction(
        () => document.pointerLockElement === document.querySelector('canvas'),
        null,
        { timeout: 4000 },
      );
      return;
    } catch {
      if (attempt < 2) await page.waitForTimeout(100);
    }
  }
  const diagnostics = await page.evaluate(() => ({
    pointerLockErrors: window.__COD_POINTER_LOCK_ERRORS__,
    rejections: window.__COD_POINTER_LOCK_REJECTIONS__,
    focused: document.hasFocus(),
    visibility: document.visibilityState,
    pointerLockElement: document.pointerLockElement?.tagName ?? null,
  }));
  throw new Error(`Pointer lock failed after three real deploy clicks: ${JSON.stringify(diagnostics)}`);
}

await withDevServer(async () => {
  const browser = await launchBrowser();
  let normalBrowser = null;

  try {
    const { page, context, errors } = await newHarnessPage(browser, {
      // Use a neutral weapon shot so canonical combat-showcase automation cannot
      // mutate ammo while this test validates the player's own fire/reload state.
      shot: 'weapon_hip',
      scenario: 'playtest',
    });

    const initial = await page.evaluate(() => window.__COD_HARNESS__.snapshot());

    // Prefer a game-provided deterministic action driver.
    const hasRunAction = await page.evaluate(
      () => typeof window.__COD_HARNESS__.runAction === 'function',
    );

    let actionStates = null;
    if (hasRunAction) {
      actionStates = await page.evaluate(async () => {
        const h = window.__COD_HARNESS__;
        const states = {};
        states.afterMove = await h.runAction('move_forward', { frames: 30 });
        states.afterLook = await h.runAction('look_right', { frames: 3 });
        states.afterJump = await h.runAction('jump', { frames: 5 });
        await h.stepFrames(45);
        states.crouchHeld = await h.runAction('crouch_hold', { frames: 12 });
        states.leanHeld = await h.runAction('lean_right_hold', { frames: 12 });
        states.afterFire = await h.runAction('fire', { frames: 24 });
        states.adsOn = await h.runAction('ads_on', { frames: 18 });
        states.adsOff = await h.runAction('ads_off', { frames: 10 });
        states.reloadStarted = await h.runAction('reload', { frames: 8 });
        await h.stepFrames(130);
        states.reloadComplete = h.snapshot();
        await h.runAction('aim_at_enemy', { frames: 1 });
        await h.runAction('ads_on', { frames: 16 });
        states.afterEngagement = await h.runAction('engage_enemy', { frames: 42 });
        await h.runAction('ads_off', { frames: 4 });
        await h.reset({ seed: 1337, scenario: 'collision-test' });
        await h.setShot('weapon_hip');
        states.afterCollisionPush = await h.runAction('collision_push', { frames: 90 });
        await h.reset({ seed: 1337, scenario: 'interior-transition-test' });
        await h.setShot('weapon_hip');
        states.afterIndoorTransition = await h.runAction('indoor_transition', { frames: 45 });
        await h.reset({ seed: 1337, scenario: 'ai-cover-test' });
        await h.setShot('weapon_hip');
        states.beforeReposition = h.snapshot();
        states.afterReposition = await h.runAction('ai_take_damage', { frames: 360 });
        await h.reset({ seed: 1337, scenario: 'occlusion-test' });
        await h.setShot('weapon_hip');
        states.beforeOcclusion = h.snapshot();
        states.afterOcclusion = await h.runAction('cover_occlusion_check', { frames: 120 });
        await h.reset({ seed: 1337, scenario: 'death-test' });
        await h.setShot('weapon_hip');
        states.beforeDeath = h.snapshot();
        states.afterDeath = await h.runAction('force_player_death', { frames: 30 });
        await h.reset({ seed: 1337, scenario: 'death-reload-test' });
        await h.setShot('combat');
        states.afterDeathDuringReload = await h.runAction('death_during_reload', { frames: 150 });
        return states;
      });
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

    if (hasRunAction) {
      const moved = Math.hypot(
        actionStates.afterMove.player.position[0] - initial.player.position[0],
        actionStates.afterMove.player.position[2] - initial.player.position[2],
      );
      if (moved < 0.25) throw new Error(`Movement action had no meaningful effect: ${moved}`);
      if (Math.abs(actionStates.afterLook.player.yaw - actionStates.afterMove.player.yaw) < 0.05) {
        throw new Error('Look action did not change player yaw.');
      }
      if (actionStates.afterJump.player.grounded || actionStates.afterJump.player.position[1] <= 0.05) {
        throw new Error('Jump action did not produce a finite airborne state.');
      }
      if (actionStates.crouchHeld.player.stance !== 'crouch') {
        throw new Error('Crouch action did not enter the crouched stance.');
      }
      if (actionStates.leanHeld.player.lean < 0.04) {
        throw new Error('Lean action did not produce a visible camera lean.');
      }
      const leanOffset = Math.hypot(
        actionStates.leanHeld.player.cameraPosition[0] - actionStates.leanHeld.player.position[0],
        actionStates.leanHeld.player.cameraPosition[2] - actionStates.leanHeld.player.position[2],
      );
      if (leanOffset < 0.04) throw new Error(`Lean did not shift the aim origin laterally: ${leanOffset}`);
      if (actionStates.afterFire.weapon.ammo >= initial.weapon.ammo || actionStates.afterFire.weapon.shotsFired <= 0) {
        throw new Error('Fire action did not consume ammunition and record shots.');
      }
      if (!actionStates.adsOn.weapon.ads || actionStates.adsOn.weapon.adsBlend < 0.8) {
        throw new Error('ADS action did not reach an aimed state.');
      }
      if (actionStates.adsOff.weapon.ads || actionStates.adsOff.weapon.adsBlend > 0.25) {
        throw new Error('ADS release did not settle back to hip state.');
      }
      if (!actionStates.reloadStarted.weapon.reloading) throw new Error('Reload action did not enter a reload phase.');
      if (actionStates.reloadComplete.weapon.reloading || actionStates.reloadComplete.weapon.ammo !== 30 || actionStates.reloadComplete.weapon.reserve >= initial.weapon.reserve) {
        throw new Error('Reload did not complete with consistent magazine/reserve state.');
      }
      if (actionStates.afterEngagement.enemiesAlive >= initial.enemiesAlive) {
        throw new Error(`Deterministic aimed engagement did not kill an enemy: ${JSON.stringify(actionStates.afterEngagement)}`);
      }
      const collisionZ = actionStates.afterCollisionPush.player.position[2];
      if (collisionZ < -0.46 || collisionZ > -0.38) {
        throw new Error(`Player did not stop at the cover collision boundary: z=${collisionZ}`);
      }
      if (actionStates.afterIndoorTransition.player.position[0] < 7.2) {
        throw new Error(`Player could not cross the exterior/interior threshold: x=${actionStates.afterIndoorTransition.player.position[0]}`);
      }
      if (actionStates.afterIndoorTransition.audio.lastFootstepSurface !== 'tile') {
        throw new Error(`Interior traversal did not produce tile footsteps: ${JSON.stringify(actionStates.afterIndoorTransition.audio)}`);
      }
      const coverMove = Math.hypot(
        actionStates.afterReposition.enemies[0].position[0] - actionStates.beforeReposition.enemies[0].position[0],
        actionStates.afterReposition.enemies[0].position[2] - actionStates.beforeReposition.enemies[0].position[2],
      );
      if (coverMove < 2.0 || actionStates.afterReposition.enemies[0].state !== 'cover' || !actionStates.afterReposition.enemies[0].covering || actionStates.afterReposition.enemies[0].hasLos) {
        throw new Error(`Damaged AI did not reposition toward cover: move=${coverMove} state=${actionStates.afterReposition.enemies[0].state}`);
      }
      const occludedEnemy = actionStates.afterOcclusion.enemies[0];
      if (occludedEnemy.hasLos || occludedEnemy.state !== 'search') {
        throw new Error(`Occluded AI incorrectly saw the player: ${JSON.stringify(occludedEnemy)}`);
      }
      if (actionStates.afterOcclusion.player.health !== actionStates.beforeOcclusion.player.health) {
        throw new Error('Occluded AI damaged the player through cover.');
      }
      if (!actionStates.afterDeath.player.dead || actionStates.afterDeath.player.health !== 0) {
        throw new Error('Forced lethal damage did not enter the player death state.');
      }
      if (actionStates.afterDeath.weapon.shotsFired !== actionStates.beforeDeath.weapon.shotsFired) {
        throw new Error('Weapon continued firing after player death.');
      }
      const deathMove = Math.hypot(
        actionStates.afterDeath.player.position[0] - actionStates.beforeDeath.player.position[0],
        actionStates.afterDeath.player.position[2] - actionStates.beforeDeath.player.position[2],
      );
      if (deathMove > 0.001) throw new Error(`Player moved after death: ${deathMove}`);
      if (!actionStates.afterDeathDuringReload.player.dead || actionStates.afterDeathDuringReload.weapon.reloading || actionStates.afterDeathDuringReload.weapon.ammo !== 7 || actionStates.afterDeathDuringReload.weapon.reserve !== 120) {
        throw new Error(`Death did not cancel reload atomically: ${JSON.stringify(actionStates.afterDeathDuringReload)}`);
      }
      if (actionStates.afterDeathDuringReload.enemies.filter((enemy) => enemy.alive).some((enemy) => enemy.state !== 'hold')) {
        throw new Error('AI continued combat behavior after player death.');
      }
    }

    console.log(JSON.stringify({
      ok: true,
      usedDeterministicActions: hasRunAction,
      initial,
      actionStates,
      final: finalState,
    }, null, 2));

    await context.close();

    normalBrowser = await launchBrowser({ headless: false });
    const normalContext = await normalBrowser.newContext({ viewport: { width: config.width, height: config.height } });
    const normalPage = await normalContext.newPage();
    const normalErrors = [];
    normalPage.on('pageerror', (error) => normalErrors.push(`pageerror: ${error.message}`));
    normalPage.on('console', (message) => {
      if (message.type() !== 'error') return;
      const location = message.location();
      normalErrors.push(`console: ${message.text()} (${location.url || 'unknown'}:${location.lineNumber ?? 0})`);
    });
    await normalPage.goto(config.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await normalPage.waitForFunction(() => window.__COD_HARNESS__?.ready === true, null, { timeout: config.timeoutMs });
    const pausedInitial = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    if (!pausedInitial.paused) throw new Error('Normal mode advanced before deployment.');
    await acquirePointerLock(normalPage);
    await normalPage.waitForFunction(() => window.__COD_HARNESS__.snapshot().paused === false, null, { timeout: config.timeoutMs });
    const deployed = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    await normalPage.keyboard.down('KeyW');
    await normalPage.waitForTimeout(260);
    await normalPage.keyboard.up('KeyW');
    await normalPage.mouse.move(config.width * 0.62, config.height * 0.48, { steps: 3 });
    await normalPage.mouse.down({ button: 'left' });
    await normalPage.waitForTimeout(180);
    await normalPage.mouse.up({ button: 'left' });
    await normalPage.waitForTimeout(180);
    const liveInput = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    const liveMove = Math.hypot(liveInput.player.position[0] - deployed.player.position[0], liveInput.player.position[2] - deployed.player.position[2]);
    if (liveMove < 0.1 || Math.abs(liveInput.player.yaw - deployed.player.yaw) < 0.01 || liveInput.weapon.shotsFired <= deployed.weapon.shotsFired) {
      throw new Error(`Real keyboard/mouse input did not drive gameplay: ${JSON.stringify({ deployed, liveInput })}`);
    }
    if (liveInput.audio.state !== 'running' || liveInput.audio.eventsPlayed <= 0 || liveInput.audio.spatialEvents <= 0 || !liveInput.audio.reverbReady) {
      throw new Error(`Web Audio did not produce active spatial/reverb feedback: ${JSON.stringify(liveInput.audio)}`);
    }
    const enemyFeedback = await normalPage.evaluate(() => window.__COD_HARNESS__.runAction('enemy_fire_feedback', { frames: 4 }));
    if (!enemyFeedback.enemies[0]?.hasLos || enemyFeedback.enemies[0]?.state !== 'engage') {
      throw new Error(`Enemy failed to acquire the player across a staged open world path: ${JSON.stringify(enemyFeedback.enemies[0])}`);
    }
    if (enemyFeedback.audio.enemyShotEvents <= 0 || enemyFeedback.fx.enemyMuzzleEvents <= 0) {
      throw new Error(`Enemy fire lacked independently proven source feedback: ${JSON.stringify({ audio: enemyFeedback.audio, fx: enemyFeedback.fx })}`);
    }
    await normalPage.evaluate(() => document.exitPointerLock());
    await normalPage.waitForFunction(() => document.pointerLockElement === null && window.__COD_HARNESS__.snapshot().paused === true, null, { timeout: config.timeoutMs });
    const pausedBefore = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    await normalPage.keyboard.down('KeyW');
    await normalPage.waitForTimeout(240);
    await normalPage.keyboard.up('KeyW');
    const pausedAfter = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    if (pausedAfter.frame !== pausedBefore.frame || JSON.stringify(pausedAfter.player.position) !== JSON.stringify(pausedBefore.player.position)) {
      throw new Error('Simulation continued behind the briefing after pointer-lock release.');
    }
    await acquirePointerLock(normalPage);
    await normalPage.waitForFunction(() => window.__COD_HARNESS__.snapshot().paused === false, null, { timeout: config.timeoutMs });
    await normalPage.evaluate(() => window.__COD_HARNESS__.runAction('force_player_death', { frames: 2 }));
    await normalPage.waitForFunction(() => !document.querySelector('#death-screen').hidden, null, { timeout: config.timeoutMs });
    await normalPage.locator('#restart-button').click();
    await normalPage.waitForFunction(() => {
      const state = window.__COD_HARNESS__.snapshot();
      return !state.player.dead
        && state.player.health === 100
        && !state.paused
        && document.querySelector('#death-screen').hidden
        && document.querySelector('#briefing').classList.contains('is-hidden')
        && document.pointerLockElement === document.querySelector('canvas');
    }, null, { timeout: config.timeoutMs });
    const redeployed = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    if (redeployed.audio.eventsPlayed !== 0 || redeployed.audio.spatialEvents !== 0 || redeployed.audio.activeVoices !== 0 || redeployed.audio.enemyShotEvents !== 0) {
      throw new Error(`Redeploy retained prior-session audio state: ${JSON.stringify(redeployed.audio)}`);
    }
    await normalPage.waitForTimeout(180);
    const resumed = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    if (resumed.paused || resumed.frame <= redeployed.frame) {
      throw new Error(`Redeploy did not resume simulation: ${JSON.stringify({ redeployed, resumed })}`);
    }
    await normalPage.evaluate(() => window.__COD_HARNESS__.runAction('force_player_death', { frames: 2 }));
    await normalPage.waitForFunction(
      () => !document.querySelector('#death-screen').hidden && document.pointerLockElement === null,
      null,
      { timeout: config.timeoutMs },
    );
    await normalPage.evaluate(() => {
      document.querySelector('canvas').requestPointerLock = () => Promise.reject(new DOMException('forced test rejection', 'NotAllowedError'));
    });
    await normalPage.locator('#restart-button').click();
    await normalPage.waitForFunction(() => {
      const state = window.__COD_HARNESS__.snapshot();
      return !state.player.dead
        && state.player.health === 100
        && state.paused
        && document.querySelector('#death-screen').hidden
        && !document.querySelector('#briefing').classList.contains('is-hidden')
        && document.pointerLockElement === null;
    }, null, { timeout: config.timeoutMs });
    const rejectedRedeploy = await normalPage.evaluate(() => window.__COD_HARNESS__.snapshot());
    assertNoBrowserErrors(normalErrors);
    console.log(JSON.stringify({ ok: true, normalMode: { deployed, liveInput, pausedBefore, pausedAfter, redeployed, resumed, rejectedRedeploy } }, null, 2));
    await normalContext.close();
  } finally {
    await normalBrowser?.close();
    await browser.close();
  }
});
