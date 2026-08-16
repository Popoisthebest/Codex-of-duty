import * as THREE from 'three';

const approach = (value, target, amount) => {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
};

// The deterministic pose every v2 harness shot and playtest scenario starts from.
const LEGACY_SPAWN = [0, 0, 6];
// Recovery. Without it the player never loses a fight - they bleed out by chip
// damage accumulated across a whole life, which makes every duel feel
// consequence-free and every death feel arbitrary.
const REGEN_DELAY = 4.5;        // seconds out of contact before recovery starts
const REGEN_PER_SECOND = 18;
const REGEN_CEILING = 100;

// v3 scenarios run a real match, so they use match-selected spawns instead.
const MATCH_SCENARIOS = new Set(['tdm-core', 'combat-soak']);

export class PlayerSystem {
  static id = 'player';
  static deps = ['physics', 'match'];

  async init(ctx) {
    this.ctx = ctx;
    this.team = 'alpha';
    this.actorId = 'player';
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.spawn = new THREE.Vector3(...LEGACY_SPAWN);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.regenDelay = 0;
    this.dead = false;
    this.groundY = 0;
    this.stance = 'stand';
    this.sprinting = false;
    this.grounded = true;
    this.eyeHeight = 1.7;
    this.lean = 0;
    this.stepDistance = 0;
    this.aimZoom = 0;
    this.sprintBlend = 0;
    this.landDip = 0;
    this.landDipVelocity = 0;
    this.lastDamageFrom = null;
    this.damageDirection = 0;
    this.damageTimer = 0;
    this.stateEvent = {
      health: 100, stance: 'stand', sprinting: false, grounded: true,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    };
    ctx.camera.rotation.order = 'YXZ';
    this.damageOff = ctx.events.on('combat:damage', (event) => {
      if (event.targetType !== 'player' || this.health <= 0) return;
      const sourceTeam = event.sourceTeam ?? null;
      if (sourceTeam && sourceTeam === this.team) return;
      if (ctx.peek('match')?.isProtected('player')) return;
      this.lastDamageFrom = event.source ?? null;
      this.applyDamage(event.amount, event.source, event.hitZone);
    });
    this.respawnOff = ctx.events.on('match:respawn', (event) => {
      if (event.actorId !== 'player') return;
      this.respawn(event.spawn);
    });
    this.restartOff = ctx.events.on('match:restart', () => {
      this.respawn(ctx.peek('match')?.initialSpawn('player'));
    });
    await this.reset(ctx);
  }

  reset(ctx) {
    // Harness shots and the v2 playtest replay a fixed pose; live matches take a
    // real match-selected spawn.
    const match = ctx.peek('match');
    const legacy = !match || (ctx.harness.active && !MATCH_SCENARIOS.has(ctx.harness.scenario));
    const spawn = legacy ? { x: LEGACY_SPAWN[0], y: LEGACY_SPAWN[1], z: LEGACY_SPAWN[2], yaw: 0 } : match.initialSpawn('player');
    this.spawn.set(spawn.x, spawn.y ?? 0, spawn.z);
    this.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.health = 100;
    this.regenDelay = 0;
    this.dead = false;
    this.groundY = spawn.y ?? 0;
    this.stance = 'stand';
    this.sprinting = false;
    this.grounded = true;
    this.eyeHeight = 1.7;
    this.lean = 0;
    this.stepDistance = 0;
    this.sprintBlend = 0;
    this.landDip = 0;
    this.landDipVelocity = 0;
    this.lastDamageFrom = null;
    this.damageDirection = 0;
    this.damageTimer = 0;
    this.setAimZoom(0, true);
    this.syncCamera(ctx, true);
    if (match && !ctx.harness.active) match.confirmSpawn('player', this.position);
  }

  respawn(spawn) {
    const ctx = this.ctx;
    const point = spawn ?? { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z, yaw: this.yaw };
    this.position.set(point.x, point.y ?? 0, point.z);
    this.velocity.set(0, 0, 0);
    this.yaw = point.yaw ?? this.yaw;
    this.pitch = 0;
    this.health = 100;
    this.regenDelay = 0;
    this.dead = false;
    this.groundY = point.y ?? 0;
    this.grounded = true;
    this.stance = 'stand';
    this.sprinting = false;
    this.eyeHeight = 1.7;
    this.lean = 0;
    this.stepDistance = 0;
    this.sprintBlend = 0;
    this.landDip = 0;
    this.landDipVelocity = 0;
    this.lastDamageFrom = null;
    this.damageTimer = 0;
    this.setAimZoom(0, true);
    this.syncCamera(ctx, true);
    ctx.peek('match')?.confirmSpawn('player', this.position);
    ctx.events.emit('player:respawned', { x: this.position.x, y: this.position.y, z: this.position.z });
  }

