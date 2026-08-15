import * as THREE from 'three';

const ACTOR_HEIGHT = 1.72;
const STEP_UP = 0.46;

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
    this.worldRayDistance = 0;
    this.worldRayCollider = null;
    this.worldRayNormalX = 0;
    this.worldRayNormalY = 0;
    this.worldRayNormalZ = 0;
    this.nearby = [];
    this.raySlab = [];
    this.floors = [];
    this.bounds = ctx.get('world').getBounds();
  }

  raycast(origin, direction, maxDistance = 100, skipTeam = null) {
    this.targets.length = 0;
    const world = this.ctx.get('world');
    world.appendRaycastTargets(this.targets);
    for (const provider of this.targetProviders) provider(this.targets);
    return this.intersectTargets(origin, direction, maxDistance, skipTeam);
  }

  raycastWorld(origin, direction, maxDistance = 100) {
    // AI sight and audio occlusion need gameplay-space obstruction, not
    // per-triangle contact against the decorative render batches.  Those
    // batches deliberately contain many disconnected facade details, making
    // enemy LOS probes far more expensive than the render itself.  Reuse the
    // same axis-aligned solids that own movement collision; player hitscan
    // still uses the detailed mesh path in `raycast()`.
    if (!this.findWorldIntersection(origin, direction, maxDistance)) return null;
    return {
      distance: this.worldRayDistance,
      point: origin.clone().addScaledVector(direction, this.worldRayDistance),
      normal: new THREE.Vector3(this.worldRayNormalX, this.worldRayNormalY, this.worldRayNormalZ),
      surface: this.worldRayCollider.surface ?? 'concrete',
      actorId: null,
      hitZone: null,
      object: null,
    };
  }

  raycastWorldDistance(origin, direction, maxDistance = 100) {
    return this.findWorldIntersection(origin, direction, maxDistance) ? this.worldRayDistance : null;
  }

  // The district holds thousands of solids, so a linear scan per probe is not
  // viable with twelve combatants. Walk the world broadphase grid along the ray
  // and stop as soon as a hit is closer than the next cell boundary.
  findWorldIntersection(origin, direction, maxDistance) {
    const world = this.ctx.get('world');
    let nearest = maxDistance;
    let nearestCollider = null;
    let normalX = 0; let normalY = 0; let normalZ = 0;
    {
      world.queryRayColliders(origin.x, origin.z, direction.x, direction.z, maxDistance, this.raySlab);
      for (const collider of this.raySlab) {
        const minY = collider.minY ?? 0;
        const maxY = collider.maxY ?? collider.height;
        // A ray originating in its own movement solid must not immediately
        // self-occlude. This can happen at exact cover boundaries after actor
        // resolution; the next collider on the ray remains eligible.
        if (origin.x >= collider.minX && origin.x <= collider.maxX
          && origin.y >= minY && origin.y <= maxY
          && origin.z >= collider.minZ && origin.z <= collider.maxZ) continue;
        let tMin = 0.02; let tMax = nearest;
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
    }
    if (!nearestCollider) return false;
    this.worldRayDistance = nearest;
    this.worldRayCollider = nearestCollider;
    this.worldRayNormalX = normalX;
    this.worldRayNormalY = normalY;
    this.worldRayNormalZ = normalZ;
    return true;
  }

  intersectTargets(origin, direction, maxDistance, skipTeam = null) {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0.02;
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.targets, true);
    // Friendly bodies do not stop a bullet in team deathmatch; the shot passes
    // through a squadmate and can still reach the opponent behind them.
    let hit = null;
    for (const candidate of hits) {
      if (skipTeam && candidate.object.userData?.team === skipTeam) continue;
      hit = candidate; break;
    }
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

  // The floor an actor at this position should stand on: the highest walkable
  // top at or just above the feet, so stairs and container tops are climbable
  // while a 4 m catwalk is not.
  groundHeightAt(x, z, currentY, stepUp = STEP_UP) {
    const world = this.ctx.get('world');
    let best = 0;
    for (const platform of world.getPlatforms()) {
      if (x < platform.minX || x > platform.maxX || z < platform.minZ || z > platform.maxZ) continue;
      if (platform.top > currentY + stepUp || platform.top <= best) continue;
      best = platform.top;
    }
    return best;
  }

  resolveActor(position, radius, height = ACTOR_HEIGHT, stepUp = STEP_UP) {
    const world = this.ctx.get('world');
    const feet = position.y; const head = position.y + height;
    for (const box of world.queryColliders(position.x - radius, position.x + radius, position.z - radius, position.z + radius, this.nearby)) {
      const minY = box.minY ?? 0;
      const maxY = box.maxY ?? box.height;
      // Walking under an elevated mass is not a collision, and neither is a
      // solid low enough to step onto. Without the step-up exemption a stair
      // tread pushes the actor back down the flight it is trying to climb.
      if (maxY <= feet + stepUp || minY >= head) continue;
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
    const bounds = this.bounds;
    position.x = Math.max(bounds.minX + 0.5, Math.min(bounds.maxX - 0.5, position.x));
    position.z = Math.max(bounds.minZ + 0.5, Math.min(bounds.maxZ - 0.5, position.z));
  }

  getCoverPoints() { return this.ctx.get('world').getCoverPoints(); }
  getGroundSurface(position) { return this.ctx.get('world').surfaceAt(position); }

  separateActors(positions, radii = null, immovableIndex = -1, radius = 0.33) {
    // Resolve movable pairs first. Repeating the projection keeps compact enemy
    // groups stable after a world boundary pushes one member back into another.
    for (let iteration = 0; iteration < 3; iteration += 1) {
      for (let i = 0; i < positions.length; i += 1) {
        if (i === immovableIndex) continue;
        for (let j = i + 1; j < positions.length; j += 1) {
          if (j === immovableIndex) continue;
          const a = positions[i]; const b = positions[j];
          // Actors on different decks do not jostle each other.
          if (Math.abs(a.y - b.y) > 1.4) continue;
          const minimum = (radii?.[i] ?? radius) + (radii?.[j] ?? radius);
          const dx = b.x - a.x; const dz = b.z - a.z; const distance = Math.hypot(dx, dz);
          if (distance >= minimum) continue;
          let dirX; let dirZ;
          if (distance < 1e-5) {
            dirX = (i + j) % 2 ? 1 : -1;
            dirZ = (i * 3 + j) % 2 ? 0.5 : -0.5;
            const inverse = 1 / Math.hypot(dirX, dirZ);
            dirX *= inverse; dirZ *= inverse;
          } else {
            dirX = dx / distance; dirZ = dz / distance;
          }
          const half = (minimum - distance) * 0.5;
          a.x -= dirX * half; a.z -= dirZ * half;
          b.x += dirX * half; b.z += dirZ * half;
        }
      }
      for (let i = 0; i < positions.length; i += 1) {
        if (i !== immovableIndex) this.resolveActor(positions[i], radii?.[i] ?? radius);
      }
    }

    if (immovableIndex < 0 || immovableIndex >= positions.length) return;
    const anchor = positions[immovableIndex];
    const anchorRadius = radii?.[immovableIndex] ?? radius;
    // Project player contacts last so later enemy-enemy work cannot reintroduce
    // overlap. If the radial position is wall-pinned, choose the nearest free
    // tangent around the player instead of oscillating into the wall.
    for (let i = 0; i < positions.length; i += 1) {
      if (i === immovableIndex) continue;
      const actor = positions[i]; const actorRadius = radii?.[i] ?? radius;
      if (Math.abs(actor.y - anchor.y) > 1.4) continue;
      const minimum = anchorRadius + actorRadius;
      const dx = actor.x - anchor.x; const dz = actor.z - anchor.z;
      if (dx * dx + dz * dz >= minimum * minimum) continue;
      const baseAngle = Math.hypot(dx, dz) > 1e-5
        ? Math.atan2(dz, dx)
        : ((i * 2 + 1) / Math.max(2, positions.length)) * Math.PI * 2;
      let placed = false;
      for (let shell = 0; shell < 4 && !placed; shell += 1) {
        const targetDistance = minimum + 0.001 + shell * actorRadius * 1.2;
        for (let sample = 0; sample < 32; sample += 1) {
          const offset = sample === 0 ? 0 : sample % 2 ? (sample + 1) * 0.5 : -sample * 0.5;
          const angle = baseAngle + offset * Math.PI / 16;
          const x = anchor.x + Math.cos(angle) * targetDistance;
          const z = anchor.z + Math.sin(angle) * targetDistance;
          if (!this.canOccupyActor(x, actor.y, z, actorRadius, positions, radii, i, radius)) continue;
          actor.x = x; actor.z = z; placed = true; break;
        }
      }
      if (!placed) {
        // No feasible local slot exists (a genuinely closed constraint). Keep
        // world validity instead of tunnelling into static geometry.
        this.resolveActor(actor, actorRadius);
      }
    }
  }

  canOccupyActor(x, y, z, radius, positions, radii, selfIndex, defaultRadius) {
    const bounds = this.bounds;
    if (x < bounds.minX + 0.5 || x > bounds.maxX - 0.5 || z < bounds.minZ + 0.5 || z > bounds.maxZ - 0.5) return false;
    const world = this.ctx.get('world');
    const feet = y; const head = y + ACTOR_HEIGHT;
    for (const box of world.queryColliders(x - radius, x + radius, z - radius, z + radius, this.nearby)) {
      const minY = box.minY ?? 0;
      const maxY = box.maxY ?? box.height;
      if (maxY <= feet + STEP_UP || minY >= head) continue;
      const nearestX = Math.max(box.minX, Math.min(x, box.maxX));
      const nearestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - nearestX; const dz = z - nearestZ;
      if (dx * dx + dz * dz < radius * radius - 1e-8) return false;
    }
    for (let i = 0; i < positions.length; i += 1) {
      if (i === selfIndex) continue;
      const other = positions[i]; const minimum = radius + (radii?.[i] ?? defaultRadius);
      if (Math.abs(other.y - y) > 1.4) continue;
      const dx = x - other.x; const dz = z - other.z;
      if (dx * dx + dz * dz < minimum * minimum - 1e-8) return false;
    }
    return true;
  }

  fireHitscan({ origin, direction, maxDistance = 100, damage = 30, source = 'player', sourceTeam = null }) {
    const hit = this.raycast(origin, direction, maxDistance, sourceTeam);
    if (!hit) return { hit: false, end: origin.clone().addScaledVector(direction, maxDistance) };
    const multiplier = hit.hitZone === 'head' ? 1.65 : hit.hitZone === 'limb' ? 0.72 : 1;
    if (hit.actorId != null) {
      this.ctx.events.emit('combat:damage', {
        targetType: hit.actorId === 'player' ? 'player' : 'enemy',
        targetId: hit.actorId,
        amount: damage * multiplier,
        source,
        sourceTeam,
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
