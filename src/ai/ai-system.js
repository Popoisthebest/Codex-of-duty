import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Legacy deterministic encounter used by the v2 harness shots and playtest.
const LEGACY_SPAWNS = [
  [0, 0, -3.0],
  [2.8, 0, -5.2],
  [5.4, 0, -1.8],
  [-5.2, 0, -6.2],
];

// Team identification is a fairness requirement, not decoration. The previous
// palettes differed by under 2% luminance (olive 0x4b5545 vs brown 0x5a4a44) and
// both sat inside the environment's own fabric/wood range, so at 25 m the two
// sides were indistinguishable. The HUD teaches cyan for Alpha and orange for
// Bravo everywhere, so the characters now carry that same language: a cool
// desaturated-teal kit against a warm rust kit, plus an emissive marker band
// that stays legible at range and in shadow.
const TEAM_PALETTE = {
  alpha: {
    uniform: 0x3d5a5c, vest: 0x1b2c30, skin: 0x7e523b, visor: 0x0e1a1c,
    gear: 0x4a6d6b, lens: 0x5fe3e0, emissive: 0x1c6f6d, marker: 0x83e6e4, markerEmissive: 0x2ad4d0,
  },
  bravo: {
    uniform: 0x6d3a2a, vest: 0x2e1a14, skin: 0x8a6247, visor: 0x1a0f0c,
    gear: 0x8a4a30, lens: 0xff8b5a, emissive: 0x7a2a12, marker: 0xff8b5a, markerEmissive: 0xd44a1c,
  },
};

// Lanes give each bot a preferred route family. Bots are assigned round-robin,
// so a team spreads across the map instead of forming one blob.
const LANES = {
  alpha: {
    west: ['west-yard', 'depot', 'west-yard', 'bravo-yard'],
    central: ['market', 'arcade', 'north-junction', 'bravo-yard'],
    east: ['east-terrace', 'east-offices', 'east-terrace', 'bravo-yard'],
  },
  bravo: {
    west: ['west-yard', 'depot', 'west-yard', 'alpha-yard'],
    central: ['north-junction', 'market', 'arcade', 'alpha-yard'],
    east: ['east-terrace', 'east-offices', 'east-terrace', 'alpha-yard'],
  },
};

const LANE_ORDER = ['central', 'west', 'east'];
const INDOOR_ZONES = new Set(['depot', 'east-offices', 'arcade']);

const ROSTER = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `alpha-${i}`, team: 'alpha', legacy: -1 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `bravo-${i}`, team: 'bravo', legacy: i < 4 ? i : -1 })),
];

const PERCEPTION_STRIDE = 4;
// Sight range is a pacing control, not a realism knob. At 62 m on a ~100 m map a
// bot could see across most of the district, so it was almost always in an
// engage/search state and almost never executed a route. That flattened the
// match into a permanent brawl around the central junction and meant no bot ever
// used a staircase, an interior, or an elevated firing position.
const SIGHT_RANGE = 42;
const FIRE_RANGE = 36;
const ENGAGE_RANGE = 22;
const PATH_ARRIVE = 1.1;
const PATH_ARRIVE_STAIR = 0.42;
const STUCK_SECONDS = 1.2;
// Goal selection samples this many candidates and keeps the best value/cost.
const GOAL_SAMPLES = 14;
const GOAL_DISTANCE_SCALE = 16;

// Small binary heap so A* over a few thousand nav nodes stays cheap enough to
// run every time a bot repaths.
class MinHeap {
  constructor() { this.items = []; this.costs = []; }
  clear() { this.items.length = 0; this.costs.length = 0; }
  get size() { return this.items.length; }
  push(item, cost) {
    this.items.push(item); this.costs.push(cost);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i); i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop(); const lastCost = this.costs.pop();
    if (this.items.length) {
      this.items[0] = lastItem; this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1; const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.costs[left] < this.costs[smallest]) smallest = left;
        if (right < this.items.length && this.costs[right] < this.costs[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(smallest, i); i = smallest;
      }
    }
    return top;
  }
  swap(a, b) {
    const item = this.items[a]; this.items[a] = this.items[b]; this.items[b] = item;
    const cost = this.costs[a]; this.costs[a] = this.costs[b]; this.costs[b] = cost;
  }
}

export class AISystem {
  static id = 'ai';
  static deps = ['physics', 'match', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'combatants';
    ctx.scene.add(this.group);
    this.resources = new Set();
    this.bots = [];
    this.byId = new Map();
    this.livePositions = [];
    this.liveRadii = [];
    this.liveOwners = [];
    this.heap = new MinHeap();
    this.goalTrace = [];
    this.scratchVec = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.ray = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();
    this.damageOff = ctx.events.on('combat:damage', (event) => this.onDamage(event));
    this.respawnOff = ctx.events.on('match:respawn', (event) => this.onRespawn(event));
    this.restartOff = ctx.events.on('match:restart', () => this.deployAll());
    this.buildBots();
    this.unregisterTargets = ctx.get('physics').registerTargetProvider((targets) => this.appendRaycastTargets(targets));
    this.initNavigation();
    await this.reset(ctx);
  }

  initNavigation() {
    const world = this.ctx.get('world');
    this.nav = world.getNavNodes();
    this.navCost = new Float32Array(this.nav.length);
    this.navFrom = new Int32Array(this.nav.length);
    this.navVisit = new Int32Array(this.nav.length);
    this.navTick = 0;
  }

  // -------------------------------------------------------------- appearance

