import * as THREE from 'three';

const makePart = (group, geometry, material, position, rotation = null) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.fromArray(position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

export class WeaponSystem {
  static id = 'weapons';
  static deps = ['physics', 'player', 'render'];

  async init(ctx) {
    this.ctx = ctx;
    this.magSize = 30;
    this.fireInterval = 60 / 680;
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.reloadDuration = 1.95;
    this.ads = false;
    this.adsBlend = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shotIndex = 0;
    this.muzzleTimer = 0;
    this.shotAds = false;
    this.fxShowcase = false;
    this.showcaseFire = false;
    this.showcaseCooldown = 0;
    this.resources = [];
    this.rng = ctx.rng.fork('weapons');
    this.origin = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.buildViewmodel(ctx);
    await this.reset(ctx);
  }

  buildViewmodel(ctx) {
    this.group = new THREE.Group();
    this.group.name = 'VX-12 rifle viewmodel';
    ctx.viewScene.add(this.group);

    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x4a5150, roughness: 0.28, metalness: 0.76, envMapIntensity: 1.15 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x191e1f, roughness: 0.38, metalness: 0.7, envMapIntensity: 1.05 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x29302e, roughness: 0.62, metalness: 0.06 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x8b683e, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x284753, roughness: 0.06, metalness: 0.12, transmission: 0.12, transparent: true, opacity: 0.78, emissive: 0x07181c, emissiveIntensity: 0.55 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x303229, roughness: 0.9, metalness: 0.01 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x313a35, roughness: 0.92, metalness: 0 });
    const knuckle = new THREE.MeshStandardMaterial({ color: 0x171a17, roughness: 0.76, metalness: 0.04 });
    const reticle = new THREE.MeshBasicMaterial({ color: 0xff673b, transparent: true, opacity: 0.95, depthWrite: false });
    this.resources.push(gunmetal, darkMetal, polymer, accent, glass, glove, sleeve, knuckle, reticle);

    const receiverShape = new THREE.Shape();
    receiverShape.moveTo(-0.13, -0.1); receiverShape.lineTo(-0.11, 0.1); receiverShape.lineTo(-0.07, 0.15); receiverShape.lineTo(0.11, 0.13); receiverShape.lineTo(0.14, -0.075); receiverShape.lineTo(0.08, -0.13); receiverShape.closePath();
    const receiverGeometry = new THREE.ExtrudeGeometry(receiverShape, { depth: 0.72, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 2 }); receiverGeometry.translate(0, 0, -0.36);
    makePart(this.group, receiverGeometry, gunmetal, [0, -0.1, -0.58]);
    makePart(this.group, new THREE.CylinderGeometry(0.105, 0.115, 0.9, 10), polymer, [0, -0.045, -1.34], [Math.PI / 2, 0, 0]);
    makePart(this.group, new THREE.CylinderGeometry(0.038, 0.044, 0.78, 16), darkMetal, [0, -0.045, -2.14], [Math.PI / 2, 0, 0]);
    makePart(this.group, new THREE.CylinderGeometry(0.06, 0.052, 0.2, 12), darkMetal, [0, -0.045, -2.62], [Math.PI / 2, 0, 0]);
    makePart(this.group, new THREE.BoxGeometry(0.18, 0.16, 0.74), polymer, [0, -0.12, 0.02]);
    makePart(this.group, new THREE.BoxGeometry(0.24, 0.07, 0.5), polymer, [0, -0.045, 0.28]);
    makePart(this.group, new THREE.BoxGeometry(0.14, 0.33, 0.22), polymer, [0, -0.34, -0.42], [-0.16, 0, 0]);
    const magazineShape = new THREE.Shape(); magazineShape.moveTo(-0.075, 0.18); magazineShape.lineTo(0.075, 0.18); magazineShape.lineTo(0.095, -0.17); magazineShape.lineTo(0.04, -0.24); magazineShape.lineTo(-0.065, -0.21); magazineShape.closePath();
    const magazineGeometry = new THREE.ExtrudeGeometry(magazineShape, { depth: 0.2, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }); magazineGeometry.translate(0, 0, -0.1);
    makePart(this.group, magazineGeometry, accent, [0, -0.36, -0.73], [0.1, 0, 0]);

    // Rail, controls, fasteners and handguard vents break up the silhouette and material response.
    makePart(this.group, new THREE.BoxGeometry(0.18, 0.035, 1.62), darkMetal, [0, 0.085, -0.93]);
    for (let i = 0; i < 16; i += 1) makePart(this.group, new THREE.BoxGeometry(0.21, 0.035, 0.05), gunmetal, [0, 0.12, -0.2 - i * 0.095]);
    for (const side of [-1, 1]) for (let i = 0; i < 5; i += 1) {
      const vent = makePart(this.group, new THREE.BoxGeometry(0.012, 0.035, 0.13), darkMetal, [side * 0.105, -0.02, -1.08 - i * 0.16]); vent.rotation.x = -0.35;
    }
    makePart(this.group, new THREE.BoxGeometry(0.11, 0.04, 0.12), accent, [-0.11, -0.04, -0.42], [0, 0, -0.18]);
    makePart(this.group, new THREE.CylinderGeometry(0.024, 0.024, 0.025, 12), accent, [0.125, -0.12, -0.53], [Math.PI / 2, 0, 0]);
    makePart(this.group, new THREE.CylinderGeometry(0.02, 0.02, 0.025, 12), darkMetal, [0.125, -0.05, -0.72], [Math.PI / 2, 0, 0]);

    // Compact holographic sight with a readable sight picture.
    makePart(this.group, new THREE.BoxGeometry(0.25, 0.055, 0.34), darkMetal, [0, 0.12, -0.66]);
    makePart(this.group, new THREE.BoxGeometry(0.038, 0.19, 0.13), darkMetal, [-0.105, 0.22, -0.72], [0, 0, -0.08]);
    makePart(this.group, new THREE.BoxGeometry(0.038, 0.19, 0.13), darkMetal, [0.105, 0.22, -0.72], [0, 0, 0.08]);
    makePart(this.group, new THREE.BoxGeometry(0.22, 0.035, 0.13), darkMetal, [0, 0.31, -0.72]);
    makePart(this.group, new THREE.PlaneGeometry(0.17, 0.14), glass, [0, 0.225, -0.788]);
    this.opticDot = makePart(this.group, new THREE.CircleGeometry(0.0065, 12), reticle, [0, 0.225, -0.778]);
    makePart(this.group, new THREE.BoxGeometry(0.035, 0.18, 0.05), darkMetal, [0, 0.05, -2.23]);

    // Articulated gloved hands and sleeves; the support hand wraps the handguard.
    makePart(this.group, new THREE.CapsuleGeometry(0.105, 0.38, 6, 12), sleeve, [-0.24, -0.47, -1.02], [1.04, 0.05, -0.34]);
    makePart(this.group, new THREE.CapsuleGeometry(0.095, 0.18, 6, 12), glove, [-0.08, -0.25, -1.32], [1.18, 0.05, -0.22]);
    for (let i = 0; i < 4; i += 1) makePart(this.group, new THREE.CapsuleGeometry(0.022, 0.13, 4, 8), glove, [-0.08 + i * 0.045, -0.19, -1.34 - i * 0.018], [1.38, 0, -0.05]);
    for (let i = 0; i < 3; i += 1) makePart(this.group, new THREE.BoxGeometry(0.034, 0.018, 0.065), knuckle, [-0.075 + i * 0.047, -0.125, -1.34 - i * 0.018], [-0.15, 0, 0]);
    makePart(this.group, new THREE.CapsuleGeometry(0.11, 0.42, 6, 12), sleeve, [0.29, -0.5, 0.02], [0.72, 0, 0.18]);
    makePart(this.group, new THREE.CapsuleGeometry(0.095, 0.19, 6, 12), glove, [0.09, -0.31, -0.33], [0.48, 0, 0.16]);
    for (let i = 0; i < 3; i += 1) makePart(this.group, new THREE.CapsuleGeometry(0.021, 0.105, 4, 8), glove, [0.06 + i * 0.042, -0.29, -0.42 - i * 0.015], [0.62, 0, 0.1]);
    makePart(this.group, new THREE.BoxGeometry(0.15, 0.025, 0.13), knuckle, [0.09, -0.23, -0.36], [-0.08, 0, 0.12]);
    this.resources.push(...this.group.children.map((mesh) => mesh.geometry));
    this.group.scale.setScalar(0.66);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.42, 9, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff7b2f, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.muzzleFlash.rotation.x = -Math.PI / 2;
    this.muzzleFlash.position.set(0, -0.045, -2.82);
    this.muzzleFlash.visible = false;
    this.group.add(this.muzzleFlash);
    this.resources.push(this.muzzleFlash.geometry, this.muzzleFlash.material);
    const flashShape = new THREE.Shape();
    flashShape.moveTo(0, 0.2); flashShape.lineTo(0.035, 0.045); flashShape.lineTo(0.21, 0); flashShape.lineTo(0.035, -0.045); flashShape.lineTo(0, -0.2); flashShape.lineTo(-0.035, -0.045); flashShape.lineTo(-0.21, 0); flashShape.lineTo(-0.035, 0.045); flashShape.closePath();
    this.muzzleStar = new THREE.Mesh(new THREE.ShapeGeometry(flashShape), new THREE.MeshBasicMaterial({ color: 0xffc55f, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.muzzleStar.position.set(0, -0.045, -2.83); this.muzzleStar.visible = false; this.group.add(this.muzzleStar); this.resources.push(this.muzzleStar.geometry, this.muzzleStar.material);
    this.muzzleLight = new THREE.PointLight(0xff8b3d, 0, 1.7, 2); this.muzzleLight.position.set(0, -0.02, -2.45); this.group.add(this.muzzleLight);

    const key = new THREE.DirectionalLight(0xffe0c3, 4.6);
    key.position.set(-2, 4, 3);
    ctx.viewScene.add(key);
    const fill = new THREE.HemisphereLight(0xbad9ed, 0x392d24, 2.15);
    ctx.viewScene.add(fill);
    this.viewLights = [key, fill];
  }

  reset(ctx) {
    this.ammo = this.magSize;
    this.reserve = 120;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.ads = false;
    this.adsBlend = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shotIndex = 0;
    this.muzzleTimer = 0;
    this.shotAds = false;
    this.fxShowcase = false;
    this.showcaseFire = false;
    this.showcaseCooldown = 0;
    this.rng = ctx.rng.fork('weapons');
    this.group.visible = true;
    this.updateViewmodel(0, ctx);
  }

  setShot(name, ctx) {
    this.shotAds = name === 'weapon_ads';
    this.fxShowcase = name === 'fx';
    this.showcaseFire = name === 'combat' || name === 'fx';
    this.showcaseCooldown = 0.05;
    if (name === 'weapon_ads') {
      this.ads = true;
      this.adsBlend = 1;
    } else {
      this.ads = false;
      this.adsBlend = 0;
    }
    if (name === 'fx') this.muzzleTimer = 0.08;
    if (name === 'hud') {
      this.ammo = 7;
      this.reloading = true;
      this.reloadTimer = 0.15;
      ctx.events.emit('weapon:reload', { phase: 'start', ammo: this.ammo, reserve: this.reserve });
    }
  }

  fixedUpdate(step, ctx) {
    this.fireCooldown = Math.max(0, this.fireCooldown - step);
    this.muzzleTimer = Math.max(0, this.muzzleTimer - step);
    const player = ctx.get('player');
    if (player.dead) {
      if (this.reloading) {
        this.reloading = false;
        this.reloadTimer = 0;
        ctx.events.emit('weapon:reload', { phase: 'cancelled', ammo: this.ammo, reserve: this.reserve });
      }
      this.ads = false;
      this.showcaseFire = false;
      this.adsBlend = THREE.MathUtils.damp(this.adsBlend, 0, 18, step);
      this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 18, step);
      this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 22, step);
      this.updateViewmodel(step, ctx);
      return;
    }
    const wantsAds = !player.dead && (this.shotAds || ctx.input.isDown('ads')) && !player.sprinting && !this.reloading;
    this.ads = wantsAds;
    this.adsBlend = THREE.MathUtils.damp(this.adsBlend, Number(wantsAds), wantsAds ? 18 : 13, step);
    if (this.showcaseFire && !player.dead && !this.reloading) {
      this.showcaseCooldown -= step;
      if (this.showcaseCooldown <= 0 && this.ammo > 0) {
        this.showcaseCooldown = 0.24;
        this.fire(ctx);
      } else if (this.ammo === 0 && this.reserve > 0) {
        this.startReload(ctx);
      }
    }

    if (this.reloading) {
      this.reloadTimer += step;
      if (this.reloadTimer >= this.reloadDuration) this.finishReload(ctx);
    } else if (ctx.input.consumePressed('reload') && this.ammo < this.magSize && this.reserve > 0) {
      this.startReload(ctx);
    }

    if (!player.dead && ctx.input.isDown('fire') && !this.reloading && !player.sprinting && this.fireCooldown <= 0) {
      if (this.ammo > 0) this.fire(ctx);
      else {
        this.fireCooldown = 0.18;
        ctx.events.emit('weapon:dryfire', { weapon: 'vx12' });
      }
    }

    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 18, step);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 22, step);
    this.updateViewmodel(step, ctx);
  }

  fire(ctx) {
    this.ammo -= 1;
    this.fireCooldown += this.fireInterval;
    this.shotIndex += 1;
    this.muzzleTimer = 0.045;
    const player = ctx.get('player');
    const vertical = 0.0064 + this.rng.range(0.001, 0.0045);
    const horizontal = this.rng.range(-0.0038, 0.0038);
    ctx.camera.getWorldPosition(this.origin);
    ctx.camera.getWorldDirection(this.direction);
    const spread = THREE.MathUtils.lerp(0.0048, 0.0012, this.adsBlend * this.adsBlend);
    this.right.set(1, 0, 0).applyQuaternion(ctx.camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(ctx.camera.quaternion);
    this.direction.addScaledVector(this.right, this.rng.range(-spread, spread));
    this.direction.addScaledVector(this.up, this.rng.range(-spread, spread)).normalize();
    const result = ctx.get('physics').fireHitscan({ origin: this.origin, direction: this.direction, maxDistance: 90, damage: 34 });
    player.applyRecoil(vertical, horizontal);
    this.recoilPitch += 0.035;
    this.recoilYaw += horizontal * 2.2;
    ctx.events.emit('weapon:fired', {
      weapon: 'vx12',
      shot: this.shotIndex,
      ammo: this.ammo,
      origin: { x: this.origin.x, y: this.origin.y, z: this.origin.z },
      direction: { x: this.direction.x, y: this.direction.y, z: this.direction.z },
      end: { x: result.end.x, y: result.end.y, z: result.end.z },
      hit: result.hit,
      actorId: result.actorId ?? null,
      projectileModel: 'instant-hitscan-with-tracer',
    });
  }

  startReload(ctx) {
    this.reloading = true;
    this.reloadTimer = 0;
    this.ads = false;
    ctx.events.emit('weapon:reload', { phase: 'start', ammo: this.ammo, reserve: this.reserve });
  }

  finishReload(ctx) {
    const needed = this.magSize - this.ammo;
    const loaded = Math.min(needed, this.reserve);
    this.ammo += loaded;
    this.reserve -= loaded;
    this.reloading = false;
    this.reloadTimer = 0;
    ctx.events.emit('weapon:reload', { phase: 'complete', ammo: this.ammo, reserve: this.reserve });
  }

  updateViewmodel(_step, ctx) {
    const speed = Math.hypot(ctx.get('player').velocity.x, ctx.get('player').velocity.z);
    const t = ctx.time.elapsed;
    const bob = Math.min(1, speed / 4.5);
    const hipX = 0.34;
    const hipY = -0.255;
    const adsX = 0;
    const adsY = -0.152;
    this.group.position.set(
      THREE.MathUtils.lerp(hipX, adsX, this.adsBlend) + Math.sin(t * 7.7) * 0.008 * bob + this.recoilYaw,
      THREE.MathUtils.lerp(hipY, adsY, this.adsBlend) + Math.cos(t * 15.4) * 0.006 * bob - this.recoilPitch,
      THREE.MathUtils.lerp(-0.03, -0.48, this.adsBlend) + this.recoilPitch * 0.35,
    );
    const reload = this.reloading ? Math.sin(Math.min(1, this.reloadTimer / this.reloadDuration) * Math.PI) : 0;
    this.group.rotation.set(-0.035 - reload * 0.24, -0.025 + reload * 0.42, -0.035 + reload * 0.24);
    this.muzzleFlash.visible = this.muzzleTimer > 0 || this.fxShowcase;
    this.muzzleStar.visible = this.muzzleFlash.visible;
    this.muzzleLight.intensity = this.muzzleFlash.visible ? 2.8 : 0;
    if (this.muzzleFlash.visible) {
      this.muzzleFlash.rotation.z = (this.shotIndex * 2.399963) % (Math.PI * 2);
      this.muzzleFlash.scale.setScalar(0.82 + (this.shotIndex % 3) * 0.12);
      this.muzzleStar.rotation.z = (this.shotIndex * 1.618) % (Math.PI * 2);
      this.muzzleStar.scale.setScalar(0.82 + (this.shotIndex % 2) * 0.16);
    }
    ctx.get('player').setAimZoom(this.adsBlend);
  }

  snapshot() {
    return {
      id: 'vx12',
      ammo: this.ammo,
      reserve: this.reserve,
      reloading: this.reloading,
      reloadPhase: this.getReloadPhase(),
      ads: this.ads,
      adsBlend: this.adsBlend,
      shotsFired: this.shotIndex,
      projectileModel: 'instant-hitscan-with-tracer',
    };
  }

  getReloadPhase() {
    return this.reloading ? (this.reloadTimer < 0.55 ? 'mag_out' : this.reloadTimer < 1.45 ? 'mag_in' : 'chamber') : 'ready';
  }

  stageHarnessReload(ammo = 7, reserve = 120) {
    this.ammo = THREE.MathUtils.clamp(Math.floor(ammo), 0, this.magSize);
    this.reserve = Math.max(0, Math.floor(reserve));
    this.startReload(this.ctx);
  }

  dispose() {
    this.ctx.viewScene.remove(this.group, ...this.viewLights);
    for (const resource of this.resources) resource.dispose?.();
  }
}
