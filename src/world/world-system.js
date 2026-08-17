import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The original Sable Market block is the visual baseline for this project and is
// preserved coordinate-for-coordinate. v3 grows a full combat district around it
// instead of scaling it, so the polished street becomes the central zone of a
// 6v6 map rather than the whole game.
const BUILDINGS = [
  { x: -9.2, z: 8, w: 4.8, h: 6.8, d: 9.5, mat: 'plasterBlue' },
  { x: -9.0, z: -2.5, w: 4.6, h: 8.8, d: 10, mat: 'brick', underpass: [-4.35, -0.65] },
  { x: -9.4, z: -13, w: 5.2, h: 7.4, d: 10, mat: 'plasterWarm' },
  { x: 9.2, z: 8, w: 4.8, h: 7.8, d: 9.5, mat: 'plasterWarm' },
  { x: 9.0, z: -2.5, w: 4.6, h: 6.4, d: 10, mat: 'plasterBlue', underpass: [-4.35, -0.65] },
  // The east row used to be a continuous 31 m mass from z -18 to z 12.75 whose
  // only ground opening was the underpass at z -2.5, so every market/terrace
  // crossing funnelled through one point and combatants 25 m apart never saw
  // each other. A collapsed shopfront adds a second crossing into the southern
  // flank, and a window slot gives sight without a route.
  {
    x: 9.35, z: -13, w: 5.1, h: 9.2, d: 10, mat: 'brick',
    openings: [
      { from: -15.8, to: -12.8, y0: 0, y1: 2.7, breach: true, transition: ['east-market-breach', 'east-terrace'] },
      { from: -10.6, to: -8.8, y0: 1.3, y1: 2.3 },
    ],
  },
];

const BOUNDS = { minX: -50, maxX: 50, minZ: -56, maxZ: 46 };

// Zone identity drives navigation goals, spawn grouping, HUD location text and
// the map report. Outdoor rects do not overlap; indoor rects nest inside them
// and win the lookup because `zoneAt` prefers the tighter box.
const ZONES = [
  { id: 'alpha-yard', name: 'Alpha Staging', kind: 'outdoor', team: 'alpha', minX: -50, maxX: 50, minZ: 21, maxZ: 46, surface: 'concrete' },
  { id: 'market', name: 'Sable Market', kind: 'outdoor', minX: -14, maxX: 14, minZ: -21, maxZ: 21, surface: 'asphalt' },
  { id: 'arcade', name: 'Market Arcade', kind: 'indoor', minX: 3.4, maxX: 11.7, minZ: -9, maxZ: 10, surface: 'tile' },
  { id: 'west-yard', name: 'Freight Yard', kind: 'outdoor', minX: -50, maxX: -14, minZ: -44, maxZ: 21, surface: 'concrete' },
  { id: 'depot', name: 'Freight Depot', kind: 'indoor', minX: -44, maxX: -23, minZ: -11, maxZ: 13, surface: 'concrete' },
  { id: 'east-terrace', name: 'Terrace Steps', kind: 'outdoor', minX: 14, maxX: 50, minZ: -44, maxZ: 21, surface: 'tile' },
  { id: 'east-offices', name: 'Bureau Block', kind: 'indoor', minX: 19, maxX: 30, minZ: -8, maxZ: 12, surface: 'tile' },
  { id: 'north-junction', name: 'North Junction', kind: 'outdoor', minX: -14, maxX: 14, minZ: -44, maxZ: -21, surface: 'asphalt' },
  { id: 'bravo-yard', name: 'Bravo Staging', kind: 'outdoor', team: 'bravo', minX: -50, maxX: 50, minZ: -56, maxZ: -44, surface: 'concrete' },
];

// Explicit zone adjacency. Every edge is a traversable opening built in geometry;
// the cyclomatic number of this graph is the reported route-loop count.
const ZONE_LINKS = [
  ['alpha-yard', 'market'], ['alpha-yard', 'west-yard'], ['alpha-yard', 'east-terrace'],
  ['market', 'arcade'], ['market', 'west-yard'], ['market', 'east-terrace'], ['market', 'north-junction'],
  ['west-yard', 'depot'], ['west-yard', 'north-junction'], ['west-yard', 'bravo-yard'],
  ['east-terrace', 'east-offices'], ['east-terrace', 'north-junction'], ['east-terrace', 'bravo-yard'],
  ['north-junction', 'bravo-yard'],
];

const ROUTE_FAMILIES = [
  { id: 'west', name: 'Freight Line', zones: ['alpha-yard', 'west-yard', 'depot', 'bravo-yard'] },
  { id: 'central', name: 'Market Spine', zones: ['alpha-yard', 'market', 'arcade', 'north-junction', 'bravo-yard'] },
  { id: 'east', name: 'Terrace Climb', zones: ['alpha-yard', 'east-terrace', 'east-offices', 'bravo-yard'] },
];

const NAV_STEP = 2.4;
const NAV_CLEARANCE = 0.44;
const NAV_STEP_UP = 0.46;
const ACTOR_HEIGHT = 1.72;
const GRID_CELL = 5;
// Forward rendering evaluates every scene light per fragment. Eight is enough
// to cover the lamps visible from any one place in this district.
const ACTIVE_POINT_LIGHTS = 6;
const LIGHT_CULL_MARGIN = 2;

export class WorldSystem {
  static id = 'world';
  static deps = ['render', 'materials', 'sky'];

  async init(ctx) {
    this.ctx = ctx; this.scene = ctx.scene; this.materials = ctx.get('materials');
    this.group = new THREE.Group(); this.group.name = 'Sable district combat map'; this.scene.add(this.group);
    this.colliders = []; this.raycastTargets = []; this.resources = new Set(); this.lights = []; this.geometryCache = new Map();
    this.platforms = []; this.surfaceRects = []; this.landmarks = []; this.transitions = []; this.spawnPoints = []; this.navLinks = []; this.lightEmitters = [];
    this.batchKey = 'market';
    this.coverPoints = [[-2.6, -2.58], [3.0, -1.25], [0.4, -5.72], [-2.9, -11.55], [1.8, -11.55], [-4.75, -6.65]];
    this.buildGround(); this.buildArchitecture(); this.buildInteriorShop(); this.buildMarket(); this.buildStreetDetails(); this.buildLandmarks();
    this.buildPerimeter();
    this.buildWestYard(); this.buildDepot(); this.buildEastTerrace(); this.buildOffices(); this.buildNorthJunction(); this.buildDeploymentYards();
    this.buildDistantSkyline();
    this.buildLightPool();
    this.buildColliderGrid();
    this.buildNavigation();
    this.buildSpawnPoints();
    if (ctx.config.staticBatch !== false) this.mergeStaticMeshes();
    this.buildMapReport();
  }

  // `cast` is separate from `shadows` so decorative trim can still receive light
  // and shadow without entering the shadow pass. The shadow cascade follows the
  // player across the whole district, so every casting mesh is a per-frame cost.
  add(mesh, { surface = 'concrete', raycast = true, shadows = true, cast = shadows } = {}) {
    mesh.userData.surface = surface; mesh.userData.batch = this.batchKey; mesh.castShadow = cast; mesh.receiveShadow = shadows; this.group.add(mesh);
    if (raycast) this.raycastTargets.push(mesh); if (mesh.geometry) this.resources.add(mesh.geometry); return mesh;
  }

