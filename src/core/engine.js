import { AISystem } from '../ai/ai-system.js';
import { DeterministicRng } from './rng.js';
import { EventBus } from './events.js';
import { InputState } from './input.js';
import { runScenario } from './scenarios.js';
import { FrameProfiler } from './frame-profiler.js';

export class Engine {
  constructor({ scene, camera, viewScene, viewCamera, canvas, config = {} }) {
    this.systems = [];
    this.systemMap = new Map();
    this.fixed = 1 / 60;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.paused = false;
    this.raf = 0;

    const events = new EventBus();
    const rng = new DeterministicRng(1337);
    const input = new InputState(canvas);
    this.profiler = new FrameProfiler();
    this.ctx = {
      scene,
      camera,
      viewScene,
      viewCamera,
      canvas,
      config,
      events,
      input,
      rng,
      time: { elapsed: 0, dt: this.fixed, fixed: this.fixed, alpha: 0, frame: 0, scale: 1 },
      harness: { active: false, scenario: 'default', shot: 'overview', seed: 1337 },
      get: (id) => {
        const system = this.systemMap.get(id);
        if (!system) throw new Error(`System not available: ${id}`);
        return system;
      },
      peek: (id) => this.systemMap.get(id) ?? null,
      has: (id) => this.systemMap.has(id),
    };
  }

  register(system) {
    const id = system.constructor.id;
    if (!id || this.systemMap.has(id)) throw new Error(`Invalid or duplicate system id: ${id}`);
    this.systems.push(system);
    this.systemMap.set(id, system);
    return this;
  }

  async init() {
    const initialized = new Set();
    for (const system of this.systems) {
      const deps = system.constructor.deps ?? [];
      for (const dep of deps) {
        if (!this.systemMap.has(dep)) throw new Error(`${system.constructor.id} requires ${dep}`);
        if (!initialized.has(dep)) throw new Error(`${system.constructor.id} requires ${dep} to initialize first`);
      }
      await system.init?.(this.ctx);
      initialized.add(system.constructor.id);
    }
  }

  simulateStep() {
    const { ctx } = this;
    ctx.input.consumeLook();
    ctx.time.dt = this.fixed;
    ctx.time.fixed = this.fixed;
    ctx.time.elapsed += this.fixed * ctx.time.scale;
    ctx.time.frame += 1;
    if (!this.profiler.enabled) {
      for (const system of this.systems) system.fixedUpdate?.(this.fixed, ctx);
      return;
    }
    for (const system of this.systems) {
      if (!system.fixedUpdate) continue;
      const start = performance.now();
      system.fixedUpdate(this.fixed, ctx);
      this.profiler.accumulate(system.constructor.id, 'fixed', performance.now() - start);
    }
  }

  renderFrame(dt = this.fixed) {
    const { ctx } = this;
    ctx.time.dt = dt;
    if (!this.profiler.enabled) {
      for (const system of this.systems) system.update?.(dt, ctx);
      for (const system of this.systems) system.lateUpdate?.(dt, ctx);
      return;
    }
    for (const system of this.systems) {
      if (!system.update) continue;
      const start = performance.now();
      system.update(dt, ctx);
      this.profiler.accumulate(system.constructor.id, 'update', performance.now() - start);
    }
    for (const system of this.systems) {
      if (!system.lateUpdate) continue;
      const start = performance.now();
      system.lateUpdate(dt, ctx);
      this.profiler.accumulate(system.constructor.id, 'late', performance.now() - start);
    }
  }

