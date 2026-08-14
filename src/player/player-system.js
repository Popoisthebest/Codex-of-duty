import * as THREE from 'three';

const approach = (value, target, amount) => {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
};

export class PlayerSystem {
  static id = 'player';
  static deps = ['physics'];

  async init(ctx) {
    this.ctx = ctx;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.spawn = new THREE.Vector3(0, 0, 6);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.stance = 'stand';
    this.sprinting = false;
    this.grounded = true;
    this.eyeHeight = 1.7;
    this.lean = 0;
    this.stepDistance = 0;
    this.aimZoom = 0;
    this.stateEvent = {
      health: 100, stance: 'stand', sprinting: false, grounded: true,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    };
    ctx.camera.rotation.order = 'YXZ';
    this.damageOff = ctx.events.on('combat:damage', (event) => {
      if (event.targetType !== 'player' || this.health <= 0) return;
      this.applyDamage(event.amount, event.source);
    });
    await this.reset(ctx);
  }

  reset(ctx) {
    this.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.stance = 'stand';
    this.sprinting = false;
    this.grounded = true;
    this.eyeHeight = 1.7;
    this.lean = 0;
    this.stepDistance = 0;
    this.setAimZoom(0, true);
    this.syncCamera(ctx, true);
  }

  fixedUpdate(step, ctx) {
    const input = ctx.input;
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
    if (this.grounded && speed > 0.4) {
      this.stepDistance += speed * step;
      const stride = this.sprinting ? 1.45 : this.stance === 'crouch' ? 2.1 : 1.72;
      if (this.stepDistance >= stride) {
        this.stepDistance -= stride;
        ctx.events.emit('player:footstep', { surface: ctx.get('physics').getGroundSurface(this.position), speed, sprinting: this.sprinting, position: { x: this.position.x, y: this.position.y, z: this.position.z } });
      }
    }
    if (this.position.y <= 0) {
      if (!this.grounded && this.velocity.y < -2) ctx.events.emit('player:landed', { speed: -this.velocity.y });
      this.position.y = 0;
      this.velocity.y = 0;
      this.grounded = true;
    }
    ctx.get('physics').resolveActor(this.position, 0.36);

    const targetEye = crouching ? 1.16 : 1.7;
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEye, 14, step);
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
    ctx.camera.position.set(this.position.x + leanX, this.position.y + this.eyeHeight + moveBob, this.position.z + leanZ);
    ctx.camera.rotation.set(this.pitch, this.yaw, -this.lean, 'YXZ');
  }

  applyDamage(amount, source = 'unknown') {
    if (this.dead) return;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    if (this.health <= 0) {
      this.dead = true;
      this.sprinting = false;
      this.velocity.set(0, 0, 0);
      this.ctx.events.emit('actor:died', { actorType: 'player', actorId: 'player', source, position: { x: this.position.x, y: this.position.y, z: this.position.z } });
    }
  }

  applyRecoil(pitch, yaw) {
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, -1.42, 1.42);
    this.yaw += yaw;
    this.syncCamera(this.ctx, true);
  }

  setAimZoom(blend, immediate = false) {
    this.aimZoom = THREE.MathUtils.clamp(blend, 0, 1);
    const fov = THREE.MathUtils.lerp(70, 54, this.aimZoom);
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
    this.grounded = this.position.y <= 0;
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
    };
  }

  dispose() {
    this.damageOff?.();
  }
}
