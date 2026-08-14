import * as THREE from 'three';

const hideMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export class FXSystem {
  static id = 'fx';
  static deps = ['weapons', 'physics', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'combat-fx';
    ctx.scene.add(this.group);
    this.rng = ctx.rng.fork('fx');
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.delta = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.matrix = new THREE.Matrix4();

    this.tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = Array.from({ length: 24 }, () => ({ life: 0, visible: false, maxLife: 0.08, start: new THREE.Vector3(), end: new THREE.Vector3() }));
    this.tracerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.034, 1, 6), this.tracerMaterial, this.tracers.length);
    this.tracerMesh.frustumCulled = false;
    this.group.add(this.tracerMesh);

    this.particleMaterial = new THREE.MeshBasicMaterial({ color: 0xd8b178, transparent: true, opacity: 0.88 });
    this.particles = Array.from({ length: 120 }, () => ({ life: 0, visible: false, maxLife: 0.4, position: new THREE.Vector3(), velocity: new THREE.Vector3(), size: 0 }));
    this.particleMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.045, 0), this.particleMaterial, this.particles.length);
    this.particleMesh.frustumCulled = false;
    this.group.add(this.particleMesh);

    this.shellMaterial = new THREE.MeshStandardMaterial({ color: 0xb0813f, roughness: 0.34, metalness: 0.82 });
    this.shells = Array.from({ length: 18 }, () => ({ life: 0, visible: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3() }));
    this.shellMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.055, 8), this.shellMaterial, this.shells.length);
    this.shellMesh.frustumCulled = false;
    this.group.add(this.shellMesh);

    this.enemyMuzzleMaterial = new THREE.MeshBasicMaterial({ color: 0xffb14f, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.enemyMuzzles = Array.from({ length: 8 }, () => ({ life: 0, maxLife: 0.065, visible: false, position: new THREE.Vector3() }));
    this.enemyMuzzleMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.12, 0), this.enemyMuzzleMaterial, this.enemyMuzzles.length);
    this.enemyMuzzleMesh.frustumCulled = false;
    this.group.add(this.enemyMuzzleMesh);
    this.enemyMuzzleLight = new THREE.PointLight(0xff8a38, 0, 2.4, 2); this.group.add(this.enemyMuzzleLight);
    this.enemyMuzzleLightLife = 0;
    this.enemyMuzzleEvents = 0;

    this.decalMaterial = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
    this.decalMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07, 10), this.decalMaterial, 64);
    this.decalMesh.frustumCulled = false;
    this.decalCursor = 0;
    this.group.add(this.decalMesh);

    const smokeCanvas = document.createElement('canvas'); smokeCanvas.width = smokeCanvas.height = 64;
    const smokeCtx = smokeCanvas.getContext('2d'); const gradient = smokeCtx.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,.9)'); gradient.addColorStop(0.38, 'rgba(210,220,215,.6)'); gradient.addColorStop(1, 'rgba(80,88,84,0)'); smokeCtx.fillStyle = gradient; smokeCtx.fillRect(0, 0, 64, 64);
    this.smokeTexture = new THREE.CanvasTexture(smokeCanvas);
    this.impactMaterial = new THREE.SpriteMaterial({ map: this.smokeTexture, color: 0xffc77a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.impactSprite = new THREE.Sprite(this.impactMaterial); this.impactSprite.visible = false; this.impactSprite.scale.setScalar(0.55); this.group.add(this.impactSprite); this.impactLife = 0;
    this.smokes = Array.from({ length: 12 }, (_, index) => {
      const material = new THREE.SpriteMaterial({ map: this.smokeTexture, color: index % 2 ? 0xa9aaa0 : 0x767c78, transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(material); sprite.visible = false; this.group.add(sprite);
      return { life: 0, maxLife: 0.7, size: 0.5, sprite, material, position: new THREE.Vector3(), velocity: new THREE.Vector3() };
    });

    for (let i = 0; i < this.tracers.length; i += 1) this.tracerMesh.setMatrixAt(i, hideMatrix);
    for (let i = 0; i < this.particles.length; i += 1) this.particleMesh.setMatrixAt(i, hideMatrix);
    for (let i = 0; i < this.shells.length; i += 1) this.shellMesh.setMatrixAt(i, hideMatrix);
    for (let i = 0; i < this.enemyMuzzles.length; i += 1) this.enemyMuzzleMesh.setMatrixAt(i, hideMatrix);
    for (let i = 0; i < 64; i += 1) this.decalMesh.setMatrixAt(i, hideMatrix);

    this.offFired = ctx.events.on('weapon:fired', (event) => this.onWeaponFired(event));
    this.offImpact = ctx.events.on('projectile:impact', (event) => this.onImpact(event));
    this.offAiFired = ctx.events.on('ai:fired', (event) => this.onAiFired(event));
  }

  reset(ctx) {
    this.rng = ctx.rng.fork('fx');
    for (let i = 0; i < this.tracers.length; i += 1) { this.tracers[i].life = 0; this.tracers[i].visible = false; this.tracerMesh.setMatrixAt(i, hideMatrix); }
    for (let i = 0; i < this.particles.length; i += 1) { this.particles[i].life = 0; this.particles[i].visible = false; this.particleMesh.setMatrixAt(i, hideMatrix); }
    for (let i = 0; i < this.shells.length; i += 1) { this.shells[i].life = 0; this.shells[i].visible = false; this.shellMesh.setMatrixAt(i, hideMatrix); }
    for (let i = 0; i < this.enemyMuzzles.length; i += 1) { this.enemyMuzzles[i].life = 0; this.enemyMuzzles[i].visible = false; this.enemyMuzzleMesh.setMatrixAt(i, hideMatrix); }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.shellMesh.instanceMatrix.needsUpdate = true;
    this.enemyMuzzleMesh.instanceMatrix.needsUpdate = true;
    this.enemyMuzzleLightLife = 0; this.enemyMuzzleLight.intensity = 0; this.enemyMuzzleEvents = 0;
    this.decalCursor = 0;
    this.showcase = false;
    this.showcaseTimer = 0;
    this.impactLife = 0; this.impactSprite.visible = false;
    for (const smoke of this.smokes) { smoke.life = 0; smoke.sprite.visible = false; smoke.material.opacity = 0; }
    for (let i = 0; i < 64; i += 1) this.decalMesh.setMatrixAt(i, hideMatrix);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  setShot(name) {
    this.showcase = name === 'fx';
    if (!this.showcase) return;
    this.a.set(0.25, 1.55, -0.4);
    this.b.set(0.1, 1.25, -4.2);
    this.spawnTracer(this.a, this.b, 0.28);
    this.spawnImpact(this.b, this.forward.set(0, 0, 1), 'concrete', 22);
  }

  findFree(pool) {
    let oldest = pool[0];
    for (const item of pool) {
      if (item.life <= 0) return item;
      if (item.life < oldest.life) oldest = item;
    }
    return oldest;
  }

  onWeaponFired(event) {
    this.spawnTracer(event.origin, event.end, 0.09);
    const shell = this.findFree(this.shells);
    shell.life = 0.9;
    shell.position.copy(event.origin).addScaledVector(this.ctx.camera.matrixWorld.elements ? this.rightFromCamera() : this.up, 0.22);
    shell.velocity.set(this.rng.range(1.2, 2.2), this.rng.range(1.1, 2), this.rng.range(-0.7, 0.7)).applyQuaternion(this.ctx.camera.quaternion);
    shell.spin.set(this.rng.range(-9, 9), this.rng.range(-12, 12), this.rng.range(-8, 8));
  }

  rightFromCamera() {
    return this.a.set(1, 0, 0).applyQuaternion(this.ctx.camera.quaternion);
  }

  onImpact(event) {
    this.spawnImpact(event.point, event.normal, event.surface, event.surface === 'flesh' ? 5 : 11);
    if (event.surface !== 'flesh') this.spawnDecal(event.point, event.normal, event.surface);
  }

  onAiFired(event) {
    this.a.copy(event.origin);
    this.b.copy(event.end);
    this.spawnTracer(this.a, this.b, 0.06);
    const flash = this.findFree(this.enemyMuzzles);
    flash.life = flash.maxLife;
    flash.position.copy(event.origin);
    this.enemyMuzzleLight.position.copy(event.origin);
    this.enemyMuzzleLightLife = 0.055;
    this.enemyMuzzleEvents += 1;
  }

  spawnTracer(start, end, life) {
    const tracer = this.findFree(this.tracers);
    tracer.life = life;
    tracer.maxLife = life;
    tracer.start.copy(start);
    tracer.end.copy(end);
  }

  spawnImpact(point, normal, surface, count) {
    for (let i = 0; i < count; i += 1) {
      const particle = this.findFree(this.particles);
      particle.life = this.rng.range(0.18, surface === 'flesh' ? 0.32 : 0.5);
      particle.maxLife = particle.life;
      particle.position.copy(point).addScaledVector(normal, 0.025);
      particle.velocity.set(this.rng.range(-1, 1), this.rng.range(0.2, 1.8), this.rng.range(-1, 1));
      particle.velocity.addScaledVector(normal, this.rng.range(0.8, 2.8));
      particle.size = this.rng.range(0.55, surface === 'flesh' ? 1.4 : 1.9);
    }
    this.impactSprite.position.copy(point).addScaledVector(normal, 0.05);
    this.impactSprite.scale.setScalar(surface === 'flesh' ? 0.32 : 0.58);
    this.impactLife = this.showcase ? 999 : 0.12;
    this.impactSprite.visible = true;
    if (surface !== 'flesh') {
      for (let i = 0; i < 3; i += 1) {
        const smoke = this.findFree(this.smokes); smoke.life = smoke.maxLife = this.rng.range(0.45, 0.85); smoke.size = this.rng.range(0.38, 0.72);
        smoke.position.copy(point).addScaledVector(normal, 0.06 + i * 0.035);
        smoke.velocity.set(this.rng.range(-0.22, 0.22), this.rng.range(0.18, 0.5), this.rng.range(-0.22, 0.22)).addScaledVector(normal, this.rng.range(0.12, 0.3));
      }
    }
  }

  spawnDecal(point, normal) {
    const index = this.decalCursor++ % 64;
    this.quaternion.setFromUnitVectors(this.forward, normal);
    this.a.copy(point).addScaledVector(normal, 0.006);
    const size = this.rng.range(0.7, 1.35);
    this.scale.set(size, size, size);
    this.matrix.compose(this.a, this.quaternion, this.scale);
    this.decalMesh.setMatrixAt(index, this.matrix);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  fixedUpdate(step) {
    if (this.showcase) {
      this.showcaseTimer -= step;
      if (this.showcaseTimer <= 0) {
        this.showcaseTimer = 0.16;
        this.a.set(0.15, 1.42, -0.8);
        this.b.set(this.rng.range(-0.2, 0.2), this.rng.range(1.05, 1.55), -4.1);
        this.spawnTracer(this.a, this.b, 0.24);
        this.spawnImpact(this.b, this.forward.set(0, 0, 1), 'concrete', 9);
      }
    }
    let tracersDirty = false;
    for (let i = 0; i < this.tracers.length; i += 1) {
      const tracer = this.tracers[i];
      tracer.life -= step;
      if (tracer.life <= 0) {
        if (tracer.visible) { this.tracerMesh.setMatrixAt(i, hideMatrix); tracer.visible = false; tracersDirty = true; }
        continue;
      }
      this.delta.subVectors(tracer.end, tracer.start);
      const length = this.delta.length();
      this.a.copy(tracer.start).addScaledVector(this.delta, 0.5);
      this.quaternion.setFromUnitVectors(this.up, this.delta.normalize());
      this.scale.set(1, length, 1);
      this.matrix.compose(this.a, this.quaternion, this.scale);
      this.tracerMesh.setMatrixAt(i, this.matrix);
      tracer.visible = true;
      tracersDirty = true;
    }
    if (tracersDirty) this.tracerMesh.instanceMatrix.needsUpdate = true;

    let particlesDirty = false;
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      particle.life -= step;
      if (particle.life <= 0) {
        if (particle.visible) { this.particleMesh.setMatrixAt(i, hideMatrix); particle.visible = false; particlesDirty = true; }
        continue;
      }
      particle.velocity.y -= 5.2 * step;
      particle.position.addScaledVector(particle.velocity, step);
      const scale = particle.size * Math.max(0.2, particle.life / particle.maxLife);
      this.scale.setScalar(scale);
      this.quaternion.identity();
      this.matrix.compose(particle.position, this.quaternion, this.scale);
      this.particleMesh.setMatrixAt(i, this.matrix);
      particle.visible = true;
      particlesDirty = true;
    }
    if (particlesDirty) this.particleMesh.instanceMatrix.needsUpdate = true;

    let shellsDirty = false;
    for (let i = 0; i < this.shells.length; i += 1) {
      const shell = this.shells[i];
      shell.life -= step;
      if (shell.life <= 0) {
        if (shell.visible) { this.shellMesh.setMatrixAt(i, hideMatrix); shell.visible = false; shellsDirty = true; }
        continue;
      }
      shell.velocity.y -= 7.5 * step;
      shell.position.addScaledVector(shell.velocity, step);
      if (shell.position.y < 0.04) {
        shell.position.y = 0.04;
        shell.velocity.y = Math.abs(shell.velocity.y) * 0.35;
        shell.velocity.multiplyScalar(0.72);
      }
      this.euler.set(shell.spin.x * shell.life, shell.spin.y * shell.life, shell.spin.z * shell.life);
      this.quaternion.setFromEuler(this.euler);
      this.scale.set(1, 1, 1);
      this.matrix.compose(shell.position, this.quaternion, this.scale);
      this.shellMesh.setMatrixAt(i, this.matrix);
      shell.visible = true;
      shellsDirty = true;
    }
    if (shellsDirty) this.shellMesh.instanceMatrix.needsUpdate = true;

    let enemyMuzzlesDirty = false;
    for (let i = 0; i < this.enemyMuzzles.length; i += 1) {
      const flash = this.enemyMuzzles[i]; flash.life -= step;
      if (flash.life <= 0) {
        if (flash.visible) { this.enemyMuzzleMesh.setMatrixAt(i, hideMatrix); flash.visible = false; enemyMuzzlesDirty = true; }
        continue;
      }
      this.quaternion.identity(); this.scale.setScalar(0.55 + flash.life / flash.maxLife * 0.65); this.matrix.compose(flash.position, this.quaternion, this.scale);
      this.enemyMuzzleMesh.setMatrixAt(i, this.matrix); flash.visible = true; enemyMuzzlesDirty = true;
    }
    if (enemyMuzzlesDirty) this.enemyMuzzleMesh.instanceMatrix.needsUpdate = true;
    this.enemyMuzzleLightLife -= step;
    this.enemyMuzzleLight.intensity = this.enemyMuzzleLightLife > 0 ? 3.8 * this.enemyMuzzleLightLife / 0.055 : 0;

    this.impactLife -= step;
    if (this.impactLife <= 0) this.impactSprite.visible = false;
    for (const smoke of this.smokes) {
      smoke.life -= step;
      if (smoke.life <= 0) { smoke.sprite.visible = false; continue; }
      smoke.position.addScaledVector(smoke.velocity, step); smoke.velocity.y += 0.08 * step;
      const progress = 1 - smoke.life / smoke.maxLife; const size = smoke.size * (1 + progress * 1.35);
      smoke.sprite.position.copy(smoke.position); smoke.sprite.scale.setScalar(size); smoke.sprite.visible = true; smoke.material.opacity = Math.sin(Math.PI * Math.min(1, progress)) * 0.34;
    }
  }

  snapshot() { return { enemyMuzzleEvents: this.enemyMuzzleEvents, activeEnemyMuzzles: this.enemyMuzzles.filter((flash) => flash.life > 0).length }; }

  dispose() {
    this.offFired?.();
    this.offImpact?.();
    this.offAiFired?.();
    this.ctx.scene.remove(this.group);
    this.tracerMesh.geometry.dispose();
    this.particleMesh.geometry.dispose();
    this.shellMesh.geometry.dispose();
    this.enemyMuzzleMesh.geometry.dispose();
    this.decalMesh.geometry.dispose();
    this.tracerMaterial.dispose();
    this.particleMaterial.dispose();
    this.shellMaterial.dispose();
    this.enemyMuzzleMaterial.dispose();
    this.decalMaterial.dispose();
    this.impactMaterial.dispose();
    for (const smoke of this.smokes) smoke.material.dispose();
    this.smokeTexture.dispose();
  }
}