  stepFrames(count) {
    const frames = Math.max(0, Math.min(10000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < frames; i += 1) {
      this.simulateStep();
      this.renderFrame(this.fixed);
    }
  }

  // Scenario acceleration: gameplay lives entirely in fixedUpdate, so a long
  // soak can advance the simulation at full rate while rendering occasionally
  // to keep view-side systems (FX, viewmodel, audio) ticking honestly.
  simulateFrames(count, renderEvery = 12, onStep = null) {
    const frames = Math.max(0, Math.min(200000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < frames; i += 1) {
      this.simulateStep();
      if (renderEvery > 0 && i % renderEvery === 0) this.renderFrame(this.fixed * renderEvery);
      if (onStep && onStep(i) === false) return i + 1;
    }
    return frames;
  }

  async reset({ seed = 1337, scenario = 'default', render = true } = {}) {
    const numericSeed = Number(seed);
    const resolvedSeed = Number.isFinite(numericSeed) ? numericSeed >>> 0 : 1337;
    this.stop();
    this.accumulator = 0;
    this.ctx.time.elapsed = 0;
    this.ctx.time.frame = 0;
    this.ctx.time.alpha = 0;
    this.ctx.harness.seed = resolvedSeed;
    this.ctx.harness.scenario = String(scenario);
    this.ctx.rng.setSeed(resolvedSeed);
    this.ctx.input.clear();
    for (const system of this.systems) await system.reset?.(this.ctx);
    if (this.ctx.harness.active) await this.applyShot('overview', false);
    this.ctx.events.emit('game:reset', { seed: resolvedSeed, scenario: this.ctx.harness.scenario });
    if (render) this.renderFrame(0);
  }

  async setShot(name) {
    const shots = this.listShots();
    if (!shots.includes(name)) throw new Error(`Unknown canonical shot: ${name}`);
    if (this.ctx.harness.active) await this.reset({ seed: this.ctx.harness.seed, scenario: this.ctx.harness.scenario, render: false });
    await this.applyShot(name, true);
  }

  async applyShot(name, render = true) {
    this.ctx.harness.shot = name;
    for (const system of this.systems) await system.setShot?.(name, this.ctx);
    if (render) this.renderFrame(0);
  }

  listShots() {
    return ['overview', 'street', 'interior', 'weapon_hip', 'weapon_ads', 'combat', 'enemy', 'material_close', 'lighting', 'fx', 'hud'];
  }

  snapshot() {
    const player = this.ctx.peek('player');
    const ai = this.ctx.peek('ai');
    return {
      frame: this.ctx.time.frame,
      seed: this.ctx.harness.seed,
      scenario: this.ctx.harness.scenario,
      shot: this.ctx.harness.shot,
      paused: this.paused,
      player: player?.snapshot?.() ?? null,
      weapon: this.ctx.peek('weapons')?.snapshot?.() ?? null,
      enemiesAlive: ai?.aliveCount?.() ?? 0,
      enemies: ai?.snapshot?.() ?? [],
      match: this.ctx.peek('match')?.snapshot?.() ?? null,
      audio: this.ctx.peek('audio')?.snapshot?.() ?? null,
      fx: this.ctx.peek('fx')?.snapshot?.() ?? null,
    };
  }

  getGameplayReport() {
    return this.ctx.get('match').getReport();
  }

  // Leaves harness shot staging and runs the real 6v6 match. Capture and
  // scenario tools use this so they observe live gameplay, not a posed shot.
  enterMatchMode() {
    this.ctx.get('ai').enterMatchMode();
    this.ctx.get('match').forceStart();
    this.ctx.get('render').usePlayerCamera(true);
    this.ctx.get('ui').showHud();
    return this.snapshot();
  }

  // Capture-only spectator move: parks the player camera somewhere in the map so
  // a live match can be photographed. It stages a pose and changes no match state.
  stagePlayerView({ position, yaw = 0, pitch = 0 }) {
    this.ctx.get('render').usePlayerCamera(true);
    const player = this.ctx.get('player');
    player.stageHarnessPose({ position, yaw, pitch, eyeHeight: 1.7, stance: 'stand' });
    // Push the camera out of any solid it landed inside and stand it on the real
    // floor. A capture point buried in a container photographs the inside of that
    // container, which reads as broken geometry and has already produced one
    // false defect report.
    const physics = this.ctx.get('physics');
    physics.resolveActor(player.position, 0.36);
    player.position.y = physics.groundHeightAt(player.position.x, player.position.z, player.position.y, 0.46);
    player.groundY = player.position.y;
    player.syncCamera(this.ctx, true);
    this.renderFrame(0);
    return this.snapshot();
  }

  async runScenario(name, options = {}) {
    return runScenario(this, name, options);
  }

  async runAction(name, options = {}) {
    const frames = Math.max(1, Math.min(600, Math.floor(Number(options.frames) || 1)));
    const input = this.ctx.input;
    // Deterministic actions probe live combat behaviour, so they run against an
    // active match rather than spending their frame budget in the deploy count.
    this.ctx.peek('match')?.forceStart();
    const aimAtEnemy = () => {
      const target = this.ctx.peek('ai')?.getAimPoint?.();
      if (!target) return;
      this.ctx.get('player').aimAtPoint(target);
    };
    const map = {
      move_forward: 'forward',
      move_backward: 'backward',
      sprint_forward: 'sprint',
      fire: 'fire',
      ads_on: 'ads',
      reload: 'reload',
      crouch: 'crouch',
      jump: 'jump',
    };
    // Duel benchmark. Measures how long a bot needs to kill the player under
    // controlled conditions, and how long the player needs to kill a bot, using
    // production combat on both sides. Kept deliberately separate from the
    // scripted-human soak: this measures the combat MODEL, not how well a
    // scripted driver plays.
    if (name === 'measure_duel') {
      const ai = this.ctx.get('ai');
      const player = this.ctx.get('player');
      const input = this.ctx.input;
      this.setPaused(false);
      this.ctx.peek('match')?.forceStart();
      input.clearVirtual();

      const range = Number(options.range ?? 5);
      const mode = String(options.mode ?? 'stationary');
      const bot = ai.stageCharacter(this.ctx);
      if (!bot) return this.snapshot();
      // Put the player at the requested range, facing the bot.
      player.stageHarnessPose({ position: [0, 0, range], yaw: 0, pitch: 0, eyeHeight: 1.7, stance: mode === 'crouch' ? 'crouch' : 'stand' });
      this.ctx.peek('match')?.clearProtection();
      bot.stationary = true;
      bot.targetId = 'player';
      bot.state = 'engage';
      bot.hasLos = true;
      bot.lastSeenAge = 0;
      bot.lastSeen.copy(player.position);
      bot.fireCooldown = 0;
      player.health = 100;
      player.dead = false;

      const maxFrames = Math.max(60, Math.floor(Number(options.frames) || 900));
      let frames = 0;
      let losBrokenAt = null;
      while (frames < maxFrames && player.health > 0 && !player.dead) {
        // Target behaviour under test.
        if (mode === 'moving') {
          input.setVirtual('left', (Math.floor(frames / 26) % 2) === 0);
          input.setVirtual('right', (Math.floor(frames / 26) % 2) === 1);
        } else if (mode === 'breaking-los' && frames === 30) {
          // Step out of the engagement entirely.
          player.position.set(0, 0, range + 40);
          losBrokenAt = frames;
        }
        this.stepFrames(1);
        frames += 1;
      }
      input.clearVirtual();
      const botTtk = player.health <= 0 || player.dead ? Number((frames / 60).toFixed(2)) : null;
      const healthLeft = Math.max(0, Math.round(player.health));

      // Player side: perfect aim held on a bot, production weapon path.
      const weapons = this.ctx.get('weapons');
      const target = ai.stageCharacter(this.ctx);
      player.stageHarnessPose({ position: [0, 0, range], yaw: 0, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
      target.stationary = true; target.health = 100; target.alive = true;
      weapons.resetLoadout?.();
      player.health = 100; player.dead = false;
      this.stepFrames(2);
      player.aimAtPoint({ x: target.root.position.x, y: target.root.position.y + 1.2, z: target.root.position.z });
      let shotFrames = 0;
      input.setVirtual('fire', true);
      while (shotFrames < 300 && target.alive) { this.stepFrames(1); shotFrames += 1; }
      input.setVirtual('fire', false);
      const playerTtk = target.alive ? null : Number((shotFrames / 60).toFixed(2));

      input.clearVirtual();
      this.setPaused(true);
      return {
        ...this.snapshot(),
        duel: { mode, range, botTtk, playerTtk, healthLeft, losBrokenAt, framesRun: frames },
      };
    }

    // Recoil verification. Fires a controlled magazine through the real input and
    // weapon path - nothing writes pitch directly - and samples the player's
    // actual aim alongside the viewmodel's own recoil state, so the two can be
    // checked for disagreement. Reports its own diagnostics (ammo, shots,
    // paused) so a run that fails to fire is visible rather than silently
    // reporting zero displacement.
    if (name === 'measure_recoil') {
      const player = this.ctx.get('player');
      const weapons = this.ctx.get('weapons');
      const input = this.ctx.input;
      this.setPaused(false);
      this.ctx.peek('match')?.forceStart();
      input.clearVirtual();
      player.stageHarnessPose({ position: [0, 0, 6], yaw: 0, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
      weapons.resetLoadout?.();
      this.stepFrames(4);

      const deg = (radians) => Number((radians * 180 / Math.PI).toFixed(3));
      const sample = () => ({
        pitch: deg(player.pitch),
        pending: deg(player.recoilPending ?? 0),
        viewKick: deg(weapons.recoilKick ?? 0),
        viewPitch: deg(weapons.recoilPitch ?? 0),
      });

      const startAmmo = weapons.ammo;
      const initial = sample();
      const series = [];
      // Track the peak in radians and convert once; comparing a radian pitch
      // against a value already converted to degrees froze the peak after frame 1.
      let peakRad = player.pitch;
      let peakFrame = 0;
      const burst = [];

      // Hold the trigger for a full magazine, one frame at a time.
      input.setVirtual('fire', true);
      let frame = 0;
      const maxFrames = Math.max(1, Math.floor(Number(options.frames) || 200));
      while (frame < maxFrames && weapons.ammo > 0 && !weapons.reloading) {
        this.stepFrames(1);
        frame += 1;
        if (player.pitch > peakRad) { peakRad = player.pitch; peakFrame = frame; }
        // Sample the climb during the burst, not just at its end.
        if (frame === 6 || frame === 18 || frame === 36 || frame === 90) {
          burst.push({ frame, round: startAmmo - weapons.ammo, ...sample() });
        }
      }
      input.setVirtual('fire', false);
      const firedFrames = frame;
      const shotsFired = startAmmo - weapons.ammo;
      const atRelease = sample();

      // Recovery samples at fixed wall-clock offsets after the trigger releases.
      const marks = [15, 30, 60, 120];   // 250 ms, 500 ms, 1 s, 2 s at 60 Hz
      let stepped = 0;
      for (const mark of marks) {
        this.stepFrames(mark - stepped);
        stepped = mark;
        series.push({ msAfterRelease: Math.round((mark / 60) * 1000), ...sample() });
      }
      this.stepFrames(60);
      const settled = sample();
      input.clearVirtual();
      this.setPaused(true);
      return {
        ...this.snapshot(),
        recoil: {
          startAmmo, shotsFired, firedFrames, peakFrame,
          initial, peakPitch: deg(peakRad), burst, atRelease, series, settled,
          residual: Number((settled.pitch - initial.pitch).toFixed(3)),
        },
      };
    }

    // First-person weapon inspection. Every state is reached by driving the same
    // virtual inputs a player uses - no viewmodel pose is written directly - and
    // the engine is left paused so the captured frame is the staged frame.
    if (name === 'stage_weapon') {
      const render = this.ctx.peek('render');
      if (render) { render.useCaptureCamera = false; render.showViewmodel = true; }
      this.setPaused(false);
      const player = this.ctx.get('player');
      const weapons = this.ctx.get('weapons');
      const input = this.ctx.input;
      input.clearVirtual();
      player.stageHarnessPose({ position: [0, 0, 6], yaw: 0, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
      weapons.resetLoadout?.();
      this.stepFrames(6);

      const pose = String(options.pose ?? 'hip-idle');
      const frames = Math.max(1, Math.floor(Number(options.frames) || 8));
      const hold = (name2, value) => input.setVirtual(name2, value);

      if (pose === 'walk' || pose === 'sprint') {
        hold('forward', true);
        hold('sprint', pose === 'sprint');
        this.stepFrames(frames);
      } else if (pose === 'ads-in' || pose === 'ads-idle') {
        hold('ads', true);
        this.stepFrames(pose === 'ads-in' ? Math.min(frames, 4) : frames);
      } else if (pose === 'shot' || pose === 'burst' || pose === 'ads-shot') {
        if (pose === 'ads-shot') { hold('ads', true); this.stepFrames(24); }
        hold('fire', true);
        this.stepFrames(pose === 'burst' ? frames : 2);
        hold('fire', false);
        if (pose !== 'burst') this.stepFrames(Math.max(0, frames - 2));
      } else if (pose === 'recovery') {
        hold('fire', true);
        this.stepFrames(14);
        hold('fire', false);
        this.stepFrames(frames);
      } else if (pose.startsWith('reload')) {
        weapons.stageHarnessReload?.(4, 120);
        input.pressVirtual?.('reload');
        hold('reload', true);
        this.stepFrames(2);
        hold('reload', false);
        this.stepFrames(frames);
      } else if (pose === 'turn') {
        // A real flick through the look channel, so the rifle's lag is genuine.
        for (let i = 0; i < frames; i += 1) {
          input.injectLook(90, 0);
          this.stepFrames(1);
        }
      } else if (pose === 'landing') {
        player.position.y += 3.2;
        player.velocity.y = 0;
        player.grounded = false;
        this.stepFrames(frames);
      } else {
        this.stepFrames(frames);
      }
      input.clearVirtual();
      this.setPaused(true);
      return { ...this.snapshot(), weapon: weapons.snapshot?.() ?? null };
    }

    // Character reaction inspection. Stages one soldier in front of the player
    // camera and drives it through a real state - walking under the production
    // movement function, or hit/killed through the production damage event -
    // then holds for capture.
    if (name === 'stage_character') {
      const ai = this.ctx.get('ai');
      const render = this.ctx.peek('render');
      if (render) { render.useCaptureCamera = false; render.showViewmodel = false; }
      // Staging must be the last thing that happens: a capture run settles the
      // page before it shoots, and any real time that elapses keeps simulating -
      // which ran the collapse past the requested frame and, further on,
      // respawned the subject out of shot entirely.
      this.setPaused(false);
      const bot = ai.stageCharacter(this.ctx);
      if (!bot) return this.snapshot();
      const pose = String(options.pose ?? 'stand');
      const settle = Math.max(1, Math.floor(Number(options.settle) || 8));
      this.stepFrames(settle);

      // Aiming and firing while stationary or moving: the bot is given a real
      // target and left to run its production engage path.
      if (pose === 'aim' || pose === 'fire' || pose === 'aim-move') {
        const player = this.ctx.get('player');
        bot.stationary = pose !== 'aim-move';
        bot.targetId = 'player';
        bot.state = 'engage';
        bot.hasLos = true;
        bot.lastSeenAge = 0;
        bot.lastSeen.copy(player.position);
        bot.fireCooldown = pose === 'fire' ? 0 : 4;
        const frames = Math.max(1, Math.floor(Number(options.frames) || 12));
        for (let i = 0; i < frames; i += 1) {
          if (pose === 'aim-move') ai.moveBot(bot, 1, 0, 2.2 * (1 / 60));
          this.stepFrames(1);
        }
        this.setPaused(true);
        return { ...this.snapshot(), subject: AISystem.describePose(bot) };
      }

      if (pose === 'decel') {
        // Accelerate then stop, so the gait's response to deceleration is visible.
        bot.stationary = false;
        for (let i = 0; i < 30; i += 1) { ai.moveBot(bot, 1, 0, 4.6 * (1 / 60)); this.stepFrames(1); }
        this.stepFrames(Math.max(1, Math.floor(Number(options.frames) || 10)));
        this.setPaused(true);
        return { ...this.snapshot(), subject: AISystem.describePose(bot) };
      }

      if (pose === 'walk' || pose === 'run') {
        // Real locomotion: the production movement function, stepped frame by
        // frame, so the gait phase is driven by genuinely measured displacement.
        bot.stationary = false;
        const speed = pose === 'run' ? 4.6 : 2.2;
        const frames = Math.max(1, Math.floor(Number(options.frames) || 40));
        for (let i = 0; i < frames; i += 1) {
          ai.moveBot(bot, 1, 0, speed * (1 / 60));
          this.stepFrames(1);
        }
        this.setPaused(true);
        return { ...this.snapshot(), subject: AISystem.describePose(bot) };
      }

      if (pose === 'hit' || pose === 'headshot') {
        ai.stageDamage(bot, this.ctx, pose === 'headshot'
          ? { amount: 30, hitZone: 'head' }
          : { amount: 24, hitZone: 'torso' });
        this.stepFrames(Math.max(1, Math.floor(Number(options.frames) || 3)));
        this.setPaused(true);
        return { ...this.snapshot(), subject: AISystem.describePose(bot) };
      }

      if (pose.startsWith('collapse') || pose === 'dead') {
        // A lethal shot through the real damage pipeline, then hold for however
        // long into the collapse this frame wants.
        ai.stageDamage(bot, this.ctx, { amount: 400, hitZone: 'torso' });
        this.stepFrames(Math.max(1, Math.floor(Number(options.frames) || 6)));
        this.setPaused(true);
        return { ...this.snapshot(), subject: AISystem.describePose(bot) };
      }

      this.stepFrames(Math.max(1, Math.floor(Number(options.frames) || 6)));
      this.setPaused(true);
      return { ...this.snapshot(), subject: AISystem.describePose(bot) };
    }

    // Visual inspection: stand the player at a chosen spot and facing so a
    // capture run can photograph new geometry from actual eye height.
    if (name === 'inspect_from') {
      const player = this.ctx.get('player');
      player.position.set(Number(options.x) || 0, Number(options.y) || 0, Number(options.z) || 0);
      player.yaw = Number(options.yaw) || 0;
      player.pitch = Number(options.pitch) || 0;
      player.velocity?.set?.(0, 0, 0);
      // Render through the player's own camera, not the canonical capture pose,
      // so the shot shows what a player standing here actually sees.
      const render = this.ctx.peek('render');
      if (render) { render.useCaptureCamera = false; render.showViewmodel = true; }
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'look_right') {
      input.injectLook(120, 0);
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'aim_at_enemy') {
      aimAtEnemy();
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'engage_enemy') {
      input.setVirtual('ads', true);
      input.setVirtual('fire', true);
      for (let i = 0; i < frames; i += 1) {
        aimAtEnemy();
        this.stepFrames(1);
      }
      input.setVirtual('fire', false);
      return this.snapshot();
    }
    if (name === 'ads_off') {
      input.setVirtual('ads', false);
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'ads_on') {
      input.setVirtual('ads', true);
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'profile_motion_start') {
      input.clearVirtual();
      input.setVirtual('forward', true);
      input.setVirtual('sprint', true);
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'profile_combat_start') {
      input.clearVirtual();
      input.setVirtual('ads', true);
      input.setVirtual('fire', true);
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'profile_reload') {
      input.clearVirtual();
      input.setVirtual('reload', true);
      this.stepFrames(frames);
      input.setVirtual('reload', false);
      return this.snapshot();
    }
    if (name === 'profile_ai_only') {
      input.clearVirtual();
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'cover_occlusion_check') {
      input.clearVirtual();
      const ai = this.ctx.get('ai');
      ai.stageOcclusionTest();
      input.setVirtual('crouch', true);
      this.stepFrames(frames);
      const occluded = this.snapshot();
      input.setVirtual('crouch', false);
      this.stepFrames(1);
      return occluded;
    }
    if (name === 'force_player_death') {
      input.clearVirtual();
      this.ctx.get('player').applyDamage(999, 'harness');
      input.setVirtual('fire', true);
      this.stepFrames(frames);
      input.setVirtual('fire', false);
      return this.snapshot();
    }
    if (name === 'crouch_hold') {
      input.setVirtual('crouch', true);
      this.stepFrames(frames);
      const held = this.snapshot();
      input.setVirtual('crouch', false);
      this.stepFrames(1);
      return held;
    }
    if (name === 'lean_right_hold') {
      input.setVirtual('leanRight', true);
      this.stepFrames(frames);
      const held = this.snapshot();
      input.setVirtual('leanRight', false);
      this.stepFrames(1);
      return held;
    }
    if (name === 'collision_push') {
      const player = this.ctx.get('player');
      player.stageHarnessPose({ position: [-2.6, 0, 0.2], yaw: 0, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
      input.setVirtual('forward', true);
      this.stepFrames(frames);
      input.setVirtual('forward', false);
      this.stepFrames(1);
      return this.snapshot();
    }
    if (name === 'indoor_transition') {
      const player = this.ctx.get('player');
      player.stageHarnessPose({ position: [6.35, 0, 6.45], yaw: -Math.PI / 2, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
      input.setVirtual('forward', true);
      this.stepFrames(frames);
      input.setVirtual('forward', false);
      this.stepFrames(1);
      return this.snapshot();
    }
    if (name === 'death_during_reload') {
      input.clearVirtual();
      const weapon = this.ctx.get('weapons');
      weapon.stageHarnessReload(7, 120);
      this.stepFrames(Math.min(frames, 20));
      this.ctx.get('player').applyDamage(999, 'harness');
      this.stepFrames(Math.max(130, frames));
      return this.snapshot();
    }
    if (name === 'ai_take_damage') {
      input.clearVirtual();
      const ai = this.ctx.get('ai'); ai.applyHarnessDamage(0, 8, 'torso');
      for (let i = 0; i < frames; i += 1) {
        this.stepFrames(1);
        if (ai.isEnemyInCover(0)) { this.stepFrames(1); break; }
      }
      return this.snapshot();
    }
    if (name === 'enemy_fire_feedback') {
      input.clearVirtual();
      this.ctx.get('ai').stageFireFeedbackTest();
      this.stepFrames(frames);
      return this.snapshot();
    }
    if (name === 'run_match_to_end') {
      // Drives a live match to its end through the production score rule: the
      // limit is lowered to just above the current leader and real combat
      // supplies the remaining kills. Nothing writes a score or a winner.
      input.clearVirtual();
      const match = this.ctx.get('match');
      const ai = this.ctx.get('ai');
      ai.enterMatchMode();
      match.forceStart();
      const scores = match.getScores();
      const target = Math.max(scores.alpha, scores.bravo) + Math.max(1, Math.floor(Number(options.remainingKills) || 2));
      const restore = match.configureRules({ scoreLimit: target, respawnSeconds: 1.2 });
      const budget = Math.max(600, Math.min(24000, Math.floor(Number(options.maxFrames) || 12000)));
      for (let i = 0; i < budget && match.phase !== 'ended'; i += 60) this.stepFrames(60);
      restore();
      return this.snapshot();
    }
    if (name === 'profile_pulse') {
      input.injectLook(options.index % 240 === 0 ? 24 : -24, 0);
      input.setVirtual('fire', true);
      this.stepFrames(frames);
      input.setVirtual('fire', false);
      return this.snapshot();
    }
    const action = map[name];
    if (!action) throw new Error(`Unknown harness action: ${name}`);
    input.setVirtual(action, true);
    if (name === 'sprint_forward') input.setVirtual('forward', true);
    this.stepFrames(frames);
    input.setVirtual(action, false);
    if (name === 'sprint_forward') input.setVirtual('forward', false);
    this.stepFrames(1);
    return this.snapshot();
  }

  start() {
    if (this.running || this.ctx.harness.active) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
      const frameMs = now - this.lastTime;
      this.lastTime = now;
      const profiling = this.profiler.enabled;
      const t0 = profiling ? performance.now() : 0;
      let steps = 0;
      if (this.paused) {
        this.accumulator = 0;
      } else {
        this.accumulator += dt;
        while (this.accumulator >= this.fixed) {
          this.simulateStep();
          this.accumulator -= this.fixed;
          steps += 1;
        }
      }
      const t1 = profiling ? performance.now() : 0;
      this.ctx.time.alpha = this.accumulator / this.fixed;
      this.renderFrame(dt);
      if (profiling) {
        const t2 = performance.now();
        // update/lateUpdate are split inside renderFrame's per-system timing; the
        // pair total is taken here so `unaccounted` isolates time spent outside
        // our JS entirely (compositor, GPU backpressure, GC).
        const renderMs = t2 - t1;
        const updateShare = this.profilerUpdateSplit(renderMs);
        this.profiler.record({ frameMs, fixedMs: t1 - t0, updateMs: updateShare.update, lateMs: updateShare.late, steps });
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // Splits the render half of a frame into update vs lateUpdate using the
  // per-system totals gathered this frame, so the ratio is measured rather than
  // assumed. lateUpdate is where renderer.render() happens.
  profilerUpdateSplit(renderMs) {
    let update = 0; let late = 0;
    for (const entry of this.profiler.systemMs.values()) { update += entry.update; late += entry.late; }
    const previous = this.profilerPrevious ?? { update: 0, late: 0 };
    const deltaUpdate = update - previous.update;
    const deltaLate = late - previous.late;
    this.profilerPrevious = { update, late };
    const total = deltaUpdate + deltaLate;
    if (total <= 0) return { update: 0, late: renderMs };
    return { update: (deltaUpdate / total) * renderMs, late: (deltaLate / total) * renderMs };
  }

  setProfiling(enabled) {
    this.gpuSupported = this.ctx.get('render').setGpuProfiling(enabled);
    this.profiler.enabled = Boolean(enabled);
    if (enabled) {
      this.profiler.reset();
      this.profiler.setSystems(this.systems.map((system) => system.constructor.id));
      this.profilerPrevious = { update: 0, late: 0 };
    }
    return this.profiler.enabled;
  }

  getFrameProfile() {
    return { ...this.profiler.report(), gpu: this.ctx.get('render').getGpuReport() };
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this.accumulator = 0;
    this.ctx.input.enabled = !this.paused;
    this.ctx.input.clear();
  }

  resize(width, height) {
    for (const system of this.systems) system.resize?.(width, height, this.ctx);
  }

  dispose() {
    this.stop();
    for (let i = this.systems.length - 1; i >= 0; i -= 1) this.systems[i].dispose?.();
    this.ctx.input.dispose();
    this.ctx.events.clear();
  }
}
