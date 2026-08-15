import * as THREE from 'three';
import { PhysicsSystem } from '../src/physics/physics-system.js';

const epsilon = 1e-8;
const assert = (condition, message) => {
  if (!condition) throw new Error(`Physics contract failed: ${message}`);
};
const near = (actual, expected) => Math.abs(actual - expected) <= epsilon;

// Reference world stub implementing the broadphase contract the physics system
// depends on. Queries return every collider, so this test exercises the physics
// maths rather than the world's grid acceleration.
async function createPhysics(colliders = [], platforms = []) {
  const world = {
    getColliders: () => colliders,
    getPlatforms: () => platforms,
    getBounds: () => ({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }),
    queryColliders: (minX, maxX, minZ, maxZ, out) => { out.length = 0; out.push(...colliders); return out; },
    queryRayColliders: (ox, oz, dx, dz, maxDistance, out) => { out.length = 0; out.push(...colliders); return out; },
    appendRaycastTargets: () => {},
    getCoverPoints: () => [],
    surfaceAt: () => 'concrete',
  };
  const physics = new PhysicsSystem();
  await physics.init({ get: (id) => (id === 'world' ? world : null) });
  return physics;
}

const rayColliders = [
  { minX: 0, maxX: 1, minZ: 0, maxZ: 1, height: 2, surface: 'metal' },
  { minX: 2, maxX: 3, minZ: 0, maxZ: 1, height: 2, surface: 'wood' },
];
const rayPhysics = await createPhysics(rayColliders);
const entry = rayPhysics.raycastWorld(new THREE.Vector3(-1, 1, 0.5), new THREE.Vector3(1, 0, 0), 10);
const entryPoint = entry.point.clone();
const entryNormal = entry.normal.clone();
const inside = rayPhysics.raycastWorld(new THREE.Vector3(0.5, 1, 0.5), new THREE.Vector3(1, 0, 0), 10);
const vertical = rayPhysics.raycastWorld(new THREE.Vector3(0.5, 3, 0.5), new THREE.Vector3(0, -1, 0), 10);
const diagonalDirection = new THREE.Vector3(1, -1, 0).normalize();
const diagonal = rayPhysics.raycastWorld(new THREE.Vector3(-1, 3, 0.5), diagonalDirection, 10);
const parallelMiss = rayPhysics.raycastWorld(new THREE.Vector3(-1, 3, 0.5), new THREE.Vector3(1, 0, 0), 10);
const shortMiss = rayPhysics.raycastWorld(new THREE.Vector3(-1, 1, 0.5), new THREE.Vector3(1, 0, 0), 0.5);
assert(entry !== inside, 'detailed world hits must have independent lifetimes');
assert(near(entry?.distance, 1) && entry.surface === 'metal' && entry.normal.x === -1, 'entry face/surface');
assert(entry.point !== vertical.point && entry.normal !== vertical.normal, 'nested hit values must have independent lifetimes');
assert(entry.point.equals(entryPoint) && entry.normal.equals(entryNormal), 'later rays must not mutate an earlier hit');
assert(near(inside?.distance, 1.5) && inside.surface === 'wood', 'origin-inside self occlusion policy');
assert(near(vertical?.distance, 1) && vertical.normal.y === 1, 'vertical top-face ray');
assert(near(diagonal?.distance, Math.SQRT2), 'diagonal ray');
assert(parallelMiss === null && shortMiss === null, 'parallel and max-distance misses');
assert(near(rayPhysics.raycastWorldDistance(new THREE.Vector3(-1, 1, 0.5), new THREE.Vector3(1, 0, 0), 10), 1), 'distance-only ray');
const singlePhysics = await createPhysics([rayColliders[0]]);
assert(singlePhysics.raycastWorld(new THREE.Vector3(0.5, 1, 0.5), new THREE.Vector3(1, 0, 0), 10) === null, 'single-collider inside ray');

const openPhysics = await createPhysics();
const player = new THREE.Vector3(0, 0, 0);
const enemyA = new THREE.Vector3(0.67, 0, 0);
const enemyB = new THREE.Vector3(1, 0, 0);
openPhysics.separateActors([player, enemyA, enemyB], [0.36, 0.31, 0.31], 0);
assert(player.equals(new THREE.Vector3(0, 0, 0)), 'player body must remain immovable');
assert(player.distanceTo(enemyA) >= 0.67 - epsilon, 'player/enemy A separation');
assert(player.distanceTo(enemyB) >= 0.67 - epsilon, 'player/enemy B separation');
assert(enemyA.distanceTo(enemyB) >= 0.62 - epsilon, 'enemy/enemy separation');

