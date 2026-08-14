export class UISystem {
  static id = 'ui';
  static deps = ['player', 'weapons', 'ai'];

  async init(ctx) {
    this.ctx = ctx;
    this.hitTimer = 0;
    this.damageTimer = 0;
    this.killTimer = 0;
    this.lastAmmo = '';
    this.lastHealth = '';
    this.lastEnemies = '';
    this.lastBearing = -1;
    this.lastWeaponState = '';
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    if (ctx.harness.active) this.root.classList.add('is-harness');
    this.root.innerHTML = `
      <div class="hud-vignette" aria-hidden="true"></div>
      <div class="hud-scanlines" aria-hidden="true"></div>
      <section class="hud-objective" aria-label="Current objective">
        <div class="hud-kicker"><span class="hud-pulse"></span> OPERATION NIGHTGLASS</div>
        <div class="hud-objective-title">SECURE THE MARKET BLOCK</div>
        <div class="hud-objective-meta"><span>ALPHA</span><b id="enemy-count">4 HOSTILES</b></div>
      </section>
      <div class="hud-compass" aria-label="Compass"><span>W</span><i></i><span>NW</span><i></i><strong id="bearing">N&nbsp;&nbsp;000</strong><i></i><span>NE</span><i></i><span>E</span></div>
      <div class="hud-crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hud-hitmarker" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hud-kill" id="kill-feed" role="status"></div>
      <section class="hud-health" aria-label="Player health">
        <div class="hud-label">VITALS</div><div class="hud-health-row"><b id="health-value">100</b><div class="hud-health-track"><i id="health-fill"></i></div></div>
        <div class="hud-condition" aria-label="Health condition"><i></i><i></i><i></i></div>
      </section>
      <section class="hud-ammo" aria-label="Ammunition">
        <div class="hud-weapon">VX-12 <span>5.56 NATO</span></div>
        <div class="hud-ammo-row"><b id="ammo-value">30</b><i></i><span id="reserve-value">120</span></div>
        <div class="hud-firemode">AUTO&nbsp;&nbsp;•&nbsp;&nbsp;<span id="weapon-state">READY</span></div>
        <div class="hud-reload-track" aria-hidden="true"><i></i></div>
      </section>
      <div class="hud-controls">SHIFT SPRINT&nbsp;&nbsp;·&nbsp;&nbsp;Q/E LEAN&nbsp;&nbsp;·&nbsp;&nbsp;R RELOAD</div>
      <div class="hud-death" id="death-screen" hidden><div><span>OPERATOR DOWN</span><b>MISSION FAILED</b><button id="restart-button" type="button">REDEPLOY</button></div></div>
      <div class="hud-briefing" id="briefing">
        <div class="briefing-card">
          <div class="briefing-eyebrow">TACTICAL INSERTION // 04:17 LOCAL</div>
          <h1>NIGHTGLASS</h1>
          <p>Hostile forces control the old market corridor. Push through the block, clear the squad, and hold the junction.</p>
          <div class="briefing-grid"><span><b>WASD</b> MOVE</span><span><b>MOUSE</b> AIM</span><span><b>LMB</b> FIRE</span><span><b>RMB</b> ADS</span><span><b>R</b> RELOAD</span><span><b>CTRL</b> CROUCH</span></div>
          <button id="deploy-button" type="button"><i></i> DEPLOY</button>
          <small>ESC releases mouse control</small>
        </div>
      </div>`;
    document.querySelector('#app').appendChild(this.root);
    this.installStyles();
    this.els = {
      enemy: this.root.querySelector('#enemy-count'), bearing: this.root.querySelector('#bearing'),
      health: this.root.querySelector('#health-value'), healthFill: this.root.querySelector('#health-fill'),
      ammo: this.root.querySelector('#ammo-value'), reserve: this.root.querySelector('#reserve-value'),
      weaponState: this.root.querySelector('#weapon-state'), hit: this.root.querySelector('.hud-hitmarker'),
      vignette: this.root.querySelector('.hud-vignette'), kill: this.root.querySelector('#kill-feed'),
      crosshair: this.root.querySelector('.hud-crosshair'), briefing: this.root.querySelector('#briefing'),
      condition: [...this.root.querySelectorAll('.hud-condition i')], reloadTrack: this.root.querySelector('.hud-reload-track'), reloadFill: this.root.querySelector('.hud-reload-track i'),
      death: this.root.querySelector('#death-screen'), restart: this.root.querySelector('#restart-button'),
    };
    if (ctx.harness.active) this.els.briefing.hidden = true;
    this.onDeploy = () => {
      const request = ctx.canvas.requestPointerLock?.();
      request?.catch?.(() => this.els.briefing.classList.remove('is-hidden'));
    };
    this.root.querySelector('#deploy-button').addEventListener('click', this.onDeploy);
    this.onRestart = () => {
      const request = ctx.canvas.requestPointerLock?.();
      if (request?.catch) request.catch(() => this.els.briefing.classList.remove('is-hidden'));
      else this.els.briefing.classList.remove('is-hidden');
      ctx.events.emit('game:restart-request', {});
    };
    this.els.restart.addEventListener('click', this.onRestart);
    this.onLock = () => {
      if (ctx.harness.active) return;
      const locked = document.pointerLockElement === ctx.canvas;
      if (locked) this.els.briefing.classList.add('is-hidden');
      else if (ctx.get('player').dead) this.els.briefing.classList.add('is-hidden');
      else this.els.briefing.classList.remove('is-hidden');
      ctx.events.emit('game:pause-changed', { paused: !locked });
    };
    document.addEventListener('pointerlockchange', this.onLock);
    this.offHit = ctx.events.on('combat:hit', (event) => {
      this.hitTimer = 0.15;
      this.els.hit.classList.toggle('is-kill', event.killed);
      if (event.killed) {
        this.killTimer = 2.4;
        this.els.kill.textContent = `HOSTILE DOWN  +${event.hitZone === 'head' ? '125' : '100'}`;
      }
    });
    this.offDamage = ctx.events.on('combat:damage', (event) => {
      if (event.targetType === 'player') this.damageTimer = 0.42;
    });
    this.offDeath = ctx.events.on('actor:died', (event) => {
      if (event.actorType !== 'player') return;
      this.els.death.hidden = false;
      this.root.classList.add('is-dead');
      this.els.briefing.classList.add('is-hidden');
      if (!ctx.harness.active) document.exitPointerLock?.();
    });
  }

  installStyles() {
    this.style = document.createElement('style');
    this.style.textContent = `
      .hud-briefing[hidden]{display:none!important}.hud-briefing.is-hidden,.hud-briefing.is-hidden *{pointer-events:none!important}.hud-root.is-dead .hud-crosshair,.hud-root.is-dead .hud-hitmarker,.hud-root.is-dead .hud-kill{opacity:0!important}.hud-scanlines{opacity:.025!important}.hud-root.is-harness *{transition:none!important;animation:none!important}
      :root{--hud:#d9eef1;--cyan:#83e6e4;--amber:#ffb35a;--danger:#ff5d4b}.hud-root,.hud-root *{box-sizing:border-box}.hud-root{position:fixed;inset:0;pointer-events:none;color:var(--hud);font-family:Inter,ui-sans-serif,system-ui,sans-serif;text-shadow:0 1px 3px #000;letter-spacing:.06em;z-index:10}.hud-scanlines{position:absolute;inset:0;opacity:.055;background:repeating-linear-gradient(0deg,transparent 0 3px,#a8dce8 4px);mix-blend-mode:screen}.hud-vignette{position:absolute;inset:0;background:radial-gradient(circle at center,transparent 45%,rgba(0,0,0,.46) 100%),radial-gradient(circle at center,transparent 58%,rgba(120,0,0,0) 72%);transition:background .08s}.hud-vignette.is-hit{background:radial-gradient(circle at center,transparent 46%,rgba(130,0,0,.58) 100%)}.hud-objective{position:absolute;left:34px;top:30px;padding:13px 16px 12px;border-left:2px solid var(--cyan);background:linear-gradient(90deg,rgba(4,15,20,.72),rgba(4,15,20,.08));min-width:280px}.hud-kicker,.hud-label,.hud-firemode{font-size:10px;color:#92a8ac}.hud-pulse{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 9px var(--cyan);margin-right:7px}.hud-objective-title{font-weight:800;font-size:14px;margin-top:5px}.hud-objective-meta{display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:#8ba0a4}.hud-objective-meta b{color:var(--amber)}.hud-compass{position:absolute;top:26px;left:50%;transform:translateX(-50%);width:360px;display:flex;gap:16px;align-items:center;justify-content:center;font:10px/1 ui-monospace,monospace;color:#8da3a7}.hud-compass i{height:5px;width:1px;background:#91a9ad}.hud-compass strong{color:white;font-size:12px;border-top:2px solid var(--amber);padding-top:8px}.hud-crosshair{--gap:10px;position:absolute;left:50%;top:50%;width:1px;height:1px}.hud-crosshair i{position:absolute;background:rgba(228,247,247,.85);box-shadow:0 0 3px #000}.hud-crosshair i:nth-child(1),.hud-crosshair i:nth-child(2){height:1px;width:7px;top:0}.hud-crosshair i:nth-child(1){right:var(--gap)}.hud-crosshair i:nth-child(2){left:var(--gap)}.hud-crosshair i:nth-child(3),.hud-crosshair i:nth-child(4){width:1px;height:7px;left:0}.hud-crosshair i:nth-child(3){bottom:var(--gap)}.hud-crosshair i:nth-child(4){top:var(--gap)}.hud-crosshair b{position:absolute;width:2px;height:2px;background:var(--amber);transform:translate(-.5px,-.5px)}.hud-hitmarker{position:absolute;left:50%;top:50%;opacity:0;transition:opacity .04s}.hud-hitmarker.is-visible{opacity:1}.hud-hitmarker i{position:absolute;width:9px;height:2px;background:white;box-shadow:0 0 4px #000}.hud-hitmarker i:nth-child(1){transform:translate(-13px,-10px) rotate(45deg)}.hud-hitmarker i:nth-child(2){transform:translate(4px,-10px) rotate(-45deg)}.hud-hitmarker i:nth-child(3){transform:translate(-13px,8px) rotate(-45deg)}.hud-hitmarker i:nth-child(4){transform:translate(4px,8px) rotate(45deg)}.hud-hitmarker.is-kill i{background:var(--danger)}.hud-kill{position:absolute;left:50%;top:56%;transform:translateX(-50%);font-size:12px;font-weight:800;color:var(--amber);opacity:0;transition:opacity .2s}.hud-kill.is-visible{opacity:1}.hud-health{position:absolute;left:34px;bottom:32px;width:245px}.hud-health-row{display:flex;gap:12px;align-items:center}.hud-health-row b{font:700 26px/1 ui-monospace,monospace}.hud-health-track{height:5px;flex:1;background:rgba(180,220,225,.2)}.hud-health-track i{display:block;width:100%;height:100%;background:linear-gradient(90deg,var(--cyan),#e5fcfb);box-shadow:0 0 8px rgba(131,230,228,.5)}.hud-condition{display:flex;gap:4px;margin:8px 0 0 44px}.hud-condition i{width:38px;height:3px;background:rgba(111,137,144,.25)}.hud-condition i.is-active{background:#6f8990}.hud-root.is-critical .hud-health-row b{color:var(--danger)}.hud-root.is-critical .hud-health-track i,.hud-root.is-critical .hud-condition i.is-active{background:linear-gradient(90deg,var(--danger),#ff947d);box-shadow:0 0 9px rgba(255,93,75,.55)}.hud-ammo{position:absolute;right:34px;bottom:30px;text-align:right}.hud-weapon{font-weight:800;font-size:13px}.hud-weapon span{font-size:9px;color:#7d969b;margin-left:8px}.hud-ammo-row{display:flex;justify-content:flex-end;align-items:end;gap:10px;margin-top:3px}.hud-ammo-row b{font:800 44px/.9 ui-monospace,monospace}.hud-ammo-row i{width:1px;height:29px;background:#688087}.hud-ammo-row span{font:16px/1 ui-monospace,monospace;color:#9aadb0}.hud-firemode{margin-top:8px}.hud-firemode span{color:var(--cyan)}.hud-reload-track{height:2px;width:100%;margin-top:6px;background:rgba(131,230,228,.16);opacity:0}.hud-reload-track.is-visible{opacity:1}.hud-reload-track i{display:block;height:100%;width:0;background:var(--amber);box-shadow:0 0 7px var(--amber)}.hud-controls{position:absolute;bottom:13px;left:50%;transform:translateX(-50%);font-size:9px;color:#779095}.hud-death[hidden]{display:none}.hud-death{position:absolute;inset:0;display:grid;place-items:center;pointer-events:auto;background:radial-gradient(circle,rgba(38,8,5,.25),rgba(3,4,5,.88));text-align:center}.hud-death span{display:block;color:var(--danger);font-size:11px}.hud-death b{display:block;font-size:38px;margin:8px 0 22px}.hud-death button{pointer-events:auto;border:1px solid var(--danger);background:rgba(95,14,9,.4);color:white;padding:14px 32px;font-weight:900;letter-spacing:.16em;cursor:pointer}.hud-death button:focus-visible{outline:2px solid white;outline-offset:3px}.hud-briefing{position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(15,31,36,.58),rgba(2,6,8,.94));backdrop-filter:blur(5px);transition:opacity .25s}.hud-briefing.is-hidden{opacity:0;pointer-events:none}.briefing-card{width:min(520px,calc(100vw - 32px));padding:42px;border:1px solid rgba(134,209,210,.25);border-left:3px solid var(--cyan);background:linear-gradient(145deg,rgba(8,22,26,.94),rgba(6,11,14,.94));box-shadow:0 25px 80px #000}.briefing-eyebrow{font-size:10px;color:var(--cyan)}.briefing-card h1{font-size:52px;line-height:1;margin:13px 0 16px;letter-spacing:.13em}.briefing-card p{font-size:13px;line-height:1.7;color:#aebec0;letter-spacing:.02em}.briefing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:24px 0;font-size:9px;color:#778d91}.briefing-grid b{display:block;color:white;font-size:11px;margin-bottom:3px}.briefing-card button{pointer-events:auto;width:100%;height:48px;border:1px solid var(--cyan);background:rgba(94,205,203,.12);color:white;font-weight:900;letter-spacing:.16em;cursor:pointer}.briefing-card button:hover,.briefing-card button:focus-visible{background:rgba(94,205,203,.28);outline:2px solid white;outline-offset:2px}.briefing-card button i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 9px var(--cyan);margin-right:9px}.briefing-card small{display:block;text-align:center;color:#65777a;font-size:9px;margin-top:14px}@media(max-width:680px){.hud-objective{left:14px;top:14px;min-width:220px}.hud-compass{top:112px;width:280px}.hud-controls{display:none}.hud-health{left:16px;bottom:20px;width:170px}.hud-ammo{right:16px;bottom:20px}.hud-ammo-row b{font-size:34px}.briefing-card{padding:28px}.briefing-card h1{font-size:38px}.briefing-grid{grid-template-columns:repeat(2,1fr)}}`;
    document.head.appendChild(this.style);
  }

  fixedUpdate(step) {
    this.hitTimer = Math.max(0, this.hitTimer - step);
    this.damageTimer = Math.max(0, this.damageTimer - step);
    this.killTimer = Math.max(0, this.killTimer - step);
  }

  setShot(name, ctx) {
    const show = ['weapon_hip', 'weapon_ads', 'combat', 'fx', 'hud'].includes(name);
    if (ctx.harness.active) this.root.style.display = show ? '' : 'none';
    if (name === 'hud') {
      this.hitTimer = 999;
      this.damageTimer = 999;
      this.killTimer = 999;
      this.els.hit.classList.add('is-kill');
      this.els.kill.textContent = 'HOSTILE DOWN  +125';
    }
  }

  reset() {
    this.hitTimer = 0; this.damageTimer = 0; this.killTimer = 0; this.lastAmmo = ''; this.lastHealth = ''; this.lastEnemies = ''; this.lastBearing = -1; this.lastWeaponState = '';
    this.els.death.hidden = true; this.root.classList.remove('is-critical', 'is-dead'); this.els.hit.classList.remove('is-visible', 'is-kill'); this.els.kill.classList.remove('is-visible');
  }

  update() {
    const player = this.ctx.get('player');
    const weapon = this.ctx.get('weapons');
    const alive = this.ctx.get('ai').aliveCount();
    const ammoText = String(weapon.ammo).padStart(2, '0');
    const healthText = String(Math.ceil(player.health)).padStart(3, '0');
    if (ammoText !== this.lastAmmo) { this.els.ammo.textContent = ammoText; this.els.reserve.textContent = String(weapon.reserve).padStart(3, '0'); this.lastAmmo = ammoText; }
    if (healthText !== this.lastHealth) {
      this.els.health.textContent = healthText; this.els.healthFill.style.width = `${player.health}%`; this.root.classList.toggle('is-critical', player.health <= 30);
      const activeSegments = player.health <= 0 ? 0 : player.health <= 33 ? 1 : player.health <= 66 ? 2 : 3; this.els.condition.forEach((segment, index) => segment.classList.toggle('is-active', index < activeSegments)); this.lastHealth = healthText;
    }
    if (alive !== this.lastEnemies) { this.els.enemy.textContent = alive ? `${alive} HOSTILE${alive === 1 ? '' : 'S'}` : 'BLOCK SECURED'; this.lastEnemies = alive; }
    const degrees = Math.round(((-player.yaw * 180 / Math.PI) % 360 + 360) % 360);
    if (degrees !== this.lastBearing) { this.els.bearing.innerHTML = `N&nbsp;&nbsp;${String(degrees).padStart(3, '0')}`; this.lastBearing = degrees; }
    const weaponState = weapon.reloading ? weapon.getReloadPhase().replace('_', ' ').toUpperCase() : weapon.ads ? 'ADS' : 'READY';
    if (weaponState !== this.lastWeaponState) { this.els.weaponState.textContent = weaponState; this.lastWeaponState = weaponState; }
    this.els.reloadTrack.classList.toggle('is-visible', weapon.reloading); this.els.reloadFill.style.width = `${weapon.reloading ? Math.min(100, weapon.reloadTimer / weapon.reloadDuration * 100) : 0}%`;
    const spread = 7 + Math.min(14, Math.hypot(player.velocity.x, player.velocity.z) * 1.3) + weapon.recoilPitch * 90 - weapon.adsBlend * 5;
    this.els.crosshair.style.setProperty('--gap', `${Math.max(2, spread)}px`);
    this.els.crosshair.style.opacity = weapon.adsBlend > 0.92 ? '0' : '1';
    this.els.hit.classList.toggle('is-visible', this.hitTimer > 0);
    this.els.vignette.classList.toggle('is-hit', this.damageTimer > 0);
    this.els.kill.classList.toggle('is-visible', this.killTimer > 0);
  }

  dispose() {
    this.offHit?.(); this.offDamage?.(); this.offDeath?.();
    document.removeEventListener('pointerlockchange', this.onLock);
    this.root.querySelector('#deploy-button')?.removeEventListener('click', this.onDeploy);
    this.els.restart?.removeEventListener('click', this.onRestart);
    this.root.remove();
    this.style.remove();
  }
}
