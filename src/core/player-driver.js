// Deterministic scripted player for scenario runs.
//
// The previous driver held `forward`, never turned, and snapped its aim onto any
// visible opponent. It walked into walls and camped, so every "player-facing"
// pacing number it produced described a wall-camper rather than a player.
//
// This one plays through the same inputs a person uses:
//   * movement via the virtual WASD/sprint actions
//   * turning via `input.injectLook`, the same channel the mouse feeds, with a
//     capped turn rate — it never writes yaw/pitch directly
//   * firing and reloading through the weapon's own input handling
//
// It is deliberately NOT omniscient. It only notices opponents inside its own
// view cone, within a plausible spotting range, with real line of sight, and it
// needs a reaction delay before it reacts to one. Aim converges over time and
// keeps residual error, so it cannot headshot on sight.

const LOOK_SENSITIVITY = 0.00225;   // matches PlayerSystem
const MAX_TURN_RATE = 5.2;          // rad/s, roughly a brisk flick
const AIM_TURN_RATE = 7.5;          // faster while engaging a known target
const VIEW_CONE = 0.95;             // ~54 deg from centre; a player sees a screen, not a sphere
const SPOT_RANGE = 46;
const REACTION_SECONDS = 0.28;
const FIRE_ANGLE = 0.035;           // only pull the trigger when actually on target
const ARRIVE = 1.6;
const REPATH_SECONDS = 1.5;
const STUCK_SECONDS = 1.1;

const wrapAngle = (angle) => {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
};