  fixedUpdate(step, ctx) {
    if (!this.dead) {
      if (this.regenDelay > 0) this.regenDelay = Math.max(0, this.regenDelay - step);
      else if (this.health < REGEN_CEILING) {
        const before = this.health;
        this.health = Math.min(REGEN_CEILING, this.health + REGEN_PER_SECOND * step);
        // The HUD only redraws on change, so tell it when recovery crosses a point.
        if (Math.floor(this.health) !== Math.floor(before)) {
          ctx.events.emit('player:health', { health: this.health, regenerating: true });
        }
      }
    }
    const input = ctx.input;
    this.damageTimer = Math.max(0, this.damageTimer - step);
    if (this.dead) {
      this.velocity.set(0, 0, 0);
      this.sprinting = false;
      this.syncCamera(ctx, false);
      this.emitState(ctx);
      return;
    }
    const sensitivity = 0.00225;
    this.yaw -= input.lookX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY * sensitivity, -1.42, 1.42);

    const crouching = input.isDown('crouch');
    const movingForward = input.isDown('forward');
    this.sprinting = input.isDown('sprint') && movingForward && !crouching;
    this.stance = crouching ? 'crouch' : 'stand';

    const x = Number(input.isDown('right')) - Number(input.isDown('left'));
    const z = Number(input.isDown('backward')) - Number(movingForward);
    this.wish.set(x, 0, z);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);

    const maxSpeed = crouching ? 2.25 : this.sprinting ? 7.2 : 4.35;
    const accel = this.wish.lengthSq() > 0 ? (this.grounded ? 35 : 10) : 28;
    this.velocity.x = approach(this.velocity.x, this.wish.x * maxSpeed, accel * step);
    this.velocity.z = approach(this.velocity.z, this.wish.z * maxSpeed, accel * step);

    if (input.consumePressed('jump') && this.grounded && !crouching) {
      this.velocity.y = 5.1;
      this.grounded = false;
    }
    if (!this.grounded) this.velocity.y -= 14.5 * step;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.position.addScaledVector(this.velocity, step);
    const physics = ctx.get('physics');
    physics.resolveActor(this.position, 0.36);
    // Elevation: stairs, container tops and terraces are real walk surfaces, so
    // the floor under the player is queried rather than assumed to be y = 0.
    const ground = physics.groundHeightAt(this.position.x, this.position.z, this.position.y, this.grounded ? 0.46 : 0.05);
    this.groundY = ground;
    if (this.grounded && speed > 0.4) {
      this.stepDistance += speed * step;
      const stride = this.sprinting ? 1.45 : this.stance === 'crouch' ? 2.1 : 1.72;
      if (this.stepDistance >= stride) {
        this.stepDistance -= stride;
        ctx.events.emit('player:footstep', { surface: physics.getGroundSurface(this.position), speed, sprinting: this.sprinting, position: { x: this.position.x, y: this.position.y, z: this.position.z } });
      }
    }
    if (this.position.y <= ground) {
      if (!this.grounded && this.velocity.y < -2) {
        const impact = -this.velocity.y;
        // Landing drives a critically-damped camera dip. The event existed but
        // nothing reacted to it, so drops felt weightless.
        this.landDipVelocity -= Math.min(0.085, impact * 0.011);
        ctx.events.emit('player:landed', { speed: impact });
      }
      this.position.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else if (this.velocity.y === 0 && this.position.y > ground + 0.02) {
      this.grounded = false;
    }

    const targetEye = crouching ? 1.16 : 1.7;
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEye, 14, step);
    // Sprint blend feeds both the FOV kick and the weapon's sprint pose. It eases
    // in faster than it eases out so starting a sprint reads as an acceleration.
    this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, this.sprinting ? 1 : 0, this.sprinting ? 7 : 5, step);
    this.landDipVelocity += -this.landDip * 190 * step;
    this.landDipVelocity *= Math.max(0, 1 - 12 * step);
    this.landDip += this.landDipVelocity * step;
    const leanInput = Number(input.isDown('leanRight')) - Number(input.isDown('leanLeft'));
    this.lean = THREE.MathUtils.damp(this.lean, leanInput * 0.075, 12, step);
    this.syncCamera(ctx, false);
    this.emitState(ctx);
  }

  setShot(name) {
    if (name === 'hud') this.health = 31;
    else if (name === 'combat' || name === 'fx') this.health = 72;
  }

  syncCamera(ctx, immediate) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveBob = immediate ? 0 : Math.sin(ctx.time.elapsed * (this.sprinting ? 12 : 8.5)) * Math.min(0.022, speed * 0.003);
    const leanX = Math.cos(this.yaw) * this.lean; const leanZ = -Math.sin(this.yaw) * this.lean;
    ctx.camera.position.set(this.position.x + leanX, this.position.y + this.eyeHeight + moveBob + this.landDip, this.position.z + leanZ);
    ctx.camera.rotation.set(this.pitch, this.yaw, -this.lean, 'YXZ');
  }

  applyDamage(amount, source = 'unknown', hitZone = null) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    // Taking fire suspends recovery, so a fight is still lost by losing it.
    this.regenDelay = REGEN_DELAY;
    this.damageTimer = 0.6;
    const shooter = this.ctx.peek('ai')?.byId?.get?.(source);
    if (shooter) {
      // The attacker's world position is published rather than a baked screen
      // angle: the HUD recomputes the bearing every frame so the indicator keeps
      // pointing at the shooter while the player turns to face them.
      this.ctx.events.emit('player:damaged', {
        amount, hitZone, source,
        x: shooter.root.position.x, y: shooter.root.position.y, z: shooter.root.position.z,
        health: this.health,
      });
      this.ctx.events.emit('combat:contact', { actorId: 'player', team: this.team, targetId: source });
    } else {
      this.ctx.events.emit('player:damaged', { amount, hitZone, source, x: null, y: null, z: null, health: this.health });
    }
    if (this.health <= 0) {
      this.dead = true;
      this.sprinting = false;
      this.velocity.set(0, 0, 0);
      this.ctx.events.emit('actor:died', {
        actorType: 'player', actorId: 'player', team: this.team, source, hitZone,
        position: { x: this.position.x, y: this.position.y, z: this.position.z },
      });
    }
  }

  applyRecoil(pitch, yaw) {
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, -1.42, 1.42);
    this.yaw += yaw;
    this.syncCamera(this.ctx, true);
  }

  setAimZoom(blend, immediate = false) {
    this.aimZoom = THREE.MathUtils.clamp(blend, 0, 1);
    // Sprint widens the view slightly; ADS narrows it. They compose rather than
    // fight because ADS is suppressed while sprinting.
    const fov = THREE.MathUtils.lerp(70, 54, this.aimZoom) + this.sprintBlend * 5.5;
    if (immediate || Math.abs(this.ctx.camera.fov - fov) > 1e-6) {
      this.ctx.camera.fov = fov;
      this.ctx.camera.updateProjectionMatrix();
    }
    if (immediate || Math.abs(this.ctx.viewCamera.fov - fov) > 1e-6) {
      this.ctx.viewCamera.fov = fov;
      this.ctx.viewCamera.updateProjectionMatrix();
    }
  }

  aimAtPoint(point) {
    const dx = point.x - this.position.x;
    const dy = point.y - (this.position.y + this.eyeHeight);
    const dz = point.z - this.position.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.42, 1.42);
    this.syncCamera(this.ctx, true);
  }

  stageHarnessPose({ position, yaw = this.yaw, pitch = this.pitch, eyeHeight = this.eyeHeight, stance = this.stance }) {
    this.position.set(...position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeHeight = eyeHeight;
    this.stance = stance;
    this.groundY = this.ctx.get('physics').groundHeightAt(this.position.x, this.position.z, this.position.y, 0.46);
    this.grounded = this.position.y <= this.groundY + 0.01;
    this.syncCamera(this.ctx, true);
  }

  emitState(ctx) {
    const state = this.stateEvent;
    state.health = this.health;
    state.stance = this.stance;
    state.sprinting = this.sprinting;
    state.grounded = this.grounded;
    state.x = this.position.x;
    state.y = this.position.y;
    state.z = this.position.z;
    state.yaw = this.yaw;
    state.pitch = this.pitch;
    ctx.events.emit('player:state', state);
  }

  snapshot() {
    return {
      position: this.position.toArray(),
      cameraPosition: this.ctx.camera.position.toArray(),
      health: this.health,
      dead: this.dead,
      stance: this.stance,
      sprinting: this.sprinting,
      yaw: this.yaw,
      pitch: this.pitch,
      lean: this.lean,
      grounded: this.grounded,
      sprintBlend: Number(this.sprintBlend.toFixed(3)),
      landDip: Number(this.landDip.toFixed(4)),
      zone: this.ctx.peek('world')?.zoneAt(this.position.x, this.position.z, this.position.y) ?? null,
    };
  }

  dispose() {
    this.damageOff?.(); this.respawnOff?.(); this.restartOff?.();
  }
}
