import * as THREE from 'three';

export class PhysicsSystem {
  static id = 'physics';
  static deps = ['world'];

  async init(ctx) {
    this.ctx = ctx;
    this.raycaster = new THREE.Raycaster();
    this.targets = [];
    this.targetProviders = new Set();
    this.normalMatrix = new THREE.Matrix3();
    this.normal = new THREE.Vector3();
    this.worldHit = {
      distance: 0,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      surface: 'concrete',
      actorId: null,
      hitZone: null,
      object: null,
    };
  }

  raycast(origin, direction, maxDistance = 100) {
    this.targets.length = 0;
    const world = this.ctx.get('world');
    world.appendRaycastTargets(this.targets);
    for (const provider of this.targetProviders) provider(this.targets);
    return this.intersectTargets(origin, direction, maxDistance);
  }

  raycastWorld(origin, direction, maxDistance = 100) {
    // AI sight and audio occlusion need gameplay-space obstruction, not
    // per-triangle contact against the decorative render batches.  Those
    // batches deliberately contain many disconnected facade details, making
    // four enemy LOS probes per fixed step far more expensive than the render
    // itself.  Reuse the same axis-aligned solids that own movement collision;
    // player hitscan still uses the detailed mesh path in `raycast()`.
    let nearest = maxDistance;
    let nearestCollider = null;
    let normalX = 0; let normalY = 0; let normalZ = 0;
    const near = 0.02;
    for (const collider of this.ctx.get('world').getColliders()) {
      const minY = collider.minY ?? 0;
      const maxY = collider.maxY ?? collider.height;
      // A ray originating in its own movement solid must not immediately
      // self-occlude. This can happen at exact cover boundaries after actor
      // resolution; the next collider on the ray remains eligible.
      if (origin.x >= collider.minX && origin.x <= collider.maxX
        && origin.y >= minY && origin.y <= maxY
        && origin.z >= collider.minZ && origin.z <= collider.maxZ) continue;
      let tMin = near; let tMax = nearest;
      let hitX = 0; let hitY = 0; let hitZ = 0;
      let intersects = true;

      if (Math.abs(direction.x) < 1e-8) {
        intersects = origin.x >= collider.minX && origin.x <= collider.maxX;
      } else {
        let entry = (collider.minX - origin.x) / direction.x;
        let exit = (collider.maxX - origin.x) / direction.x;
        let entryNormal = -1;
        if (entry > exit) { const swap = entry; entry = exit; exit = swap; entryNormal = 1; }
        if (entry > tMin) { tMin = entry; hitX = entryNormal; hitY = 0; hitZ = 0; }
        tMax = Math.min(tMax, exit);
        intersects = tMin <= tMax;
      }
      if (intersects && Math.abs(direction.y) < 1e-8) {
        intersects = origin.y >= minY && origin.y <= maxY;
      } else if (intersects) {
        let entry = (minY - origin.y) / direction.y;
        let exit = (maxY - origin.y) / direction.y;
        let entryNormal = -1;
        if (entry > exit) { const swap = entry; entry = exit; exit = swap; entryNormal = 1; }
        if (entry > tMin) { tMin = entry; hitX = 0; hitY = entryNormal; hitZ = 0; }
        tMax = Math.min(tMax, exit);
        intersects = tMin <= tMax;
      }
      if (intersects && Math.abs(direction.z) < 1e-8) {
        intersects = origin.z >= collider.minZ && origin.z <= collider.maxZ;
      } else if (intersects) {
        let entry = (collider.minZ - origin.z) / direction.z;
        let exit = (collider.maxZ - origin.z) / direction.z;
        let entryNormal = -1;
        if (entry > exit) { const swap = entry; entry = exit; exit = swap; entryNormal = 1; }
        if (entry > tMin) { tMin = entry; hitX = 0; hitY = 0; hitZ = entryNormal; }
        tMax = Math.min(tMax, exit);
        intersects = tMin <= tMax;
      }
      if (!intersects || tMin >= nearest) continue;
      nearest = tMin;
      nearestCollider = collider;
      normalX = hitX; normalY = hitY; normalZ = hitZ;
    }
    if (!nearestCollider) return null;
    this.worldHit.distance = nearest;
    this.worldHit.point.copy(origin).addScaledVector(direction, nearest);
    this.worldHit.normal.set(normalX, normalY, normalZ);
    this.worldHit.surface = nearestCollider.surface ?? 'concrete';
    return this.worldHit;
  }