const exactPlayer = new THREE.Vector3(2, 0, 2);
const exactEnemy = exactPlayer.clone();
const exactPlayerRepeat = exactPlayer.clone();
const exactEnemyRepeat = exactPlayer.clone();
openPhysics.separateActors([exactPlayer, exactEnemy], [0.36, 0.31], 0);
openPhysics.separateActors([exactPlayerRepeat, exactEnemyRepeat], [0.36, 0.31], 0);
assert(exactPlayer.distanceTo(exactEnemy) >= 0.67 - epsilon, 'exact-center overlap');
assert(exactPlayer.equals(exactPlayerRepeat) && exactEnemy.equals(exactEnemyRepeat), 'exact-center determinism');

const wall = { minX: 0, maxX: 1, minZ: -5, maxZ: 5, height: 3, surface: 'concrete' };
const wallPhysics = await createPhysics([wall]);
const wallPlayer = new THREE.Vector3(-0.36, 0, 0);
const wallPlayerBefore = wallPlayer.clone();
const wallEnemy = new THREE.Vector3(-0.31, 0, 0);
wallPhysics.separateActors([wallPlayer, wallEnemy], [0.36, 0.31], 0);
const nearestWallX = Math.max(wall.minX, Math.min(wallEnemy.x, wall.maxX));
const nearestWallZ = Math.max(wall.minZ, Math.min(wallEnemy.z, wall.maxZ));
assert(wallPlayer.distanceTo(wallEnemy) >= 0.67 - epsilon, 'wall-pinned player contact');
assert(wallPlayer.equals(wallPlayerBefore), 'wall-pinned player must remain immovable');
assert(Math.hypot(wallEnemy.x - nearestWallX, wallEnemy.z - nearestWallZ) >= 0.31 - epsilon, 'wall clearance');

const squadPlayer = new THREE.Vector3(4, 0, 4);
const squadPlayerBefore = squadPlayer.clone();
const squad = Array.from({ length: 4 }, () => squadPlayer.clone());
const bodies = [squadPlayer, ...squad];
const radii = [0.36, 0.31, 0.31, 0.31, 0.31];
openPhysics.separateActors(bodies, radii, 0);
assert(squadPlayer.equals(squadPlayerBefore), 'squad player must remain immovable');
for (let i = 0; i < bodies.length; i += 1) {
  for (let j = i + 1; j < bodies.length; j += 1) {
    assert(bodies[i].distanceTo(bodies[j]) >= radii[i] + radii[j] - epsilon, `squad bodies ${i}/${j}`);
  }
}

const wallSquadPlayer = new THREE.Vector3(-0.36, 0, 0);
const wallSquadPlayerBefore = wallSquadPlayer.clone();
const wallSquad = Array.from({ length: 4 }, () => new THREE.Vector3(-0.31, 0, 0));
const wallBodies = [wallSquadPlayer, ...wallSquad];
wallPhysics.separateActors(wallBodies, radii, 0);
assert(wallSquadPlayer.equals(wallSquadPlayerBefore), 'wall-squad player must remain immovable');
for (let i = 0; i < wallBodies.length; i += 1) {
  const body = wallBodies[i];
  if (i > 0) {
    const nearestX = Math.max(wall.minX, Math.min(body.x, wall.maxX));
    const nearestZ = Math.max(wall.minZ, Math.min(body.z, wall.maxZ));
    assert(Math.hypot(body.x - nearestX, body.z - nearestZ) >= radii[i] - epsilon, `wall-squad clearance ${i}`);
  }
  for (let j = i + 1; j < wallBodies.length; j += 1) {
    assert(body.distanceTo(wallBodies[j]) >= radii[i] + radii[j] - epsilon, `wall-squad bodies ${i}/${j}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  raycast: {
    entryDistance: entry.distance,
    insideSkipsSelfDistance: inside.distance,
  },
  contacts: {
    threeBody: [player.distanceTo(enemyA), player.distanceTo(enemyB), enemyA.distanceTo(enemyB)],
    exactOverlap: exactPlayer.distanceTo(exactEnemy),
    wallPinned: wallPlayer.distanceTo(wallEnemy),
    squadPairs: 10,
    wallSquadPairs: 10,
  },
}, null, 2));
