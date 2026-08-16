const DAMAGE_INDICATOR_SECONDS = 1.35;
const DAMAGE_INDICATOR_SLOTS = 4;

const clockText = (seconds) => {
  const total = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export class UISystem {
  static id = 'ui';
  static deps = ['match', 'player', 'weapons', 'ai'];

  async init(ctx) {
    this.ctx = ctx;
    this.hitTimer = 0;
    this.damageTimer = 0;
    this.killTimer = 0;
    this.lastAmmo = '';
    this.lastHealth = '';
    this.lastAlive = '';
    this.lastBearing = -1;
    this.lastWeaponState = '';
    this.lastScores = '';
    this.lastClock = '';
    this.lastFeedSequence = -1;
    this.lastPhase = '';
    this.lastZone = '';
    this.lastRespawn = '';
    this.scoreboardOpen = false;
    this.domState = Object.create(null);
    this.damageSources = Array.from({ length: DAMAGE_INDICATOR_SLOTS }, () => ({ source: null, x: 0, z: 0, life: 0, strength: 0 }));
    this.announceTimer = 0;
    this.announceKey = '';
    this.lastLead = 'tied';
    this.matchPointShown = false;
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    if (ctx.harness.active) this.root.classList.add('is-harness');
    this.root.innerHTML = `
      <div class="hud-vignette" aria-hidden="true"></div>
      <div class="hud-scanlines" aria-hidden="true"></div>
      <section class="hud-match" aria-label="Match state">
        <div class="hud-team is-alpha"><span>ALPHA</span><b id="score-alpha">0</b></div>
        <div class="hud-clock"><b id="match-clock">10:00</b><i id="match-mode">TEAM DEATHMATCH · 100</i></div>
        <div class="hud-team is-bravo"><b id="score-bravo">0</b><span>BRAVO</span></div>
      </section>
      <section class="hud-objective" aria-label="Current objective">
        <div class="hud-kicker"><span class="hud-pulse"></span> OPERATION NIGHTGLASS</div>
        <div class="hud-objective-title" id="objective-title">ELIMINATE BRAVO · FIRST TO 100</div>
        <div class="hud-objective-meta"><span id="zone-label">SABLE MARKET</span><b id="enemy-count">6 HOSTILES</b></div>
      </section>
      <div class="hud-compass" aria-label="Compass"><span>W</span><i></i><span>NW</span><i></i><strong id="bearing">N&nbsp;&nbsp;000</strong><i></i><span>NE</span><i></i><span>E</span></div>
      <div class="hud-crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hud-hitmarker" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hud-damage" aria-hidden="true">${'<i></i>'.repeat(DAMAGE_INDICATOR_SLOTS)}</div>
      <div class="hud-kill" id="kill-feed" role="status"></div>
      <div class="hud-announce" id="announce" role="status"><b id="announce-text"></b><span id="announce-sub"></span></div>
      <ul class="hud-feed" id="match-feed" aria-label="Kill feed"></ul>
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
      <div class="hud-controls">SHIFT SPRINT&nbsp;&nbsp;·&nbsp;&nbsp;Q/E LEAN&nbsp;&nbsp;·&nbsp;&nbsp;R RELOAD&nbsp;&nbsp;·&nbsp;&nbsp;TAB SCORES</div>
      <div class="hud-countdown" id="prematch" hidden><b id="prematch-value">3</b><span>DEPLOYING</span></div>
      <div class="hud-death" id="death-screen" hidden><div><span id="death-cause">ELIMINATED</span><b>RESPAWNING</b><em id="respawn-timer">4</em></div></div>
      <div class="hud-end" id="match-end" hidden><div class="end-card">
        <span id="end-result">VICTORY</span>
        <b id="end-score">100 — 84</b>
        <p id="end-reason">Score limit reached.</p>
        <div id="end-board" class="end-board"></div>
        <button id="restart-button" type="button">REMATCH</button>
      </div></div>
      <div class="hud-scoreboard" id="scoreboard" hidden><div class="board-wrap" id="board-wrap"></div></div>
      <div class="hud-briefing" id="briefing">
        <div class="briefing-card">
          <div class="briefing-eyebrow">TEAM DEATHMATCH // 6v6 // 04:17 LOCAL</div>
          <h1>NIGHTGLASS</h1>
          <p>You lead Alpha into the Sable district. Six of you against six of Bravo. First team to 100 eliminations wins; the clock ends it at ten minutes.</p>
          <div class="briefing-grid"><span><b>WASD</b> MOVE</span><span><b>MOUSE</b> AIM</span><span><b>LMB</b> FIRE</span><span><b>RMB</b> ADS</span><span><b>R</b> RELOAD</span><span><b>TAB</b> SCORES</span></div>
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
      announce: this.root.querySelector('#announce'), announceText: this.root.querySelector('#announce-text'), announceSub: this.root.querySelector('#announce-sub'),
      damage: [...this.root.querySelectorAll('.hud-damage i')],
      condition: [...this.root.querySelectorAll('.hud-condition i')], reloadTrack: this.root.querySelector('.hud-reload-track'), reloadFill: this.root.querySelector('.hud-reload-track i'),
      death: this.root.querySelector('#death-screen'), restart: this.root.querySelector('#restart-button'),
      scoreAlpha: this.root.querySelector('#score-alpha'), scoreBravo: this.root.querySelector('#score-bravo'),
      clock: this.root.querySelector('#match-clock'), feed: this.root.querySelector('#match-feed'),
      zone: this.root.querySelector('#zone-label'), deathCause: this.root.querySelector('#death-cause'),
      respawnTimer: this.root.querySelector('#respawn-timer'), prematch: this.root.querySelector('#prematch'),
      prematchValue: this.root.querySelector('#prematch-value'), end: this.root.querySelector('#match-end'),
      endResult: this.root.querySelector('#end-result'), endScore: this.root.querySelector('#end-score'),
      endReason: this.root.querySelector('#end-reason'), endBoard: this.root.querySelector('#end-board'),
      scoreboard: this.root.querySelector('#scoreboard'), boardWrap: this.root.querySelector('#board-wrap'),
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
      else if (this.ctx.get('match').phase === 'ended') this.els.briefing.classList.add('is-hidden');
      else this.els.briefing.classList.remove('is-hidden');
      ctx.events.emit('game:pause-changed', { paused: !locked });
    };
    document.addEventListener('pointerlockchange', this.onLock);
    this.onKey = (event) => {
      if (event.code !== 'Tab') return;
      event.preventDefault();
      this.scoreboardOpen = event.type === 'keydown';
    };
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
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
    // Directional damage: without it a player shot from behind only knows they
    // are losing health, not where to turn. Sources are pooled and re-aimed each
    // frame from the attacker's world position.
    this.offPlayerDamage = ctx.events.on('player:damaged', (event) => {
      if (event.x == null) return;
      const existing = this.damageSources.find((entry) => entry.source === event.source && entry.life > 0);
      const slot = existing ?? this.damageSources.find((entry) => entry.life <= 0);
      if (!slot) return;
      slot.source = event.source;
      slot.x = event.x; slot.z = event.z;
      slot.life = DAMAGE_INDICATOR_SECONDS;
      // A single rifle hit must already be clearly readable; repeated hits from
      // the same shooter drive it to full.
      slot.strength = Math.min(1, (existing ? slot.strength : 0.62) + event.amount / 90);
    });
    this.offDeath = ctx.events.on('actor:died', (event) => {
      if (event.actorType !== 'player') return;
      const killer = ctx.get('match').getParticipant(event.source);
      this.els.deathCause.textContent = killer ? `ELIMINATED BY ${killer.name}` : 'ELIMINATED';
      this.root.classList.add('is-dead');
      this.els.briefing.classList.add('is-hidden');
    });
  }

  installStyles() {
    this.style = document.createElement('style');
    this.style.textContent = `
      .hud-briefing[hidden]{display:none!important}.hud-briefing.is-hidden,.hud-briefing.is-hidden *{pointer-events:none!important}.hud-root.is-dead .hud-crosshair,.hud-root.is-dead .hud-hitmarker,.hud-root.is-dead .hud-kill{opacity:0!important}.hud-scanlines{opacity:.025!important}.hud-root.is-harness *{transition:none!important;animation:none!important}
      :root{--hud:#d9eef1;--cyan:#83e6e4;--amber:#ffb35a;--danger:#ff5d4b;--bravo:#ff8b5a}.hud-root,.hud-root *{box-sizing:border-box}.hud-root{position:fixed;inset:0;pointer-events:none;color:var(--hud);font-family:Inter,ui-sans-serif,system-ui,sans-serif;text-shadow:0 1px 3px #000;letter-spacing:.06em;z-index:10}.hud-scanlines{position:absolute;inset:0;opacity:.055;background:repeating-linear-gradient(0deg,transparent 0 3px,#a8dce8 4px);mix-blend-mode:screen}.hud-vignette{position:absolute;inset:0;background:radial-gradient(circle at center,transparent 45%,rgba(0,0,0,.46) 100%),radial-gradient(circle at center,transparent 58%,rgba(120,0,0,0) 72%);transition:background .08s}.hud-vignette.is-hit{background:radial-gradient(circle at center,transparent 46%,rgba(130,0,0,.58) 100%)}
      .hud-match{position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:18px;padding:8px 18px;background:linear-gradient(180deg,rgba(4,15,20,.82),rgba(4,15,20,.28));border-bottom:1px solid rgba(134,209,210,.28)}.hud-team{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:800}.hud-team b{font:800 26px/1 ui-monospace,monospace}.hud-team.is-alpha b,.hud-team.is-alpha span{color:var(--cyan)}.hud-team.is-bravo b,.hud-team.is-bravo span{color:var(--bravo)}.hud-clock{text-align:center;min-width:120px}.hud-clock b{display:block;font:700 20px/1 ui-monospace,monospace}.hud-clock i{display:block;font-style:normal;font-size:8px;color:#8ba0a4;margin-top:4px}
      .hud-objective{position:absolute;left:34px;top:30px;padding:13px 16px 12px;border-left:2px solid var(--cyan);background:linear-gradient(90deg,rgba(4,15,20,.72),rgba(4,15,20,.08));min-width:280px}.hud-kicker,.hud-label,.hud-firemode{font-size:10px;color:#92a8ac}.hud-pulse{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 9px var(--cyan);margin-right:7px}.hud-objective-title{font-weight:800;font-size:13px;margin-top:5px}.hud-objective-meta{display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:#8ba0a4}.hud-objective-meta b{color:var(--amber)}
      .hud-compass{position:absolute;top:96px;left:50%;transform:translateX(-50%);width:360px;display:flex;gap:16px;align-items:center;justify-content:center;font:10px/1 ui-monospace,monospace;color:#8da3a7}.hud-compass i{height:5px;width:1px;background:#91a9ad}.hud-compass strong{color:white;font-size:12px;border-top:2px solid var(--amber);padding-top:8px}
      .hud-crosshair{--gap:10px;position:absolute;left:50%;top:50%;width:1px;height:1px}.hud-crosshair i{position:absolute;background:rgba(228,247,247,.85);box-shadow:0 0 3px #000}.hud-crosshair i:nth-child(1),.hud-crosshair i:nth-child(2){height:1px;width:7px;top:0}.hud-crosshair i:nth-child(1){right:var(--gap)}.hud-crosshair i:nth-child(2){left:var(--gap)}.hud-crosshair i:nth-child(3),.hud-crosshair i:nth-child(4){width:1px;height:7px;left:0}.hud-crosshair i:nth-child(3){bottom:var(--gap)}.hud-crosshair i:nth-child(4){top:var(--gap)}.hud-crosshair b{position:absolute;width:2px;height:2px;background:var(--amber);transform:translate(-.5px,-.5px)}.hud-hitmarker{position:absolute;left:50%;top:50%;opacity:0;transition:opacity .04s}.hud-hitmarker.is-visible{opacity:1}.hud-hitmarker i{position:absolute;width:9px;height:2px;background:white;box-shadow:0 0 4px #000}.hud-hitmarker i:nth-child(1){transform:translate(-13px,-10px) rotate(45deg)}.hud-hitmarker i:nth-child(2){transform:translate(4px,-10px) rotate(-45deg)}.hud-hitmarker i:nth-child(3){transform:translate(-13px,8px) rotate(-45deg)}.hud-hitmarker i:nth-child(4){transform:translate(4px,8px) rotate(45deg)}.hud-hitmarker.is-kill i{background:var(--danger)}.hud-announce{position:absolute;left:50%;top:20%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .25s}.hud-announce.is-visible{opacity:1}.hud-announce b{display:block;font-size:26px;font-weight:900;letter-spacing:.2em;color:var(--amber);text-shadow:0 2px 14px rgba(0,0,0,.9)}.hud-announce span{display:block;font-size:10px;letter-spacing:.28em;color:#c2d3d6;margin-top:5px}.hud-announce.is-bad b{color:var(--danger)}.hud-announce.is-good b{color:var(--cyan)}.hud-damage{position:absolute;left:50%;top:50%;width:0;height:0}.hud-damage i{position:absolute;left:-34px;top:-110px;width:68px;height:0;opacity:0;border-left:34px solid transparent;border-right:34px solid transparent;border-bottom:30px solid rgba(255,104,74,.96);transform-origin:50% 110px;transition:opacity .1s;will-change:transform,opacity}.hud-kill{position:absolute;left:50%;top:56%;transform:translateX(-50%);font-size:12px;font-weight:800;color:var(--amber);opacity:0;transition:opacity .2s}.hud-kill.is-visible{opacity:1}
      .hud-feed{position:absolute;right:34px;top:120px;list-style:none;margin:0;padding:0;text-align:right;font-size:11px;font-weight:700;max-width:330px}.hud-feed li{margin-bottom:5px;padding:3px 8px;background:rgba(4,15,20,.55);display:inline-block}.hud-feed b{font-weight:800}.hud-feed .t-alpha{color:var(--cyan)}.hud-feed .t-bravo{color:var(--bravo)}.hud-feed i{font-style:normal;color:#8ba0a4;margin:0 6px}
      .hud-health{position:absolute;left:34px;bottom:32px;width:245px}.hud-health-row{display:flex;gap:12px;align-items:center}.hud-health-row b{font:700 26px/1 ui-monospace,monospace}.hud-health-track{height:5px;flex:1;background:rgba(180,220,225,.2)}.hud-health-track i{display:block;width:100%;height:100%;background:linear-gradient(90deg,var(--cyan),#e5fcfb);box-shadow:0 0 8px rgba(131,230,228,.5)}.hud-condition{display:flex;gap:4px;margin:8px 0 0 44px}.hud-condition i{width:38px;height:3px;background:rgba(111,137,144,.25)}.hud-condition i.is-active{background:#6f8990}.hud-root.is-critical .hud-health-row b{color:var(--danger)}.hud-root.is-critical .hud-health-track i,.hud-root.is-critical .hud-condition i.is-active{background:linear-gradient(90deg,var(--danger),#ff947d);box-shadow:0 0 9px rgba(255,93,75,.55)}
      .hud-ammo{position:absolute;right:34px;bottom:30px;text-align:right}.hud-weapon{font-weight:800;font-size:13px}.hud-weapon span{font-size:9px;color:#7d969b;margin-left:8px}.hud-ammo-row{display:flex;justify-content:flex-end;align-items:end;gap:10px;margin-top:3px}.hud-ammo-row b{font:800 44px/.9 ui-monospace,monospace}.hud-ammo-row i{width:1px;height:29px;background:#688087}.hud-ammo-row span{font:16px/1 ui-monospace,monospace;color:#9aadb0}.hud-firemode{margin-top:8px}.hud-firemode span{color:var(--cyan)}.hud-reload-track{height:2px;width:100%;margin-top:6px;background:rgba(131,230,228,.16);opacity:0}.hud-reload-track.is-visible{opacity:1}.hud-reload-track i{display:block;height:100%;width:0;background:var(--amber);box-shadow:0 0 7px var(--amber)}.hud-controls{position:absolute;bottom:13px;left:50%;transform:translateX(-50%);font-size:9px;color:#779095}
      .hud-countdown[hidden],.hud-death[hidden],.hud-end[hidden],.hud-scoreboard[hidden]{display:none}.hud-countdown{position:absolute;inset:0;display:grid;place-items:center;text-align:center}.hud-countdown b{display:block;font:800 96px/1 ui-monospace,monospace;color:var(--cyan);text-shadow:0 0 40px rgba(131,230,228,.5)}.hud-countdown span{font-size:11px;letter-spacing:.32em;color:#9fb6b9}
      .hud-death{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle,rgba(38,8,5,.2),rgba(3,4,5,.72));text-align:center}.hud-death span{display:block;color:var(--danger);font-size:11px;letter-spacing:.2em}.hud-death b{display:block;font-size:30px;margin:10px 0 6px;letter-spacing:.12em}.hud-death em{display:block;font:800 54px/1 ui-monospace,monospace;font-style:normal;color:var(--amber)}
      .hud-end{position:absolute;inset:0;display:grid;place-items:center;pointer-events:auto;background:radial-gradient(circle at 50% 40%,rgba(10,26,31,.72),rgba(2,5,7,.95))}.end-card{width:min(560px,calc(100vw - 32px));padding:36px;border:1px solid rgba(134,209,210,.28);border-left:3px solid var(--cyan);background:linear-gradient(145deg,rgba(8,22,26,.95),rgba(6,11,14,.95));text-align:center}.end-card span{display:block;font-size:40px;font-weight:900;letter-spacing:.18em;color:var(--cyan)}.hud-end.is-defeat .end-card{border-left-color:var(--danger)}.hud-end.is-defeat .end-card span{color:var(--danger)}.end-card b{display:block;font:800 26px/1 ui-monospace,monospace;margin:12px 0 6px}.end-card p{font-size:11px;color:#9fb1b4;margin:0 0 18px}.end-board{font-size:11px;margin-bottom:20px}.end-board div{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(134,209,210,.12)}.end-card button{pointer-events:auto;width:100%;height:48px;border:1px solid var(--cyan);background:rgba(94,205,203,.14);color:white;font-weight:900;letter-spacing:.16em;cursor:pointer}.end-card button:hover,.end-card button:focus-visible{background:rgba(94,205,203,.3);outline:2px solid white;outline-offset:2px}
      .hud-scoreboard{position:absolute;inset:0;display:grid;place-items:center;background:rgba(2,6,8,.72)}.board-wrap{display:flex;gap:20px}.board-team{width:290px;border-top:2px solid var(--cyan);background:rgba(5,16,20,.92);padding:14px}.board-team.is-bravo{border-top-color:var(--bravo)}.board-head{display:flex;justify-content:space-between;font-weight:900;font-size:13px;margin-bottom:10px}.board-team.is-bravo .board-head{color:var(--bravo)}.board-team.is-alpha .board-head{color:var(--cyan)}.board-row{display:grid;grid-template-columns:1fr 34px 34px 52px;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(134,209,210,.1);color:#c6d8da}.board-row.is-dead{opacity:.45}.board-row.is-human{color:#fff;font-weight:800}.board-row i{font-style:normal;text-align:right}.board-legend{display:grid;grid-template-columns:1fr 34px 34px 52px;font-size:9px;color:#7f979b;padding-bottom:4px}
      .hud-briefing{position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(15,31,36,.58),rgba(2,6,8,.94));backdrop-filter:blur(5px);transition:opacity .25s}.hud-briefing.is-hidden{opacity:0;pointer-events:none}.briefing-card{width:min(520px,calc(100vw - 32px));padding:42px;border:1px solid rgba(134,209,210,.25);border-left:3px solid var(--cyan);background:linear-gradient(145deg,rgba(8,22,26,.94),rgba(6,11,14,.94));box-shadow:0 25px 80px #000}.briefing-eyebrow{font-size:10px;color:var(--cyan)}.briefing-card h1{font-size:52px;line-height:1;margin:13px 0 16px;letter-spacing:.13em}.briefing-card p{font-size:13px;line-height:1.7;color:#aebec0;letter-spacing:.02em}.briefing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:24px 0;font-size:9px;color:#778d91}.briefing-grid b{display:block;color:white;font-size:11px;margin-bottom:3px}.briefing-card button{pointer-events:auto;width:100%;height:48px;border:1px solid var(--cyan);background:rgba(94,205,203,.12);color:white;font-weight:900;letter-spacing:.16em;cursor:pointer}.briefing-card button:hover,.briefing-card button:focus-visible{background:rgba(94,205,203,.28);outline:2px solid white;outline-offset:2px}.briefing-card button i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 9px var(--cyan);margin-right:9px}.briefing-card small{display:block;text-align:center;color:#65777a;font-size:9px;margin-top:14px}
      @media(max-width:680px){.hud-match{top:8px;gap:10px;padding:6px 12px}.hud-match .hud-team b{font-size:20px}.hud-objective{left:14px;top:74px;min-width:190px;padding:8px 12px}.hud-objective-title{font-size:11px}.hud-compass{top:172px;width:280px}.hud-controls{display:none}.hud-health{left:16px;bottom:20px;width:170px}.hud-ammo{right:16px;bottom:20px}.hud-ammo-row b{font-size:34px}.hud-feed{right:14px;top:170px;font-size:10px}.briefing-card{padding:28px}.briefing-card h1{font-size:38px}.briefing-grid{grid-template-columns:repeat(2,1fr)}.board-wrap{flex-direction:column;gap:10px}.board-team{width:min(320px,calc(100vw - 24px))}}`;
    document.head.appendChild(this.style);
  }

  fixedUpdate(step) {
    if (this.announceTimer > 0) {
      this.announceTimer = Math.max(0, this.announceTimer - step);
      if (this.announceTimer === 0) this.els.announce.classList.remove('is-visible');
    }
    for (const entry of this.damageSources) {
      if (entry.life > 0) entry.life = Math.max(0, entry.life - step);
    }
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

  // Live-match capture and playback need the real HUD, not the shot-staged one.
  showHud() {
    this.root.style.display = '';
    this.els.briefing.hidden = true;
  }

  reset() {
    this.hitTimer = 0; this.damageTimer = 0; this.killTimer = 0; this.lastAmmo = ''; this.lastHealth = ''; this.lastAlive = ''; this.lastBearing = -1; this.lastWeaponState = '';
    this.lastScores = ''; this.lastClock = ''; this.lastFeedSequence = -1; this.lastPhase = ''; this.lastZone = ''; this.lastRespawn = '';
    this.scoreboardOpen = false;
    this.domState = Object.create(null);
    for (const entry of this.damageSources) { entry.life = 0; entry.strength = 0; entry.source = null; }
    this.announceTimer = 0; this.announceKey = ''; this.lastLead = 'tied'; this.matchPointShown = false;
    this.els.announce.classList.remove('is-visible', 'is-good', 'is-bad');
    this.els.death.hidden = true; this.els.end.hidden = true; this.els.prematch.hidden = true; this.els.scoreboard.hidden = true;
    this.els.feed.replaceChildren();
    this.root.classList.remove('is-critical', 'is-dead'); this.els.end.classList.remove('is-defeat');
    this.els.hit.classList.remove('is-visible', 'is-kill'); this.els.kill.classList.remove('is-visible');
  }

  update() {
    const player = this.ctx.get('player');
    const weapon = this.ctx.get('weapons');
    const match = this.ctx.get('match');
    const ai = this.ctx.get('ai');

    const ammoText = String(weapon.ammo).padStart(2, '0');
    const healthText = String(Math.ceil(player.health)).padStart(3, '0');
    if (ammoText !== this.lastAmmo) { this.els.ammo.textContent = ammoText; this.els.reserve.textContent = String(weapon.reserve).padStart(3, '0'); this.lastAmmo = ammoText; }
    if (healthText !== this.lastHealth) {
      this.els.health.textContent = healthText; this.els.healthFill.style.width = `${player.health}%`; this.root.classList.toggle('is-critical', player.health <= 30);
      const activeSegments = player.health <= 0 ? 0 : player.health <= 33 ? 1 : player.health <= 66 ? 2 : 3; this.els.condition.forEach((segment, index) => segment.classList.toggle('is-active', index < activeSegments)); this.lastHealth = healthText;
    }
    const aliveText = `${ai.aliveCount()}/${ai.alliesAlive() + (player.dead ? 0 : 1)}`;
    if (aliveText !== this.lastAlive) {
      this.els.enemy.textContent = `${ai.aliveCount()} HOSTILE${ai.aliveCount() === 1 ? '' : 'S'} UP`;
      this.lastAlive = aliveText;
    }
    const degrees = Math.round(((-player.yaw * 180 / Math.PI) % 360 + 360) % 360);
    if (degrees !== this.lastBearing) { this.els.bearing.innerHTML = `N&nbsp;&nbsp;${String(degrees).padStart(3, '0')}`; this.lastBearing = degrees; }
    const zone = this.ctx.get('world').zoneName(this.ctx.get('world').zoneAt(player.position.x, player.position.z, player.position.y)).toUpperCase();
    if (zone !== this.lastZone) { this.els.zone.textContent = zone; this.lastZone = zone; }

    const scores = match.getScores();
    const scoreKey = `${scores.alpha}:${scores.bravo}`;
    if (scoreKey !== this.lastScores) {
      this.els.scoreAlpha.textContent = String(scores.alpha);
      this.els.scoreBravo.textContent = String(scores.bravo);
      this.lastScores = scoreKey;
    }
    const clock = clockText(match.getTimeRemaining());
    if (clock !== this.lastClock) { this.els.clock.textContent = clock; this.lastClock = clock; }

    this.updateAnnouncements(match, scores);

    const feed = match.getKillFeed();
    if (feed.length && feed[0].sequence !== this.lastFeedSequence) {
      this.lastFeedSequence = feed[0].sequence;
      this.renderFeed(feed);
    }

    this.updatePhase(match, player);
    if (this.scoreboardOpen !== !this.els.scoreboard.hidden) {
      this.els.scoreboard.hidden = !this.scoreboardOpen;
      if (this.scoreboardOpen) this.renderScoreboard(match);
    }

    const weaponState = weapon.reloading ? weapon.getReloadPhase().replace('_', ' ').toUpperCase() : weapon.ads ? 'ADS' : 'READY';
    if (weaponState !== this.lastWeaponState) { this.els.weaponState.textContent = weaponState; this.lastWeaponState = weaponState; }
    // Every write below runs on a render frame, so each one is change-guarded.
    // Unconditional style writes dirty the layout tree each frame and show up as
    // a regular dropped-frame beat rather than as extra draw calls.
    this.setState('reloading', weapon.reloading, (value) => this.els.reloadTrack.classList.toggle('is-visible', value));
    const reloadPercent = weapon.reloading ? Math.round(Math.min(100, weapon.reloadTimer / weapon.reloadDuration * 100)) : 0;
    this.setState('reloadPercent', reloadPercent, (value) => { this.els.reloadFill.style.width = `${value}%`; });
    const spread = Math.round(7 + Math.min(14, Math.hypot(player.velocity.x, player.velocity.z) * 1.3) + weapon.recoilPitch * 90 - weapon.adsBlend * 5);
    this.setState('spread', Math.max(2, spread), (value) => this.els.crosshair.style.setProperty('--gap', `${value}px`));
    this.setState('crosshairHidden', weapon.adsBlend > 0.92, (value) => { this.els.crosshair.style.opacity = value ? '0' : '1'; });
    this.setState('hit', this.hitTimer > 0, (value) => this.els.hit.classList.toggle('is-visible', value));
    this.setState('damage', this.damageTimer > 0, (value) => this.els.vignette.classList.toggle('is-hit', value));
    this.setState('killBanner', this.killTimer > 0, (value) => this.els.kill.classList.toggle('is-visible', value));
    this.updateDamageIndicators(player);
  }

  // Bearing is recomputed from the attacker's world position every frame so the
  // arc tracks the shooter as the player turns, which is what makes it usable
  // for actually finding them rather than just noticing you were hit.
  updateDamageIndicators(player) {
    for (let i = 0; i < this.damageSources.length; i += 1) {
      const entry = this.damageSources[i];
      const element = this.els.damage[i];
      if (!element) continue;
      if (entry.life <= 0) {
        this.setState(`dmg${i}`, 0, () => { element.style.opacity = '0'; });
        continue;
      }
      const dx = entry.x - player.position.x;
      const dz = entry.z - player.position.z;
      // Project onto the player's own forward/right axes. Using atan2(dx, dz)
      // directly puts "straight ahead" at 180 degrees, which pointed every
      // indicator the wrong way round.
      const sin = Math.sin(player.yaw); const cos = Math.cos(player.yaw);
      const forward = dx * -sin + dz * -cos;
      const right = dx * cos + dz * -sin;
      const degrees = Math.round(Math.atan2(right, forward) * 180 / Math.PI);
      const fade = Math.min(1, entry.life / DAMAGE_INDICATOR_SECONDS);
      const opacity = Math.round(fade * entry.strength * 100) / 100;
      this.setState(`dmgA${i}`, degrees, (value) => { element.style.transform = `rotate(${value}deg)`; });
      this.setState(`dmg${i}`, opacity, (value) => { element.style.opacity = String(value); });
    }
  }

  setState(key, value, apply) {
    if (this.domState[key] === value) return;
    this.domState[key] = value;
    apply(value);
  }

  updatePhase(match, player) {
    const phase = match.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.els.prematch.hidden = phase !== 'prematch';
      if (phase === 'ended') this.showMatchEnd(match); else this.els.end.hidden = true;
      if (phase !== 'ended' && !this.ctx.harness.active && document.pointerLockElement !== this.ctx.canvas) this.els.briefing.classList.remove('is-hidden');
    }
    if (phase === 'prematch') {
      const value = String(Math.max(1, Math.ceil(match.prematchTimer)));
      if (value !== this.lastRespawn) { this.els.prematchValue.textContent = value; this.lastRespawn = value; }
      return;
    }
    const participant = match.getParticipant('player');
    const dying = player.dead && phase === 'active';
    this.setState('dying', dying, (value) => { this.els.death.hidden = !value; });
    this.setState('deadClass', player.dead, (value) => this.root.classList.toggle('is-dead', value));
    if (dying) {
      const value = String(Math.max(0, Math.ceil(participant.respawnTimer)));
      if (value !== this.lastRespawn) { this.els.respawnTimer.textContent = value; this.lastRespawn = value; }
    }
  }

  // Match milestones read off authoritative scores. Without these a TDM has no
  // sense of momentum: the score just ticks and the match ends abruptly.
  updateAnnouncements(match, scores) {
    if (match.phase !== 'active') {
      if (this.announceTimer > 0) { this.announceTimer = 0; this.els.announce.classList.remove('is-visible'); }
      return;
    }
    const lead = scores.alpha === scores.bravo ? 'tied' : scores.alpha > scores.bravo ? 'alpha' : 'bravo';
    const remaining = Math.min(scores.limit - scores.alpha, scores.limit - scores.bravo);
    // Proportional to the ruleset: 5 kills out at the default limit of 100, but
    // a scenario running a short limit should not call match point at 1-0.
    const matchPointAt = Math.max(2, Math.round(scores.limit * 0.05));
    if (!this.matchPointShown && remaining <= matchPointAt && remaining > 0) {
      this.matchPointShown = true;
      this.announce('MATCH POINT', `${scores.limit - Math.max(scores.alpha, scores.bravo)} TO WIN`, lead === 'alpha' ? 'is-good' : 'is-bad');
    } else if (lead !== this.lastLead && scores.alpha + scores.bravo > 0) {
      if (lead === 'tied') this.announce('SCORES LEVEL', `${scores.alpha} — ${scores.bravo}`, '');
      else if (lead === 'alpha') this.announce('ALPHA LEADS', `${scores.alpha} — ${scores.bravo}`, 'is-good');
      else this.announce('BRAVO LEADS', `${scores.alpha} — ${scores.bravo}`, 'is-bad');
    }
    this.lastLead = lead;
  }

  announce(text, sub, tone) {
    const key = `${text}:${sub}`;
    if (key === this.announceKey && this.announceTimer > 0) return;
    this.announceKey = key;
    this.announceTimer = 2.6;
    this.els.announceText.textContent = text;
    this.els.announceSub.textContent = sub;
    this.els.announce.classList.remove('is-good', 'is-bad');
    if (tone) this.els.announce.classList.add(tone);
    this.els.announce.classList.add('is-visible');
  }

  renderFeed(feed) {
    const list = document.createDocumentFragment();
    for (const entry of feed) {
      const item = document.createElement('li');
      const killer = entry.killer
        ? `<b class="t-${entry.killerTeam}">${entry.killer}</b>`
        : '<b>—</b>';
      const marker = entry.friendly ? 'TEAM KILL' : entry.headshot ? 'HEADSHOT' : 'ELIMINATED';
      item.innerHTML = `${killer}<i>${marker}</i><b class="t-${entry.victimTeam}">${entry.victim}</b>`;
      list.appendChild(item);
    }
    this.els.feed.replaceChildren(list);
  }

  renderScoreboard(match) {
    const wrap = document.createDocumentFragment();
    for (const team of match.getScoreboard()) {
      const panel = document.createElement('div');
      panel.className = `board-team is-${team.id}`;
      const rows = team.players.map((entry) => `<div class="board-row${entry.alive ? '' : ' is-dead'}${entry.kind === 'human' ? ' is-human' : ''}"><span>${entry.name}</span><i>${entry.kills}</i><i>${entry.deaths}</i><i>${entry.score}</i></div>`).join('');
      panel.innerHTML = `<div class="board-head"><span>${team.name}</span><span>${team.score}</span></div><div class="board-legend"><span>OPERATOR</span><i>K</i><i>D</i><i>PTS</i></div>${rows}`;
      wrap.appendChild(panel);
    }
    this.els.boardWrap.replaceChildren(wrap);
  }

  showMatchEnd(match) {
    const scores = match.getScores();
    const playerTeam = 'alpha';
    const won = match.winner === playerTeam;
    this.els.end.hidden = false;
    this.els.end.classList.toggle('is-defeat', !won && match.winner !== 'draw');
    this.els.endResult.textContent = match.winner === 'draw' ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
    this.els.endScore.textContent = `${scores.alpha} — ${scores.bravo}`;
    this.els.endReason.textContent = match.endReason === 'score-limit' ? 'Score limit reached.' : 'Time limit reached.';
    const board = match.getScoreboard();
    this.els.endBoard.innerHTML = board.map((team) => `<div><span>${team.name}</span><span>${team.score}</span></div>`).join('');
    this.els.death.hidden = true;
    if (!this.ctx.harness.active) document.exitPointerLock?.();
  }

  dispose() {
    this.offHit?.(); this.offDamage?.(); this.offPlayerDamage?.(); this.offDeath?.();
    document.removeEventListener('pointerlockchange', this.onLock);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    this.root.querySelector('#deploy-button')?.removeEventListener('click', this.onDeploy);
    this.els.restart?.removeEventListener('click', this.onRestart);
    this.root.remove();
    this.style.remove();
  }
}