  // `collision` registers a solid whose vertical span defaults to floor level.
  // Elevated masses pass an explicit `minY` so an actor can walk beneath them.
  // `fitUv` keeps the geometry's 0..1 UVs. Per-face UV scaling is right for
  // tiling materials but destroys a fitted texture: sign canvases from
  // `createSign` are single 512x128 images that must map exactly once across the
  // face. Scaled by dimension/2.2 with clamp-to-edge they crop, and on small
  // signs the whole text row falls outside the face - five of nine signs on the
  // map were rendering as blank panels.
  box(size, position, material, { collision = false, surface = 'concrete', rotation = null, bevel = false, minY = null, walkable = false, cast = true, raycast = true, fitUv = false } = {}) {
    // The flag has to be part of the cache key, or a sign box would share cached
    // geometry with a same-sized wall box and inherit its scaled UVs.
    const key = `box:${size.join(',')}:${bevel ? 1 : 0}:${fitUv ? 'fit' : 'tile'}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = bevel ? new THREE.BoxGeometry(...size, 2, 2, 2) : new THREE.BoxGeometry(...size);
      if (!fitUv) WorldSystem.scaleBoxUvs(geometry, size);
      this.geometryCache.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); if (rotation) mesh.rotation.set(...rotation); this.add(mesh, { surface, cast, raycast });
    if (collision) {
      const top = position[1] + size[1] * 0.5;
      this.solid(position[0] - size[0] * 0.5, position[0] + size[0] * 0.5, position[2] - size[2] * 0.5, position[2] + size[2] * 0.5, minY == null ? 0 : minY, top, surface, walkable);
    }
    return mesh;
  }

  // Material UV `repeat` is per material, but box UVs run 0..1 per face whatever
  // the face measures, so one tile stretched across a 100 x 9 m perimeter wall
  // exactly as it did across a 2 m crate. Scaling per face by its own dimensions
  // keeps texel density constant. The geometry cache is keyed by size, so this
  // is paid once per distinct box.
  static scaleBoxUvs(geometry, [w, h, d], metresPerTile = 2.2) {
    const uv = geometry.attributes.uv;
    if (!uv) return;
    // BoxGeometry group order: +X, -X, +Y, -Y, +Z, -Z.
    const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    // geometry.groups index into the index buffer, not the vertex buffer.
    // BoxGeometry emits equal per-face vertex blocks in group order, so the
    // vertex partition is what maps a UV back to its face.
    const perFace = uv.count / 6;
    if (!Number.isInteger(perFace)) return;
    for (let g = 0; g < 6; g += 1) {
      const [su, sv] = spans[g];
      const scaleU = Math.max(0.05, su / metresPerTile);
      const scaleV = Math.max(0.05, sv / metresPerTile);
      for (let i = g * perFace; i < (g + 1) * perFace; i += 1) {
        uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
      }
    }
    uv.needsUpdate = true;
  }

  static scalePlaneUvs(geometry, width, height, metresPerTile = 2.2) {
    const uv = geometry.attributes.uv;
    if (!uv) return;
    const scaleU = Math.max(0.05, width / metresPerTile);
    const scaleV = Math.max(0.05, height / metresPerTile);
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
    uv.needsUpdate = true;
  }

  solid(minX, maxX, minZ, maxZ, minY, maxY, surface = 'concrete', walkable = false) {
    this.colliders.push({ minX, maxX, minZ, maxZ, minY, maxY, height: maxY, surface });
    if (walkable) this.addPlatform(minX, maxX, minZ, maxZ, maxY, surface);
  }

  cylinder(radiusTop, radiusBottom, height, position, material, surface = 'metal', segments = 16) {
    const key = `cylinder:${radiusTop},${radiusBottom},${height},${segments}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) { geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments); this.geometryCache.set(key, geometry); }
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); return this.add(mesh, { surface });
  }

  addPlatform(minX, maxX, minZ, maxZ, top, surface) { this.platforms.push({ minX, maxX, minZ, maxZ, top, surface }); }

  // A deck is a walkable slab: visible geometry, a solid body under its top so
  // actors cannot stand inside it, and a walk surface at its top face.
  deck([sx, sz], [x, y, z], material, { surface = 'concrete', thickness = 0.32 } = {}) {
    this.box([sx, thickness, sz], [x, y - thickness * 0.5, z], material, { surface });
    this.solid(x - sx * 0.5, x + sx * 0.5, z - sz * 0.5, z + sz * 0.5, y - thickness, y, surface, true);
    return y;
  }

  // Walls are runs with explicit openings, so a doorway is a hole in one solid
  // rather than three hand-placed segments that can drift apart.
  wallRun({ axis, fixed, from, to, y0 = 0, y1, material, surface = 'concrete', thickness = 0.5, openings = [] }) {
    const cuts = new Set([from, to]);
    for (const opening of openings) { cuts.add(Math.max(from, opening.from)); cuts.add(Math.min(to, opening.to)); }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i]; const b = sorted[i + 1];
      if (b - a < 0.05) continue;
      const mid = (a + b) * 0.5;
      // A segment can be crossed by several openings at different heights — a
      // ground doorway and an upper firing gallery, for instance. Taking only
      // the first match silently filled in every opening above the lowest one,
      // which is why the depot mezzanine and the bureau's upper storey measured
      // as sealed boxes despite having galleries authored into them.
      const crossing = openings
        .filter((item) => mid > item.from && mid < item.to)
        .map((item) => [Math.max(y0, item.y0 ?? y0), Math.min(y1, item.y1 ?? y1)])
        .filter(([low, high]) => high > low)
        .sort((left, right) => left[0] - right[0]);
      const bands = [];
      let cursor = y0;
      for (const [low, high] of crossing) {
        if (low > cursor) bands.push([cursor, low]);
        cursor = Math.max(cursor, high);
      }
      bands.push([cursor, y1]);
      for (const [ba, bb] of bands) {
        if (bb - ba < 0.05) continue;
        const size = axis === 'x' ? [b - a, bb - ba, thickness] : [thickness, bb - ba, b - a];
        const position = axis === 'x' ? [mid, (ba + bb) * 0.5, fixed] : [fixed, (ba + bb) * 0.5, mid];
        this.box(size, position, material, { collision: true, surface, minY: ba });
      }
    }
  }

  railing(minX, maxX, minZ, maxZ, y, material, { skip = [] } = {}) {
    const spans = [
      ['x', minX, maxX, minZ, minZ, 'south'], ['x', minX, maxX, maxZ, maxZ, 'north'],
      ['z', minX, minX, minZ, maxZ, 'west'], ['z', maxX, maxX, minZ, maxZ, 'east'],
    ];
    for (const [axis, x0, x1, z0, z1, side] of spans) {
      if (skip.includes(side)) continue;
      const length = axis === 'x' ? x1 - x0 : z1 - z0;
      if (length <= 0.4) continue;
      const cx = (x0 + x1) * 0.5; const cz = (z0 + z1) * 0.5;
      this.box(axis === 'x' ? [length, 0.06, 0.06] : [0.06, 0.06, length], [cx, y + 1.0, cz], material, { surface: 'metal' });
      const count = Math.max(2, Math.floor(length / 1.8));
      for (let i = 0; i <= count; i += 1) {
        const t = i / count;
        this.box([0.05, 1.0, 0.05], [axis === 'x' ? x0 + (x1 - x0) * t : cx, y + 0.5, axis === 'z' ? z0 + (z1 - z0) * t : cz], material, { surface: 'metal' });
      }
    }
  }

  // Stairs are built from real steps and register their own nav chain, so bots
  // and the player traverse elevation the same way.
  stairs({ x, z, fromY = 0, toY, run, width = 2.6, axis = 'z', direction = 1, material, surface = 'concrete' }) {
    const rise = toY - fromY;
    const steps = Math.max(2, Math.round(rise / 0.3));
    const stepRise = rise / steps; const stepRun = run / steps;
    const chain = [];
    for (let i = 0; i < steps; i += 1) {
      const top = fromY + stepRise * (i + 1);
      const offset = stepRun * (i + 0.5) * direction;
      const px = axis === 'z' ? x : x + offset;
      const pz = axis === 'z' ? z + offset : z;
      const size = axis === 'z' ? [width, top, stepRun] : [stepRun, top, width];
      this.box(size, [px, top * 0.5, pz], material, { collision: true, surface, walkable: true });
      chain.push([px, top, pz]);
    }
    const entry = axis === 'z' ? [x, fromY, z - stepRun * 0.8 * direction] : [x - stepRun * 0.8 * direction, fromY, z];
    const exit = axis === 'z' ? [x, toY, z + (run + stepRun * 0.8) * direction] : [x + (run + stepRun * 0.8) * direction, toY, z];
    this.navLinks.push({ points: [entry, ...chain, exit] });
    return { entry, exit };
  }

  // Breaks a large blank wall into a read: a base course, pilaster rhythm, a
  // cornice, and an optional window band. All decorative and collision-free, so
  // it costs geometry that merges into the zone batch and nothing in gameplay.
  // `side` is +1 or -1 for which face of the wall plane the detail sits on.
  facade({ axis, fixed, from, to, y0 = 0, y1, side = 1, pilasterEvery = 4.5, windowY = null, windowRows = 1, windowStep = 3.2, ribbed = false, openings = [] }) {
    const concrete = this.materials.get('concrete');
    const metal = this.materials.get('metal');
    const dark = this.materials.get('darkGlass');
    const warm = this.materials.get('warmWindow');
    const length = to - from;
    if (length < 1) return;
    // Trim must respect the same doorways `wallRun` cut. Decorating the full
    // span drew pilasters, ribs and cornices straight across every opening,
    // leaving them hanging in mid-air with the interior visible between them —
    // reported as "floating slats with no bases or tops".
    const blocked = (along, bandLow, bandHigh) => openings.some((opening) => (
      along > opening.from - 0.3 && along < opening.to + 0.3
      && bandHigh > (opening.y0 ?? y0) && bandLow < (opening.y1 ?? y1)
    ));
    const plane = fixed + side * 0.28;
    // Trim reads only through the shadow it casts on the wall behind it. An
    // earlier pass set cast:false here for performance; the A/B that motivated
    // it showed facades were not the cost, and the result was invisible detail.
    const trim = { surface: 'concrete' };
    const span = (thickness, height, centre, y) => (axis === 'x'
      ? this.box([thickness, height, 0.16], [centre, y, plane], concrete, trim)
      : this.box([0.16, height, thickness], [plane, y, centre], concrete, trim));
    const band = (height, y, material, depth = 0.22) => (axis === 'x'
      ? this.box([length, height, depth], [(from + to) * 0.5, y, fixed + side * (depth * 0.5 + 0.26)], material, trim)
      : this.box([depth, height, length], [fixed + side * (depth * 0.5 + 0.26), y, (from + to) * 0.5], material, trim));
    // Continuous bands are split around openings instead of skipped entirely, so
    // a base course still runs either side of a doorway.
    const bandRun = (height, y, material, depth) => {
      const cuts = [from];
      for (const opening of openings) {
        if ((opening.y1 ?? y1) <= y - height * 0.5 || (opening.y0 ?? y0) >= y + height * 0.5) continue;
        cuts.push(Math.max(from, opening.from - 0.3), Math.min(to, opening.to + 0.3));
      }
      cuts.push(to);
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i += 1) {
        const a = cuts[i]; const b = cuts[i + 1];
        if (b - a < 0.35) continue;
        if (blocked((a + b) * 0.5, y - height * 0.5, y + height * 0.5)) continue;
        const centre = (a + b) * 0.5; const runLength = b - a;
        const size = axis === 'x' ? [runLength, height, depth] : [depth, height, runLength];
        const position = axis === 'x'
          ? [centre, y, fixed + side * (depth * 0.5 + 0.26)]
          : [fixed + side * (depth * 0.5 + 0.26), y, centre];
        this.box(size, position, material, trim);
      }
    };
    bandRun(0.55, y0 + 0.28, concrete, 0.22);
    bandRun(0.42, y1 - 0.21, concrete, 0.3);
    const pilasters = Math.max(2, Math.round(length / pilasterEvery));
    for (let i = 0; i <= pilasters; i += 1) {
      const centre = from + (length * i) / pilasters;
      if (blocked(centre, y0, y1)) continue;
      span(0.55, y1 - y0 - 0.6, centre, y0 + (y1 - y0) * 0.5);
    }
    if (ribbed) {
      for (let offset = from + 0.6; offset < to; offset += 1.1) {
        if (blocked(offset, y0, y1)) continue;
        span(0.1, y1 - y0 - 1.4, offset, y0 + (y1 - y0) * 0.5);
      }
    }
    if (windowY == null) return;
    for (let row = 0; row < windowRows; row += 1) {
      const y = windowY + row * 2.3;
      if (y + 0.6 > y1) break;
      let index = 0;
      for (let offset = from + windowStep * 0.6; offset < to - windowStep * 0.4; offset += windowStep) {
        if (blocked(offset, y - 0.6, y + 0.6)) { index += 1; continue; }
        const lit = (index + row) % 5 === 0;
        const material = lit ? warm : dark;
        const glassTrim = { surface: 'glass' };
        const frameTrim = { surface: 'metal' };
        const glass = axis === 'x'
          ? this.box([1.35, 1.05, 0.1], [offset, y, plane + side * 0.06], material, glassTrim)
          : this.box([0.1, 1.05, 1.35], [plane + side * 0.06, y, offset], material, glassTrim);
        glass.rotation.y = axis === 'x' ? 0 : Math.PI * 0.5;
        if (axis === 'x') {
          this.box([1.55, 0.1, 0.14], [offset, y + 0.6, plane + side * 0.04], metal, frameTrim);
          this.box([1.55, 0.1, 0.14], [offset, y - 0.6, plane + side * 0.04], metal, frameTrim);
        } else {
          this.box([0.14, 0.1, 1.55], [plane + side * 0.04, y + 0.6, offset], metal, frameTrim);
          this.box([0.14, 0.1, 1.55], [plane + side * 0.04, y - 0.6, offset], metal, frameTrim);
        }
        index += 1;
      }
    }
  }

  // Practical lights are registered as data, not as scene lights. three.js
  // forward-renders every light in the scene for every lit fragment, so the 22
  // lamps this district wants cost 22 light evaluations per pixel everywhere —
  // measured as ~15 ms of world-pass GPU time. Instead a fixed pool of
  // ACTIVE_POINT_LIGHTS real lights is re-pointed at the nearest emitters each
  // frame. The count stays constant so the shader program never recompiles.
  emitter(x, y, z, color, intensity, distance, decay) {
    this.lightEmitters.push({ x, y, z, color, intensity, distance, decay });
  }

  buildLightPool() {
    this.lightPool = [];
    for (let i = 0; i < ACTIVE_POINT_LIGHTS; i += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      light.position.set(0, -1000, 0);
      this.group.add(light);
      this.lightPool.push(light);
      this.lights.push(light);
    }
    this.emitterOrder = this.lightEmitters.map((_, index) => index);
  }

  // Reassigns the pool to the nearest emitters. Distance is measured to the
  // emitter, and an emitter further away than its own falloff radius can never
  // contribute, so it is skipped entirely.
  updateLights(camera) {
    if (!this.lightPool) return;
    const order = this.emitterOrder;
    const emitters = this.lightEmitters;
    for (let i = 0; i < order.length; i += 1) {
      const e = emitters[order[i]];
      e.score = (e.x - camera.position.x) ** 2 + (e.y - camera.position.y) ** 2 + (e.z - camera.position.z) ** 2;
    }
    order.sort((a, b) => emitters[a].score - emitters[b].score);
    for (let i = 0; i < this.lightPool.length; i += 1) {
      const light = this.lightPool[i];
      const emitter = i < order.length ? emitters[order[i]] : null;
      if (!emitter || emitter.score > (emitter.distance + LIGHT_CULL_MARGIN) ** 2) {
        light.intensity = 0;
        light.position.set(0, -1000, 0);
        continue;
      }
      light.position.set(emitter.x, emitter.y, emitter.z);
      light.color.setHex(emitter.color);
      light.intensity = emitter.intensity;
      light.distance = emitter.distance;
      light.decay = emitter.decay;
    }
  }

  update(_dt, ctx) {
    this.updateLights(this.ctx.get('render').activeCamera(ctx));
  }

  landmark(id, name, x, z, y = 0) { this.landmarks.push({ id, name, x, y, z }); }
  transition(id, from, to, x, z) { this.transitions.push({ id, from, to, x, z }); }
  surfaceRect(minX, maxX, minZ, maxZ, surface) { this.surfaceRects.push({ minX, maxX, minZ, maxZ, surface }); }

  buildGround() {
    const asphalt = this.materials.get('asphalt'); const concrete = this.materials.get('concrete'); const tile = this.materials.get('tile');
    const boundary = new THREE.MeshBasicMaterial({ color: 0x18262e, fog: true });
    this.localMaterials = [boundary];
    const perimeter = new THREE.Mesh(new THREE.PlaneGeometry(340, 340), boundary); perimeter.rotation.x = -Math.PI / 2; perimeter.position.set(0, -0.18, -6); this.add(perimeter, { surface: 'concrete', raycast: false, shadows: false });
    const districtGeometry = new THREE.PlaneGeometry(BOUNDS.maxX - BOUNDS.minX + 6, BOUNDS.maxZ - BOUNDS.minZ + 6, 28, 28);
    WorldSystem.scalePlaneUvs(districtGeometry, BOUNDS.maxX - BOUNDS.minX + 6, BOUNDS.maxZ - BOUNDS.minZ + 6);
    const district = new THREE.Mesh(districtGeometry, concrete);
    district.rotation.x = -Math.PI / 2; district.position.set(0, -0.02, (BOUNDS.minZ + BOUNDS.maxZ) * 0.5); this.add(district, { surface: 'concrete', shadows: false });
    this.surfaceRect(BOUNDS.minX, BOUNDS.maxX, BOUNDS.minZ, BOUNDS.maxZ, 'concrete');
    const roadGeometry = new THREE.PlaneGeometry(14, 88, 20, 70);
    WorldSystem.scalePlaneUvs(roadGeometry, 14, 88);
    const road = new THREE.Mesh(roadGeometry, asphalt); road.rotation.x = -Math.PI / 2; road.position.z = -6; this.add(road, { surface: 'asphalt' });
    this.surfaceRect(-7, 7, -50, 38, 'asphalt');
    this.box([2.25, 0.24, 46], [-6.95, 0.1, -3], concrete, { surface: 'concrete' });
    this.box([2.25, 0.24, 46], [6.95, 0.1, -3], tile, { surface: 'tile' });
    this.surfaceRect(-8.1, -5.8, -26, 20, 'concrete');
    this.surfaceRect(5.8, 8.1, -26, 20, 'tile');
    for (const x of [-5.86, 5.86]) this.box([0.1, 0.22, 46], [x, 0.14, -3], concrete, { surface: 'concrete' });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xc3a863, roughness: 0.84, metalness: 0 });
    this.localMaterials.push(stripe);
    for (let z = 24; z > -46; z -= 4.2) this.box([0.09, 0.012, 2.2], [0, 0.018, z], stripe, { surface: 'asphalt' });
    const puddleMat = this.materials.get('darkGlass');
    for (const [x, z, sx, sz] of [[-1.8, 5.1, 1.3, 2.2], [2.5, -8.2, 1.8, 1.1], [-3.6, -13.8, 1.1, 1.9], [-21, -6, 2.1, 1.4], [26, -24, 1.6, 2.4], [3, -31, 2.3, 1.6], [-30, -28, 1.8, 1.8]]) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 24), puddleMat); puddle.scale.set(sx, sz, 1); puddle.rotation.x = -Math.PI / 2; puddle.position.set(x, 0.026, z); this.add(puddle, { surface: 'water', raycast: false, shadows: false });
    }
  }

  buildPerimeter() {
    this.batchKey = 'perimeter';
    const concrete = this.materials.get('concrete');
    const h = 9;
    this.wallRun({ axis: 'z', fixed: BOUNDS.minX - 0.6, from: BOUNDS.minZ, to: BOUNDS.maxZ, y1: h, material: concrete, thickness: 1.2 });
    this.wallRun({ axis: 'z', fixed: BOUNDS.maxX + 0.6, from: BOUNDS.minZ, to: BOUNDS.maxZ, y1: h, material: concrete, thickness: 1.2 });
    this.wallRun({ axis: 'x', fixed: BOUNDS.minZ - 0.6, from: BOUNDS.minX, to: BOUNDS.maxX, y1: h, material: concrete, thickness: 1.2 });
    this.wallRun({ axis: 'x', fixed: BOUNDS.maxZ + 0.6, from: BOUNDS.minX, to: BOUNDS.maxX, y1: h, material: concrete, thickness: 1.2 });
    // The boundary is 100 m of wall on every side; a pilaster rhythm and coping
    // keep it reading as city edge rather than a grey backdrop.
    this.facade({ axis: 'z', fixed: BOUNDS.minX, from: BOUNDS.minZ, to: BOUNDS.maxZ, y1: h, side: 1, pilasterEvery: 6 });
    this.facade({ axis: 'z', fixed: BOUNDS.maxX, from: BOUNDS.minZ, to: BOUNDS.maxZ, y1: h, side: -1, pilasterEvery: 6 });
    this.facade({ axis: 'x', fixed: BOUNDS.minZ, from: BOUNDS.minX, to: BOUNDS.maxX, y1: h, side: 1, pilasterEvery: 6 });
    this.facade({ axis: 'x', fixed: BOUNDS.maxZ, from: BOUNDS.minX, to: BOUNDS.maxX, y1: h, side: -1, pilasterEvery: 6 });
    this.batchKey = 'market';
  }

  // Nudge decoration out of a doorway or window. Trim and pipes are mesh-only:
  // left in an opening they stop the player's bullets and sight while the AI's
  // collider ray passes through, which reads as the gun not working.
  clearOfOpenings(b, z, margin = 0.55) {
    if (!b.openings) return z;
    for (const opening of b.openings) {
      if (z < opening.from - margin || z > opening.to + margin) continue;
      const below = opening.from - margin - 0.25;
      const above = opening.to + margin + 0.25;
      const inside = (value) => value > b.z - b.d * 0.5 + 0.3 && value < b.z + b.d * 0.5 - 0.3;
      if (inside(above)) return above;
      if (inside(below)) return below;
      return above;
    }
    return z;
  }

  buildInteriorShop() {
    const plaster = this.materials.get('plasterWarm'); const tile = this.materials.get('tile'); const wood = this.materials.get('wood'); const metal = this.materials.get('metal');
    const teaLabel = this.materials.createSign('TEA', '#3f2d21', '#e7d39d');
    const menuLabel = this.materials.createSign('MINT  TEA  SPICE', '#27352d', '#ead79e');
    // A compact room built inside the right-front shell. The outer building's
    // backfaces disappear from this camera, leaving a genuine open threshold.
    this.box([4.45, 0.1, 6.0], [9.15, 0.18, 6.45], tile, { surface: 'tile' });
    this.box([4.45, 0.14, 6.0], [9.15, 3.15, 6.45], wood, { surface: 'wood' });
    this.box([0.12, 3.0, 6.0], [11.38, 1.65, 6.45], plaster, { collision: true, surface: 'plaster' });
    this.box([4.4, 3.0, 0.12], [9.15, 1.65, 9.4], plaster, { collision: true, surface: 'plaster' });
    this.box([0.16, 3.0, 0.38], [6.92, 1.65, 3.7], wood, { surface: 'wood' });
    this.box([0.16, 3.0, 0.38], [6.92, 1.65, 8.9], wood, { surface: 'wood' });
    this.box([0.16, 0.26, 5.6], [6.92, 3.0, 6.3], wood, { surface: 'wood' });
    // Counter, inset shelving, tins and warm pendant establish human scale.
    this.box([0.75, 1.05, 3.2], [10.72, 0.72, 6.6], wood, { collision: true, surface: 'wood' });
    for (const y of [1.0, 1.72, 2.42]) this.box([0.25, 0.09, 3.75], [11.24, y, 6.35], wood, { surface: 'wood' });
    for (let i = 0; i < 15; i += 1) {
      const z = 4.8 + (i % 5) * 0.7; const y = 1.13 + Math.floor(i / 5) * 0.72;
      this.cylinder(0.11, 0.11, 0.28, [11.05, y, z], i % 3 === 0 ? this.materials.get('rust') : metal, 'metal', 12);
      this.box([0.012, 0.1, 0.16], [10.935, y, z], teaLabel, { surface: 'metal', fitUv: true });
    }
    this.box([0.025, 0.38, 1.75], [11.29, 2.76, 7.72], menuLabel, { surface: 'wood', fitUv: true });
    // Stock, weighing scale and hanging herbs make this room feel actively used.
    const fabric = this.materials.get('fabric'); const rust = this.materials.get('rust');
    for (let i = 0; i < 5; i += 1) {
      const sack = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 5, 10), fabric);
      sack.position.set(7.55 + (i % 2) * 0.46, 0.34 + Math.floor(i / 2) * 0.28, 8.45 - (i % 3) * 0.22);
      sack.rotation.z = Math.PI / 2 + (i - 2) * 0.05; this.add(sack, { surface: 'fabric' });
    }
    this.solid(7.2, 8.35, 7.72, 8.78, 0, 1.05, 'fabric');
    this.cylinder(0.06, 0.08, 0.42, [10.35, 1.38, 5.65], metal, 'metal', 12);
    this.box([0.62, 0.04, 0.28], [10.35, 1.58, 5.65], rust, { surface: 'metal' });
    for (const z of [5.15, 5.48, 6.72]) {
      this.cylinder(0.025, 0.025, 0.66, [9.45, 2.68, z], wood, 'wood', 8);
      for (let j = 0; j < 4; j += 1) {
        const herb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09 + j * 0.008, 0), fabric); herb.position.set(9.45 + (j % 2) * 0.08, 2.34 - j * 0.13, z); this.add(herb, { surface: 'fabric', shadows: false });
      }
    }
    this.cylinder(0.03, 0.03, 0.75, [9.15, 2.75, 6.05], metal, 'metal', 10);
    this.cylinder(0.24, 0.34, 0.28, [9.15, 2.37, 6.05], this.materials.get('lamp'), 'glass', 16);
    this.emitter(9.15, 2.28, 6.05, 0xffa65c, 3.1, 7.5, 1.8);
    this.surfaceRect(6.9, 11.4, 3.4, 9.45, 'tile');
    this.transition('shop-threshold', 'market', 'arcade', 6.9, 6.45);
  }

  buildArchitecture() {
    for (let index = 0; index < BUILDINGS.length; index += 1) {
      const b = BUILDINGS[index]; const material = this.materials.get(b.mat);
      const surface = b.mat === 'brick' ? 'brick' : 'plaster';
      if (index === 3) {
        const frontX = b.x - b.w * 0.5;
        this.box([0.22, b.h - 3.1, b.d], [frontX, 3.1 + (b.h - 3.1) * 0.5, b.z], material, { surface });
        this.box([0.22, 3.1, 0.45], [frontX, 1.55, 3.475], material, { collision: true, surface });
        this.box([0.22, 3.1, 3.85], [frontX, 1.55, 10.825], material, { collision: true, surface });
        this.box([b.w, 0.28, b.d], [b.x, b.h - 0.14, b.z], material, { surface });
        this.box([b.w, b.h, 0.22], [b.x, b.h * 0.5, b.z + b.d * 0.5], material, { surface });
      } else if (b.underpass) {
        // Ground-floor underpass: the mass above stays solid while the passage
        // below becomes a covered route between the market and a flank.
        const [gapMin, gapMax] = b.underpass;
        const clear = 3.15;
        this.wallRun({
          axis: 'z', fixed: b.x, from: b.z - b.d * 0.5, to: b.z + b.d * 0.5, y1: b.h,
          material, surface, thickness: b.w, openings: [{ from: gapMin, to: gapMax, y0: 0, y1: clear }],
        });
        this.box([b.w + 0.2, 0.08, gapMax - gapMin], [b.x, 0.04, (gapMin + gapMax) * 0.5], this.materials.get('concrete'), { surface: 'concrete' });
        this.surfaceRect(b.x - b.w * 0.5, b.x + b.w * 0.5, gapMin, gapMax, 'concrete');
        this.cylinder(0.16, 0.16, 0.1, [b.x, clear - 0.16, (gapMin + gapMax) * 0.5], this.materials.get('lamp'), 'glass', 10);
        this.emitter(b.x, clear - 0.3, (gapMin + gapMax) * 0.5, 0xffc07a, 2.6, 9, 2);
        const side = b.x < 0 ? 'west-yard' : 'east-terrace';
        this.transition(`${side}-underpass`, 'market', side, b.x, (gapMin + gapMax) * 0.5);
        this.coverPoints.push([b.x + (b.x < 0 ? -3.4 : 3.4), gapMin - 1.6]);
      } else if (b.openings) {
        // Same mass as the plain box, built as a wall run so it can carry
        // openings. Footprint, height and material are unchanged.
        this.wallRun({
          axis: 'z', fixed: b.x, from: b.z - b.d * 0.5, to: b.z + b.d * 0.5, y1: b.h,
          material, surface, thickness: b.w, openings: b.openings,
        });
        for (const opening of b.openings) {
          const mid = (opening.from + opening.to) * 0.5;
          if (!opening.breach) {
            // Sill and lintel so a punched hole reads as a window, not a gap.
            this.box([b.w + 0.16, 0.16, opening.to - opening.from + 0.3], [b.x, opening.y0 - 0.08, mid], this.materials.get('concrete'), { surface: 'concrete' });
            this.box([b.w + 0.16, 0.18, opening.to - opening.from + 0.3], [b.x, opening.y1 + 0.09, mid], this.materials.get('concrete'), { surface: 'concrete' });
            continue;
          }
          this.surfaceRect(b.x - b.w * 0.5, b.x + b.w * 0.5, opening.from, opening.to, 'concrete');
          this.box([b.w + 0.2, 0.08, opening.to - opening.from], [b.x, 0.04, mid], this.materials.get('concrete'), { surface: 'concrete' });
          // Rubble shoulders sit just outside each mouth. The mouths are the two
          // x faces of the wall, so these offset along x; offsetting along z put
          // them inside the solid flanks, where they were invisible and useless.
          // Flank each mouth without narrowing it. These sit outside the wall in x
          // and outside the opening in z, so they give an approaching player
          // something to break line of sight against while the bore stays a clean
          // 3 m. Placed in the bore they became a chicane and pathing through the
          // breach collapsed.
          for (const side of [-1, 1]) {
            const x = b.x + side * (b.w * 0.5 + 0.7);
            for (const z of [opening.from - 1.0, opening.to + 1.0]) {
              this.box([1.4, 0.9, 1.1], [x, 0.45, z], this.materials.get('concrete'), { collision: true, surface: 'concrete' });
              this.coverPoints.push([x, z]);
            }
          }
          this.emitter(b.x, opening.y1 - 0.4, mid, 0xffc07a, 2.2, 8, 2);
          if (opening.transition) {
            const [id, target] = opening.transition;
            this.transition(id, 'market', target, b.x, mid);
          }
          this.coverPoints.push([b.x + 3.6, mid], [b.x - 3.6, mid]);
        }
      } else {
        this.box([b.w, b.h, b.d], [b.x, b.h * 0.5, b.z], material, { collision: true, surface });
      }
      const facadeX = b.x < 0 ? b.x + b.w * 0.5 + 0.012 : b.x - b.w * 0.5 - 0.012;
      const darkWindow = this.materials.get('darkGlass'); const warmWindow = this.materials.get('warmWindow'); const frameMaterial = this.materials.get('metal');
      for (let floor = 1; floor < Math.floor(b.h / 2.15); floor += 1) {
        for (let dz = -3.1; dz <= 3.2; dz += 2.15) {
          const cell = Math.round((dz + 3.1) / 2.15); const lit = (index * 7 + floor * 3 + cell) % 7 === 0;
          // Vary which interior a lit pane shows so a facade is not a stencil.
          const windowMaterial = lit
            ? this.materials.get(['warmWindow', 'warmWindow1', 'warmWindow2'][(index + floor * 2 + cell) % 3])
            : darkWindow;
          const window = this.box([0.035, 0.92, 1.16], [facadeX, floor * 2.05 + 0.45, b.z + dz], windowMaterial, { surface: 'glass' });
          window.rotation.y = b.x < 0 ? 0 : Math.PI;
          if ((cell + floor + index) % 3 !== 0) this.box([0.06, 0.08, 1.34], [facadeX + (b.x < 0 ? 0.035 : -0.035), floor * 2.05 + 0.45, b.z + dz], frameMaterial, { surface: 'metal' });
          this.box([0.07, 1.05, 0.07], [facadeX + (b.x < 0 ? 0.04 : -0.04), floor * 2.05 + 0.45, b.z + dz], frameMaterial, { surface: 'metal' });
          if ((cell + index) % 4 === 0) this.box([0.11, 0.72, 0.42], [facadeX + (b.x < 0 ? 0.075 : -0.075), floor * 2.05 + 0.45, b.z + dz + 0.73], this.materials.get('wood'), { surface: 'wood', rotation: [0, b.x < 0 ? -0.18 : 0.18, 0] });
        }
      }
      const ledgeX = b.x < 0 ? facadeX + 0.12 : facadeX - 0.12;
      this.box([0.38, 0.13, b.d * 0.82], [ledgeX, 2.0, b.z], this.materials.get('concrete'), { surface: 'concrete' });
      const facadeOffset = b.x < 0 ? 1 : -1;
      this.box([0.28, 0.24, b.d * 0.95], [facadeX + facadeOffset * 0.08, b.h - 0.22, b.z], this.materials.get('concrete'), { surface: 'concrete' });
      this.box([b.w * 0.9, 0.34, 0.28], [b.x, b.h + 0.13, b.z - b.d * 0.43], this.materials.get('concrete'), { surface: 'concrete' });
      this.box([b.w * 0.9, 0.34, 0.28], [b.x, b.h + 0.13, b.z + b.d * 0.43], this.materials.get('concrete'), { surface: 'concrete' });
      const doorZ = b.z + (index % 2 ? 2.2 : -2.1);
      this.box([0.05, 2.25, 1.15], [facadeX + facadeOffset * 0.035, 1.18, doorZ], this.materials.get(index % 3 === 0 ? 'rust' : 'darkGlass'), { surface: index % 3 === 0 ? 'metal' : 'glass' });
      this.box([0.12, 0.18, 1.5], [facadeX + facadeOffset * 0.09, 2.37, doorZ], this.materials.get('metal'), { surface: 'metal' });
      const drainZ = this.clearOfOpenings(b, b.z + b.d * 0.38);
      const drain = this.cylinder(0.055, 0.065, Math.min(5.5, b.h - 0.4), [facadeX + facadeOffset * 0.16, Math.min(5.5, b.h - 0.4) * 0.5, drainZ], this.materials.get('rust'));
      drain.position.x = facadeX + facadeOffset * 0.16;
      drain.position.z = drainZ;
      if (index % 2 === 0) this.addBalcony(facadeX, 3.15, b.z + 0.5, b.x < 0 ? 1 : -1);
      this.addRoofDetail(b.x, b.h, b.z, index);
      // The original block only detailed its street elevation, because nothing
      // could stand behind it. The flanks now look at these rear walls, so they
      // get the same window/pilaster language instead of reading as a blank box.
      const rearSide = b.x < 0 ? -1 : 1;
      const rearX = b.x + rearSide * b.w * 0.5;
      this.facade({
        axis: 'z', fixed: rearX, from: b.z - b.d * 0.5, to: b.z + b.d * 0.5, y1: b.h, side: rearSide,
        openings: b.openings,
        pilasterEvery: 3.4, windowY: 2.5, windowRows: Math.max(1, Math.floor((b.h - 3.4) / 2.3)), windowStep: 3.2,
      });
      this.cylinder(0.06, 0.07, Math.min(5, b.h - 0.6), [rearX + rearSide * 0.34, Math.min(5, b.h - 0.6) * 0.5, this.clearOfOpenings(b, b.z - b.d * 0.32)], this.materials.get('rust'));
    }
    const archMat = this.materials.get('brick');
    this.box([3.1, 5.4, 2.0], [-5.2, 2.7, -19.5], archMat, { collision: true, surface: 'brick' });
    this.box([3.1, 5.4, 2.0], [5.2, 2.7, -19.5], archMat, { collision: true, surface: 'brick' });
    this.box([7.5, 1.35, 2.0], [0, 4.72, -19.5], archMat, { surface: 'brick' });
    this.box([11.5, 0.35, 2.35], [0, 5.55, -19.5], this.materials.get('concrete'), { surface: 'concrete' });
    this.transition('market-arch', 'market', 'north-junction', 0, -19.5);
  }

  addBalcony(facadeX, y, z, side) {
    const metal = this.materials.get('metal'); const concrete = this.materials.get('concrete');
    this.box([1.0, 0.12, 3.8], [facadeX + side * 0.45, y, z], concrete, { surface: 'concrete' });
    for (let dz = -1.7; dz <= 1.7; dz += 0.42) this.box([0.04, 0.78, 0.04], [facadeX + side * 0.93, y + 0.42, z + dz], metal, { surface: 'metal' });
    this.box([0.05, 0.08, 3.7], [facadeX + side * 0.93, y + 0.8, z], metal, { surface: 'metal' });
  }

  addRoofDetail(x, height, z, index) {
    const metal = this.materials.get(index % 2 ? 'rust' : 'metal');
    this.box([1.5, 0.8, 1.2], [x, height + 0.4, z + 1.4], metal, { surface: 'metal' });
    this.cylinder(0.26, 0.3, 1.5, [x + 0.7, height + 0.75, z - 1], metal);
    this.cylinder(0.42, 0.42, 0.12, [x - 0.5, height + 0.5, z - 1.8], metal).rotation.z = Math.PI / 2.7;
  }

  buildMarket() {
    const wood = this.materials.get('wood'); const fabric = this.materials.get('fabric'); const metal = this.materials.get('metal'); const tile = this.materials.get('tile');
    // Covered right-hand arcade establishes the indoor/outdoor transition.
    this.box([2.6, 0.16, 13], [5.1, 3.2, -1.5], metal, { surface: 'metal' });
    this.box([2.65, 0.12, 13], [5.1, 0.2, -1.5], tile, { surface: 'tile' });
    this.surfaceRect(3.8, 6.4, -8, 5, 'tile');
    for (let z = 4.4; z >= -7.2; z -= 2.35) {
      this.cylinder(0.1, 0.12, 3.1, [3.86, 1.68, z], metal);
      this.cylinder(0.1, 0.12, 3.1, [6.28, 1.68, z], metal);
    }
    const warmLightMat = this.materials.get('lamp');
    for (const z of [2.2, -2.5, -6.5]) {
      this.cylinder(0.13, 0.13, 0.28, [5.0, 2.92, z], warmLightMat, 'glass', 12);
      this.emitter(5.0, 2.7, z, 0xff9b4a, 2.7, 7, 2);
    }
    for (const [x, z, rot, tint] of [[4.55, 2.2, 0, 0], [4.9, -1.4, 0.06, 1], [-4.8, 3.8, -0.04, 2], [-4.75, -5.8, 0.05, 1]]) {
      this.box([2.2, 0.12, 1.15], [x, 1.08, z], wood, { collision: true, surface: 'wood', rotation: [0, rot, 0] });
      for (const dx of [-0.92, 0.92]) this.box([0.1, 1.02, 0.1], [x + dx, 0.55, z], wood, { surface: 'wood' });
      const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.2, 5, 3), fabric); canopy.position.set(x, 2.55, z - 0.15); canopy.rotation.set(-Math.PI / 2 + 0.09, 0, rot); canopy.material = fabric; this.add(canopy, { surface: 'fabric' });
      this.addProduce(x, 1.22, z, tint);
    }
    for (let z = 4.4; z >= -7.2; z -= 2.35) {
      for (const x of [3.86, 6.28]) this.solid(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 0, 3.2, 'metal');
    }
    this.box([2.7, 1.25, 0.32], [5.8, 1.25, -7.8], this.materials.get('rust'), { collision: true, surface: 'metal' });
    this.transition('arcade-north', 'arcade', 'market', 5.1, 5.2);
  }

  addProduce(x, y, z, tint) {
    const colors = [0xa24b32, 0xc99134, 0x5d7439]; const mat = new THREE.MeshStandardMaterial({ color: colors[tint], roughness: 0.82 }); this.localMaterials.push(mat);
    const geometry = new THREE.SphereGeometry(0.105, 12, 8); this.resources.add(geometry);
    for (let ix = -4; ix <= 4; ix += 1) for (let iz = -1; iz <= 1; iz += 1) {
      const fruit = new THREE.Mesh(geometry, mat); fruit.position.set(x + ix * 0.19, y + Math.abs(ix % 2) * 0.04 + (ix % 3) * 0.008, z + iz * 0.22 + (ix % 2) * 0.025); fruit.scale.set(0.92 + (ix & 1) * 0.1, 0.84 + (iz + 1) * 0.08, 0.94); fruit.castShadow = true; fruit.userData.batch = this.batchKey; this.group.add(fruit);
    }
  }

  buildStreetDetails() {
    const wood = this.materials.get('wood'); const metal = this.materials.get('metal'); const rust = this.materials.get('rust'); const rubber = this.materials.get('rubber'); const concrete = this.materials.get('concrete');
    const barrelLabel = this.materials.createSign('FUEL 42', '#ddd0a4', '#322c23');
    // Gameplay cover remains aligned with the deterministic encounter.
    this.box([3.2, 1.4, 1.4], [-2.6, 0.7, -1.5], wood, { collision: true, surface: 'wood' });
    for (let y = 0.18; y < 1.3; y += 0.38) this.box([3.28, 0.055, 1.45], [-2.6, y, -1.5], metal, { surface: 'metal' });
    this.box([2.2, 1.1, 1.8], [3, 0.55, 0], rust, { collision: true, surface: 'metal' });
    this.box([1.5, 1.5, 1.5], [0.4, 0.75, -4.6], concrete, { collision: true, surface: 'concrete' });
    // Delivery van landmark.
    this.box([2.25, 1.55, 4.2], [-3.95, 1.05, 7.1], metal, { collision: true, surface: 'metal' });
    this.box([2.28, 0.82, 1.4], [-3.95, 1.63, 5.55], this.materials.get('darkGlass'), { surface: 'glass' });
    for (const z of [5.8, 8.35]) for (const x of [-5.0, -2.9]) { const wheel = this.cylinder(0.37, 0.37, 0.22, [x, 0.42, z], rubber, 'rubber', 16); wheel.rotation.z = Math.PI / 2; }
    // Barrels, crates, sandbags and road barriers.
    for (const [x, z] of [[4.7, 5.8], [5.2, 6.4], [-5.1, -9.2], [2.1, -11.2]]) {
      const barrel = this.cylinder(0.34, 0.34, 0.95, [x, 0.62, z], rust, 'metal', 18); barrel.castShadow = true;
      this.cylinder(0.355, 0.355, 0.055, [x, 0.91, z], metal, 'metal', 18); this.cylinder(0.355, 0.355, 0.055, [x, 0.34, z], metal, 'metal', 18);
      this.cylinder(0.29, 0.29, 0.026, [x, 1.102, z], metal, 'metal', 18);
      this.cylinder(0.045, 0.045, 0.035, [x - 0.16, 1.13, z + 0.08], rust, 'metal', 12);
      this.box([0.018, 0.62, 0.035], [x - 0.342, 0.64, z], metal, { surface: 'metal' });
      this.box([0.016, 0.2, 0.27], [x - 0.354, 0.66, z], barrelLabel, { surface: 'metal', fitUv: true });
      this.solid(x - 0.38, x + 0.38, z - 0.38, z + 0.38, 0, 1.15, 'metal');
    }
    for (let i = 0; i < 8; i += 1) this.box([0.82, 0.54, 0.68], [-5.0 + (i % 2) * 0.76, 0.38 + Math.floor(i / 2) * 0.48, -3.7 + (i % 3) * 0.14], wood, { surface: 'wood' });
    this.solid(-5.5, -3.7, -4.15, -3.1, 0, 2.25, 'wood');
    const sandMat = this.materials.get('fabric');
    for (let i = 0; i < 13; i += 1) { const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.55, 4, 8), sandMat); bag.rotation.z = Math.PI / 2; bag.position.set(-2.9 + (i % 7) * 0.72, 0.25 + Math.floor(i / 7) * 0.27, -10.8 + (i % 2) * 0.14); this.add(bag, { surface: 'fabric' }); }
    this.solid(-3.3, 2.3, -11.2, -10.35, 0, 0.72, 'fabric');
    // Street lamps and overhead cable clutter.
    for (const [x, z] of [[-5.65, 10], [5.65, 4], [-5.65, -6.5], [5.65, -13], [-5.65, 17], [5.65, 18]]) this.addLamp(x, z);
    this.addCable([[-6.3, 6.5, 11], [0, 5.5, 9], [6.3, 6.7, 7]]);
    this.addCable([[-6.3, 7.1, -2], [0, 5.9, -1], [6.3, 7.3, 0]]);
    this.addCable([[-6.3, 6.4, -12], [0, 5.1, -10], [6.3, 6.8, -9]]);
    // Deterministic rubble, concentrated along edges so the combat lane stays readable.
    const rubbleGeo = new THREE.TetrahedronGeometry(0.14, 0); this.resources.add(rubbleGeo);
    for (let i = 0; i < 45; i += 1) { const side = i % 2 ? 1 : -1; const mesh = new THREE.Mesh(rubbleGeo, i % 3 ? concrete : rust); mesh.position.set(side * (5.2 + (i % 5) * 0.17), 0.16, 13 - (i * 1.73) % 34); mesh.rotation.set(i * 0.7, i * 1.13, i * 0.31); mesh.scale.setScalar(0.55 + (i % 4) * 0.18); mesh.castShadow = true; mesh.userData.batch = this.batchKey; this.group.add(mesh); }
    // Northern market approach cover so the alpha-side spine is not a bare run.
    for (const [x, z, w, d] of [[-3.4, 13.6, 2.4, 1.1], [3.6, 15.2, 1.2, 2.6], [-2.2, 18.4, 1.4, 1.4], [4.2, 19.6, 2.6, 1.1], [-4.6, -15.5, 2.6, 1.1], [3.2, -16.5, 1.2, 2.4]]) {
      this.box([w, 1.15, d], [x, 0.58, z], concrete, { collision: true, surface: 'concrete' });
      this.coverPoints.push([x, z]);
    }
  }

  addLamp(x, z) {
    const metal = this.materials.get('metal'); const lampMat = this.materials.get('lamp');
    this.cylinder(0.07, 0.11, 4.2, [x, 2.2, z], metal); this.box([0.95, 0.08, 0.08], [x + (x < 0 ? 0.4 : -0.4), 4.18, z], metal, { surface: 'metal' });
    this.cylinder(0.16, 0.22, 0.25, [x + (x < 0 ? 0.82 : -0.82), 3.98, z], lampMat, 'glass', 12);
    this.solid(x - 0.14, x + 0.14, z - 0.14, z + 0.14, 0, 4.3, 'metal');
  }

  addCable(points) {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.018, 5, false), this.materials.get('rubber')); this.add(mesh, { surface: 'rubber', shadows: false });
  }

  buildLandmarks() {
    const signA = this.materials.createSign('SABLE MARKET', '#183e40', '#d9f4e8');
    const signB = this.materials.createSign('HOTEL ALBA', '#5e2c24', '#f1d29b');
    const signC = this.materials.createSign('KARIM AUTO', '#24364b', '#e0e8e3');
    this.box([0.08, 1.15, 4.2], [-6.72, 3.25, 6.6], signA, { surface: 'metal', fitUv: true });
    this.box([0.08, 1.0, 3.35], [6.7, 3.55, -3.1], signB, { surface: 'metal', fitUv: true });
    this.box([0.08, 0.85, 3.0], [-6.68, 2.5, -11.4], signC, { surface: 'metal', fitUv: true });
    // Clock and end-gate create a navigation anchor.
    const clockFace = new THREE.MeshStandardMaterial({ color: 0xd8d0b5, emissive: 0x6b5434, emissiveIntensity: 0.65, roughness: 0.55 }); this.localMaterials.push(clockFace);
    const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 28), clockFace); clock.position.set(0, 4.75, -18.42); clock.rotation.x = Math.PI / 2; this.add(clock, { surface: 'glass' });
    const hand = this.materials.get('metal'); this.box([0.055, 0.48, 0.035], [0, 4.89, -18.34], hand, { surface: 'metal', rotation: [0, 0, 0.42] }); this.box([0.05, 0.34, 0.035], [0.12, 4.72, -18.33], hand, { surface: 'metal', rotation: [0, 0, -0.78] });
    this.landmark('clock-gate', 'Clock Gate', 0, -19, 4.75);
    this.landmark('sable-sign', 'Sable Market Sign', -6.7, 6.6, 3.25);
    this.landmark('hotel-alba', 'Hotel Alba', 6.7, -3.1, 3.55);
    this.landmark('karim-auto', 'Karim Auto', -6.7, -11.4, 2.5);
  }

  // ---------------------------------------------------------------- west flank

  buildWestYard() {
    this.batchKey = 'west-yard';
    const concrete = this.materials.get('concrete'); const metal = this.materials.get('metal'); const rust = this.materials.get('rust'); const asphalt = this.materials.get('asphalt');
    this.surfaceRect(-50, -14, -44, 21, 'concrete');
    this.box([9, 0.05, 62], [-19, 0.02, -11], asphalt, { surface: 'asphalt' });
    this.surfaceRect(-23.5, -14.5, -42, 20, 'asphalt');
    // Container stacks spread the length of the flank: layered hard cover with
    // climbable tops so the yard is not a flat run.
    const containers = [
      [-18.5, 14.5, 0, 1], [-25.5, 17.5, 1, 0], [-20.5, -4.5, 0, 1], [-27.5, -14.5, 1, 1],
      [-33, 19, 1, 0], [-40, -19, 0, 1], [-45, 6, 1, 0], [-18.5, -24, 0, 1],
      [-30, -28, 1, 1], [-40, -34, 0, 0], [-24, -37, 1, 0], [-45, -25, 1, 1],
    ];
    for (const [x, z, rotated, stacked] of containers) {
      this.addContainer(x, z, rotated, 0);
      if (stacked) this.addContainer(x + (rotated ? 0 : 0.4), z + (rotated ? 0.4 : 0), rotated, 2.62);
      this.coverPoints.push([x + (rotated ? 1.8 : 3.6), z + (rotated ? 3.6 : 1.8)]);
    }
    // Catwalk band: the yard's upper fighting level, reached by two stair flights
    // and continued by the depot mezzanine.
    const catwalkY = 3.5;
    this.deck([21, 2.6], [-25.5, catwalkY, 19.5], metal, { surface: 'metal' });
    this.railing(-36, -15, 18.2, 20.8, catwalkY, metal, { skip: ['east'] });
    for (let x = -35; x < -15; x += 4.5) this.cylinder(0.12, 0.12, catwalkY, [x, catwalkY * 0.5, 19.5], metal);
    this.stairs({ x: -16.4, z: 15.2, toY: catwalkY, run: 4.4, width: 2.4, axis: 'z', direction: 1, material: metal, surface: 'metal' });
    this.deck([2.6, 15], [-35, catwalkY, 11], metal, { surface: 'metal' });
    this.railing(-36.3, -33.7, 3.5, 18.4, catwalkY, metal, { skip: ['north'] });
    for (let z = 5; z < 18; z += 4.5) this.cylinder(0.12, 0.12, catwalkY, [-35, catwalkY * 0.5, z], metal);
    this.stairs({ x: -35, z: 2.2, toY: catwalkY, run: 4.4, width: 2.4, axis: 'z', direction: 1, material: metal, surface: 'metal' });
    // Cargo crane landmark, visible from most of the western half.
    this.box([2.2, 12, 2.2], [-45, 6, -12], rust, { collision: true, surface: 'metal' });
    this.box([2.6, 1.2, 16], [-45, 12.4, -6], rust, { surface: 'metal' });
    this.box([1.0, 3.6, 1.0], [-45, 10.6, 0.5], metal, { surface: 'metal' });
    this.landmark('cargo-crane', 'Cargo Crane', -45, -12, 12);
    // Water tower over the north-west corner.
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { this.cylinder(0.14, 0.18, 9, [-42 + dx, 4.5, 17 + dz], rust); this.solid(-42 + dx - 0.2, -42 + dx + 0.2, 17 + dz - 0.2, 17 + dz + 0.2, 0, 9, 'metal'); }
    this.cylinder(3.1, 3.1, 3.4, [-42, 10.8, 17], rust, 'metal', 18);
    this.cylinder(3.2, 0.2, 1.6, [-42, 13.3, 17], rust, 'metal', 18);
    this.landmark('water-tower', 'Water Tower', -42, 17, 10.8);
    // Fuel farm, sandbag chains and wrecks give the yard a cover rhythm.
    for (const [x, z] of [[-25, 3], [-25, -1], [-29, 1]]) {
      this.cylinder(1.5, 1.5, 3.2, [x, 1.6, z], rust, 'metal', 16);
      this.solid(x - 1.55, x + 1.55, z - 1.55, z + 1.55, 0, 3.2, 'metal');
      this.coverPoints.push([x, z + 2.2]);
    }
    this.addSandbagLine(-32, 12, 6, 'x');
    this.addSandbagLine(-16, -14, 5, 'z');
    this.addSandbagLine(-34, -31, 6, 'x');
    this.addSandbagLine(-20, -40, 5, 'x');
    this.addWreck(-31, -8, 0.7); this.addWreck(-38, 14, 2.3); this.addWreck(-22, -32, 1.4); this.addWreck(-43, -40, 0.4);
    for (const [x, z] of [[-17, 19], [-31, -4], [-44, 12], [-22, -20], [-36, -36], [-17, -41]]) this.addLamp(x, z);
    this.transition('west-market-north', 'west-yard', 'market', -13.5, 15);
    this.batchKey = 'market';
  }

  addContainer(x, z, rotated, baseY) {
    const palette = ['rust', 'metal', 'plasterBlue', 'plasterWarm'];
    const material = this.materials.get(palette[(Math.abs(Math.round(x)) + Math.abs(Math.round(z))) % palette.length]);
    const w = rotated ? 2.5 : 6.1; const d = rotated ? 6.1 : 2.5; const h = 2.6;
    this.box([w, h, d], [x, baseY + h * 0.5, z], material, { collision: true, surface: 'metal', minY: baseY, walkable: true });
    const ribs = rotated ? d : w;
    for (let i = -Math.floor(ribs / 2) + 0.5; i < ribs / 2; i += 0.55) {
      const rx = rotated ? x + w * 0.5 + 0.02 : x + i;
      const rz = rotated ? z + i : z + d * 0.5 + 0.02;
      this.box(rotated ? [0.05, h * 0.86, 0.1] : [0.1, h * 0.86, 0.05], [rx, baseY + h * 0.5, rz], material, { surface: 'metal' });
    }
  }

  addSandbagLine(x, z, count, axis) {
    const fabric = this.materials.get('fabric');
    for (let i = 0; i < count * 2; i += 1) {
      const along = (i % count) * 0.72; const tier = Math.floor(i / count) * 0.3;
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 4, 8), fabric);
      bag.rotation.z = axis === 'x' ? Math.PI / 2 : 0; bag.rotation.y = axis === 'x' ? 0 : Math.PI / 2;
      bag.position.set(axis === 'x' ? x + along : x, 0.26 + tier, axis === 'x' ? z : z + along);
      this.add(bag, { surface: 'fabric' });
    }
    const length = count * 0.72;
    this.solid(
      axis === 'x' ? x - 0.4 : x - 0.42, axis === 'x' ? x + length : x + 0.42,
      axis === 'x' ? z - 0.42 : z - 0.4, axis === 'x' ? z + 0.42 : z + length,
      0, 0.92, 'fabric',
    );
    this.coverPoints.push([axis === 'x' ? x + length * 0.5 : x + 1.0, axis === 'x' ? z + 1.0 : z + length * 0.5]);
  }

  addWreck(x, z, rotation) {
    const rust = this.materials.get('rust'); const rubber = this.materials.get('rubber'); const glass = this.materials.get('darkGlass');
    this.box([2.1, 1.35, 4.6], [x, 0.85, z], rust, { collision: true, surface: 'metal', rotation: [0, rotation, 0] });
    this.box([1.9, 0.8, 1.9], [x, 1.75, z + 0.4], glass, { surface: 'glass', rotation: [0, rotation, 0] });
    for (const dz of [-1.6, 1.6]) for (const dx of [-1.0, 1.0]) {
      const wheel = this.cylinder(0.4, 0.4, 0.24, [x + dx * Math.cos(rotation) - dz * Math.sin(rotation), 0.4, z + dx * Math.sin(rotation) + dz * Math.cos(rotation)], rubber, 'rubber', 14);
      wheel.rotation.z = Math.PI / 2; wheel.rotation.y = rotation;
    }
    this.coverPoints.push([x + 1.6, z]);
  }

  buildDepot() {
    this.batchKey = 'depot';
    const concrete = this.materials.get('concrete'); const metal = this.materials.get('metal'); const rust = this.materials.get('rust'); const wood = this.materials.get('wood');
    const minX = -44; const maxX = -23; const minZ = -11; const maxZ = 13; const wallH = 8.4;
    this.surfaceRect(minX, maxX, minZ, maxZ, 'concrete');
    this.box([maxX - minX, 0.1, maxZ - minZ], [(minX + maxX) * 0.5, 0.05, (minZ + maxZ) * 0.5], concrete, { surface: 'concrete' });
    // Shell with four openings: yard door, north door, south door and a
    // mezzanine-height door onto the catwalk.
    this.wallRun({ axis: 'z', fixed: minX, from: minZ, to: maxZ, y1: wallH, material: concrete });
    this.wallRun({
      axis: 'z', fixed: maxX, from: minZ, to: maxZ, y1: wallH, material: concrete,
      openings: [
        { from: -4, to: 2, y0: 0, y1: 3.4 },
        // Loading gallery. A narrow slot measured a 2.3% open arc from the
        // mezzanine eye position — effectively a sealed box. This is long
        // enough to actually overlook the yard, with a waist-high sill left
        // below it so the position still has cover.
        { from: -9.5, to: 10, y0: 4.35, y1: 6.2 },
      ],
    });
    this.wallRun({ axis: 'x', fixed: minZ, from: minX, to: maxX, y1: wallH, material: concrete, openings: [{ from: -37, to: -31, y0: 0, y1: 3.4 }, { from: -43, to: -31, y0: 4.35, y1: 6.2 }] });
    this.wallRun({ axis: 'x', fixed: maxZ, from: minX, to: maxX, y1: wallH, material: concrete, openings: [{ from: -40, to: -35, y0: 0, y1: 3.4 }, { from: -36.4, to: -33.6, y0: 3.5, y1: 5.8 }] });
    this.box([maxX - minX + 1, 0.4, maxZ - minZ + 1], [(minX + maxX) * 0.5, wallH + 0.2, (minZ + maxZ) * 0.5], metal, { surface: 'metal' });
    // A twenty-metre blank slab reads as filler next to the market facades, so
    // the depot shell gets an industrial read: ribbed cladding, pilasters, a
    // clerestory window band and a parapet.
    const depotEast = [{ from: -4, to: 2, y0: 0, y1: 3.4 }, { from: -9.5, to: 10, y0: 4.35, y1: 6.2 }];
    const depotNorth = [{ from: -37, to: -31, y0: 0, y1: 3.4 }, { from: -43, to: -31, y0: 4.35, y1: 6.2 }];
    const depotSouth = [{ from: -40, to: -35, y0: 0, y1: 3.4 }, { from: -36.4, to: -33.6, y0: 3.5, y1: 5.8 }];
    this.facade({ axis: 'z', fixed: maxX, from: minZ, to: maxZ, y1: wallH, side: 1, pilasterEvery: 4, ribbed: true, windowY: 6.2, windowRows: 1, windowStep: 3.6, openings: depotEast });
    this.facade({ axis: 'z', fixed: minX, from: minZ, to: maxZ, y1: wallH, side: -1, pilasterEvery: 4, ribbed: true, windowY: 6.2, windowRows: 1, windowStep: 3.6 });
    this.facade({ axis: 'x', fixed: minZ, from: minX, to: maxX, y1: wallH, side: -1, pilasterEvery: 4.2, ribbed: true, windowY: 6.2, windowRows: 1, windowStep: 3.4, openings: depotNorth });
    this.facade({ axis: 'x', fixed: maxZ, from: minX, to: maxX, y1: wallH, side: 1, pilasterEvery: 4.2, ribbed: true, windowY: 6.2, windowRows: 1, windowStep: 3.4, openings: depotSouth });
    // Roof plant and a gantry crane rail give the shell a silhouette.
    for (const x of [-40, -33, -26]) {
      this.box([3.2, 1.5, 2.6], [x, wallH + 1.15, 2], metal, { surface: 'metal' });
      this.cylinder(0.5, 0.6, 2.2, [x + 1.4, wallH + 1.5, -4], rust);
    }
    this.box([1.0, 0.7, maxZ - minZ - 2], [-33.5, wallH - 1.2, 1], rust, { surface: 'metal' });
    // Mezzanine: the depot's upper fighting level, joined to the yard catwalk.
    const mezzY = 3.5;
    this.deck([2.6, 13], [-35, mezzY, 6.4], metal, { surface: 'metal' });
    this.railing(-36.3, -33.7, -0.1, 12.9, mezzY, metal, { skip: ['north'] });
    this.deck([17, 5.4], [-33.5, mezzY, -2.6], metal, { surface: 'metal' });
    this.railing(-42, -25, -5.3, 0.1, mezzY, metal, { skip: ['north'] });
    for (const [x, z] of [[-35, 11], [-35, 2], [-41, -2.6], [-27, -2.6]]) this.cylinder(0.13, 0.13, mezzY, [x, mezzY * 0.5, z], metal);
    this.stairs({ x: -26.5, z: -6.6, toY: mezzY, run: 4.6, width: 2.6, axis: 'z', direction: 1, material: metal, surface: 'metal' });
    // Interior clutter: racking, crates and drums keep indoor sightlines broken.
    for (const z of [-8.5, 4, 9.5] ) {
      this.box([0.6, 3.1, 4.4], [-39.5, 1.55, z], rust, { collision: true, surface: 'metal' });
      this.box([2.4, 0.12, 4.4], [-39.5, 1.55, z], wood, { surface: 'wood' });
      this.coverPoints.push([-38, z]);
    }
    for (const [x, z] of [[-29, -8], [-27.5, 2.5], [-31, 6], [-26, 10]]) {
      this.box([1.6, 1.5, 1.6], [x, 0.75, z], wood, { collision: true, surface: 'wood' });
      this.coverPoints.push([x, z]);
    }
    for (const [x, z] of [[-24.5, -9.5], [-25.5, 11], [-42, 11]]) {
      this.cylinder(0.4, 0.4, 1.05, [x, 0.55, z], rust, 'metal', 14);
      this.solid(x - 0.42, x + 0.42, z - 0.42, z + 0.42, 0, 1.05, 'metal');
    }
    const lampMat = this.materials.get('lamp');
    for (const [x, z] of [[-39, 8], [-28, 8], [-39, -6], [-28, -6]]) {
      this.cylinder(0.34, 0.34, 0.18, [x, 6.6, z], lampMat, 'glass', 12);
      this.emitter(x, 6.4, z, 0xffd9a5, 3.2, 20, 2);
    }
    const depotSign = this.materials.createSign('SABLE FREIGHT', '#2b3a2c', '#dfe8cd');
    this.box([0.1, 1.4, 8], [-22.85, 6.4, 4], depotSign, { surface: 'metal', fitUv: true });
    this.landmark('depot', 'Sable Freight Depot', -33.5, 1, 6.4);
    this.transition('depot-yard-east', 'west-yard', 'depot', -23, -1);
    this.transition('depot-north', 'depot', 'west-yard', -34, -11);
    this.transition('depot-south', 'depot', 'west-yard', -37.5, 13);
    this.transition('depot-mezzanine', 'depot', 'west-yard', -35, 13);
    this.batchKey = 'market';
  }

  // ---------------------------------------------------------------- east flank

  buildEastTerrace() {
    this.batchKey = 'east-terrace';
    const concrete = this.materials.get('concrete'); const tile = this.materials.get('tile'); const metal = this.materials.get('metal');
    this.surfaceRect(14, 50, -44, 21, 'tile');
    // Two stepped terraces make elevation a real tactical band on this flank.
    const lowY = this.deck([19, 30], [24.5, 1.5, 2], tile, { surface: 'tile' });
    this.railing(15, 34, -13, 17, lowY, metal, { skip: ['east'] });
    const highY = this.deck([14, 18], [41, 3.6, 3], tile, { surface: 'tile' });
    this.railing(34, 48, -6, 12, highY, metal, { skip: ['west'] });
    this.stairs({ x: 20, z: -16.6, toY: lowY, run: 3.6, width: 4.2, axis: 'z', direction: 1, material: concrete, surface: 'concrete' });
    this.stairs({ x: 28, z: 20.6, toY: lowY, run: 3.6, width: 4.2, axis: 'z', direction: -1, material: concrete, surface: 'concrete' });
    this.stairs({ x: 13.6, z: -2.5, toY: lowY, run: 3.4, width: 3.4, axis: 'x', direction: 1, material: concrete, surface: 'concrete' });
    // The deck used to be reachable from the market only at z -2.5, the same z as
    // the underpass, so one funnel owned every crossing. A northern flight gives
    // the deck a second approach and makes the elevation contestable.
    this.stairs({ x: 13.6, z: 11.5, toY: lowY, run: 3.4, width: 3.4, axis: 'x', direction: 1, material: concrete, surface: 'concrete' });
    this.transition('east-terrace-north-steps', 'market', 'east-terrace', 14.5, 11.5);
    this.stairs({ x: 30.8, z: 8, fromY: lowY, toY: highY, run: 3.2, width: 3.6, axis: 'x', direction: 1, material: concrete, surface: 'concrete' });
    this.stairs({ x: 30.8, z: -4, fromY: lowY, toY: highY, run: 3.2, width: 3.6, axis: 'x', direction: 1, material: concrete, surface: 'concrete' });
    // Planters and a pergola give cover on the open terrace.
    const foliage = new THREE.MeshStandardMaterial({ color: 0x46603a, roughness: 0.88 }); this.localMaterials.push(foliage);
    for (const [x, z, y] of [[17, -6, lowY], [17, 8, lowY], [32.5, -8, lowY], [32.5, 10, lowY], [38, -2, highY], [45, 6, highY], [45, -4, highY]]) {
      this.box([2.2, 1.0, 2.2], [x, y + 0.5, z], concrete, { collision: true, surface: 'concrete', minY: y });
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), foliage); bush.position.set(x, y + 1.4, z); this.add(bush, { surface: 'foliage' });
      this.coverPoints.push([x, z]);
    }
    for (let z = -11; z <= 15; z += 6.5) { this.cylinder(0.16, 0.16, 3.2, [16.5, lowY + 1.6, z], metal); this.solid(16.3, 16.7, z - 0.2, z + 0.2, lowY, lowY + 3.2, 'metal'); }
    this.box([3, 0.14, 28], [16.5, lowY + 3.2, 2], metal, { surface: 'metal' });
    // Radio mast landmark on the high terrace.
    for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) { this.cylinder(0.1, 0.12, 16, [45 + dx, highY + 8, -13 + dz], metal); this.solid(45 + dx - 0.15, 45 + dx + 0.15, -13 + dz - 0.15, -13 + dz + 0.15, highY, highY + 16, 'metal'); }
    this.box([2.6, 0.2, 2.6], [45, highY + 16, -13], metal, { surface: 'metal' });
    this.cylinder(0.08, 0.08, 6, [45, highY + 19, -13], metal);
    this.landmark('radio-mast', 'Radio Mast', 45, -13, highY + 16);
    // Ground level south of the terraces carries the long flank route to bravo.
    this.surfaceRect(14, 50, -44, -13, 'concrete');
    for (const [x, z, rot] of [[17, -17, 0], [22, -19, 0.3], [28, -17.5, -0.2], [40, -22, 1.2], [20, -30, 0.5], [33, -34, 2.1], [45, -38, 0.9], [24, -41, 1.6]]) this.addWreck(x, z, rot);
    this.addSandbagLine(17, 19, 6, 'x');
    this.addSandbagLine(36, -19, 5, 'x');
    this.addSandbagLine(26, -27, 6, 'x');
    this.addSandbagLine(41, -31, 5, 'x');
    for (const [x, z] of [[16, 19], [46, 17], [18, -24], [38, -28], [28, -38], [47, -42]]) this.addLamp(x, z);
    // Low warehouse ruins keep the southern half of the flank from being a field.
    for (const [x, z, w, d, h] of [[22, -24, 7, 5, 3.4], [37, -26, 6, 8, 4.2], [30, -36, 9, 5, 3.0], [44, -34, 5, 6, 3.8], [18, -36, 6, 7, 4.4]]) {
      this.wallRun({ axis: 'x', fixed: z - d * 0.5, from: x - w * 0.5, to: x + w * 0.5, y1: h, material: concrete, thickness: 0.45, openings: [{ from: x - 1.2, to: x + 1.2, y0: 0, y1: 2.4 }] });
      this.wallRun({ axis: 'x', fixed: z + d * 0.5, from: x - w * 0.5, to: x + w * 0.5, y1: h, material: concrete, thickness: 0.45, openings: [{ from: x - 1.2, to: x + 1.2, y0: 0, y1: 2.4 }] });
      this.wallRun({ axis: 'z', fixed: x - w * 0.5, from: z - d * 0.5, to: z + d * 0.5, y1: h, material: concrete, thickness: 0.45 });
      this.wallRun({ axis: 'z', fixed: x + w * 0.5, from: z - d * 0.5, to: z + d * 0.5, y1: h, material: concrete, thickness: 0.45, openings: [{ from: z - 1.2, to: z + 1.2, y0: 0, y1: 2.4 }] });
      this.box([w + 0.6, 0.3, d + 0.6], [x, h + 0.15, z], concrete, { surface: 'concrete' });
      this.coverPoints.push([x + w * 0.5 + 1.2, z], [x - w * 0.5 - 1.2, z]);
    }
    this.transition('east-market-north', 'east-terrace', 'market', 13.5, 15);
    this.batchKey = 'market';
  }

  buildOffices() {
    this.batchKey = 'east-offices';
    const plaster = this.materials.get('plasterBlue'); const tile = this.materials.get('tile'); const metal = this.materials.get('metal'); const wood = this.materials.get('wood'); const glass = this.materials.get('darkGlass');
    const minX = 19; const maxX = 30; const minZ = -8; const maxZ = 12; const floorY = 1.5; const upperY = 5.0; const roofY = 8.4;
    this.surfaceRect(minX, maxX, minZ, maxZ, 'tile');
    // The bureau block stands on the low terrace, so its ground floor is level 1.
    this.wallRun({ axis: 'z', fixed: minX, from: minZ, to: maxZ, y0: floorY, y1: roofY, material: plaster, thickness: 0.4, openings: [{ from: -1, to: 3, y0: floorY, y1: floorY + 2.5 }, { from: -7, to: -3.5, y0: floorY + 0.9, y1: floorY + 2.1 }, { from: -7, to: 11.5, y0: upperY + 0.85, y1: upperY + 2.5 }] });
    this.wallRun({ axis: 'z', fixed: maxX, from: minZ, to: maxZ, y0: floorY, y1: roofY, material: plaster, thickness: 0.4, openings: [{ from: 4, to: 8, y0: floorY, y1: floorY + 2.5 }, { from: -7.5, to: 11.5, y0: upperY + 0.85, y1: upperY + 2.5 }] });
    this.wallRun({ axis: 'x', fixed: minZ, from: minX, to: maxX, y0: floorY, y1: roofY, material: plaster, thickness: 0.4, openings: [{ from: 23, to: 27, y0: floorY, y1: floorY + 2.5 }, { from: 19.5, to: 29.5, y0: upperY + 0.85, y1: upperY + 2.5 }] });
    this.wallRun({ axis: 'x', fixed: maxZ, from: minX, to: maxX, y0: floorY, y1: roofY, material: plaster, thickness: 0.4, openings: [{ from: 21, to: 25, y0: floorY, y1: floorY + 2.5 }] });
    this.box([maxX - minX, 0.36, maxZ - minZ], [(minX + maxX) * 0.5, roofY + 0.18, (minZ + maxZ) * 0.5], plaster, { surface: 'plaster' });
    // Two glazed office storeys rather than a blue box: window bands on every
    // elevation, pilasters and a parapet, matching the market's facade language.
    const westOpen = [{ from: -1, to: 3, y0: floorY, y1: floorY + 2.5 }, { from: -7, to: 11.5, y0: upperY + 0.85, y1: upperY + 2.5 }];
    const eastOpen = [{ from: 4, to: 8, y0: floorY, y1: floorY + 2.5 }, { from: -7.5, to: 11.5, y0: upperY + 0.85, y1: upperY + 2.5 }];
    const southOpen = [{ from: 23, to: 27, y0: floorY, y1: floorY + 2.5 }, { from: 19.5, to: 29.5, y0: upperY + 0.85, y1: upperY + 2.5 }];
    const northOpen = [{ from: 21, to: 25, y0: floorY, y1: floorY + 2.5 }];
    this.facade({ axis: 'z', fixed: minX, from: minZ, to: maxZ, y0: floorY, y1: roofY, side: -1, pilasterEvery: 4, windowY: floorY + 1.5, windowRows: 2, windowStep: 3.1, openings: westOpen });
    this.facade({ axis: 'z', fixed: maxX, from: minZ, to: maxZ, y0: floorY, y1: roofY, side: 1, pilasterEvery: 4, windowY: floorY + 1.5, windowRows: 2, windowStep: 3.1, openings: eastOpen });
    this.facade({ axis: 'x', fixed: minZ, from: minX, to: maxX, y0: floorY, y1: roofY, side: -1, pilasterEvery: 3.6, windowY: floorY + 1.5, windowRows: 2, windowStep: 3.0, openings: southOpen });
    this.facade({ axis: 'x', fixed: maxZ, from: minX, to: maxX, y0: floorY, y1: roofY, side: 1, pilasterEvery: 3.6, windowY: floorY + 1.5, windowRows: 2, windowStep: 3.0, openings: northOpen });
    for (const [x, z] of [[21, -6], [28, 9]]) {
      this.box([2.2, 1.0, 1.6], [x, roofY + 0.7, z], metal, { surface: 'metal' });
      this.cylinder(0.34, 0.4, 1.4, [x + 1.4, roofY + 0.9, z], this.materials.get('rust'));
    }
    // Interior trim: a dado rail, ceiling coffers and pillars read as a fitted
    // office instead of a painted shell.
    for (const z of [minZ + 0.4, maxZ - 0.4]) this.box([maxX - minX - 1, 0.12, 0.1], [(minX + maxX) * 0.5, floorY + 1.05, z], wood, { surface: 'wood' });
    for (const x of [minX + 0.4, maxX - 0.4]) this.box([0.1, 0.12, maxZ - minZ - 1], [x, floorY + 1.05, (minZ + maxZ) * 0.5], wood, { surface: 'wood' });
    for (const [x, z] of [[22.5, -4], [27.5, -4], [22.5, 8], [27.5, 8]]) {
      this.box([0.42, upperY - floorY, 0.42], [x, floorY + (upperY - floorY) * 0.5, z], plaster, { collision: true, surface: 'plaster', minY: floorY });
      this.box([0.42, roofY - upperY - 0.4, 0.42], [x, upperY + (roofY - upperY) * 0.5, z], plaster, { collision: true, surface: 'plaster', minY: upperY });
    }
    for (let z = minZ + 2; z < maxZ; z += 2.6) this.box([maxX - minX - 0.8, 0.16, 0.18], [(minX + maxX) * 0.5, roofY - 0.35, z], plaster, { surface: 'plaster' });
    // Upper floor with an atrium void so the two levels see each other.
    this.deck([11, 8], [24.5, upperY, -3.5], tile, { surface: 'tile' });
    this.deck([5, 6], [21.5, upperY, 3], tile, { surface: 'tile' });
    this.deck([11, 4], [24.5, upperY, 9.5], tile, { surface: 'tile' });
    this.railing(19, 30, 0, 7, upperY, metal, { skip: ['west'] });
    this.stairs({ x: 28, z: -6.4, fromY: floorY, toY: upperY, run: 4.4, width: 2.6, axis: 'z', direction: 1, material: tile, surface: 'tile' });
    this.stairs({ x: 21.5, z: 10.6, fromY: floorY, toY: upperY, run: 4.4, width: 2.6, axis: 'z', direction: -1, material: tile, surface: 'tile' });
    // Furniture breaks up both floors so the interior is not an empty shell.
    for (const x of [21.5, 24.5, 27.5]) {
      this.box([0.3, 2.5, 0.3], [x, upperY + 1.65, minZ], plaster, { surface: 'plaster', cast: false });
      this.box([0.3, 2.5, 0.3], [x, upperY + 1.65, maxZ], plaster, { surface: 'plaster', cast: false });
    }
    for (const z of [-4, 2, 8]) {
      this.box([0.3, 2.5, 0.3], [minX, upperY + 1.65, z], plaster, { surface: 'plaster', cast: false });
      this.box([0.3, 2.5, 0.3], [maxX, upperY + 1.65, z], plaster, { surface: 'plaster', cast: false });
    }
    for (const [x, z] of [[22, -5], [27, -2], [26, -6], [22, 9.5], [27, 9.5]]) {
      this.box([2.0, 0.75, 1.0], [x, upperY + 0.38, z], wood, { collision: true, surface: 'wood', minY: upperY });
      this.coverPoints.push([x, z]);
    }
    for (const [x, z] of [[20.5, -6.5], [26, 1], [23, 10.5], [28.5, 5]]) {
      this.box([1.4, 1.35, 0.16], [x, floorY + 0.68, z], glass, { collision: true, surface: 'glass', minY: floorY });
      this.coverPoints.push([x, z]);
    }
    for (const [x, z] of [[21.5, -3], [28, 3], [24, 7]]) {
      this.box([1.6, 1.4, 1.6], [x, floorY + 0.7, z], wood, { collision: true, surface: 'wood', minY: floorY });
      this.coverPoints.push([x, z]);
    }
    const lampMat = this.materials.get('lamp');
    for (const [x, z, y] of [[24, -4, upperY + 2.5], [24, 8, upperY + 2.5], [22, 6, floorY + 2.4], [28, -5, floorY + 2.4]]) {
      this.cylinder(0.3, 0.3, 0.12, [x, y, z], lampMat, 'glass', 12);
      this.emitter(x, y - 0.2, z, 0xcfe4ff, 2.5, 16, 2);
    }
    const officeSign = this.materials.createSign('BUREAU 12', '#1f3448', '#dbe6f2');
    this.box([0.1, 1.3, 7], [18.85, roofY - 1.4, 2], officeSign, { surface: 'metal', fitUv: true });
    this.landmark('bureau', 'Bureau 12', 24.5, 2, roofY);
    this.transition('offices-west', 'east-terrace', 'east-offices', 19, 1);
    this.transition('offices-east', 'east-terrace', 'east-offices', 30, 6);
    this.transition('offices-south', 'east-terrace', 'east-offices', 25, -8);
    this.transition('offices-north', 'east-terrace', 'east-offices', 23, 12);
    this.batchKey = 'market';
  }

  // ------------------------------------------------------------ north junction

  buildNorthJunction() {
    this.batchKey = 'north-junction';
    const asphalt = this.materials.get('asphalt'); const concrete = this.materials.get('concrete'); const metal = this.materials.get('metal');
    this.surfaceRect(-14, 14, -44, -21, 'asphalt');
    this.box([28, 0.05, 23], [0, 0.02, -32.5], asphalt, { surface: 'asphalt' });
    // Central island and monument: the crossroad landmark, and the mass that
    // denies a straight staging-to-staging shooting lane down the spine.
    this.cylinder(4.2, 4.6, 1.1, [0, 0.55, -32], concrete, 'concrete', 24);
    this.solid(-4.4, 4.4, -36.4, -27.6, 0, 1.1, 'concrete');
    this.cylinder(0.7, 0.9, 8.0, [0, 5.1, -32], concrete, 'concrete', 14);
    this.solid(-0.95, 0.95, -32.95, -31.05, 0, 9.1, 'concrete');
    const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), this.materials.get('emissive'));
    beacon.position.set(0, 9.4, -32); this.add(beacon, { surface: 'metal' });
    this.emitter(0, 9.4, -32, 0x6ee9df, 4.4, 26, 2);
    this.landmark('junction-beacon', 'Junction Beacon', 0, -32, 9.4);
    this.coverPoints.push([0, -26.8], [0, -37.2], [-5.2, -32], [5.2, -32]);
    // Overpass: an elevated firing line across the junction, reached from both
    // flanks, that overlooks the crossroad rather than either staging yard.
    const spanY = 4.6;
    this.deck([32, 5], [0, spanY, -39], concrete, { surface: 'concrete' });
    this.railing(-16, 16, -41.5, -36.5, spanY, metal);
    for (const x of [-13, -6, 6, 13]) { this.cylinder(0.5, 0.6, spanY, [x, spanY * 0.5, -39], concrete, 'concrete', 12); this.solid(x - 0.6, x + 0.6, -39.6, -38.4, 0, spanY - 0.32, 'concrete'); }
    this.stairs({ x: -17.4, z: -39, toY: spanY, run: 5.2, width: 3.0, axis: 'x', direction: 1, material: concrete, surface: 'concrete' });
    this.stairs({ x: 17.4, z: -39, toY: spanY, run: 5.2, width: 3.0, axis: 'x', direction: -1, material: concrete, surface: 'concrete' });
    this.landmark('overpass', 'Junction Overpass', 0, -39, spanY);
    // Barricades and a bus shelter give the open junction a cover rhythm.
    for (const [x, z] of [[-9, -25], [9, -25], [-6, -37], [6, -37], [-11, -31], [11, -31]]) {
      this.box([3.2, 1.15, 1.0], [x, 0.58, z], concrete, { collision: true, surface: 'concrete' });
      this.coverPoints.push([x, z + 1.3]);
    }
    this.addSandbagLine(-6, -23, 5, 'x');
    this.addWreck(-11, -35, 1.1); this.addWreck(11, -36, -0.6);
    this.box([7, 0.16, 3], [-11, 2.9, -24], metal, { surface: 'metal' });
    for (const [dx, dz] of [[-3.2, -1.3], [3.2, -1.3], [-3.2, 1.3], [3.2, 1.3]]) { this.cylinder(0.1, 0.1, 2.9, [-11 + dx, 1.45, -24 + dz], metal); this.solid(-11 + dx - 0.15, -11 + dx + 0.15, -24 + dz - 0.15, -24 + dz + 0.15, 0, 2.9, 'metal'); }
    this.box([7, 1.5, 0.14], [-11, 1.5, -25.4], this.materials.get('darkGlass'), { collision: true, surface: 'glass' });
    for (const [x, z] of [[-12, -22], [12, -22], [-12, -43], [12, -43]]) this.addLamp(x, z);
    this.batchKey = 'market';
  }

  buildDeploymentYards() {
    const concrete = this.materials.get('concrete'); const fabric = this.materials.get('fabric'); const rust = this.materials.get('rust');
    for (const team of ['alpha', 'bravo']) {
      const south = team === 'alpha';
      const depth = south ? 1 : -1;
      const zNear = south ? 21 : -44;
      const zFar = south ? 45 : -55;
      this.batchKey = `${team}-yard`;
      // Yard depth differs a lot per side (alpha 24 m, bravo 11 m), so everything
      // in the yard is placed as a fraction of it rather than at fixed offsets.
      const yardDepth = Math.abs(zFar - zNear);
      this.surfaceRect(-50, 50, Math.min(zNear, zFar), Math.max(zNear, zFar), 'concrete');
      this.box([100, 0.06, Math.abs(zFar - zNear)], [0, 0.03, (zNear + zFar) * 0.5], this.materials.get('yardSlab'), { surface: 'concrete' });
      // Front line with three gates; the shoulders beyond x = +-27 stay open so
      // the yard has five ways out rather than one funnel.
      this.wallRun({
        axis: 'x', fixed: zNear + depth * 0.6, from: -27, to: 27, y1: 4.4, material: concrete, thickness: 1.1,
        openings: [{ from: -20, to: -12 }, { from: -4, to: 4 }, { from: 12, to: 20 }],
      });
      // Blast-wall segments read as fortification once they carry a base, a
      // coping and buttresses; the three gates stay visually obvious.
      for (const [a, b] of [[-27, -20], [-12, -4], [4, 12], [20, 27]]) {
        this.facade({ axis: 'x', fixed: zNear + depth * 0.6, from: a, to: b, y1: 4.4, side: depth, pilasterEvery: 2.6 });
        this.facade({ axis: 'x', fixed: zNear + depth * 0.6, from: a, to: b, y1: 4.4, side: -depth, pilasterEvery: 2.6 });
      }
      const gateLamp = this.materials.get('lamp');
      for (const gate of [-16, 0, 16]) {
        this.cylinder(0.2, 0.2, 0.3, [gate, 4.6, zNear + depth * 0.6], gateLamp, 'glass', 10);
        this.emitter(gate, 4.4, zNear + depth * 1.2, south ? 0x7fe6e2 : 0xff8b5a, 3.4, 16, 2);
      }
      // Staging clutter across the full width, so the yard is a place, not a box.
      // Tents were at a fixed 8 m offset while the canopy, mast and floodlights
      // are placed as fractions of yard depth. In bravo's 11 m yard the fractions
      // collapsed onto the tent row and built ten poles - including all four legs
      // of the comms mast, the zone's own landmark - straight through the tents.
      // Tents now use the same fraction, and any tent whose slot is claimed by a
      // pole is skipped rather than intersected.
      const tentZ = zNear + depth * yardDepth * 0.28;
      // Poles stand at x = +-33 (floodlights), +-16.6 (canopy legs) and +-0.8
      // (mast legs). The tent row is offset to sit between those lines.
      const poleXs = [-33, -16.6, -0.8, 0.8, 16.6, 33];
      for (const ox of [-40, -24, -8, 8, 24, 40]) {
        if (poleXs.some((px) => Math.abs(px - ox) < 3.2)) continue;
        const cz = tentZ;
        const tent = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.8, 4), fabric);
        tent.position.set(ox, 1.4, cz); tent.rotation.y = Math.PI / 4; this.add(tent, { surface: 'fabric' });
        this.solid(ox - 2.2, ox + 2.2, cz - 2.2, cz + 2.2, 0, 2.8, 'fabric');
        this.coverPoints.push([ox, cz + depth * 3.2]);
      }
      // The rear half of each yard measured as bare concrete - a 6 m deep band
      // running clear for ninety metres, the emptiest ground on the map and a
      // quarter of its walkable area. All the existing clutter sat within 16 m of
      // the front line. This is the deep staging that was missing: a vehicle
      // canopy, a supply dump and a comms mast, clustered into two readable
      // groups rather than scattered, so the yard reads as a place without
      // becoming noise to fight through.
      const metalMat = this.materials.get('metal');
      const woodMat = this.materials.get('wood');
      for (const side of [-1, 1]) {
        const bayX = side * 21;
        const bayZ = zNear + depth * yardDepth * 0.55;
        // Open-sided vehicle canopy: four legs and a roof, a strong silhouette
        // against a wall that was otherwise unbroken.
        const bayD = yardDepth > 18 ? 3.2 : 2.2;
        for (const [dx, dz] of [[-4.4, -bayD], [4.4, -bayD], [-4.4, bayD], [4.4, bayD]]) {
          this.cylinder(0.16, 0.18, 4.2, [bayX + dx, 2.1, bayZ + dz], metalMat);
          this.solid(bayX + dx - 0.2, bayX + dx + 0.2, bayZ + dz - 0.2, bayZ + dz + 0.2, 0, 4.2, 'metal');
        }
        this.box([10.2, 0.22, bayD * 2.4], [bayX, 4.3, bayZ], metalMat, { surface: 'metal' });
        this.box([10.6, 0.1, 0.5], [bayX, 4.5, bayZ - bayD * 1.1], rust, { surface: 'metal' });
        // Fuel drums and pallet stacks under the canopy.
        for (const [dx, dz] of [[-3.4, 1.9], [-2.6, 2.5], [3.2, -2.0]]) {
          this.cylinder(0.42, 0.42, 1.15, [bayX + dx, 0.58, bayZ + dz], rust);
          this.solid(bayX + dx - 0.42, bayX + dx + 0.42, bayZ + dz - 0.42, bayZ + dz + 0.42, 0, 1.15, 'metal');
        }
        for (let i = 0; i < 3; i += 1) {
          this.box([2.6, 0.34, 1.7], [bayX + 2.4, 0.17 + i * 0.36, bayZ + 2.4], woodMat, { collision: i === 0, surface: 'wood' });
        }
        this.coverPoints.push([bayX + 2.4, bayZ + 4.0], [bayX - 4.8, bayZ]);
        // Painted bay markings: the flat slab had no ground detail at all.
        for (const dz of [-bayD * 0.8, bayD * 0.8]) {
          this.box([9.6, 0.02, 0.16], [bayX, 0.05, bayZ + dz], rust, { surface: 'concrete', cast: false });
        }
        this.box([0.16, 0.02, 5.4], [bayX - 4.8, 0.05, bayZ], rust, { surface: 'concrete', cast: false });
      }
      // Comms mast: the yard's landmark and its only vertical reference.
      const mastZ = zNear + depth * yardDepth * 0.82;
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        this.cylinder(0.09, 0.11, 13, [dx, 6.5, mastZ + dz], metalMat);
        this.solid(dx - 0.14, dx + 0.14, mastZ + dz - 0.14, mastZ + dz + 0.14, 0, 13, 'metal');
      }
      this.box([2.3, 0.18, 2.3], [0, 13, mastZ], metalMat, { surface: 'metal' });
      for (const dy of [7.4, 10.2]) this.box([3.4, 0.1, 0.5], [0, dy, mastZ], rust, { surface: 'metal' });
      this.emitter(0, 13.4, mastZ, south ? 0x7fe6e2 : 0xff8b5a, 2.2, 22, 1);
      this.landmark(`${team}-mast`, south ? 'Alpha Comms Mast' : 'Bravo Comms Mast', 0, mastZ, 13);
      // Generator and cable runs at the mast base: infrastructure, not scatter.
      this.box([2.2, 1.2, 1.4], [3.2, 0.6, mastZ], rust, { collision: true, surface: 'metal' });
      this.coverPoints.push([3.2, mastZ + 1.8]);
      this.addCable([[0.8, 1.2, mastZ], [2.6, 0.9, mastZ], [3.2, 1.2, mastZ]]);
      // Floodlights washing the back wall, so the rear is lit rather than flat.
      for (const fx of [-33, 33]) {
        const fz = zNear + depth * yardDepth * 0.72;
        this.cylinder(0.13, 0.15, 5.4, [fx, 2.7, fz], metalMat);
        this.solid(fx - 0.18, fx + 0.18, fz - 0.18, fz + 0.18, 0, 5.4, 'metal');
        this.box([1.3, 0.5, 0.35], [fx, 5.5, fz], metalMat, { surface: 'metal' });
        this.emitter(fx, 5.4, fz + depth * 0.6, 0xffd9a5, 3.0, 24, 2);
      }

      for (const [ox, oz] of [[-42, 14], [-24, 15], [-8, 16], [8, 16], [24, 15], [42, 14]]) {
        const cz = zNear + depth * oz;
        this.box([2.4, 1.5, 2.4], [ox, 0.75, cz], rust, { collision: true, surface: 'metal' });
        this.coverPoints.push([ox, cz]);
      }
      this.addWreck(-12, zNear + depth * 4, 0.2); this.addWreck(12, zNear + depth * 4, -0.3);
      this.addWreck(-38, zNear + depth * 5, 1.1); this.addWreck(38, zNear + depth * 5, -1.1);
      this.addSandbagLine(-30, zNear + depth * 3, 6, 'x');
      this.addSandbagLine(24, zNear + depth * 3, 6, 'x');
      for (const [x, oz] of [[-30, 4], [0, 4], [30, 4], [-16, 18], [16, 18]]) this.addLamp(x, zNear + depth * oz);
      const label = this.materials.createSign(south ? 'ALPHA STAGING' : 'BRAVO STAGING', south ? '#123a45' : '#4a1f1c', '#e6f1ef');
      this.box([12, 1.8, 0.12], [0, 4.6, zFar + (south ? -0.4 : 0.4)], label, { surface: 'metal', fitUv: true });
      this.landmark(`${team}-staging`, south ? 'Alpha Staging' : 'Bravo Staging', 0, zFar, 4.6);
      this.transition(`${team}-gate-west`, `${team}-yard`, south ? 'west-yard' : 'north-junction', -16, zNear);
      this.transition(`${team}-gate-centre`, `${team}-yard`, south ? 'market' : 'north-junction', 0, zNear);
      this.transition(`${team}-gate-east`, `${team}-yard`, south ? 'east-terrace' : 'north-junction', 16, zNear);
      this.batchKey = 'market';
    }
  }

  buildDistantSkyline() {
    const material = new THREE.MeshBasicMaterial({ color: 0x1c2b36, fog: true }); this.localMaterials.push(material);
    this.batchKey = 'skyline';
    for (let i = 0; i < 26; i += 1) { const x = -78 + i * 6.2; const h = 9 + (i * 7) % 16; this.box([5.6, h, 6], [x, h * 0.5 - 0.2, -76 - (i % 3) * 5], material, { surface: 'concrete', cast: false, raycast: false }); }
    for (let i = 0; i < 26; i += 1) { const x = -78 + i * 6.2; const h = 8 + (i * 5) % 14; this.box([5.6, h, 6], [x, h * 0.5 - 0.2, 66 + (i % 3) * 5], material, { surface: 'concrete', cast: false, raycast: false }); }
    for (const side of [-1, 1]) for (let i = 0; i < 22; i += 1) { const z = -72 + i * 6.4; const h = 8 + (i * 5) % 15; this.box([6, h, 6.4], [side * (64 + (i % 3) * 6), h * 0.5 - 0.2, z], material, { surface: 'concrete', cast: false, raycast: false }); }
    this.batchKey = 'market';
  }

  // -------------------------------------------------------------- broadphase

  // The district carries thousands of solids. Every gameplay query (movement,
  // line of sight, navigation sampling) goes through this uniform grid instead
  // of a linear scan.
  buildColliderGrid() {
    this.gridCols = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / GRID_CELL) + 2;
    this.gridRows = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / GRID_CELL) + 2;
    this.grid = Array.from({ length: this.gridCols * this.gridRows }, () => []);
    this.gridOversize = [];
    for (let i = 0; i < this.colliders.length; i += 1) {
      const collider = this.colliders[i];
      collider.index = i;
      const c0 = this.gridCol(collider.minX); const c1 = this.gridCol(collider.maxX);
      const r0 = this.gridRow(collider.minZ); const r1 = this.gridRow(collider.maxZ);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > 48) { this.gridOversize.push(collider); continue; }
      for (let c = c0; c <= c1; c += 1) for (let r = r0; r <= r1; r += 1) this.grid[r * this.gridCols + c].push(collider);
    }
    // Stamp dedup: a query marks each collider once instead of scanning the
    // output array, which matters because gameplay probes run every fixed step.
    this.queryStamp = new Int32Array(this.colliders.length);
    this.queryTick = 0;
  }

  gridCol(x) { return Math.max(0, Math.min(this.gridCols - 1, Math.floor((x - BOUNDS.minX) / GRID_CELL) + 1)); }
  gridRow(z) { return Math.max(0, Math.min(this.gridRows - 1, Math.floor((z - BOUNDS.minZ) / GRID_CELL) + 1)); }

  queryColliders(minX, maxX, minZ, maxZ, out) {
    out.length = 0;
    this.queryTick += 1;
    const tick = this.queryTick;
    const c0 = this.gridCol(minX); const c1 = this.gridCol(maxX);
    const r0 = this.gridRow(minZ); const r1 = this.gridRow(maxZ);
    for (let r = r0; r <= r1; r += 1) {
      const base = r * this.gridCols;
      for (let c = c0; c <= c1; c += 1) {
        const bucket = this.grid[base + c];
        for (let i = 0; i < bucket.length; i += 1) {
          const collider = bucket[i];
          if (this.queryStamp[collider.index] === tick) continue;
          this.queryStamp[collider.index] = tick;
          out.push(collider);
        }
      }
    }
    for (const collider of this.gridOversize) {
      if (this.queryStamp[collider.index] === tick) continue;
      this.queryStamp[collider.index] = tick;
      out.push(collider);
    }
    return out;
  }

  // Line-of-sight probes are the hottest gameplay query, so a ray walks the
  // broadphase cells it actually crosses instead of taking the whole segment
  // bounding box (which for a 90 m diagonal shot is most of the map).
  queryRayColliders(ox, oz, dx, dz, maxDistance, out) {
    out.length = 0;
    this.queryTick += 1;
    const tick = this.queryTick;
    const collect = (col, row) => {
      if (col < 0 || col >= this.gridCols || row < 0 || row >= this.gridRows) return;
      const bucket = this.grid[row * this.gridCols + col];
      for (let i = 0; i < bucket.length; i += 1) {
        const collider = bucket[i];
        if (this.queryStamp[collider.index] === tick) continue;
        this.queryStamp[collider.index] = tick;
        out.push(collider);
      }
    };
    let col = this.gridCol(ox); let row = this.gridRow(oz);
    const stepC = dx > 1e-9 ? 1 : dx < -1e-9 ? -1 : 0;
    const stepR = dz > 1e-9 ? 1 : dz < -1e-9 ? -1 : 0;
    let tMaxX = stepC === 0 ? Infinity : ((BOUNDS.minX + (stepC > 0 ? col : col - 1) * GRID_CELL) - ox) / dx;
    let tMaxZ = stepR === 0 ? Infinity : ((BOUNDS.minZ + (stepR > 0 ? row : row - 1) * GRID_CELL) - oz) / dz;
    const tDeltaX = stepC === 0 ? Infinity : GRID_CELL / Math.abs(dx);
    const tDeltaZ = stepR === 0 ? Infinity : GRID_CELL / Math.abs(dz);
    collect(col, row);
    for (let guard = 0; guard < 512; guard += 1) {
      if (Math.min(tMaxX, tMaxZ) > maxDistance) break;
      if (tMaxX < tMaxZ) { col += stepC; tMaxX += tDeltaX; } else { row += stepR; tMaxZ += tDeltaZ; }
      if (col < 0 || col >= this.gridCols || row < 0 || row >= this.gridRows) break;
      collect(col, row);
    }
    for (const collider of this.gridOversize) {
      if (this.queryStamp[collider.index] === tick) continue;
      this.queryStamp[collider.index] = tick;
      out.push(collider);
    }
    return out;
  }

  // -------------------------------------------------------------- navigation

  standable(x, z, y, radius = NAV_CLEARANCE) {
    if (x < BOUNDS.minX + 0.6 || x > BOUNDS.maxX - 0.6 || z < BOUNDS.minZ + 0.6 || z > BOUNDS.maxZ - 0.6) return false;
    const feet = y + 0.1; const head = y + ACTOR_HEIGHT;
    this.scratchColliders ??= [];
    for (const box of this.queryColliders(x - radius, x + radius, z - radius, z + radius, this.scratchColliders)) {
      if (box.maxY <= feet || box.minY >= head) continue;
      const nearestX = Math.max(box.minX, Math.min(x, box.maxX));
      const nearestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - nearestX; const dz = z - nearestZ;
      if (dx * dx + dz * dz < radius * radius) return false;
    }
    return true;
  }

  floorsAt(x, z, out = []) {
    out.length = 0; out.push(0);
    for (const platform of this.platforms) {
      if (x < platform.minX || x > platform.maxX || z < platform.minZ || z > platform.maxZ) continue;
      if (!out.includes(platform.top)) out.push(platform.top);
    }
    return out;
  }

  // A floor is only usable if nothing overhead crushes it: a slab 1 m above the
  // ground is a plinth, not a room.
  headroomAt(x, z, y) {
    let ceiling = Infinity;
    for (const platform of this.platforms) {
      if (x < platform.minX || x > platform.maxX || z < platform.minZ || z > platform.maxZ) continue;
      if (platform.top > y + 0.25 && platform.top < ceiling) ceiling = platform.top;
    }
    return ceiling - y;
  }

  // The nav graph is sampled from the finished geometry rather than hand-authored,
  // so a bot can only walk where the player can walk.
  buildNavigation() {
    const nodes = []; const index = new Map();
    const cols = Math.floor((BOUNDS.maxX - BOUNDS.minX) / NAV_STEP);
    const rows = Math.floor((BOUNDS.maxZ - BOUNDS.minZ) / NAV_STEP);
    const floors = [];
    for (let ci = 0; ci <= cols; ci += 1) {
      for (let ri = 0; ri <= rows; ri += 1) {
        const x = BOUNDS.minX + ci * NAV_STEP; const z = BOUNDS.minZ + ri * NAV_STEP;
        for (const y of this.floorsAt(x, z, floors).slice()) {
          if (this.headroomAt(x, z, y) < ACTOR_HEIGHT) continue;
          if (!this.standable(x, z, y)) continue;
          const id = nodes.length;
          const key = `${ci}:${ri}`;
          nodes.push({ id, x, y, z, zone: this.zoneAt(x, z, y), edges: [] });
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(id);
        }
      }
    }
    const connect = (a, b) => {
      if (a === b) return;
      if (!nodes[a].edges.includes(b)) nodes[a].edges.push(b);
      if (!nodes[b].edges.includes(a)) nodes[b].edges.push(a);
    };
    for (let ci = 0; ci <= cols; ci += 1) {
      for (let ri = 0; ri <= rows; ri += 1) {
        for (const id of index.get(`${ci}:${ri}`) ?? []) {
          const node = nodes[id];
          for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            for (const other of index.get(`${ci + dc}:${ri + dr}`) ?? []) {
              const target = nodes[other];
              if (Math.abs(target.y - node.y) > NAV_STEP_UP) continue;
              const midX = (node.x + target.x) * 0.5; const midZ = (node.z + target.z) * 0.5;
              const midY = Math.max(node.y, target.y);
              if (this.headroomAt(midX, midZ, midY) < ACTOR_HEIGHT * 0.85) continue;
              if (!this.standable(midX, midZ, midY, NAV_CLEARANCE * 0.92)) continue;
              connect(id, other);
            }
          }
        }
      }
    }
    // Stair chains are explicit: their treads are steeper than grid adjacency.
    const nearest = (x, y, z, maxDistance = NAV_STEP * 1.7) => {
      let best = -1; let bestScore = maxDistance * maxDistance;
      for (const node of nodes) {
        if (node.stair || Math.abs(node.y - y) > 0.8) continue;
        const dx = node.x - x; const dz = node.z - z; const score = dx * dx + dz * dz;
        if (score < bestScore) { bestScore = score; best = node.id; }
      }
      return best;
    };
    for (const link of this.navLinks) {
      const chain = [];
      for (const [x, y, z] of link.points) {
        const id = nodes.length;
        nodes.push({ id, x, y, z, zone: this.zoneAt(x, z, y), edges: [], stair: true });
        chain.push(id);
      }
      for (let i = 1; i < chain.length; i += 1) connect(chain[i - 1], chain[i]);
      for (const end of [chain[0], chain[chain.length - 1]]) {
        const node = nodes[end];
        const anchor = nearest(node.x, node.y, node.z);
        if (anchor >= 0) connect(end, anchor);
      }
    }
    // Drop anything no route can reach; an unreachable node is a bot trap.
    const seed = Math.max(0, nodes.findIndex((node) => node.zone === 'market'));
    const reachable = new Set([seed]);
    const queue = [seed];
    while (queue.length) {
      const current = queue.pop();
      for (const next of nodes[current].edges) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
    this.navNodes = nodes;
    this.navReachable = reachable;
    this.navZoneNodes = new Map();
    for (const node of nodes) {
      if (!reachable.has(node.id)) continue;
      if (!this.navZoneNodes.has(node.zone)) this.navZoneNodes.set(node.zone, []);
      this.navZoneNodes.get(node.zone).push(node.id);
    }
    // A coarse lookup grid turns "closest nav node to this actor" into a local
    // scan rather than a walk over every node, every time a bot repaths.
    // Overlook value per node: the fraction of directions with a long clear
    // line from standing eye height. Goal selection uses this to prefer
    // positions that can actually see the map, rather than treating every
    // elevated node as equally valuable.
    const fanOrigin = { x: 0, y: 0, z: 0 };
    const fanDir = { x: 0, y: 0, z: 0 };
    for (const node of nodes) {
      if (!reachable.has(node.id)) { node.overlook = 0; continue; }
      let open = 0;
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        fanOrigin.x = node.x; fanOrigin.y = node.y + 1.7; fanOrigin.z = node.z;
        fanDir.x = -Math.sin(angle); fanDir.y = 0; fanDir.z = -Math.cos(angle);
        const hit = this.raycastForOverlook(fanOrigin, fanDir, 30);
        if (hit >= 22) open += 1;
      }
      node.overlook = open / 8;
    }
    this.navLookup = new Map();
    for (const node of nodes) {
      if (!reachable.has(node.id)) continue;
      const key = `${Math.round(node.x / GRID_CELL)}:${Math.round(node.z / GRID_CELL)}`;
      if (!this.navLookup.has(key)) this.navLookup.set(key, []);
      this.navLookup.get(key).push(node.id);
    }
  }

  // Minimal ray test against the collider grid, used only while baking overlook
  // values at build time (physics is not constructed yet at this point).
  raycastForOverlook(origin, direction, maxDistance) {
    this.overlookScratch ??= [];
    this.queryRayColliders(origin.x, origin.z, direction.x, direction.z, maxDistance, this.overlookScratch);
    let nearest = maxDistance;
    for (const box of this.overlookScratch) {
      const minY = box.minY ?? 0; const maxY = box.maxY ?? box.height;
      if (origin.y < minY || origin.y > maxY) continue;
      let tMin = 0.05; let tMax = nearest;
      for (const [o, d, lo, hi] of [[origin.x, direction.x, box.minX, box.maxX], [origin.z, direction.z, box.minZ, box.maxZ]]) {
        if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) { tMin = Infinity; break; } continue; }
        let entry = (lo - o) / d; let exit = (hi - o) / d;
        if (entry > exit) { const swap = entry; entry = exit; exit = swap; }
        tMin = Math.max(tMin, entry); tMax = Math.min(tMax, exit);
      }
      if (tMin <= tMax && tMin < nearest) nearest = tMin;
    }
    return nearest;
  }

  nearestNavNode(x, y, z) {
    let best = -1; let bestScore = Infinity;
    for (let ring = 0; ring <= 3 && best < 0; ring += 1) {
      const cx = Math.round(x / GRID_CELL); const cz = Math.round(z / GRID_CELL);
      for (let dc = -ring; dc <= ring; dc += 1) {
        for (let dr = -ring; dr <= ring; dr += 1) {
          if (ring > 0 && Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
          for (const id of this.navLookup.get(`${cx + dc}:${cz + dr}`) ?? []) {
            const node = this.navNodes[id];
            const dy = Math.abs(node.y - y);
            const score = (node.x - x) ** 2 + (node.z - z) ** 2 + dy * dy * 9;
            if (score < bestScore) { bestScore = score; best = id; }
          }
        }
      }
    }
    return best;
  }

  buildSpawnPoints() {
    // Spawn candidates are sampled from real nav nodes, so no spawn can place an
    // actor inside geometry or on an unreachable island.
    const pick = (zone, team, wanted, filter = null) => {
      const ids = (this.navZoneNodes.get(zone) ?? []).filter((id) => !filter || filter(this.navNodes[id]));
      if (!ids.length) return;
      const stride = Math.max(1, Math.floor(ids.length / wanted));
      for (let i = 0, taken = 0; i < ids.length && taken < wanted; i += stride, taken += 1) {
        const node = this.navNodes[ids[i]];
        this.spawnPoints.push({ x: node.x, y: node.y, z: node.z, team, zone, yaw: team === 'alpha' ? Math.PI : 0 });
      }
    };
    // Nothing spawns in the outer margin: a spawn pinned against the perimeter
    // has no retreat and reads as being dumped outside the play space.
    const inField = (node) => node.x > BOUNDS.minX + 8 && node.x < BOUNDS.maxX - 8;
    pick('alpha-yard', 'alpha', 8, (node) => inField(node) && node.z > 24 && node.z < 40);
    pick('bravo-yard', 'bravo', 8, (node) => inField(node) && node.z < -46);
    // Forward candidates stop repeat deaths from replaying the same long walk.
    pick('market', 'alpha', 3, (node) => node.z > 4);
    pick('west-yard', 'alpha', 3, (node) => inField(node) && node.z > 4 && node.y < 1);
    pick('east-terrace', 'alpha', 3, (node) => inField(node) && node.z > 4 && node.y < 2);
    pick('north-junction', 'bravo', 3, (node) => node.y < 1);
    pick('west-yard', 'bravo', 3, (node) => inField(node) && node.z < -24 && node.y < 1);
    pick('east-terrace', 'bravo', 3, (node) => inField(node) && node.z < -24 && node.y < 2);
  }

  buildMapReport() {
    // Every number below is measured from the built geometry. Walkable area is a
    // 1 m occupancy sample of the actual standable surface, not a bounding box.
    let cells = 0; let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    const floors = [];
    for (let x = BOUNDS.minX + 0.5; x < BOUNDS.maxX; x += 1) {
      for (let z = BOUNDS.minZ + 0.5; z < BOUNDS.maxZ; z += 1) {
        let walkable = false;
        for (const y of this.floorsAt(x, z, floors).slice()) {
          if (this.headroomAt(x, z, y) < ACTOR_HEIGHT) continue;
          if (!this.standable(x, z, y, 0.34)) continue;
          walkable = true; break;
        }
        if (!walkable) continue;
        cells += 1;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    const levels = new Set();
    for (const node of this.navNodes) if (this.navReachable.has(node.id)) levels.add(Math.round(node.y / 1.4));
    this.mapReport = {
      playableWidthM: Math.round(maxX - minX),
      playableDepthM: Math.round(maxZ - minZ),
      playableAreaM2: cells,
      zones: ZONES.length,
      primaryRoutes: ROUTE_FAMILIES.length,
      routeLoops: ZONE_LINKS.length - ZONES.length + 1,
      verticalLevels: levels.size,
      spawnPoints: this.spawnPoints.length,
      landmarks: this.landmarks.length,
      indoorZones: ZONES.filter((zone) => zone.kind === 'indoor').length,
      outdoorZones: ZONES.filter((zone) => zone.kind === 'outdoor').length,
      indoorOutdoorTransitions: this.transitions.length,
      navNodes: this.navReachable.size,
      coverPoints: this.coverPoints.length,
      // Reachable nav nodes per zone. A zone with few nodes cannot hold a fight
      // no matter how the AI is tuned, so this separates map defects from AI ones.
      navNodesByZone: Object.fromEntries([...this.navZoneNodes].map(([zone, ids]) => [zone, ids.length])),
      elevatedNavNodesByZone: Object.fromEntries([...this.navZoneNodes].map(([zone, ids]) => [zone, ids.filter((id) => this.navNodes[id].y > 2).length])),
      colliders: this.colliders.length,
      // Post-merge mesh count: the number of objects the render and shadow passes
      // must walk every frame, which is what map density actually costs.
      meshes: this.group.children.filter((child) => child.isMesh).length,
      shadowCasters: this.group.children.filter((child) => child.isMesh && child.castShadow).length,
    };
  }

  mergeStaticMeshes() {
    // Batching is per zone so the district keeps useful frustum culling: one
    // giant merged mesh would force the whole map through every shadow pass.
    const raycastSet = new Set(this.raycastTargets); const groups = new Map();
    for (const child of [...this.group.children]) {
      if (!child.isMesh || child.isInstancedMesh || Array.isArray(child.material) || child.material.transparent) continue;
      const surface = child.userData.surface ?? 'concrete';
      // Batching is per zone. Splitting further on a spatial grid was measured
      // from five first-person viewpoints and lost every time: the extra draw
      // calls cost more than the frustum culling saved (market 366 -> 460 -> 636
      // calls at 32 m and 16 m cells).
      const key = `${child.userData.batch ?? 'market'}:${child.material.uuid}:${surface}:${Number(child.castShadow)}:${Number(child.receiveShadow)}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(child);
    }
    const removed = new Set(); const mergedRaycast = [];
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const geometries = members.map((mesh) => {
        mesh.updateMatrix(); const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); geometry.applyMatrix4(mesh.matrix); return geometry;
      });
      const geometry = mergeGeometries(geometries, false); for (const item of geometries) item.dispose();
      if (!geometry) continue;
      const exemplar = members[0]; const mesh = new THREE.Mesh(geometry, exemplar.material);
      mesh.name = `static-merge-batch:${exemplar.userData.batch ?? 'market'}:${exemplar.userData.surface ?? 'surface'}`; mesh.userData.surface = exemplar.userData.surface; mesh.castShadow = exemplar.castShadow; mesh.receiveShadow = exemplar.receiveShadow;
      this.group.add(mesh); this.resources.add(geometry);
      let shouldRaycast = false;
      for (const member of members) { shouldRaycast ||= raycastSet.has(member); removed.add(member); this.group.remove(member); }
      if (shouldRaycast) mergedRaycast.push(mesh);
    }
    this.raycastTargets = this.raycastTargets.filter((mesh) => !removed.has(mesh)); this.raycastTargets.push(...mergedRaycast);
  }

  getColliders() { return this.colliders; }
  getCoverPoints() { return this.coverPoints; }
  getPlatforms() { return this.platforms; }
  getBounds() { return BOUNDS; }
  getZones() { return ZONES; }
  getRouteFamilies() { return ROUTE_FAMILIES; }
  getSpawnPoints() { return this.spawnPoints; }
  getLandmarks() { return this.landmarks; }
  getNavNodes() { return this.navNodes; }
  getZoneNodes(zone) { return this.navZoneNodes.get(zone) ?? []; }
  getMapReport() { return this.mapReport; }

  zoneAt(x, z, y = 0) {
    let best = null; let bestArea = Infinity;
    for (const zone of ZONES) {
      if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) continue;
      // The bureau block stands on the terrace: below its floor the position is
      // still outdoors, so the indoor rect only claims the raised volume.
      if (zone.id === 'east-offices' && y < 1.2) continue;
      const area = (zone.maxX - zone.minX) * (zone.maxZ - zone.minZ);
      if (area < bestArea) { bestArea = area; best = zone; }
    }
    return best?.id ?? 'market';
  }

  zoneName(id) { return ZONES.find((zone) => zone.id === id)?.name ?? 'Sable District'; }

  surfaceAt(position) {
    let best = null; let bestTop = 0.05;
    for (const platform of this.platforms) {
      if (position.x < platform.minX || position.x > platform.maxX || position.z < platform.minZ || position.z > platform.maxZ) continue;
      if (platform.top > position.y + 0.35 || platform.top < bestTop) continue;
      bestTop = platform.top; best = platform.surface;
    }
    if (best) return best;
    for (let i = this.surfaceRects.length - 1; i >= 0; i -= 1) {
      const rect = this.surfaceRects[i];
      if (position.x >= rect.minX && position.x <= rect.maxX && position.z >= rect.minZ && position.z <= rect.maxZ) return rect.surface;
    }
    return 'concrete';
  }

  appendRaycastTargets(targets) { for (const target of this.raycastTargets) targets.push(target); }
  reset() {}
  dispose() { this.scene.remove(this.group); for (const resource of this.resources) resource.dispose?.(); for (const material of this.localMaterials) material.dispose?.(); }
}