  intersectTargets(origin, direction, maxDistance) {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0.02;
    this.raycaster.far = maxDistance;
    const hit = this.raycaster.intersectObjects(this.targets, true)[0];
    if (!hit) return null;
    const owner = hit.object.userData;
    this.normal.set(0, 1, 0);
    if (hit.face) {
      this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      this.normal.copy(hit.face.normal).applyNormalMatrix(this.normalMatrix).normalize();
    }
    return {
      distance: hit.distance,
      point: hit.point.clone(),
      normal: this.normal.clone(),
      surface: owner.surface ?? 'concrete',
      actorId: owner.actorId ?? null,
      hitZone: owner.hitZone ?? null,
      object: hit.object,
    };
  }

  registerTargetProvider(provider) {
    this.targetProviders.add(provider);
    return () => this.targetProviders.delete(provider);
  }

  resolveActor(position, radius) {
    for (const box of this.ctx.get('world').getColliders()) {
      if (position.y > box.height + 0.15) continue;
      const nearestX = Math.max(box.minX, Math.min(position.x, box.maxX));
      const nearestZ = Math.max(box.minZ, Math.min(position.z, box.maxZ));
      const dx = position.x - nearestX; const dz = position.z - nearestZ; const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= radius * radius) continue;
      if (distanceSq > 1e-8) {
        const push = radius / Math.sqrt(distanceSq) - 1; position.x += dx * push; position.z += dz * push;
      } else {
        const left = Math.abs(position.x - box.minX); const right = Math.abs(box.maxX - position.x); const front = Math.abs(position.z - box.minZ); const back = Math.abs(box.maxZ - position.z); const smallest = Math.min(left, right, front, back);
        if (smallest === left) position.x = box.minX - radius; else if (smallest === right) position.x = box.maxX + radius; else if (smallest === front) position.z = box.minZ - radius; else position.z = box.maxZ + radius;
      }
    }
    position.x = Math.max(-6.1, Math.min(11.0, position.x));
    position.z = Math.max(-18, Math.min(16, position.z));
  }

  getCoverPoints() { return this.ctx.get('world').getCoverPoints(); }
  getGroundSurface(position) { return this.ctx.get('world').surfaceAt(position); }

  separateActors(positions, radius = 0.33) {
    const minimum = radius * 2;
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i]; const b = positions[j];
        let dx = b.x - a.x; let dz = b.z - a.z; let distance = Math.hypot(dx, dz);
        if (distance >= minimum) continue;
        if (distance < 1e-5) { dx = (i + j) % 2 ? 1 : -1; dz = (i * 3 + j) % 2 ? 0.5 : -0.5; distance = Math.hypot(dx, dz); }
        const push = (minimum - distance) * 0.5 / distance;
        a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
      }
    }
    for (const position of positions) this.resolveActor(position, radius);
  }

  fireHitscan({ origin, direction, maxDistance = 100, damage = 30, source = 'player' }) {
    const hit = this.raycast(origin, direction, maxDistance);
    if (!hit) return { hit: false, end: origin.clone().addScaledVector(direction, maxDistance) };
    const multiplier = hit.hitZone === 'head' ? 1.65 : hit.hitZone === 'limb' ? 0.72 : 1;
    if (hit.actorId != null) {
      this.ctx.events.emit('combat:damage', {
        targetType: 'enemy',
        targetId: hit.actorId,
        amount: damage * multiplier,
        source,
        hitZone: hit.hitZone,
        point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
        projectileModel: 'instant-hitscan-with-tracer',
      });
    }
    this.ctx.events.emit('projectile:impact', {
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      surface: hit.surface,
      actorId: hit.actorId,
      hitZone: hit.hitZone,
      direction: { x: direction.x, y: direction.y, z: direction.z },
      projectileModel: 'instant-hitscan-with-tracer',
    });
    return { hit: true, ...hit, damage: damage * multiplier, end: hit.point };
  }

  dispose() { this.targetProviders.clear(); }
}
