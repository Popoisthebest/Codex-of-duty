import { DeterministicRng } from './rng.js';
import { EventBus } from './events.js';
import { InputState } from './input.js';

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
    for (const system of this.systems) system.fixedUpdate?.(this.fixed, ctx);
  }

  renderFrame(dt = this.fixed) {
    const { ctx } = this;
    ctx.time.dt = dt;
    for (const system of this.systems) system.update?.(dt, ctx);
    for (const system of this.systems) system.lateUpdate?.(dt, ctx);
  }

  stepFrames(count) {
    const frames = Math.max(0, Math.min(10000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < frames; i += 1) {
      this.simulateStep();
      this.renderFrame(this.fixed);
    }
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
      audio: this.ctx.peek('audio')?.snapshot?.() ?? null,
      fx: this.ctx.peek('fx')?.snapshot?.() ?? null,
    };
  }

  async runAction(name, options = {}) {
    const frames = Math.max(1, Math.min(600, Math.floor(Number(options.frames) || 1)));
    const input = this.ctx.input;
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
      this.lastTime = now;
      if (this.paused) {
        this.accumulator = 0;
      } else {
        this.accumulator += dt;
        while (this.accumulator >= this.fixed) {
          this.simulateStep();
          this.accumulator -= this.fixed;
        }
      }
      this.ctx.time.alpha = this.accumulator / this.fixed;
      this.renderFrame(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
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