  buildBots() {
    this.teamMaterials = {};
    for (const team of ['alpha', 'bravo']) {
      const palette = TEAM_PALETTE[team];
      const set = {
        uniform: new THREE.MeshStandardMaterial({ color: palette.uniform, roughness: 0.8, metalness: 0.05 }),
        vest: new THREE.MeshStandardMaterial({ color: palette.vest, roughness: 0.74, metalness: 0.12 }),
        skin: new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.76 }),
        visor: new THREE.MeshStandardMaterial({ color: palette.visor, roughness: 0.18, metalness: 0.62 }),
        gear: new THREE.MeshStandardMaterial({ color: palette.gear, roughness: 0.86, metalness: 0.03 }),
        lens: new THREE.MeshStandardMaterial({ color: palette.lens, roughness: 0.08, metalness: 0.5, emissive: palette.emissive, emissiveIntensity: 0.9 }),
        // Marker bands are self-lit so a combatant stays identifiable in shadow,
        // indoors and at the far end of the engagement range.
        marker: new THREE.MeshStandardMaterial({ color: palette.marker, roughness: 0.4, metalness: 0.1, emissive: palette.markerEmissive, emissiveIntensity: 2.4 }),
      };
      for (const material of Object.values(set)) this.resources.add(material);
      this.teamMaterials[team] = set;
    }
    this.characterParts = this.buildCharacterGeometry();
    for (let index = 0; index < ROSTER.length; index += 1) {
      const entry = ROSTER[index];
      const root = this.instantiateCharacter(entry.team, entry.id);
      this.group.add(root);
      const lane = LANE_ORDER[index % LANE_ORDER.length];
      this.bots.push({
        id: entry.id, team: entry.team, index, legacy: entry.legacy, root,
        health: 100, alive: true, participating: true, state: 'deploy',
        targetId: null, hasLos: false, lastSeen: new THREE.Vector3(), lastSeenAge: 99,
        path: [], pathIndex: 0, goalNode: -1, repathTimer: 0, goalZone: null,
        lane, laneStep: 0,
        fireCooldown: 0.8 + index * 0.13, burst: 0, aimError: 0,
        strafe: index % 2 ? 1 : -1, phase: index * 1.7,
        coverTarget: new THREE.Vector3(), coverApproach: new THREE.Vector3(),
        hasCover: false, inCover: false, approachingCover: false, coverTimer: 0, coverHoldTimer: 0,
        stuckTimer: 0, lastX: 0, lastZ: 0, groundY: 0,
        limbs: root.userData.limbs,
      });
      this.byId.set(entry.id, this.bots[this.bots.length - 1]);
    }
    this.enemyBots = this.bots.filter((bot) => bot.team === 'bravo');
  }

  // Built once from the original per-part silhouette, then merged by material so
  // eleven combatants cost a manageable number of draw calls.
  buildCharacterGeometry() {
    const parts = [];
    const push = (geometry, slot, hitZone, surface, matrix) => {
      const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      if (matrix) clone.applyMatrix4(matrix);
      parts.push({ geometry: clone, slot, hitZone, surface });
    };
    const at = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4()
      .compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

    push(new THREE.CapsuleGeometry(0.27, 0.55, 5, 10), 'uniform', 'torso', 'flesh', at(0, 1.1, 0));
    push(new THREE.BoxGeometry(0.55, 0.58, 0.28, 2, 2, 1), 'vest', 'torso', 'flesh', at(0, 1.15, -0.12));
    push(new THREE.SphereGeometry(0.2, 14, 10), 'skin', 'head', 'flesh', at(0, 1.74, 0));
    push(new THREE.CylinderGeometry(0.105, 0.12, 0.18, 10), 'skin', 'head', 'flesh', at(0, 1.55, 0));
    push(new THREE.SphereGeometry(0.225, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'vest', 'head', 'flesh', at(0, 1.79, 0));
    push(new THREE.BoxGeometry(0.22, 0.12, 0.06), 'vest', 'head', 'flesh', at(0, 1.66, -0.18));
    push(new THREE.CylinderGeometry(0.25, 0.25, 0.045, 16), 'vest', 'head', 'flesh', at(0, 1.82, -0.01));
    // Helmet stripe and shoulder bands in team colour.
    push(new THREE.BoxGeometry(0.075, 0.055, 0.42), 'marker', 'head', 'flesh', at(0, 1.9, 0));
    push(new THREE.BoxGeometry(0.16, 0.075, 0.3), 'marker', 'torso', 'flesh', at(0, 1.38, 0.16));
    push(new THREE.BoxGeometry(0.28, 0.08, 0.05), 'visor', 'head', 'flesh', at(0, 1.77, -0.18));
    push(new THREE.BoxGeometry(0.28, 0.075, 0.04), 'lens', 'head', 'flesh', at(0, 1.77, -0.215));
    push(new THREE.BoxGeometry(0.42, 0.55, 0.2, 2, 2, 1), 'gear', 'torso', 'flesh', at(0, 1.12, 0.28));
    push(new THREE.BoxGeometry(0.5, 0.1, 0.28), 'gear', 'torso', 'flesh', at(0, 0.82, 0));
    for (let p = -1; p <= 1; p += 1) push(new THREE.BoxGeometry(0.14, 0.2, 0.09), 'gear', 'torso', 'flesh', at(p * 0.16, 1.03, -0.29));
    for (const x of [-0.31, 0.31]) {
      push(new THREE.BoxGeometry(0.2, 0.2, 0.26, 2, 2, 2), 'vest', 'limb', 'flesh', at(x, 1.39, -0.02, 0, 0, x < 0 ? -0.18 : 0.18));
      push(new THREE.BoxGeometry(0.215, 0.07, 0.275), 'marker', 'limb', 'flesh', at(x, 1.46, -0.02, 0, 0, x < 0 ? -0.18 : 0.18));
      push(new THREE.CapsuleGeometry(0.085, 0.24, 4, 8), 'uniform', 'limb', 'flesh', at(x, 1.27, -0.12, -0.72, 0, x < 0 ? -0.32 : 0.32));
      push(new THREE.CapsuleGeometry(0.075, 0.25, 4, 8), 'gear', 'limb', 'flesh', at(x * 0.72, 1.1, -0.36, -1.15, 0, x < 0 ? 0.28 : -0.28));
      push(new THREE.BoxGeometry(0.14, 0.13, 0.1), 'vest', 'limb', 'flesh', at(x * 0.84, 1.13, -0.28));
      push(new THREE.SphereGeometry(0.058, 9, 7), 'visor', 'limb', 'flesh', at(x * 0.48, 1.08, -0.47));
    }
    // Rifle is one merged prop that rides with the upper body.
    const rifle = [];
    const riflePush = (geometry, slot, matrix) => {
      const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      clone.applyMatrix4(matrix);
      rifle.push({ geometry: clone, slot });
    };
    riflePush(new THREE.BoxGeometry(0.13, 0.12, 0.68), 'visor', at(0, 0, 0));
    riflePush(new THREE.CylinderGeometry(0.025, 0.03, 0.72, 10), 'visor', at(0, 0, -0.68, Math.PI / 2, 0, 0));
    riflePush(new THREE.BoxGeometry(0.12, 0.13, 0.34), 'gear', at(0, 0, 0.46));
    riflePush(new THREE.BoxGeometry(0.12, 0.11, 0.2), 'lens', at(0, 0.11, -0.05));
    // Legs merge per side with a hip-centred origin so the whole limb swings.
    const legs = [[], []];
    const legPush = (side, geometry, slot, matrix) => {
      const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      clone.applyMatrix4(matrix);
      legs[side].push({ geometry: clone, slot });
    };
    for (const [side, x] of [[0, -0.15], [1, 0.15]]) {
      legPush(side, new THREE.CapsuleGeometry(0.105, 0.29, 4, 8), 'uniform', at(0, 0.64 - 0.95, 0));
      legPush(side, new THREE.CapsuleGeometry(0.09, 0.27, 4, 8), 'uniform', at(0, 0.29 - 0.95, 0.015));
      legPush(side, new THREE.BoxGeometry(0.2, 0.18, 0.09), 'vest', at(0, 0.48 - 0.95, -0.1));
      legPush(side, new THREE.BoxGeometry(0.21, 0.18, 0.32), 'visor', at(0, 0.12 - 0.95, -0.06));
      legs[side].hipX = x;
    }
    const merge = (items) => {
      const grouped = new Map();
      for (const item of items) {
        const key = `${item.slot}:${item.hitZone ?? 'limb'}:${item.surface ?? 'fabric'}`;
        if (!grouped.has(key)) grouped.set(key, { slot: item.slot, hitZone: item.hitZone ?? 'limb', surface: item.surface ?? 'fabric', geometries: [] });
        grouped.get(key).geometries.push(item.geometry);
      }
      const result = [];
      for (const entry of grouped.values()) {
        const geometry = mergeGeometries(entry.geometries, false);
        for (const item of entry.geometries) item.dispose();
        if (!geometry) continue;
        this.resources.add(geometry);
        result.push({ slot: entry.slot, hitZone: entry.hitZone, surface: entry.surface, geometry });
      }
      return result;
    };
    return {
      body: merge(parts),
      rifle: merge(rifle.map((item) => ({ ...item, hitZone: 'limb', surface: 'metal' }))),
      legs: legs.map((side, index) => ({ hipX: index === 0 ? -0.15 : 0.15, meshes: merge(side.map((item) => ({ ...item, hitZone: 'limb', surface: 'fabric' }))) })),
    };
  }

  instantiateCharacter(team, actorId) {
    const materials = this.teamMaterials[team];
    const root = new THREE.Group();
    const attach = (parent, entry, cast = true) => {
      const mesh = new THREE.Mesh(entry.geometry, materials[entry.slot]);
      // Eleven combatants dominate the shadow-caster count. Body and legs cast;
      // small props (rifle, optics) read the same without their own shadows.
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.userData = { actorId, hitZone: entry.hitZone, surface: entry.surface, team };
      parent.add(mesh);
      return mesh;
    };
    for (const entry of this.characterParts.body) attach(root, entry);
    const rifle = new THREE.Group();
    rifle.position.set(0.16, 1.2, -0.48); rifle.rotation.x = -0.08;
    for (const entry of this.characterParts.rifle) attach(rifle, entry, false);
    root.add(rifle);
    const legs = [];
    for (const side of this.characterParts.legs) {
      const pivot = new THREE.Group();
      pivot.position.set(side.hipX, 0.95, 0);
      for (const entry of side.meshes) attach(pivot, entry);
      root.add(pivot);
      legs.push(pivot);
    }
    root.userData.limbs = { legs, rifle };
    return root;
  }

  // ------------------------------------------------------------------ lifecycle

  reset(ctx) {
    this.rng = ctx.rng.fork('ai');
    this.harnessFreeze = false;
    this.legacyStaging = false;
    this.goalTrace = [];
    this.elevatedFrames = 0;
    this.elevatedCombatFrames = 0;
    this.totalActiveFrames = 0;
    for (const bot of this.bots) {
      bot.goalMeta = null;
      bot.health = 100;
      bot.alive = true;
      bot.participating = true;
      bot.state = 'deploy';
      bot.targetId = null;
      bot.hasLos = false;
      bot.lastSeenAge = 99;
      bot.path.length = 0;
      bot.pathIndex = 0;
      bot.goalNode = -1;
      bot.goalZone = null;
      bot.laneStep = 0;
      bot.repathTimer = 0;
      bot.fireCooldown = 0.8 + bot.index * 0.13;
      bot.burst = 0;
      bot.hasCover = false;
      bot.inCover = false;
      bot.approachingCover = false;
      bot.coverTimer = 0;
      bot.coverHoldTimer = 0;
      bot.stuckTimer = 0;
      bot.root.visible = true;
      bot.root.rotation.set(0, 0, 0);
      bot.root.scale.set(1, 1, 1);
      for (const leg of bot.limbs.legs) leg.rotation.x = 0;
    bot.root.rotation.x = 0; bot.leanX = 0; bot.speed = 0; bot.gaitPhase = bot.phase;
      bot.root.rotation.x = 0; bot.leanX = 0; bot.speed = 0; bot.gaitPhase = bot.phase;
    }
    this.deployAll();
  }

  deployAll() {
    const match = this.ctx.peek('match');
    for (const bot of this.bots) {
      bot.health = 100;
      bot.alive = true;
      bot.participating = true;
      bot.root.visible = true;
      bot.root.rotation.set(0, 0, 0);
      bot.root.scale.set(1, 1, 1);
      const spawn = match ? match.initialSpawn(bot.id) : { x: 0, y: 0, z: bot.team === 'alpha' ? 30 : -50, yaw: 0 };
      this.placeBot(bot, spawn);
      match?.confirmSpawn(bot.id, bot.root.position);
    }
  }

  // A corpse stops being a hit target; a respawned body becomes one again.
  setHittable(bot, hittable) {
    bot.root.traverse((child) => { if (child.isMesh) child.userData.actorId = hittable ? bot.id : null; });
  }

  placeBot(bot, spawn) {
    if (bot.goalMeta) this.endGoal(bot, 'died');
    this.setHittable(bot, true);
    bot.stationary = false;
    bot.root.position.set(spawn.x, spawn.y ?? 0, spawn.z);
    bot.root.rotation.set(0, spawn.yaw ?? 0, 0);
    bot.root.scale.set(1, 1, 1);
    bot.flinchPitch = 0; bot.flinchRoll = 0; bot.leanX = 0; bot.aimBlend = 0;
    bot.deathTimer = null; bot.deathFrom = null;
    bot.groundY = spawn.y ?? 0;
    bot.lastX = spawn.x; bot.lastZ = spawn.z;
    bot.stuckTimer = 0;
    bot.path.length = 0;
    bot.pathIndex = 0;
    bot.goalNode = -1;
    bot.repathTimer = 0;
    bot.state = 'advance';
    bot.targetId = null;
    bot.hasLos = false;
    bot.lastSeenAge = 99;
    bot.hasCover = false;
    bot.inCover = false;
    bot.lastSeen.copy(bot.root.position);
    for (const leg of bot.limbs.legs) leg.rotation.x = 0;
    bot.root.rotation.x = 0; bot.leanX = 0; bot.speed = 0; bot.gaitPhase = bot.phase;
  }

  onRespawn(event) {
    const bot = this.byId.get(event.actorId);
    if (!bot) return;
    bot.health = 100;
    bot.alive = true;
    bot.root.visible = true;
    this.placeBot(bot, event.spawn);
    this.ctx.peek('match')?.confirmSpawn(bot.id, bot.root.position);
  }

  // --------------------------------------------------------------- harness

  setShot(name) {
    // v2 canonical shots stage the original deterministic encounter so existing
    // visual and playtest contracts keep their meaning.
    this.harnessFreeze = !['combat', 'fx', 'hud'].includes(name);
    this.legacyStaging = true;
    const showEnemies = ['street', 'weapon_hip', 'weapon_ads', 'combat', 'enemy', 'fx', 'hud'].includes(name);
    this.ctx.peek('match')?.clearProtection();
    for (const bot of this.bots) {
      if (bot.legacy >= 0) {
        bot.participating = true;
        bot.alive = true;
        bot.health = 100;
        bot.root.position.fromArray(LEGACY_SPAWNS[bot.legacy]);
        bot.root.rotation.set(0, 0, 0);
        bot.root.scale.set(1, 1, 1);
        bot.groundY = 0;
        bot.state = 'patrol';
        bot.hasLos = false;
        bot.hasCover = false;
        bot.inCover = false;
        bot.targetId = 'player';
        bot.lastSeen.copy(bot.root.position);
        bot.root.visible = showEnemies;
      } else {
        this.park(bot);
      }
    }
    if (name === 'enemy') {
      const bot = this.byId.get('bravo-0');
      bot.root.position.set(-0.25, 0, -2.3);
      bot.root.rotation.y = 2.62;
    }
  }

  // Parking removes a combatant from a staged harness shot without routing it
  // through the damage system, so no fake kill or score is produced.
  park(bot) {
    bot.participating = false;
    bot.state = 'hold';
    bot.hasLos = false;
    bot.targetId = null;
    bot.root.visible = false;
    bot.root.position.set(bot.team === 'alpha' ? -200 : 200, 0, 200 + bot.index);
    bot.groundY = 0;
  }

  // Leaves any staged harness shot and puts every combatant back into a real
  // match through the normal deployment path.
  enterMatchMode() {
    this.harnessFreeze = false;
    this.legacyStaging = false;
    for (const bot of this.bots) { bot.participating = true; bot.root.visible = true; }
    this.deployAll();
    const match = this.ctx.peek('match');
    this.ctx.get('player').respawn(match?.initialSpawn('player'));
  }

  // Pure occlusion probe: one combatant, held on its mark, so the result
  // measures whether cover blocks sight rather than where the bot walked.
  stageOcclusionTest() {
    this.harnessFreeze = false;
    const player = this.ctx.get('player');
    player.stageHarnessPose({ position: [-2.6, 0, 1.0], eyeHeight: 1.16, stance: 'crouch' });
    this.ctx.peek('match')?.clearProtection();
    for (const bot of this.bots) {
      if (bot.legacy === 0) {
        bot.participating = true; bot.alive = true; bot.health = 100; bot.root.visible = true;
        bot.root.position.set(-2.6, 0, -4.0); bot.groundY = 0; bot.fireCooldown = 0;
        bot.hasLos = false; bot.targetId = 'player'; bot.lastSeen.copy(player.position);
        bot.lastSeenAge = 0; bot.stationary = true;
        bot.hasCover = false; bot.inCover = false; bot.state = 'search';
      } else this.park(bot);
    }
  }

  // Stages a single soldier on a clear stretch of market street so character
  // reaction quality can be judged from actual frames. Everything here runs
  // through production systems: the real bot, the real movement function, the
  // real damage event and the real death path. Nothing poses the model directly.
  stageCharacter(ctx) {
    this.harnessFreeze = false;
    const player = ctx.get('player');
    // Three-quarter view: head-on hides the rifle against the torso and flattens
    // the leg swing, so carriage, stride and fall direction all read poorly.
    player.stageHarnessPose({ position: [2.0, 0, 2.5], yaw: 0.675, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
    ctx.peek('match')?.clearProtection();
    // Clear leftover tracers and impacts, otherwise the first staged frame shows
    // effects left over from whatever ran before it.
    ctx.peek('fx')?.reset(ctx);
    let subject = null;
    for (const bot of this.bots) {
      if (bot.legacy === 0) {
        this.placeBot(bot, { x: 0, y: 0, z: 0, yaw: Math.PI });
        bot.participating = true; bot.alive = true; bot.health = 100; bot.root.visible = true;
        this.setHittable(bot, true);
        bot.stationary = true;
        bot.state = 'hold'; bot.hasLos = false; bot.targetId = null;
        bot.hasCover = false; bot.inCover = false;
        subject = bot;
      } else this.park(bot);
    }
    return subject;
  }

  // Damage delivered exactly as a weapon delivers it, so flinch and death are the
  // production reactions rather than a test-only pose.
  stageDamage(bot, ctx, { amount, hitZone = 'torso' }) {
    ctx.events.emit('combat:damage', {
      targetType: 'enemy', targetId: bot.id, amount, source: 'player',
      sourceTeam: 'alpha', hitZone,
    });
  }

  // Stages a known-clear five metre engagement on the market street so the probe
  // measures enemy fire feedback, not whichever cover the live spawn happened to
  // put between the two actors.
  stageFireFeedbackTest() {
    this.harnessFreeze = false;
    const player = this.ctx.get('player');
    player.stageHarnessPose({ position: [0, 0, 6], yaw: 0, pitch: 0, eyeHeight: 1.7, stance: 'stand' });
    this.ctx.peek('match')?.clearProtection();
    for (const bot of this.bots) {
      if (bot.legacy === 0) {
        bot.participating = true; bot.alive = true; bot.health = 100; bot.root.visible = true;
        this.setHittable(bot, true);
        bot.root.position.set(0, 0, 1); bot.groundY = 0; bot.stationary = false;
        bot.fireCooldown = 0; bot.hasCover = false; bot.inCover = false; bot.targetId = 'player';
        bot.state = 'engage'; bot.hasLos = true; bot.lastSeenAge = 0; bot.lastSeen.copy(player.position);
      } else this.park(bot);
    }
  }

  // Isolates one combatant so a cover-behaviour probe measures that bot's
  // reposition rather than how fast the rest of the staged squad kills the
  // player. The bot keeps its staged position and takes real damage.
  applyHarnessDamage(enemyIndex, amount = 8, hitZone = 'torso') {
    this.harnessFreeze = false;
    const bot = this.enemyBots[enemyIndex];
    if (!bot) return;
    for (const other of this.bots) if (other !== bot) this.park(other);
    bot.participating = true;
    bot.root.visible = true;
    this.ctx.peek('match')?.clearProtection();
    this.onDamage({ targetType: 'enemy', targetId: bot.id, amount, source: 'player', hitZone });
  }

  isEnemyInCover(enemyIndex) { return Boolean(this.enemyBots[enemyIndex]?.inCover); }

  // ------------------------------------------------------------- navigation

  findPath(fromNode, toNode, out) {
    out.length = 0;
    if (fromNode < 0 || toNode < 0) return false;
    if (fromNode === toNode) { out.push(toNode); return true; }
    const nodes = this.nav;
    this.navTick += 1;
    const tick = this.navTick;
    const heap = this.heap;
    heap.clear();
    this.navCost[fromNode] = 0;
    this.navFrom[fromNode] = -1;
    this.navVisit[fromNode] = tick;
    const goal = nodes[toNode];
    const heuristic = (node) => Math.abs(node.x - goal.x) + Math.abs(node.z - goal.z) + Math.abs(node.y - goal.y) * 2;
    heap.push(fromNode, heuristic(nodes[fromNode]));
    let guard = 0;
    while (heap.size && guard < 6000) {
      guard += 1;
      const current = heap.pop();
      if (current === toNode) {
        for (let node = toNode; node >= 0; node = this.navFrom[node]) out.push(node);
        out.reverse();
        return true;
      }
      const node = nodes[current];
      const baseCost = this.navCost[current];
      for (const next of node.edges) {
        const other = nodes[next];
        const step = Math.hypot(other.x - node.x, other.z - node.z) + Math.abs(other.y - node.y) * 1.5;
        const cost = baseCost + step;
        if (this.navVisit[next] === tick && this.navCost[next] <= cost) continue;
        this.navVisit[next] = tick;
        this.navCost[next] = cost;
        this.navFrom[next] = current;
        heap.push(next, cost + heuristic(other));
      }
    }
    return false;
  }

  // Goals walk the bot's lane toward the enemy staging area, so the two teams
  // meet along three different route families rather than one corridor.
  chooseGoal(bot) {
    const world = this.ctx.get('world');
    const lane = LANES[bot.team][bot.lane];
    let zone = lane[bot.laneStep % lane.length];
    // Occasionally cut across to a neighbouring lane so routes are not scripted.
    if (this.rng.next() < 0.22) {
      const alternatives = LANE_ORDER.filter((name) => name !== bot.lane);
      const swap = alternatives[Math.floor(this.rng.next() * alternatives.length)];
      bot.lane = swap;
      zone = LANES[bot.team][swap][bot.laneStep % LANES[bot.team][swap].length];
    }
    // Offer both the lane objective and the bot's current surroundings. Picking
    // the zone first and only then scoring inside it meant every candidate was as
    // far away as that zone happened to be, so a nearby rooftop two streets over
    // never competed with a distant one. The lane still biases where a team
    // pushes; it no longer hides local options from the utility model.
    const laneNodes = world.getZoneNodes(zone);
    const localZone = world.zoneAt(bot.root.position.x, bot.root.position.z, bot.root.position.y);
    const localNodes = localZone === zone ? [] : world.getZoneNodes(localZone);
    if (!laneNodes.length && !localNodes.length) {
      bot.laneStep += 1;
      return -1;
    }
    bot.goalZone = zone;
    // Utility, not a coin flip. Goals used to be drawn uniformly from a zone and
    // separately biased toward height, which produced elevated objectives an
    // average of ~50 m away down 30-40 waypoint routes. Instrumentation showed
    // *not one* of those was ever reached: bots died or got stuck partway, every
    // time, because the trip outlasted a median 28 s life.
    //
    // A position is now worth what it overlooks, discounted by what it costs to
    // reach. Elevation wins when it is close enough to be worth the climb, which
    // is the same judgement a player makes.
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < GOAL_SAMPLES; i += 1) {
      // Two thirds lane objective, one third local. The lane keeps pulling bots
      // into contact; the local third lets a position within reach win on merit.
      // Measured: 1-in-4 local with a softer distance term was worse on both
      // counts (kills 14, elevated time 2.1%) because the model became myopic.
      const pool = (i % 3 === 2 && localNodes.length) ? localNodes : (laneNodes.length ? laneNodes : localNodes);
      const id = pool[Math.floor(this.rng.next() * pool.length)];
      const node = this.nav[id];
      const distance = Math.hypot(node.x - bot.root.position.x, node.z - bot.root.position.z);
      const climb = Math.max(0, node.y - bot.groundY);
      // Value: what the position can see, plus a modest premium for high ground.
      //
      // An expected-enemy-presence term was tried here and measured WORSE on
      // every axis that matters (see docs/GAMEPLAY_STATUS.md pass 8): bot kills
      // 27 -> 13, human combat time 19% -> 5%, Gate D no-contact p90 18.7 s ->
      // 43.3 s. Recent-contact heat is a lagging signal, and because a bot heats
      // the cells it just fought in, feeding it back into a value/cost score with
      // a distance denominator made goals even more local (elevated objectives
      // fell to ~10 m away). The heat field itself is retained and instrumented
      // in MatchSystem, but it does not drive goal choice.
      const overlook = node.overlook ?? 0;
      const value = 1 + overlook * 2.2 + (node.y > 2 ? 0.55 : 0);
      // Cost: distance dominates, and a climb costs more than flat ground
      // because stairs are slow and expose the climber.
      const cost = 1 + distance / GOAL_DISTANCE_SCALE + climb * 0.22;
      const score = value / cost + this.rng.range(0, 0.12);
      if (score > bestScore) { bestScore = score; best = id; }
      if (best >= 0 && this.nav[best].zone) bot.goalZone = this.nav[best].zone;
    }
    return best;
  }

  // Records why a tactical goal ended. Without this the only observable is
  // "elevation is unused", which cannot distinguish "never chosen" from "chosen
  // and never reached".
  endGoal(bot, reason) {
    if (!bot.goalMeta) return;
    const meta = bot.goalMeta;
    meta.reason = reason;
    meta.seconds = Number((this.ctx.time.elapsed - meta.startedAt).toFixed(1));
    this.goalTrace.push(meta);
    if (this.goalTrace.length > 4000) this.goalTrace.shift();
    bot.goalMeta = null;
  }

  repath(bot, force = false) {
    const world = this.ctx.get('world');
    if (!force && bot.repathTimer > 0) return;
    bot.repathTimer = 1.1 + this.rng.range(0, 0.9);
    const from = world.nearestNavNode(bot.root.position.x, bot.root.position.y, bot.root.position.z);
    if (from < 0) return;
    if (bot.goalNode < 0) {
      bot.goalNode = this.chooseGoal(bot);
      if (bot.goalNode >= 0) {
        const node = this.nav[bot.goalNode];
        bot.goalMeta = {
          bot: bot.id, zone: bot.goalZone, elevated: node.y > 2, goalY: Number(node.y.toFixed(1)),
          startedAt: this.ctx.time.elapsed, fromY: Number(bot.groundY.toFixed(1)),
          straight: Number(Math.hypot(node.x - bot.root.position.x, node.z - bot.root.position.z).toFixed(1)),
          pathNodes: 0, stairNodes: 0, reason: null, seconds: 0, progressed: 0,
        };
      }
    }
    if (bot.goalNode < 0) return;
    if (!this.findPath(from, bot.goalNode, bot.path)) {
      // The goal is unreachable from here; take the next lane objective instead.
      bot.laneStep += 1;
      bot.goalNode = this.chooseGoal(bot);
      if (bot.goalNode >= 0) this.findPath(from, bot.goalNode, bot.path);
    }
    bot.pathIndex = bot.path.length > 1 ? 1 : 0;
    if (bot.goalMeta && bot.path.length) {
      bot.goalMeta.pathNodes = bot.path.length;
      bot.goalMeta.stairNodes = bot.path.reduce((total, id) => total + (this.nav[id].stair ? 1 : 0), 0);
      bot.goalMeta.climb = Number(Math.max(0, this.nav[bot.goalNode].y - bot.groundY).toFixed(1));
    }
  }

  followPath(bot, step, speed) {
    if (bot.pathIndex >= bot.path.length) {
      this.endGoal(bot, 'arrived');
      bot.laneStep += 1;
      bot.goalNode = -1;
      this.repath(bot, true);
      if (bot.pathIndex >= bot.path.length) return false;
    }
    const node = this.nav[bot.path[bot.pathIndex]];
    const dx = node.x - bot.root.position.x;
    const dz = node.z - bot.root.position.z;
    const distance = Math.hypot(dx, dz);
    // Stair treads are ~0.7 m apart, closer than the open-ground arrival radius.
    // Using one radius for both let a bot at the foot of a flight mark every
    // tread "arrived" in a single frame and walk on past the stairs, so no bot
    // ever reached an upper level anywhere on the map.
    const arrive = node.stair ? PATH_ARRIVE_STAIR : PATH_ARRIVE;
    const heightTolerance = node.stair ? 0.5 : 1.2;
    if (distance < arrive && Math.abs(node.y - bot.groundY) < heightTolerance) {
      bot.pathIndex += 1;
      if (bot.goalMeta) bot.goalMeta.progressed += 1;
      this.ctx.peek('match')?.reportPathAdvance();
      return true;
    }
    if (distance > 0.001) {
      this.steerTarget = node;
      this.moveBot(bot, dx / distance, dz / distance, speed * step, node.y);
      this.steerTarget = null;
    }
    bot.root.rotation.y = Math.atan2(-dx, -dz);
    return true;
  }

  moveBot(bot, dirX, dirZ, amount, targetY = null) {
    if (bot.stationary) return;
    const physics = this.ctx.get('physics');
    const beforeX = bot.root.position.x; const beforeZ = bot.root.position.z;
    bot.root.position.x += dirX * amount;
    bot.root.position.z += dirZ * amount;
    physics.resolveActor(bot.root.position, 0.32);
    let moved = Math.hypot(bot.root.position.x - beforeX, bot.root.position.z - beforeZ);
    if (moved < amount * 0.3) {
      // Blocked. Try both tangents and keep whichever ends up closest to where
      // this bot is actually trying to get. Committing to a fixed strafe sign
      // made bots slide back and forth across an obstruction (the market arch
      // pillar in particular) instead of rounding it.
      const goal = this.steerTarget;
      let bestX = beforeX; let bestZ = beforeZ; let bestScore = -Infinity; let bestSide = bot.strafe;
      for (const side of [bot.strafe, -bot.strafe]) {
        bot.root.position.x = beforeX + dirZ * side * amount;
        bot.root.position.z = beforeZ - dirX * side * amount;
        physics.resolveActor(bot.root.position, 0.32);
        const slid = Math.hypot(bot.root.position.x - beforeX, bot.root.position.z - beforeZ);
        const closer = goal
          ? -Math.hypot(goal.x - bot.root.position.x, goal.z - bot.root.position.z)
          : 0;
        const score = slid * 10 + closer;
        if (score > bestScore) { bestScore = score; bestX = bot.root.position.x; bestZ = bot.root.position.z; bestSide = side; }
      }
      bot.root.position.x = bestX; bot.root.position.z = bestZ; bot.strafe = bestSide;
      moved = Math.hypot(bestX - beforeX, bestZ - beforeZ);
    }
    const ground = physics.groundHeightAt(bot.root.position.x, bot.root.position.z, bot.groundY, targetY == null ? 0.46 : 0.7);
    bot.groundY = ground;
    bot.root.position.y = ground;
  }

  // ------------------------------------------------------------- perception

  candidateTargets(bot) {
    const match = this.ctx.peek('match');
    const list = [];
    const player = this.ctx.get('player');
    if (bot.team !== 'alpha' && !player.dead && !match?.isProtected('player')) {
      list.push({ id: 'player', x: player.position.x, y: player.position.y, z: player.position.z, eye: player.eyeHeight * 0.86 });
    }
    for (const other of this.bots) {
      if (other.team === bot.team || !other.alive || !other.participating) continue;
      if (match?.isProtected(other.id)) continue;
      list.push({ id: other.id, x: other.root.position.x, y: other.root.position.y, z: other.root.position.z, eye: 1.45 });
    }
    return list;
  }

  updatePerception(bot) {
    const physics = this.ctx.get('physics');
    let best = null; let bestScore = Infinity;
    this.eye.copy(bot.root.position); this.eye.y += bot.inCover ? 1.15 : 1.48;
    for (const candidate of this.candidateTargets(bot)) {
      const dx = candidate.x - bot.root.position.x;
      const dz = candidate.z - bot.root.position.z;
      const flat = Math.hypot(dx, dz);
      if (flat > SIGHT_RANGE) continue;
      this.target.set(candidate.x, candidate.y + candidate.eye, candidate.z);
      this.ray.subVectors(this.target, this.eye);
      const rayDistance = this.ray.length();
      this.ray.multiplyScalar(1 / Math.max(0.0001, rayDistance));
      const obstruction = physics.raycastWorldDistance(this.eye, this.ray, rayDistance);
      if (obstruction != null && obstruction < rayDistance - 0.15) continue;
      // Prefer the closest visible opponent, with a small bias toward whoever is
      // already being fought so bots do not flip targets every probe.
      const score = flat - (candidate.id === bot.targetId ? 8 : 0);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    const hadTarget = bot.hasLos;
    if (best) {
      if (!hadTarget) this.ctx.events.emit('combat:contact', { actorId: bot.id, team: bot.team, targetId: best.id });
      bot.targetId = best.id;
      bot.hasLos = true;
      bot.lastSeen.set(best.x, best.y, best.z);
      bot.lastSeenAge = 0;
    } else {
      bot.hasLos = false;
    }
  }

  resolveTargetPosition(bot) {
    if (!bot.targetId) return null;
    if (bot.targetId === 'player') {
      const player = this.ctx.get('player');
      if (player.dead) return null;
      return { x: player.position.x, y: player.position.y, z: player.position.z, eye: player.eyeHeight * 0.86 };
    }
    const other = this.byId.get(bot.targetId);
    if (!other?.alive || !other.participating) return null;
    return { x: other.root.position.x, y: other.root.position.y, z: other.root.position.z, eye: 1.45 };
  }

  hasLiveOpponent(bot) {
    const player = this.ctx.get('player');
    if (bot.team !== 'alpha' && !player.dead) return true;
    for (const other of this.bots) if (other.team !== bot.team && other.alive && other.participating) return true;
    return false;
  }

  // ---------------------------------------------------------------- combat

  // Tuning intent: one bot firing at a target needs a few seconds of sustained
  // contact to kill it, so a fight is a decision rather than an instant loss,
  // while two or three bots working together are genuinely lethal.
  //
  // The previous numbers - 46% to-hit cap for 8-12 damage - meant ~4.9 expected
  // damage per shot against a player dealing 34, a ~20x lethality gap. Measured
  // effect: a bot needed 12.5 s of unbroken line of sight to kill a stationary
  // player, so bot-vs-bot fights almost never resolved and the human scored 59%
  // of their team's points. Eleven of twelve combatants were props. These
  // numbers close the gap to roughly 3x, which still leaves the player clearly
  // the strongest actor on the field.
  fireAt(bot, targetPosition, distance, ctx) {
    const accuracy = THREE.MathUtils.clamp(0.68 - distance * 0.011, 0.18, 0.54);
    const hit = this.rng.next() < accuracy;
    this.target.set(targetPosition.x, targetPosition.y + targetPosition.eye, targetPosition.z);
    const end = this.target.clone();
    if (!hit) {
      end.x += this.rng.range(-1.3, 1.3);
      end.y += this.rng.range(-0.75, 0.85);
      end.z += this.rng.range(-1.3, 1.3);
    }
    this.muzzle.set(0.16, 1.2, -1.48);
    bot.root.localToWorld(this.muzzle);
    ctx.events.emit('ai:fired', {
      enemyId: bot.id, team: bot.team,
      origin: { x: this.muzzle.x, y: this.muzzle.y, z: this.muzzle.z },
      end: { x: end.x, y: end.y, z: end.z }, hit,
    });
    ctx.peek('match')?.reportShot();
    // Rounds that miss must still land somewhere. `fireAt` resolves damage by a
    // dice roll and never touched the world, so incoming fire produced no dust
    // off the wall beside the player, no decals, no impact audio - the only cue
    // you were under fire was the tracer, and nothing at all before the first
    // hit landed. One ray per missed shot buys all of that back.
    if (!hit) {
      this.impactFrom ??= new THREE.Vector3(); this.impactDir ??= new THREE.Vector3();
      this.impactFrom.set(this.muzzle.x, this.muzzle.y, this.muzzle.z);
      this.impactDir.set(end.x - this.muzzle.x, end.y - this.muzzle.y, end.z - this.muzzle.z);
      const range = this.impactDir.length();
      if (range > 0.5) {
        this.impactDir.multiplyScalar(1 / range);
        const landed = ctx.get('physics').raycastWorld?.(this.impactFrom, this.impactDir, range + 6);
        if (landed) {
          ctx.events.emit('projectile:impact', {
            point: landed.point, normal: landed.normal,
            surface: landed.surface ?? 'concrete', actorId: null, source: bot.id,
          });
        }
      }
      return;
    }
    // A round that lands on a body reports flesh, so the hit reads as a body hit
    // wherever it struck.
    ctx.events.emit('projectile:impact', {
      point: { x: this.target.x, y: this.target.y, z: this.target.z },
      // Facing back toward the shooter, so the spray throws the right way.
      normal: {
        x: (this.muzzle.x - this.target.x) / Math.max(0.001, distance),
        y: (this.muzzle.y - this.target.y) / Math.max(0.001, distance),
        z: (this.muzzle.z - this.target.z) / Math.max(0.001, distance),
      },
      surface: 'flesh', actorId: bot.targetId, source: bot.id,
    });
    const damageScale = ctx.harness.scenario === 'profile' ? 0.24 : 1;
    const hitZone = this.rng.next() < 0.1 ? 'head' : 'torso';
    const base = this.rng.range(16, 21) * (hitZone === 'head' ? 1.7 : 1) * damageScale;
    ctx.events.emit('combat:damage', {
      targetType: bot.targetId === 'player' ? 'player' : 'enemy',
      targetId: bot.targetId,
      amount: base,
      source: bot.id,
      sourceTeam: bot.team,
      hitZone,
    });
  }

  onDamage(event) {
    if (event.targetType !== 'enemy') return;
    const bot = this.byId.get(event.targetId);
    if (!bot?.alive || !bot.participating) return;
    const match = this.ctx.peek('match');
    if (match?.isProtected(bot.id)) return;
    this.applyFlinch(bot, event);
    // Team deathmatch does not resolve friendly fire into damage.
    const shooter = this.byId.get(event.source);
    const sourceTeam = event.sourceTeam ?? (event.source === 'player' ? 'alpha' : shooter?.team ?? null);
    if (sourceTeam && sourceTeam === bot.team) return;
    bot.health = Math.max(0, bot.health - event.amount);
    if (event.source === 'player') {
      this.ctx.events.emit('combat:hit', { targetId: bot.id, hitZone: event.hitZone, damage: event.amount, killed: bot.health <= 0 });
      this.ctx.events.emit('combat:contact', { actorId: 'player', team: 'alpha', targetId: bot.id });
    }
    if (bot.health > 0) {
      // Being shot pushes a bot toward cover and makes it look at the shooter.
      if (!bot.hasLos && shooter) { bot.targetId = shooter.id; bot.lastSeen.copy(shooter.root.position); bot.lastSeenAge = 0; }
      else if (!bot.hasLos && event.source === 'player') { const player = this.ctx.get('player'); bot.targetId = 'player'; bot.lastSeen.copy(player.position); bot.lastSeenAge = 0; }
      this.chooseCover(bot);
      return;
    }
    this.killBot(bot, event.source, event.hitZone);
  }

  killBot(bot, source, hitZone) {
    bot.alive = false;
    this.setHittable(bot, false);
    bot.state = 'dead';
    bot.hasLos = false;
    bot.targetId = null;
    bot.hasCover = false;
    bot.inCover = false;
    // Collapse over half a second instead of flipping instantly. The direction
    // comes from where the shot came from, so bodies fall away from the shooter.
    bot.deathRoll = this.chooseFallDirection(bot) * 1.42;
    bot.deathTimer = 0;
    bot.deathFrom = { y: bot.root.position.y, roll: bot.root.rotation.z, pitch: bot.root.rotation.x };
    bot.deathPitch = THREE.MathUtils.clamp((bot.flinchPitch ?? 0) * 3 + this.rng.range(-0.2, 0.2), -0.45, 0.45);
    this.ctx.events.emit('actor:died', {
      actorType: 'enemy', actorId: bot.id, team: bot.team, source, hitZone,
      position: { x: bot.root.position.x, y: bot.root.position.y, z: bot.root.position.z },
    });
  }

  // Knock the target away from whoever shot it, scaled by the damage. Headshots
  // snap the head back harder, which is what makes them read as headshots.
  applyFlinch(bot, event) {
    const shooter = event.source === 'player'
      ? this.ctx.get('player').position
      : this.byId.get(event.source)?.root?.position ?? this.bots.find((b) => b.id === event.source)?.root?.position;
    const power = THREE.MathUtils.clamp((event.amount ?? 10) / 34, 0.15, 1)
      * (event.hitZone === 'head' ? 1.8 : 1);
    let away = 0;
    if (shooter) {
      // Component of the shot direction along the bot's own facing.
      const dx = bot.root.position.x - shooter.x;
      const dz = bot.root.position.z - shooter.z;
      const length = Math.hypot(dx, dz) || 1;
      away = (dx / length) * -Math.sin(bot.root.rotation.y) + (dz / length) * -Math.cos(bot.root.rotation.y);
    }
    bot.flinchPitch = THREE.MathUtils.clamp((bot.flinchPitch ?? 0) - away * power * 0.2, -0.3, 0.3);
    bot.flinchRoll = THREE.MathUtils.clamp((bot.flinchRoll ?? 0) + this.rng.range(-1, 1) * power * 0.12, -0.22, 0.22);
  }

  chooseCover(bot) {
    const physics = this.ctx.get('physics');
    const threat = this.resolveTargetPosition(bot) ?? { x: bot.lastSeen.x, y: bot.lastSeen.y, z: bot.lastSeen.z, eye: 1.5 };
    this.coverOrigin ??= new THREE.Vector3(); this.coverPoint ??= new THREE.Vector3(); this.coverRay ??= new THREE.Vector3();
    this.coverOrigin.set(threat.x, threat.y + threat.eye, threat.z);
    let best = null; let bestScore = Infinity;
    for (const [x, z] of physics.getCoverPoints()) {
      const botDistance = Math.hypot(x - bot.root.position.x, z - bot.root.position.z);
      const threatDistance = Math.hypot(x - threat.x, z - threat.z);
      if (botDistance > 9 || threatDistance < 2.2) continue;
      this.coverPoint.set(x, bot.groundY + 1.25, z);
      this.coverRay.subVectors(this.coverPoint, this.coverOrigin);
      const rayDistance = this.coverRay.length();
      this.coverRay.multiplyScalar(1 / Math.max(0.001, rayDistance));
      const obstruction = physics.raycastWorldDistance(this.coverOrigin, this.coverRay, rayDistance);
      if (obstruction == null || obstruction >= rayDistance - 0.2) continue;
      const score = botDistance + threatDistance * 0.08;
      if (score < bestScore) { bestScore = score; best = [x, z]; }
    }
    if (!best) return;
    bot.coverTarget.set(best[0], 0, best[1]);
    bot.coverTimer = Math.hypot(best[0] - bot.root.position.x, best[1] - bot.root.position.z) + 2;
    bot.hasCover = true;
    bot.inCover = false;
    const awayX = best[0] - threat.x; const awayZ = best[1] - threat.z;
    const awayLength = Math.hypot(awayX, awayZ) || 1;
    bot.coverApproach.set(best[0] + awayX / awayLength * 0.72, 0, best[1] + awayZ / awayLength * 0.72);
    bot.approachingCover = true;
    bot.strafe *= -1;
  }

  // ------------------------------------------------------------------ update

  fixedUpdate(step, ctx) {
    if (ctx.harness.active && this.harnessFreeze) return;
    const match = ctx.peek('match');
    const frame = ctx.time.frame;
    for (const bot of this.bots) {
      if (!bot.participating) { bot.state = 'hold'; continue; }
      // Dead bots still animate: a body that snaps flat in one frame is the
      // single most obvious tell that these are props rather than soldiers.
      if (!bot.alive) { this.animateDeath(bot, step); continue; }
      bot.lastSeenAge += step;
      bot.fireCooldown -= step;
      bot.repathTimer -= step;
      bot.coverTimer = Math.max(0, bot.coverTimer - step);
      bot.coverHoldTimer = Math.max(0, bot.coverHoldTimer - step);
      if (frame % PERCEPTION_STRIDE === bot.index % PERCEPTION_STRIDE) this.updatePerception(bot);
      if (bot.root.position.y > 2) {
        this.elevatedFrames += 1;
        if (bot.hasLos) this.elevatedCombatFrames += 1;
      }
      this.totalActiveFrames += 1;
      if (!this.hasLiveOpponent(bot)) { bot.state = 'hold'; bot.hasLos = false; this.animateBot(bot, ctx); continue; }
      if (match && match.phase === 'prematch') { bot.state = 'ready'; this.animateBot(bot, ctx); continue; }
      if (match && match.phase === 'ended') { bot.state = 'standdown'; this.animateBot(bot, ctx); continue; }
      this.updateBot(bot, step, ctx);
      this.animateBot(bot, ctx);
      this.checkStuck(bot, step, match);
    }
    this.separate(ctx);
  }

  updateBot(bot, step, ctx) {
    const target = this.resolveTargetPosition(bot);
    if (!target) { bot.hasLos = false; bot.targetId = null; }

    // A bot that reaches cover commits to it for the hold window. Leaving on the
    // next frame would make cover a single-frame blip that never breaks sight.
    if (bot.inCover && bot.coverHoldTimer > 0) { bot.state = 'cover'; return; }
    if (bot.inCover) bot.inCover = false;
    if (bot.hasCover && bot.coverTimer <= 0) { bot.hasCover = false; bot.approachingCover = false; }
    if (bot.hasCover) {
      let destination = bot.approachingCover ? bot.coverApproach : bot.coverTarget;
      let dx = destination.x - bot.root.position.x; let dz = destination.z - bot.root.position.z;
      let distance = Math.hypot(dx, dz);
      if (bot.approachingCover && distance <= 0.34) {
        bot.approachingCover = false; destination = bot.coverTarget;
        dx = destination.x - bot.root.position.x; dz = destination.z - bot.root.position.z; distance = Math.hypot(dx, dz);
      }
      if (distance > 0.34) {
        bot.state = 'reposition';
        this.moveBot(bot, dx / distance, dz / distance, step * 3.8);
        bot.root.rotation.y = Math.atan2(-dx, -dz);
        return;
      }
      bot.hasCover = false;
      bot.inCover = true;
      bot.coverHoldTimer = 1.35;
      bot.state = 'cover';
      // Re-probe immediately from the crouched eye so the bot knows this frame
      // whether the cover actually broke line of sight.
      this.updatePerception(bot);
      return;
    }

    if (target && bot.hasLos) {
      const dx = target.x - bot.root.position.x;
      const dz = target.z - bot.root.position.z;
      const distance = Math.hypot(dx, dz) || 0.001;
      bot.root.rotation.y = Math.atan2(-dx, -dz);
      bot.state = distance > ENGAGE_RANGE ? 'advance' : 'engage';
      if (distance > ENGAGE_RANGE) {
        this.moveBot(bot, dx / distance, dz / distance, step * 3.4);
      } else if (distance < 6) {
        this.moveBot(bot, -dx / distance, -dz / distance, step * 2.2);
      } else {
        this.moveBot(bot, dz / distance * bot.strafe, -dx / distance * bot.strafe, step * 2.4);
      }
      if (bot.fireCooldown <= 0 && distance < FIRE_RANGE) {
        if (bot.burst <= 0) { bot.burst = 3 + Math.floor(this.rng.next() * 3); }
        bot.burst -= 1;
        bot.fireCooldown = bot.burst > 0 ? 0.12 : 0.55 + this.rng.range(0.15, 0.6);
        this.fireAt(bot, target, distance, ctx);
      }
      return;
    }

    if (bot.lastSeenAge < 6) {
      bot.state = 'search';
      const dx = bot.lastSeen.x - bot.root.position.x;
      const dz = bot.lastSeen.z - bot.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1.2) {
        this.moveBot(bot, dx / distance, dz / distance, step * 3.2);
        bot.root.rotation.y = Math.atan2(-dx, -dz);
        return;
      }
      bot.lastSeenAge = 99;
    }

    bot.state = 'advance';
    this.repath(bot);
    this.followPath(bot, step, 3.6);
  }

  // Anti-stuck. Combat strafing can push a bot into a pocket narrower than its
  // own body that no route would ever have chosen, so recovery both re-plans and
  // returns the bot to the nearest validated nav node it can actually stand on.
  checkStuck(bot, step, match) {
    // A bot held on its mark by harness staging is not stuck; recovering it
    // would move the very actor a probe is measuring in place.
    if (bot.stationary) return;
    const moved = Math.hypot(bot.root.position.x - bot.lastX, bot.root.position.z - bot.lastZ);
    const shouldMove = bot.state === 'advance' || bot.state === 'search' || bot.state === 'reposition' || bot.state === 'engage';
    if (!shouldMove || moved > 0.05) {
      bot.stuckTimer = 0;
      bot.lastX = bot.root.position.x; bot.lastZ = bot.root.position.z;
      return;
    }
    bot.stuckTimer += step;
    if (bot.stuckTimer < STUCK_SECONDS) return;
    bot.stuckTimer = 0;
    this.endGoal(bot, 'stuck');
    bot.hasCover = false; bot.inCover = false; bot.approachingCover = false;
    bot.laneStep += 1;
    bot.goalNode = -1;
    bot.strafe *= -1;
    const world = this.ctx.get('world');
    const nodeId = world.nearestNavNode(bot.root.position.x, bot.root.position.y, bot.root.position.z);
    if (nodeId >= 0) {
      const node = this.nav[nodeId];
      if (Math.hypot(node.x - bot.root.position.x, node.z - bot.root.position.z) < 6) {
        bot.root.position.set(node.x, node.y, node.z);
        bot.groundY = node.y;
      }
    }
    bot.lastX = bot.root.position.x; bot.lastZ = bot.root.position.z;
    this.repath(bot, true);
    match?.reportStuckRecovery(bot.root.position);
  }

  // Pose readout for capture runs, so a frame that looks wrong can be checked
  // against numbers instead of argued about from a screenshot.
  static describePose(bot) {
    return {
      alive: bot.alive, visible: bot.root.visible,
      deathTimer: Number((bot.deathTimer ?? -1).toFixed(3)),
      rotX: Number(bot.root.rotation.x.toFixed(3)),
      rotZ: Number(bot.root.rotation.z.toFixed(3)),
      x: Number(bot.root.position.x.toFixed(2)),
      y: Number(bot.root.position.y.toFixed(3)),
      z: Number(bot.root.position.z.toFixed(2)),
      speed: Number((bot.speed ?? 0).toFixed(2)),
      flinchPitch: Number((bot.flinchPitch ?? 0).toFixed(3)),
    };
  }

  // Which way a body can actually fall. Toppling into a market stall reads as a
  // physics failure, so a side with no room loses to the side with room.
  chooseFallDirection(bot) {
    const physics = this.ctx.peek('physics');
    const preferred = bot.index % 2 ? 1 : -1;
    if (!physics) return preferred;
    this.fallFrom ??= new THREE.Vector3(); this.fallDir ??= new THREE.Vector3();
    const yaw = bot.root.rotation.y;
    // Local right in world space; positive roll topples toward it.
    const rightX = Math.cos(yaw); const rightZ = -Math.sin(yaw);
    let best = preferred; let bestClearance = -1;
    for (const side of [preferred, -preferred]) {
      this.fallFrom.set(bot.root.position.x, bot.root.position.y + 0.9, bot.root.position.z);
      this.fallDir.set(rightX * side, 0, rightZ * side);
      const hit = physics.raycastWorldDistance(this.fallFrom, this.fallDir, 2.3);
      const clearance = hit == null ? 2.3 : hit;
      if (clearance > bestClearance) { bestClearance = clearance; best = side; }
      // The preferred side is good enough as soon as a body length fits.
      if (side === preferred && clearance >= 2.25) return preferred;
    }
    return best;
  }

  // A body drops fast, then settles. Two eases rather than one: the fall is
  // gravity, the settle is the weight arriving.
  animateDeath(bot, step) {
    if (bot.deathTimer == null || bot.deathTimer >= 1) return;
    bot.deathTimer = Math.min(1, bot.deathTimer + step / 0.55);
    const t = bot.deathTimer;
    const fall = 1 - (1 - t) * (1 - t);            // ease-out: quick then slowing
    const settle = t * t * (3 - 2 * t);            // smoothstep for the roll
    const from = bot.deathFrom ?? { y: bot.groundY, roll: 0, pitch: 0 };
    bot.root.rotation.z = THREE.MathUtils.lerp(from.roll, bot.deathRoll, settle);
    bot.root.rotation.x = THREE.MathUtils.lerp(from.pitch, bot.deathPitch ?? 0, settle);
    // Rotating about the feet already carries the torso down to about knee
    // height; adding a further offset left the corpse hovering.
    bot.root.position.y = THREE.MathUtils.lerp(from.y, bot.groundY + 0.02, fall);
    // The legs give way ahead of the torso.
    const slump = settle * 0.55;
    bot.limbs.legs[0].rotation.x = slump;
    bot.limbs.legs[1].rotation.x = slump * 0.7;
  }

  animateBot(bot, ctx) {
    const step = ctx.time.fixed;
    // Gait is driven by measured ground speed rather than the AI state, so feet
    // stop sliding and a bot holding an angle in a firefight no longer walks on
    // the spot the way a state flag made it.
    const dx = bot.root.position.x - (bot.animX ?? bot.root.position.x);
    const dz = bot.root.position.z - (bot.animZ ?? bot.root.position.z);
    bot.animX = bot.root.position.x; bot.animZ = bot.root.position.z;
    const instant = step > 0 ? Math.hypot(dx, dz) / step : 0;
    // A respawn or an unstick teleport is not locomotion.
    bot.speed = THREE.MathUtils.damp(bot.speed ?? 0, instant > 12 ? 0 : instant, 9, step);
    const gait = THREE.MathUtils.clamp(bot.speed / 4.2, 0, 1.3);
    // Phase advances with distance covered, which is what keeps the contact rate
    // matched to the ground instead of to wall-clock time.
    bot.gaitPhase = (bot.gaitPhase ?? bot.phase) + bot.speed * 1.45 * step;
    // Audible footfalls from the same gait phase that drives the legs. Bots made
    // no sound at all, so an enemy could close to knife range in silence.
    if (bot.alive && bot.speed > 0.6 && Math.abs(bot.root.position.y - bot.groundY) < 0.12) {
      if (Math.floor(bot.gaitPhase / Math.PI) > Math.floor((bot.lastStepPhase ?? bot.gaitPhase) / Math.PI)) {
        ctx.events.emit('ai:footstep', {
          team: bot.team, sprinting: bot.speed > 3.4,
          surface: this.ctx.get('physics').getGroundSurface(bot.root.position),
          position: { x: bot.root.position.x, y: bot.root.position.y, z: bot.root.position.z },
        });
      }
    }
    bot.lastStepPhase = bot.gaitPhase;
    const swing = Math.sin(bot.gaitPhase);
    const stride = swing * (0.1 + gait * 0.36);
    bot.limbs.legs[0].rotation.x = stride;
    bot.limbs.legs[1].rotation.x = -stride;
    // Aiming posture. The rifle transform used to be identical whether the bot
    // was idling, walking or shooting at someone, and it never pitched toward a
    // target above or below it - a bot on the street fired at the terrace with a
    // perfectly level weapon. It now tucks toward the shoulder and tracks the
    // target's elevation while it has line of sight.
    //
    // The arms are baked into the merged body mesh and cannot follow the rifle,
    // so the offsets are deliberately small: enough to read as shouldering the
    // weapon, not enough to tear the rifle away from the hands.
    const engaging = bot.alive && bot.hasLos && bot.targetId ? 1 : 0;
    bot.aimBlend = THREE.MathUtils.damp(bot.aimBlend ?? 0, engaging, 9, step);
    let aimPitch = 0;
    if (bot.aimBlend > 0.01) {
      const target = this.resolveTargetPosition(bot);
      if (target) {
        const flat = Math.hypot(target.x - bot.root.position.x, target.z - bot.root.position.z);
        const rise = (target.y + (target.eye ?? 1.4)) - (bot.root.position.y + 1.35);
        aimPitch = THREE.MathUtils.clamp(Math.atan2(rise, Math.max(0.8, flat)), -0.5, 0.5);
      }
    }
    // Gait sway on the rifle fades out as the weapon comes up.
    const carry = 1 - bot.aimBlend;
    bot.limbs.rifle.rotation.z = -swing * gait * 0.07 * carry;
    bot.limbs.rifle.position.x = THREE.MathUtils.lerp(0.16, 0.07, bot.aimBlend);
    bot.limbs.rifle.position.y = THREE.MathUtils.lerp(1.2, 1.29, bot.aimBlend)
      - Math.abs(swing) * gait * 0.028 * carry
      + Math.sin(ctx.time.elapsed * 1.7 + bot.phase) * 0.012 * carry;
    // Weight drops at each footfall - twice per stride, not once.
    if (bot.alive) bot.root.position.y = bot.groundY + Math.abs(Math.cos(bot.gaitPhase)) * gait * 0.042;
    // Hit reaction. Being shot used to change nothing about the target, which
    // made every exchange feel like shooting cardboard. The impulse is set on
    // damage and decays, so sustained fire visibly staggers a soldier.
    bot.flinchPitch = (bot.flinchPitch ?? 0) * Math.max(0, 1 - step * 7);
    bot.flinchRoll = (bot.flinchRoll ?? 0) * Math.max(0, 1 - step * 7);
    // Lean into the run so a sprinting silhouette reads differently from a walker.
    // The lean is tracked separately and only composed into the transform at the
    // end: damping `rotation.x` in place fed each frame's flinch back into the
    // next frame's starting value, so a headshot compounded to 35 degrees.
    bot.leanX = THREE.MathUtils.damp(bot.leanX ?? 0, gait * 0.075, 8, step);
    bot.root.rotation.x = bot.leanX + bot.flinchPitch;
    bot.root.rotation.z = bot.flinchRoll;
    bot.limbs.rifle.rotation.x = -0.08 + aimPitch * bot.aimBlend + bot.flinchPitch * -0.7;
    bot.root.scale.y = THREE.MathUtils.damp(bot.root.scale.y, bot.inCover ? 0.86 : 1, 12, step);
  }

  separate(ctx) {
    const player = ctx.get('player');
    this.livePositions.length = 0; this.liveRadii.length = 0;
    this.livePositions.push(player.position); this.liveRadii.push(0.36);
    for (const bot of this.bots) {
      if (!bot.alive || !bot.participating) continue;
      this.livePositions.push(bot.root.position); this.liveRadii.push(0.31);
    }
    ctx.get('physics').separateActors(this.livePositions, this.liveRadii, 0);
  }

  // ------------------------------------------------------------- read models

  appendRaycastTargets(targets) {
    for (const bot of this.bots) if (bot.alive && bot.participating) targets.push(bot.root);
  }

  getActorStates() {
    if (!this.bots) return [];
    return this.bots.map((bot) => ({
      id: bot.id, team: bot.team, alive: bot.alive && bot.participating,
      x: bot.root.position.x, y: bot.root.position.y, z: bot.root.position.z,
    }));
  }

  // Aim assist for deterministic harness actions: the closest visible opponent
  // within range. The range cap matters — without it a scripted driver engages
  // targets right across the district.
  getAimPoint(maxRange = 90) {
    const player = this.ctx.get('player');
    const physics = this.ctx.get('physics');
    this.eye.copy(player.position); this.eye.y += player.eyeHeight;
    let best = null; let bestDistance = Infinity;
    for (const bot of this.enemyBots) {
      if (!bot.alive || !bot.participating) continue;
      this.target.copy(bot.root.position); this.target.y += 1.74;
      this.ray.subVectors(this.target, this.eye);
      const distance = this.ray.length();
      if (distance > maxRange || distance >= bestDistance) continue;
      this.ray.multiplyScalar(1 / Math.max(0.0001, distance));
      const obstruction = physics.raycastWorldDistance(this.eye, this.ray, distance);
      if (obstruction != null && obstruction < distance - 0.3) continue;
      bestDistance = distance;
      best = { x: this.target.x, y: this.target.y, z: this.target.z };
    }
    return best;
  }

  aliveCount() {
    let count = 0;
    for (const bot of this.enemyBots) if (bot.alive && bot.participating) count += 1;
    return count;
  }

  alliesAlive() {
    let count = 0;
    for (const bot of this.bots) if (bot.team === 'alpha' && bot.alive && bot.participating) count += 1;
    return count;
  }

  snapshot() {
    return this.enemyBots.map((bot) => ({
      id: bot.index, actorId: bot.id, team: bot.team,
      health: bot.health, alive: bot.alive && bot.participating, state: bot.state,
      hasLos: bot.hasLos, covering: bot.hasCover || bot.inCover,
      position: bot.root.position.toArray(),
      coverTarget: bot.hasCover || bot.inCover ? bot.coverTarget.toArray() : null,
    }));
  }

  // Aggregated goal-lifecycle evidence: was elevation chosen, routed to, reached,
  // and if not, what ended the attempt.
  goalReport() {
    const buckets = { elevated: {}, ground: {} };
    const add = (key, reason, meta) => {
      const bucket = buckets[key];
      bucket[reason] ??= { count: 0, seconds: 0, pathNodes: 0, straight: 0, progressed: 0, climb: 0 };
      const entry = bucket[reason];
      entry.count += 1;
      entry.seconds += meta.seconds;
      entry.pathNodes += meta.pathNodes;
      entry.straight += meta.straight;
      entry.progressed += meta.progressed;
      entry.climb += meta.climb ?? 0;
    };
    for (const meta of this.goalTrace) add(meta.elevated ? 'elevated' : 'ground', meta.reason ?? 'open', meta);
    const finish = (bucket) => Object.fromEntries(Object.entries(bucket).map(([reason, e]) => [reason, {
      count: e.count,
      meanSeconds: Number((e.seconds / e.count).toFixed(1)),
      meanPathNodes: Number((e.pathNodes / e.count).toFixed(1)),
      meanStraightM: Number((e.straight / e.count).toFixed(1)),
      meanProgressed: Number((e.progressed / e.count).toFixed(1)),
      meanClimbM: Number((e.climb / e.count).toFixed(1)),
    }]));
    const total = this.goalTrace.length || 1;
    return {
      goals: this.goalTrace.length,
      elevatedGoalSharePct: Number((this.goalTrace.filter((m) => m.elevated).length * 100 / total).toFixed(1)),
      elevated: finish(buckets.elevated),
      ground: finish(buckets.ground),
      elevatedTimePct: Number((this.elevatedFrames * 100 / Math.max(1, this.totalActiveFrames)).toFixed(2)),
      elevatedCombatTimePct: Number((this.elevatedCombatFrames * 100 / Math.max(1, this.totalActiveFrames)).toFixed(2)),
    };
  }

  teamSnapshot() {
    return this.bots.map((bot) => ({
      actorId: bot.id, team: bot.team, alive: bot.alive && bot.participating,
      state: bot.state, lane: bot.lane, goalZone: bot.goalZone,
      zone: this.ctx.get('world').zoneAt(bot.root.position.x, bot.root.position.z, bot.root.position.y),
      position: bot.root.position.toArray(),
    }));
  }

  dispose() {
    this.damageOff?.(); this.respawnOff?.(); this.restartOff?.();
    this.unregisterTargets?.();
    this.ctx.scene.remove(this.group);
    for (const resource of this.resources) resource.dispose?.();
  }
}
