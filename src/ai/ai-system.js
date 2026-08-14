import * as THREE from 'three';

const SPAWNS = [
  [0, 0, -3.0],
  [2.8, 0, -5.2],
  [5.4, 0, -1.8],
  [-5.2, 0, -6.2],
];

export class AISystem {
  static id = 'ai';
  static deps = ['physics', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'enemy-squad';
    ctx.scene.add(this.group);
    this.resources = new Set();
    this.enemies = [];
    this.livePositions = [];
    this.damageOff = ctx.events.on('combat:damage', (event) => this.onDamage(event));
    this.buildEnemies();
    this.unregisterTargets = ctx.get('physics').registerTargetProvider((targets) => this.appendRaycastTargets(targets));
    await this.reset(ctx);
  }

  buildEnemies() {
    const uniform = new THREE.MeshStandardMaterial({ color: 0x4b5545, roughness: 0.8, metalness: 0.05 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x252b24, roughness: 0.74, metalness: 0.12 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x7e523b, roughness: 0.76 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x11191a, roughness: 0.18, metalness: 0.62 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x625b43, roughness: 0.86, metalness: 0.03 });
    const lens = new THREE.MeshStandardMaterial({ color: 0x31505a, roughness: 0.08, metalness: 0.5, emissive: 0x0a2027, emissiveIntensity: 0.65 });
    for (const material of [uniform, vest, skin, visor, gear, lens]) this.resources.add(material);

    for (let id = 0; id < SPAWNS.length; id += 1) {
      const root = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.55, 5, 10), uniform);
      torso.position.y = 1.1;
      torso.userData = { actorId: id, hitZone: 'torso', surface: 'fabric' };
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.58, 0.28, 2, 2, 1), vest);
      armor.position.set(0, 1.15, -0.12);
      armor.userData = { actorId: id, hitZone: 'torso', surface: 'fabric' };
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), skin);
      head.position.y = 1.74;
      head.userData = { actorId: id, hitZone: 'head', surface: 'flesh' };
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), vest);
      helmet.position.y = 1.79;
      helmet.userData = { actorId: id, hitZone: 'head', surface: 'metal' };
      const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), visor);
      visorMesh.position.set(0, 1.77, -0.18);
      visorMesh.userData = { actorId: id, hitZone: 'head', surface: 'glass' };
      const mask = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.06), vest); mask.position.set(0, 1.66, -0.18); mask.userData = { actorId: id, hitZone: 'head', surface: 'fabric' };
      const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.075, 0.04), lens); goggle.position.set(0, 1.77, -0.215); goggle.userData = { actorId: id, hitZone: 'head', surface: 'glass' };
      const helmetBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.045, 16), vest); helmetBrim.position.set(0, 1.82, -0.01); helmetBrim.userData = { actorId: id, hitZone: 'head', surface: 'metal' };
      const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.2, 2, 2, 1), gear); backpack.position.set(0, 1.12, 0.28); backpack.userData = { actorId: id, hitZone: 'torso', surface: 'fabric' };
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.28), gear); belt.position.set(0, 0.82, 0); belt.userData = { actorId: id, hitZone: 'torso', surface: 'fabric' };
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.18, 10), skin); neck.position.y = 1.55; neck.userData = { actorId: id, hitZone: 'head', surface: 'flesh' };
      root.add(torso, armor, head, helmet, visorMesh, mask, goggle, helmetBrim, backpack, belt, neck);
      for (let p = -1; p <= 1; p += 1) {
        const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.09), gear); pouch.position.set(p * 0.16, 1.03, -0.29); pouch.userData = { actorId: id, hitZone: 'torso', surface: 'fabric' }; root.add(pouch);
      }
      const arms = [];
      for (const x of [-0.31, 0.31]) {
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.26, 2, 2, 2), vest); shoulder.position.set(x, 1.39, -0.02); shoulder.rotation.z = x < 0 ? -0.18 : 0.18; shoulder.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.24, 4, 8), uniform); upper.position.set(x, 1.27, -0.12); upper.rotation.set(-0.72, 0, x < 0 ? -0.32 : 0.32); upper.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.25, 4, 8), gear); lower.position.set(x * 0.72, 1.1, -0.36); lower.rotation.set(-1.15, 0, x < 0 ? 0.28 : -0.28); lower.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.1), vest); elbow.position.set(x * 0.84, 1.13, -0.28); elbow.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 9, 7), visor); hand.position.set(x * 0.48, 1.08, -0.47); hand.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        root.add(shoulder, upper, lower, elbow, hand); arms.push(upper, lower);
      }
      const legs = [];
      for (const x of [-0.15, 0.15]) {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.29, 4, 8), uniform); leg.position.set(x, 0.64, 0); leg.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.27, 4, 8), uniform); shin.position.set(x, 0.29, 0.015); shin.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const knee = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.09), vest); knee.position.set(x, 0.48, -0.1); knee.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.18, 0.32), visor); boot.position.set(x, 0.12, -0.06); boot.userData = { actorId: id, hitZone: 'limb', surface: 'rubber' };
        root.add(leg, shin, knee, boot); legs.push(leg);
      }
      const rifle = new THREE.Group(); rifle.position.set(0.16, 1.2, -0.48); rifle.rotation.x = -0.08;
      const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.68), visor); rifleBody.userData = { actorId: id, hitZone: 'limb', surface: 'metal' };
      const rifleStock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.34), gear); rifleStock.position.z = 0.46; rifleStock.userData = { actorId: id, hitZone: 'limb', surface: 'fabric' };
      const rifleBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.72, 10), visor); rifleBarrel.rotation.x = Math.PI / 2; rifleBarrel.position.z = -0.68; rifleBarrel.userData = { actorId: id, hitZone: 'limb', surface: 'metal' };
      const optic = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.2), lens); optic.position.set(0, 0.11, -0.05); optic.userData = { actorId: id, hitZone: 'limb', surface: 'glass' };
      rifle.add(rifleBody, rifleStock, rifleBarrel, optic); root.add(rifle);
      root.userData.limbs = { legs, arms, rifle };
      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          this.resources.add(child.geometry);
        }
      });
      this.group.add(root);
      this.enemies.push({ id, root, health: 100, alive: true, state: 'patrol', cooldown: 1, strafe: id % 2 ? 1 : -1, phase: id * 1.7, hasLos: false, lastSeen: new THREE.Vector3(), coverTarget: new THREE.Vector3(), coverApproach: new THREE.Vector3(), coverTimer: 0, coverHoldTimer: 0, hasCover: false, inCover: false, approachingCover: false, limbs: root.userData.limbs });
    }
  }

  reset(ctx) {
    this.rng = ctx.rng.fork('ai');
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      enemy.root.position.fromArray(SPAWNS[i]);
      enemy.root.rotation.set(0, 0, 0);
      enemy.root.scale.set(1, 1, 1);
      enemy.root.visible = true;
      enemy.health = 100;
      enemy.alive = true;
      enemy.state = 'patrol';
      enemy.cooldown = 0.75 + i * 0.31;
      enemy.strafe = i % 2 ? 1 : -1;
      enemy.hasLos = false;
      enemy.coverTimer = 0;
      enemy.coverHoldTimer = 0;
      enemy.hasCover = false;
      enemy.inCover = false;
      enemy.approachingCover = false;
      enemy.lastSeen.copy(enemy.root.position);
      enemy.root.traverse((child) => { if (child.isMesh && child.userData.hitZone) child.userData.actorId = enemy.id; });
    }
    this.harnessFreeze = false;
  }

  setShot(name) {
    this.harnessFreeze = !['combat', 'fx', 'hud'].includes(name);
    const showEnemies = ['street', 'weapon_hip', 'weapon_ads', 'combat', 'enemy', 'fx', 'hud'].includes(name);
    for (const enemy of this.enemies) enemy.root.visible = showEnemies;
    if (name === 'enemy') {
      this.enemies[0].root.position.set(-0.25, 0, -2.3);
      this.enemies[0].root.rotation.y = 2.62;
    }
  }

  fixedUpdate(step, ctx) {
    const player = ctx.get('player');
    if (player.dead) {
      for (const enemy of this.enemies) if (enemy.alive) { enemy.state = 'hold'; enemy.hasLos = false; }
      return;
    }
    if (ctx.harness.active && this.harnessFreeze) return;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = player.position.x - enemy.root.position.x;
      const dz = player.position.z - enemy.root.position.z;
      const distance = Math.hypot(dx, dz);
      this.eye ??= new THREE.Vector3(); this.target ??= new THREE.Vector3(); this.ray ??= new THREE.Vector3();
      this.eye.copy(enemy.root.position); this.eye.y += enemy.inCover ? 1.15 : 1.48;
      this.target.copy(player.position); this.target.y += player.eyeHeight * 0.86;
      this.ray.subVectors(this.target, this.eye); const rayDistance = this.ray.length(); this.ray.multiplyScalar(1 / Math.max(0.0001, rayDistance));
      const obstruction = ctx.get('physics').raycastWorld(this.eye, this.ray, rayDistance);
      enemy.hasLos = !obstruction || obstruction.distance >= rayDistance - 0.12;
      if (enemy.hasLos) enemy.lastSeen.copy(player.position);
      enemy.root.rotation.y = Math.atan2(-dx, -dz);
      enemy.cooldown -= step;
      enemy.coverTimer = Math.max(0, enemy.coverTimer - step);
      enemy.coverHoldTimer = Math.max(0, enemy.coverHoldTimer - step);
      if (enemy.inCover && enemy.coverHoldTimer > 0) {
        enemy.state = 'cover';
        this.animateEnemy(enemy, ctx);
        continue;
      }
      if (enemy.inCover) enemy.inCover = false;
      if (enemy.hasCover && enemy.coverTimer <= 0) { enemy.hasCover = false; enemy.approachingCover = false; }
      if (enemy.hasCover) {
        let destination = enemy.approachingCover ? enemy.coverApproach : enemy.coverTarget;
        let coverX = destination.x - enemy.root.position.x; let coverZ = destination.z - enemy.root.position.z; let coverDistance = Math.hypot(coverX, coverZ);
        if (enemy.approachingCover && coverDistance <= 0.34) {
          enemy.approachingCover = false; destination = enemy.coverTarget;
          coverX = destination.x - enemy.root.position.x; coverZ = destination.z - enemy.root.position.z; coverDistance = Math.hypot(coverX, coverZ);
        }
        if (coverDistance > 0.34) {
          enemy.state = 'reposition';
          this.moveEnemy(enemy, coverX / coverDistance, coverZ / coverDistance, step * 3.8, ctx);
          this.animateEnemy(enemy, ctx);
          continue;
        }
        enemy.hasCover = false;
        enemy.inCover = true;
        enemy.coverHoldTimer = 1.35;
        enemy.state = 'cover';
        this.animateEnemy(enemy, ctx);
        continue;
      }
      if (distance < 24 && enemy.hasLos) {
        enemy.state = distance > 9 ? 'advance' : 'engage';
        if (distance > 8) {
          this.moveEnemy(enemy, dx / distance, dz / distance, step * 0.72, ctx);
        } else {
          this.moveEnemy(enemy, dz / distance * enemy.strafe, -dx / distance * enemy.strafe, step * 0.45, ctx);
        }
        if (enemy.cooldown <= 0 && distance < 18) {
          enemy.cooldown = 0.7 + this.rng.range(0.18, 0.62);
          const hitChance = THREE.MathUtils.clamp(0.78 - distance * 0.025, 0.28, 0.66);
          const hit = this.rng.next() < hitChance;
          const end = this.target.clone(); if (!hit) { end.x += this.rng.range(-1.1, 1.1); end.y += this.rng.range(-0.65, 0.75); }
          this.muzzle ??= new THREE.Vector3(); this.muzzle.set(0.16, 1.2, -1.48); enemy.root.localToWorld(this.muzzle);
          ctx.events.emit('ai:fired', { enemyId: enemy.id, origin: { x: this.muzzle.x, y: this.muzzle.y, z: this.muzzle.z }, end: { x: end.x, y: end.y, z: end.z }, hit });
          if (hit) {
            const damageScale = ctx.harness.scenario === 'profile' ? 0.24 : 1;
            ctx.events.emit('combat:damage', { targetType: 'player', targetId: 'player', amount: this.rng.range(2.5, 5.2) * damageScale, source: enemy.id });
          }
        }
      } else if (distance < 24) {
        enemy.state = 'search';
        if (ctx.harness.scenario !== 'occlusion-test') {
          const sx = enemy.lastSeen.x - enemy.root.position.x; const sz = enemy.lastSeen.z - enemy.root.position.z; const length = Math.hypot(sx, sz);
          if (length > 0.8) this.moveEnemy(enemy, sx / length, sz / length, step * 0.58, ctx);
        }
      } else {
        enemy.state = 'patrol';
      }
      this.animateEnemy(enemy, ctx);
    }
    this.livePositions.length = 0;
    for (const enemy of this.enemies) if (enemy.alive) this.livePositions.push(enemy.root.position);
    ctx.get('physics').separateActors(this.livePositions, 0.31);
  }

  animateEnemy(enemy, ctx) {
      const moving = enemy.state === 'advance' || enemy.state === 'reposition';
      const gait = moving ? Math.sin(ctx.time.elapsed * 6 + enemy.phase) * 0.025 : 0;
      enemy.root.position.y = gait;
      const stride = moving ? Math.sin(ctx.time.elapsed * 6 + enemy.phase) * 0.34 : 0;
      enemy.limbs.legs[0].rotation.x = stride;
      enemy.limbs.legs[1].rotation.x = -stride;
      enemy.limbs.rifle.position.y = Math.sin(ctx.time.elapsed * 5 + enemy.phase) * 0.015;
      enemy.root.scale.y = THREE.MathUtils.damp(enemy.root.scale.y, enemy.inCover ? 0.86 : 1, 12, ctx.time.fixed);
  }

  moveEnemy(enemy, dirX, dirZ, amount, ctx) {
    const beforeX = enemy.root.position.x; const beforeZ = enemy.root.position.z;
    enemy.root.position.x += dirX * amount; enemy.root.position.z += dirZ * amount; ctx.get('physics').resolveActor(enemy.root.position, 0.3);
    const moved = Math.hypot(enemy.root.position.x - beforeX, enemy.root.position.z - beforeZ);
    if (moved < amount * 0.25) {
      enemy.root.position.x = beforeX + dirZ * enemy.strafe * amount; enemy.root.position.z = beforeZ - dirX * enemy.strafe * amount; ctx.get('physics').resolveActor(enemy.root.position, 0.3);
    }
  }

  stageOcclusionTest() {
    this.harnessFreeze = false;
    const player = this.ctx.get('player'); player.stageHarnessPose({ position: [-2.6, 0, 1.0], eyeHeight: 1.16, stance: 'crouch' });
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i]; enemy.root.visible = i === 0; enemy.alive = i === 0; enemy.health = i === 0 ? 100 : 0; enemy.root.position.set(i === 0 ? -2.6 : 20 + i, 0, i === 0 ? -4.0 : 20); enemy.cooldown = 0; enemy.hasLos = false; enemy.lastSeen.copy(enemy.root.position);
      enemy.root.traverse((child) => { if (child.isMesh && child.userData.hitZone) child.userData.actorId = enemy.alive ? enemy.id : null; });
    }
  }

  applyHarnessDamage(enemyId, amount = 8, hitZone = 'torso') {
    this.harnessFreeze = false;
    this.onDamage({ targetType: 'enemy', targetId: enemyId, amount, source: 'harness', hitZone });
  }

  stageFireFeedbackTest() {
    this.harnessFreeze = false;
    const player = this.ctx.get('player');
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      enemy.alive = i === 0; enemy.root.visible = i === 0; enemy.health = i === 0 ? 100 : 0;
      enemy.root.position.set(i === 0 ? player.position.x : 20 + i, 0, i === 0 ? player.position.z - 5 : 20);
      enemy.cooldown = 0; enemy.hasCover = false; enemy.inCover = false;
      enemy.root.traverse((child) => { if (child.isMesh && child.userData.hitZone) child.userData.actorId = enemy.alive ? enemy.id : null; });
    }
  }

  isEnemyInCover(enemyId) { return Boolean(this.enemies[enemyId]?.inCover); }

  onDamage(event) {
    if (event.targetType !== 'enemy') return;
    const enemy = this.enemies[event.targetId];
    if (!enemy?.alive) return;
    enemy.health = Math.max(0, enemy.health - event.amount);
    this.ctx.events.emit('combat:hit', { targetId: enemy.id, hitZone: event.hitZone, damage: event.amount, killed: enemy.health <= 0 });
    if (enemy.health > 0) this.chooseCover(enemy);
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.state = 'dead';
      enemy.root.rotation.z = enemy.id % 2 ? 1.32 : -1.32;
      enemy.root.position.y = 0.25;
      enemy.root.traverse((child) => {
        if (child.isMesh) child.userData.actorId = null;
      });
      this.ctx.events.emit('actor:died', { actorType: 'enemy', actorId: enemy.id, position: { x: enemy.root.position.x, y: enemy.root.position.y, z: enemy.root.position.z } });
    }
  }

  chooseCover(enemy) {
    const player = this.ctx.get('player'); const physics = this.ctx.get('physics');
    this.coverOrigin ??= new THREE.Vector3(); this.coverPoint ??= new THREE.Vector3(); this.coverRay ??= new THREE.Vector3();
    this.coverOrigin.copy(player.position); this.coverOrigin.y += player.eyeHeight * 0.9;
    let best = null; let bestScore = Infinity;
    for (const [x, z] of physics.getCoverPoints()) {
      const enemyDistance = Math.hypot(x - enemy.root.position.x, z - enemy.root.position.z);
      const playerDistance = Math.hypot(x - player.position.x, z - player.position.z);
      if (enemyDistance > 8 || playerDistance < 2.2) continue;
      this.coverPoint.set(x, 1.25, z); this.coverRay.subVectors(this.coverPoint, this.coverOrigin); const rayDistance = this.coverRay.length(); this.coverRay.multiplyScalar(1 / Math.max(0.001, rayDistance));
      const obstruction = physics.raycastWorld(this.coverOrigin, this.coverRay, rayDistance);
      if (!obstruction || obstruction.distance >= rayDistance - 0.2) continue;
      const score = enemyDistance + playerDistance * 0.08;
      if (score < bestScore) { bestScore = score; best = [x, z]; }
    }
    if (best) {
      enemy.coverTarget.set(best[0], 0, best[1]);
      const distance = Math.hypot(best[0] - enemy.root.position.x, best[1] - enemy.root.position.z);
      enemy.coverTimer = distance + 2;
      enemy.hasCover = true;
      enemy.inCover = false;
      const awayX = best[0] - player.position.x; const awayZ = best[1] - player.position.z; const awayLength = Math.hypot(awayX, awayZ) || 1;
      enemy.coverApproach.set(best[0] + awayX / awayLength * 0.72, 0, best[1] + awayZ / awayLength * 0.72);
      enemy.approachingCover = true;
      enemy.strafe *= -1;
    }
  }

  appendRaycastTargets(targets) {
    for (const enemy of this.enemies) if (enemy.alive) targets.push(enemy.root);
  }

  getAimPoint() {
    const enemy = this.enemies.find((candidate) => candidate.alive);
    if (!enemy) return null;
    return { x: enemy.root.position.x, y: enemy.root.position.y + 1.74, z: enemy.root.position.z };
  }

  aliveCount() {
    let count = 0;
    for (const enemy of this.enemies) if (enemy.alive) count += 1;
    return count;
  }

  snapshot() {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      health: enemy.health,
      alive: enemy.alive,
      state: enemy.state,
      hasLos: enemy.hasLos,
      covering: enemy.hasCover || enemy.inCover,
      position: enemy.root.position.toArray(),
      coverTarget: enemy.hasCover || enemy.inCover ? enemy.coverTarget.toArray() : null,
    }));
  }

  dispose() {
    this.damageOff?.();
    this.unregisterTargets?.();
    this.ctx.scene.remove(this.group);
    for (const resource of this.resources) resource.dispose?.();
  }
}