export class PlayerDriver {
  constructor(engine, rng) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.path = [];
    this.pathIndex = 0;
    this.goalNode = -1;
    this.goalZone = null;
    this.repathTimer = 0;
    this.stuckTimer = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.targetId = null;
    this.visibleFor = 0;
    this.aimSettle = 0;
    this.burst = 0;
    this.postFightTimer = 0;
    this.wanderYaw = 0;
    this.strafeSign = 1;
    this.hasSample = false;
    this.sampleX = 0;
    this.sampleZ = 0;
    this.telemetry = {
      frames: 0, combatFrames: 0, travelFrames: 0, idleFrames: 0,
      distance: 0, shots: 0, zonesVisited: new Set(), goalZones: new Map(),
      contactGaps: [], sinceContact: 0, firstContact: null,
      // Why the player is not in contact, sampled every no-contact frame.
      // Telemetry only: nothing here feeds a driver decision.
      gapCause: { far: 0, occluded: 0, behind: 0, none: 0 },
      gapSamples: [], gapCurrent: null, gapZones: new Map(), gapNearest: [], blockFractions: [], gapClearance: [], contactClearance: [], blockers: new Map(), boundaryBlockers: new Map(), boundaryBlocked: 0,
      respawnToContact: [], sinceSpawn: null, awaitingFirstContact: false,
      deaths: 0, blockedRecoveries: 0, maxY: 0, elevatedFrames: 0,
    };
  }

  // ------------------------------------------------------------- perception

  // Only opponents the player could actually see: inside the view cone, within
  // spotting range, with clear line of sight.
  findVisibleTarget(player) {
    const ai = this.ctx.get('ai');
    const physics = this.ctx.get('physics');
    const match = this.ctx.peek('match');
    this.eyeFrom ??= { x: 0, y: 0, z: 0 };
    this.eyeDir ??= { x: 0, y: 0, z: 0 };
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    let best = null;
    let bestScore = Infinity;
    for (const bot of ai.bots) {
      if (!bot.alive || !bot.participating || bot.team === player.team) continue;
      if (match?.isProtected(bot.id)) continue;
      const dx = bot.root.position.x - player.position.x;
      const dz = bot.root.position.z - player.position.z;
      const flat = Math.hypot(dx, dz);
      if (flat > SPOT_RANGE || flat < 0.001) continue;
      const dot = (dx / flat) * forwardX + (dz / flat) * forwardZ;
      if (dot < VIEW_CONE - 0.35) continue;
      const dy = (bot.root.position.y + 1.35) - (player.position.y + player.eyeHeight);
      const length = Math.hypot(dx, dy, dz);
      this.eyeFrom.x = player.position.x; this.eyeFrom.y = player.position.y + player.eyeHeight; this.eyeFrom.z = player.position.z;
      this.eyeDir.x = dx / length; this.eyeDir.y = dy / length; this.eyeDir.z = dz / length;
      const blocked = physics.raycastWorldDistance(this.eyeFrom, this.eyeDir, length);
      if (blocked != null && blocked < length - 0.4) continue;
      const score = flat - (bot.id === this.targetId ? 10 : 0);
      if (score < bestScore) { bestScore = score; best = bot; }
    }
    return best;
  }

  // Why is nobody visible right now? Distinguishes the three failure modes that
  // need completely different fixes: enemies genuinely far away (distribution),
  // close but behind geometry (map occlusion), or close and in the open but
  // outside the view cone (the player is facing the wrong way).
  diagnoseGap(player) {
    const ai = this.ctx.get('ai');
    const physics = this.ctx.get('physics');
    const match = this.ctx.peek('match');
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    let nearest = Infinity;
    let nearestBlockedFlat = Infinity;
    let cause = 'none';
    this.lastBlockFraction = null;
    this.lastBlocker = null;
    this.lastBoundaryPair = false;
    for (const bot of ai.bots) {
      if (!bot.alive || !bot.participating || bot.team === player.team) continue;
      if (match?.isProtected(bot.id)) continue;
      const dx = bot.root.position.x - player.position.x;
      const dz = bot.root.position.z - player.position.z;
      const flat = Math.hypot(dx, dz);
      if (flat < 0.001) continue;
      if (flat < nearest) nearest = flat;
      if (flat > SPOT_RANGE) continue;
      const dy = (bot.root.position.y + 1.35) - (player.position.y + player.eyeHeight);
      const length = Math.hypot(dx, dy, dz);
      this.eyeFrom ??= { x: 0, y: 0, z: 0 }; this.eyeDir ??= { x: 0, y: 0, z: 0 };
      this.eyeFrom.x = player.position.x; this.eyeFrom.y = player.position.y + player.eyeHeight; this.eyeFrom.z = player.position.z;
      this.eyeDir.x = dx / length; this.eyeDir.y = dy / length; this.eyeDir.z = dz / length;
      const blocked = physics.raycastWorldDistance(this.eyeFrom, this.eyeDir, length);
      const clear = blocked == null || blocked >= length - 0.4;
      // Where along the ray the blocker sits decides the fix. A blocker close to
      // either end is local cover (healthy: two steps breaks it). One near the
      // middle is a whole structure between the two, which no amount of local
      // movement resolves.
      if (!clear && flat < nearestBlockedFlat) {
        nearestBlockedFlat = flat;
        this.lastBlockFraction = blocked / length;
        const c = physics.raycastWorldBlocker(this.eyeFrom, this.eyeDir, length);
        this.lastBlocker = c
          ? `${c.minX.toFixed(1)},${c.maxX.toFixed(1)},${c.minZ.toFixed(1)},${c.maxZ.toFixed(1)},${(c.minY ?? 0).toFixed(1)},${(c.maxY ?? c.height ?? 0).toFixed(1)}`
          : null;
        // Was this a sightline that *should* have existed: two combatants in the
        // market/east-terrace pair, close enough to fight?
        this.lastBoundaryPair = flat < 40
          && this.zoneOf(player.position.x, player.position.z) !== this.zoneOf(bot.root.position.x, bot.root.position.z)
          && [this.zoneOf(player.position.x, player.position.z), this.zoneOf(bot.root.position.x, bot.root.position.z)]
            .every((z) => z === 'market' || z === 'east-terrace');
      }
      const inCone = ((dx / flat) * forwardX + (dz / flat) * forwardZ) >= VIEW_CONE - 0.35;
      // Worst case wins: a clear shot the player is facing away from is the most
      // damning, an occluded near enemy next.
      if (clear && !inCone) { cause = 'behind'; break; }
      if (!clear) cause = 'occluded';
      else if (cause === 'none') cause = 'occluded';
    }
    if (cause === 'none' && nearest > SPOT_RANGE) cause = 'far';
    return {
      cause, nearest, blockFraction: this.lastBlockFraction, clearance: this.measureClearance(player),
      blocker: this.lastBlocker, boundaryPair: this.lastBoundaryPair,
    };
  }

  zoneOf(x, z) {
    for (const zone of this.ctx.get('world').getZones()) {
      if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) return zone.id;
    }
    return 'none';
  }

  // How boxed-in the player is: distance to the nearest wall in eight directions.
  // A route that scrapes building faces leaves a travelling player with almost no
  // field of view regardless of how close the enemy is.
  measureClearance(player) {
    const physics = this.ctx.get('physics');
    const from = { x: player.position.x, y: player.position.y + player.eyeHeight, z: player.position.z };
    const dir = { x: 0, y: 0, z: 0 };
    let min = 12;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      dir.x = Math.sin(a); dir.y = 0; dir.z = Math.cos(a);
      const hit = physics.raycastWorldDistance(from, dir, 12);
      if (hit != null && hit < min) min = hit;
    }
    return min;
  }

  // ------------------------------------------------------------- navigation

  chooseDestination(player) {
    const world = this.ctx.get('world');
    const zones = world.getZones();
    // Head for somewhere other than the current zone, weighted away from the
    // player's own staging area so the driver pushes into the map.
    const candidates = zones.filter((zone) => zone.id !== this.currentZone(player) && zone.team !== player.team);
    const pool = candidates.length ? candidates : zones;
    const zone = pool[Math.floor(this.rng.next() * pool.length)];
    const nodes = world.getZoneNodes(zone.id);
    if (!nodes.length) return -1;
    this.goalZone = zone.id;
    this.telemetry.goalZones.set(zone.id, (this.telemetry.goalZones.get(zone.id) ?? 0) + 1);
    return nodes[Math.floor(this.rng.next() * nodes.length)];
  }

  currentZone(player) {
    return this.ctx.get('world').zoneAt(player.position.x, player.position.z, player.position.y);
  }

  repath(player, force = false) {
    if (!force && this.repathTimer > 0) return;
    this.repathTimer = REPATH_SECONDS + this.rng.range(0, 0.8);
    const world = this.ctx.get('world');
    const ai = this.ctx.get('ai');
    const from = world.nearestNavNode(player.position.x, player.position.y, player.position.z);
    if (from < 0) return;
    if (this.goalNode < 0) this.goalNode = this.chooseDestination(player);
    if (this.goalNode < 0) return;
    if (!ai.findPath(from, this.goalNode, this.path)) {
      this.goalNode = this.chooseDestination(player);
      if (this.goalNode >= 0) ai.findPath(from, this.goalNode, this.path);
    }
    this.pathIndex = this.path.length > 1 ? 1 : 0;
  }

  // ------------------------------------------------------------------ input

  // Turning goes through the same look channel as the mouse, capped to a human
  // turn rate. The driver never writes yaw directly.
  steerLook(player, desiredYaw, step, rate) {
    const delta = wrapAngle(desiredYaw - player.yaw);
    const maxStep = rate * step;
    const applied = Math.max(-maxStep, Math.min(maxStep, delta));
    this.ctx.input.injectLook(-applied / LOOK_SENSITIVITY, 0);
    return Math.abs(delta);
  }

  levelPitch(player, targetPitch, step) {
    const delta = targetPitch - player.pitch;
    const applied = Math.max(-2.5 * step, Math.min(2.5 * step, delta));
    this.ctx.input.injectLook(0, -applied / LOOK_SENSITIVITY);
  }

  // ----------------------------------------------------------------- update

  update(step) {
    const ctx = this.ctx;
    const player = ctx.get('player');
    const weapon = ctx.get('weapons');
    const input = ctx.input;
    const telemetry = this.telemetry;
    telemetry.frames += 1;

    if (player.dead) {
      input.clearVirtual();
      this.targetId = null;
      this.visibleFor = 0;
      this.path.length = 0;
      this.goalNode = -1;
      if (!this.wasDead) { telemetry.deaths += 1; this.wasDead = true; }
      this.hasSample = false;
      telemetry.idleFrames += 1;
      return;
    }
    if (this.wasDead) {
      // Fresh life: pick a new objective rather than resuming the old one.
      this.wasDead = false;
      this.goalNode = -1;
      this.repathTimer = 0;
      telemetry.sinceSpawn = 0;
      telemetry.awaitingFirstContact = true;
    }

    // Movement happens in the fixed step *between* driver updates, so progress is
    // measured against the previous update's sample. Comparing within a single
    // update always reads zero, which also made the stuck detector fire on every
    // frame.
    const moved = this.hasSample
      ? Math.hypot(player.position.x - this.sampleX, player.position.z - this.sampleZ)
      : 0;
    this.sampleX = player.position.x; this.sampleZ = player.position.z; this.hasSample = true;
    telemetry.zonesVisited.add(this.currentZone(player));
    if (player.position.y > telemetry.maxY) telemetry.maxY = player.position.y;
    if (player.position.y > 2) telemetry.elevatedFrames += 1;
    if (telemetry.sinceSpawn != null) telemetry.sinceSpawn += step;
    telemetry.sinceContact += step;

    this.repathTimer -= step;
    this.postFightTimer = Math.max(0, this.postFightTimer - step);

    // Reload through the weapon's own input path.
    if (weapon.ammo === 0 && !weapon.reloading) {
      input.setVirtual('reload', true);
      input.setVirtual('fire', false);
    } else {
      input.setVirtual('reload', false);
    }

    const target = this.findVisibleTarget(player);
    if (target) {
      this.visibleFor += step;
      if (this.targetId !== target.id) { this.targetId = target.id; this.aimSettle = 0; }
      if (telemetry.awaitingFirstContact) {
        telemetry.respawnToContact.push(Number(telemetry.sinceSpawn.toFixed(2)));
        telemetry.awaitingFirstContact = false;
      }
      if (telemetry.firstContact == null) telemetry.firstContact = ctx.peek('match')?.clock ?? null;
      if (telemetry.sinceContact > 1) {
        telemetry.contactGaps.push(Number(telemetry.sinceContact.toFixed(1)));
        if (telemetry.gapCurrent) telemetry.gapSamples.push(telemetry.gapCurrent);
      }
      telemetry.gapCurrent = null;
      telemetry.sinceContact = 0;
      telemetry.contactClearance.push(Number(this.measureClearance(player).toFixed(2)));
      this.engage(player, weapon, target, step);
      telemetry.combatFrames += 1;
    } else {
      this.visibleFor = 0;
      this.targetId = null;
      const { cause, nearest, blockFraction, clearance, blocker, boundaryPair } = this.diagnoseGap(player);
      if (blocker) telemetry.blockers.set(blocker, (telemetry.blockers.get(blocker) ?? 0) + 1);
      if (boundaryPair) {
        telemetry.boundaryBlocked += 1;
        if (blocker) telemetry.boundaryBlockers.set(blocker, (telemetry.boundaryBlockers.get(blocker) ?? 0) + 1);
      }
      telemetry.gapCause[cause] += 1;
      if (blockFraction != null) telemetry.blockFractions.push(Number(blockFraction.toFixed(3)));
      telemetry.gapClearance.push(Number(clearance.toFixed(2)));
      if (Number.isFinite(nearest)) telemetry.gapNearest.push(nearest);
      const zone = this.currentZone(player);
      telemetry.gapZones.set(zone, (telemetry.gapZones.get(zone) ?? 0) + step);
      telemetry.gapCurrent ??= { seconds: 0, far: 0, occluded: 0, behind: 0, none: 0, zone, goal: this.goalZone };
      telemetry.gapCurrent.seconds += step;
      telemetry.gapCurrent[cause] += 1;
      this.travel(player, step);
      telemetry.travelFrames += 1;
    }

    telemetry.distance += moved;
    this.trackStuck(player, moved, step);
  }

  engage(player, weapon, target, step) {
    const input = this.ctx.input;
    const dx = target.root.position.x - player.position.x;
    const dz = target.root.position.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(-dx, -dz);

    // Reaction delay: the driver must have held the target in view before it
    // starts tracking, and its aim converges rather than snapping.
    if (this.visibleFor < REACTION_SECONDS) {
      input.setVirtual('fire', false);
      input.setVirtual('ads', false);
      this.steerLook(player, desiredYaw, step, MAX_TURN_RATE * 0.6);
      return;
    }
    this.aimSettle = Math.min(1, this.aimSettle + step * 1.6);
    // Residual error never reaches zero, and it is worse at range.
    const spread = (1 - this.aimSettle) * 0.11 + 0.008 + distance * 0.0008;
    const jitter = this.rng.range(-spread, spread);
    const error = this.steerLook(player, desiredYaw + jitter, step, AIM_TURN_RATE);

    const dy = (target.root.position.y + 1.3) - (player.position.y + player.eyeHeight);
    this.levelPitch(player, Math.atan2(dy, Math.max(0.5, distance)), step);

    input.setVirtual('ads', distance > 9);
    // Strafe while shooting instead of standing in the open.
    input.setVirtual('right', this.strafeSign > 0);
    input.setVirtual('left', this.strafeSign < 0);
    input.setVirtual('forward', distance > 18);
    input.setVirtual('backward', distance < 5);
    input.setVirtual('sprint', false);

    const onTarget = error < FIRE_ANGLE && this.aimSettle > 0.5;
    if (onTarget && weapon.ammo > 0 && !weapon.reloading) {
      if (this.burst <= 0) this.burst = 4 + Math.floor(this.rng.next() * 5);
      this.burst -= 1;
      input.setVirtual('fire', true);
      this.telemetry.shots += 1;
    } else {
      input.setVirtual('fire', false);
      if (this.burst <= 0 && this.rng.next() < 0.02) this.strafeSign = -this.strafeSign;
    }
    this.postFightTimer = 1.4;
  }

  travel(player, step) {
    const input = this.ctx.input;
    input.setVirtual('fire', false);
    input.setVirtual('ads', false);
    input.setVirtual('left', false);
    input.setVirtual('right', false);
    input.setVirtual('backward', false);
    this.levelPitch(player, 0, step);

    this.repath(player);
    if (this.pathIndex >= this.path.length) {
      this.goalNode = -1;
      this.repath(player, true);
      if (this.pathIndex >= this.path.length) { input.setVirtual('forward', false); return; }
    }
    const node = this.ctx.get('ai').nav[this.path[this.pathIndex]];
    const dx = node.x - player.position.x;
    const dz = node.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ARRIVE && Math.abs(node.y - player.position.y) < 1.3) {
      this.pathIndex += 1;
      return;
    }
    // Look where you are going, then walk there.
    const error = this.steerLook(player, Math.atan2(-dx, -dz), step, MAX_TURN_RATE);
    input.setVirtual('forward', true);
    // Only sprint when roughly facing the route and not just out of a fight.
    input.setVirtual('sprint', error < 0.5 && this.postFightTimer <= 0);
  }

  trackStuck(player, moved, step) {
    if (moved > 0.02) {
      this.stuckTimer = 0;
      this.lastX = player.position.x; this.lastZ = player.position.z;
      return;
    }
    this.stuckTimer += step;
    if (this.stuckTimer < STUCK_SECONDS) return;
    // Blocked: abandon this route and pick another, the way a player would back
    // out of a corner rather than keep pushing into it.
    this.stuckTimer = 0;
    this.goalNode = -1;
    this.strafeSign = -this.strafeSign;
    this.repath(player, true);
    this.telemetry.blockedRecoveries += 1;
  }

  report() {
    const t = this.telemetry;
    const describe = (values) => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
      return {
        n: sorted.length,
        mean: Number((sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(2)),
        p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1],
      };
    };
    const frames = Math.max(1, t.frames);
    return {
      frames: t.frames,
      distanceTravelledM: Number(t.distance.toFixed(1)),
      combatTimePct: Number(((t.combatFrames / frames) * 100).toFixed(1)),
      travelTimePct: Number(((t.travelFrames / frames) * 100).toFixed(1)),
      deadTimePct: Number(((t.idleFrames / frames) * 100).toFixed(1)),
      elevatedTimePct: Number(((t.elevatedFrames / frames) * 100).toFixed(2)),
      maxY: Number(t.maxY.toFixed(2)),
      shotsFired: t.shots,
      deaths: t.deaths,
      blockedRecoveries: t.blockedRecoveries,
      zonesVisited: [...t.zonesVisited],
      zonesVisitedCount: t.zonesVisited.size,
      goalZones: Object.fromEntries(t.goalZones),
      firstContactSeconds: t.firstContact,
      respawnToContactSeconds: describe(t.respawnToContact),
      noContactGapSeconds: describe(t.contactGaps),
      gapCausePct: (() => {
        const total = Math.max(1, t.gapCause.far + t.gapCause.occluded + t.gapCause.behind + t.gapCause.none);
        return Object.fromEntries(Object.entries(t.gapCause)
          .map(([k, v]) => [k, Number(((v / total) * 100).toFixed(1))]));
      })(),
      // The long gaps are the ones that fail Gate D; report what they were made of.
      longGaps: [...t.gapSamples].sort((a, b) => b.seconds - a.seconds).slice(0, 6).map((g) => {
        const frames = Math.max(1, g.far + g.occluded + g.behind + g.none);
        return {
          seconds: Number(g.seconds.toFixed(1)), zone: g.zone, goal: g.goal,
          far: Number(((g.far / frames) * 100).toFixed(0)),
          occluded: Number(((g.occluded / frames) * 100).toFixed(0)),
          behind: Number(((g.behind / frames) * 100).toFixed(0)),
        };
      }),
      gapSecondsByZone: Object.fromEntries([...t.gapZones].map(([k, v]) => [k, Number(v.toFixed(1))]).sort((a, b) => b[1] - a[1])),
      gapNearestEnemyM: describe(t.gapNearest.map((v) => Number(v.toFixed(1)))),
      topBlockers: [...t.blockers].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([box, n]) => ({ box, n })),
      boundaryBlockedFrames: t.boundaryBlocked,
      topBoundaryBlockers: [...t.boundaryBlockers].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([box, n]) => ({ box, n })),
      gapClearanceM: describe(t.gapClearance),
      contactClearanceM: describe(t.contactClearance),
      blockerPositionPct: (() => {
        const f = t.blockFractions;
        if (!f.length) return null;
        const near = f.filter((v) => v < 0.25).length;
        const mid = f.filter((v) => v >= 0.25 && v <= 0.75).length;
        return { nearSelf: Number(((near / f.length) * 100).toFixed(1)), midRay: Number(((mid / f.length) * 100).toFixed(1)), nearTarget: Number((((f.length - near - mid) / f.length) * 100).toFixed(1)) };
      })(),
    };
  }
}
