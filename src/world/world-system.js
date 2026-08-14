import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BUILDINGS = [
  { x: -9.2, z: 8, w: 4.8, h: 6.8, d: 9.5, mat: 'plasterBlue' },
  { x: -9.0, z: -2.5, w: 4.6, h: 8.8, d: 10, mat: 'brick' },
  { x: -9.4, z: -13, w: 5.2, h: 7.4, d: 10, mat: 'plasterWarm' },
  { x: 9.2, z: 8, w: 4.8, h: 7.8, d: 9.5, mat: 'plasterWarm' },
  { x: 9.0, z: -2.5, w: 4.6, h: 6.4, d: 10, mat: 'plasterBlue' },
  { x: 9.35, z: -13, w: 5.1, h: 9.2, d: 10, mat: 'brick' },
];

export class WorldSystem {
  static id = 'world';
  static deps = ['render', 'materials', 'sky'];

  async init(ctx) {
    this.ctx = ctx; this.scene = ctx.scene; this.materials = ctx.get('materials');
    this.group = new THREE.Group(); this.group.name = 'Sable Market combat block'; this.scene.add(this.group);
    this.colliders = []; this.raycastTargets = []; this.resources = new Set(); this.lights = []; this.geometryCache = new Map();
    this.coverPoints = [[-2.6, -2.58], [3.0, -1.25], [0.4, -5.72], [-2.9, -11.55], [1.8, -11.55], [-4.75, -6.65]];
    this.buildGround(); this.buildArchitecture(); this.buildInteriorShop(); this.buildMarket(); this.buildStreetDetails(); this.buildLandmarks(); this.buildDistantSkyline();
    if (ctx.config.staticBatch !== false) this.mergeStaticMeshes();
  }

  add(mesh, { surface = 'concrete', raycast = true, shadows = true } = {}) {
    mesh.userData.surface = surface; mesh.castShadow = shadows; mesh.receiveShadow = shadows; this.group.add(mesh);
    if (raycast) this.raycastTargets.push(mesh); if (mesh.geometry) this.resources.add(mesh.geometry); return mesh;
  }

  box(size, position, material, { collision = false, surface = 'concrete', rotation = null, bevel = false } = {}) {
    const key = `box:${size.join(',')}:${bevel ? 1 : 0}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) { geometry = bevel ? new THREE.BoxGeometry(...size, 2, 2, 2) : new THREE.BoxGeometry(...size); this.geometryCache.set(key, geometry); }
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); if (rotation) mesh.rotation.set(...rotation); this.add(mesh, { surface });
    if (collision) this.colliders.push({ minX: position[0] - size[0] * 0.5, maxX: position[0] + size[0] * 0.5, minZ: position[2] - size[2] * 0.5, maxZ: position[2] + size[2] * 0.5, height: position[1] + size[1] * 0.5, surface });
    return mesh;
  }

  cylinder(radiusTop, radiusBottom, height, position, material, surface = 'metal', segments = 16) {
    const key = `cylinder:${radiusTop},${radiusBottom},${height},${segments}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) { geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments); this.geometryCache.set(key, geometry); }
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); return this.add(mesh, { surface });
  }

  buildGround() {
    const asphalt = this.materials.get('asphalt'); const concrete = this.materials.get('concrete'); const tile = this.materials.get('tile');
    const boundary = new THREE.MeshBasicMaterial({ color: 0x18262e, fog: true });
    this.localMaterials = [boundary];
    const perimeter = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), boundary); perimeter.rotation.x = -Math.PI / 2; perimeter.position.set(0, -0.16, -12); this.add(perimeter, { surface: 'concrete', raycast: false, shadows: false });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 46, 20, 50), asphalt); road.rotation.x = -Math.PI / 2; road.position.z = -3; this.add(road, { surface: 'asphalt' });
    this.box([2.25, 0.24, 46], [-6.95, 0.1, -3], concrete, { surface: 'concrete' });
    this.box([2.25, 0.24, 46], [6.95, 0.1, -3], tile, { surface: 'tile' });
    for (const x of [-5.86, 5.86]) this.box([0.1, 0.22, 46], [x, 0.14, -3], concrete, { surface: 'concrete' });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xc3a863, roughness: 0.84, metalness: 0 });
    this.localMaterials.push(stripe);
    for (let z = 12; z > -22; z -= 4.2) this.box([0.09, 0.012, 2.2], [0, 0.018, z], stripe, { surface: 'asphalt' });
    const puddleMat = this.materials.get('darkGlass');
    for (const [x, z, sx, sz] of [[-1.8, 5.1, 1.3, 2.2], [2.5, -8.2, 1.8, 1.1], [-3.6, -13.8, 1.1, 1.9]]) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 24), puddleMat); puddle.scale.set(sx, sz, 1); puddle.rotation.x = -Math.PI / 2; puddle.position.set(x, 0.026, z); this.add(puddle, { surface: 'water', raycast: false, shadows: false });
    }
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
      this.box([0.012, 0.1, 0.16], [10.935, y, z], teaLabel, { surface: 'metal' });
    }
    this.box([0.025, 0.38, 1.75], [11.29, 2.76, 7.72], menuLabel, { surface: 'wood' });
    // Stock, weighing scale and hanging herbs make this room feel actively used.
    const fabric = this.materials.get('fabric'); const rust = this.materials.get('rust');
    for (let i = 0; i < 5; i += 1) {
      const sack = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 5, 10), fabric);
      sack.position.set(7.55 + (i % 2) * 0.46, 0.34 + Math.floor(i / 2) * 0.28, 8.45 - (i % 3) * 0.22);
      sack.rotation.z = Math.PI / 2 + (i - 2) * 0.05; this.add(sack, { surface: 'fabric' });
    }
    this.colliders.push({ minX: 7.2, maxX: 8.35, minZ: 7.72, maxZ: 8.78, height: 1.05, surface: 'fabric' });
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
    const light = new THREE.PointLight(0xffa65c, 3.1, 7.5, 1.8); light.position.set(9.15, 2.28, 6.05); this.group.add(light); this.lights.push(light);
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
      } else {
        this.box([b.w, b.h, b.d], [b.x, b.h * 0.5, b.z], material, { collision: true, surface });
      }
      const facadeX = b.x < 0 ? b.x + b.w * 0.5 + 0.012 : b.x - b.w * 0.5 - 0.012;
      const darkWindow = this.materials.get('darkGlass'); const warmWindow = this.materials.get('warmWindow'); const frameMaterial = this.materials.get('metal');
      for (let floor = 1; floor < Math.floor(b.h / 2.15); floor += 1) {
        for (let dz = -3.1; dz <= 3.2; dz += 2.15) {
          const cell = Math.round((dz + 3.1) / 2.15); const lit = (index * 7 + floor * 3 + cell) % 7 === 0;
          const windowMaterial = lit ? warmWindow : darkWindow;
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
      const drain = this.cylinder(0.055, 0.065, Math.min(5.5, b.h - 0.4), [facadeX + facadeOffset * 0.16, Math.min(5.5, b.h - 0.4) * 0.5, b.z + b.d * 0.38], this.materials.get('rust'));
      drain.position.x = facadeX + facadeOffset * 0.16;
      if (index % 2 === 0) this.addBalcony(facadeX, 3.15, b.z + 0.5, b.x < 0 ? 1 : -1);
      this.addRoofDetail(b.x, b.h, b.z, index);
    }
    const archMat = this.materials.get('brick');
    this.box([3.1, 5.4, 2.0], [-5.2, 2.7, -19.5], archMat, { collision: true, surface: 'brick' });
    this.box([3.1, 5.4, 2.0], [5.2, 2.7, -19.5], archMat, { collision: true, surface: 'brick' });
    this.box([7.5, 1.35, 2.0], [0, 4.72, -19.5], archMat, { surface: 'brick' });
    this.box([11.5, 0.35, 2.35], [0, 5.55, -19.5], this.materials.get('concrete'), { surface: 'concrete' });
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
    for (let z = 4.4; z >= -7.2; z -= 2.35) {
      this.cylinder(0.1, 0.12, 3.1, [3.86, 1.68, z], metal);
      this.cylinder(0.1, 0.12, 3.1, [6.28, 1.68, z], metal);
    }
    const warmLightMat = this.materials.get('lamp');
    for (const z of [2.2, -2.5, -6.5]) {
      this.cylinder(0.13, 0.13, 0.28, [5.0, 2.92, z], warmLightMat, 'glass', 12);
      const light = new THREE.PointLight(0xff9b4a, 2.7, 7, 2); light.position.set(5.0, 2.7, z); this.group.add(light); this.lights.push(light);
    }
    for (const [x, z, rot, tint] of [[4.55, 2.2, 0, 0], [4.9, -1.4, 0.06, 1], [-4.8, 3.8, -0.04, 2], [-4.75, -5.8, 0.05, 1]]) {
      this.box([2.2, 0.12, 1.15], [x, 1.08, z], wood, { collision: true, surface: 'wood', rotation: [0, rot, 0] });
      for (const dx of [-0.92, 0.92]) this.box([0.1, 1.02, 0.1], [x + dx, 0.55, z], wood, { surface: 'wood' });
      const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.2, 5, 3), fabric); canopy.position.set(x, 2.55, z - 0.15); canopy.rotation.set(-Math.PI / 2 + 0.09, 0, rot); canopy.material = fabric; this.add(canopy, { surface: 'fabric' });
      this.addProduce(x, 1.22, z, tint);
    }
    for (let z = 4.4; z >= -7.2; z -= 2.35) {
      for (const x of [3.86, 6.28]) this.colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15, height: 3.2, surface: 'metal' });
    }
    this.box([2.7, 1.25, 0.32], [5.8, 1.25, -7.8], this.materials.get('rust'), { collision: true, surface: 'metal' });
  }

  addProduce(x, y, z, tint) {
    const colors = [0xa24b32, 0xc99134, 0x5d7439]; const mat = new THREE.MeshStandardMaterial({ color: colors[tint], roughness: 0.82 }); this.localMaterials.push(mat);
    const geometry = new THREE.SphereGeometry(0.105, 12, 8); this.resources.add(geometry);
    for (let ix = -4; ix <= 4; ix += 1) for (let iz = -1; iz <= 1; iz += 1) {
      const fruit = new THREE.Mesh(geometry, mat); fruit.position.set(x + ix * 0.19, y + Math.abs(ix % 2) * 0.04 + (ix % 3) * 0.008, z + iz * 0.22 + (ix % 2) * 0.025); fruit.scale.set(0.92 + (ix & 1) * 0.1, 0.84 + (iz + 1) * 0.08, 0.94); fruit.castShadow = true; this.group.add(fruit);
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
      this.box([0.016, 0.2, 0.27], [x - 0.354, 0.66, z], barrelLabel, { surface: 'metal' });
      this.colliders.push({ minX: x - 0.38, maxX: x + 0.38, minZ: z - 0.38, maxZ: z + 0.38, height: 1.15, surface: 'metal' });
    }
    for (let i = 0; i < 8; i += 1) this.box([0.82, 0.54, 0.68], [-5.0 + (i % 2) * 0.76, 0.38 + Math.floor(i / 2) * 0.48, -3.7 + (i % 3) * 0.14], wood, { surface: 'wood' });
    this.colliders.push({ minX: -5.5, maxX: -3.7, minZ: -4.15, maxZ: -3.1, height: 2.25, surface: 'wood' });
    const sandMat = this.materials.get('fabric');
    for (let i = 0; i < 13; i += 1) { const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.55, 4, 8), sandMat); bag.rotation.z = Math.PI / 2; bag.position.set(-2.9 + (i % 7) * 0.72, 0.25 + Math.floor(i / 7) * 0.27, -10.8 + (i % 2) * 0.14); this.add(bag, { surface: 'fabric' }); }
    this.colliders.push({ minX: -3.3, maxX: 2.3, minZ: -11.2, maxZ: -10.35, height: 0.72, surface: 'fabric' });
    // Street lamps and overhead cable clutter.
    for (const [x, z] of [[-5.65, 10], [5.65, 4], [-5.65, -6.5], [5.65, -13]]) this.addLamp(x, z);
    this.addCable([[-6.3, 6.5, 11], [0, 5.5, 9], [6.3, 6.7, 7]]);
    this.addCable([[-6.3, 7.1, -2], [0, 5.9, -1], [6.3, 7.3, 0]]);
    this.addCable([[-6.3, 6.4, -12], [0, 5.1, -10], [6.3, 6.8, -9]]);
    // Deterministic rubble, concentrated along edges so the combat lane stays readable.
    const rubbleGeo = new THREE.TetrahedronGeometry(0.14, 0); this.resources.add(rubbleGeo);
    for (let i = 0; i < 45; i += 1) { const side = i % 2 ? 1 : -1; const mesh = new THREE.Mesh(rubbleGeo, i % 3 ? concrete : rust); mesh.position.set(side * (5.2 + (i % 5) * 0.17), 0.16, 13 - (i * 1.73) % 34); mesh.rotation.set(i * 0.7, i * 1.13, i * 0.31); mesh.scale.setScalar(0.55 + (i % 4) * 0.18); mesh.castShadow = true; this.group.add(mesh); }
  }

  addLamp(x, z) {
    const metal = this.materials.get('metal'); const lampMat = this.materials.get('lamp');
    this.cylinder(0.07, 0.11, 4.2, [x, 2.2, z], metal); this.box([0.95, 0.08, 0.08], [x + (x < 0 ? 0.4 : -0.4), 4.18, z], metal, { surface: 'metal' });
    this.cylinder(0.16, 0.22, 0.25, [x + (x < 0 ? 0.82 : -0.82), 3.98, z], lampMat, 'glass', 12);
    this.colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: z - 0.14, maxZ: z + 0.14, height: 4.3, surface: 'metal' });
  }

  addCable(points) {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.018, 5, false), this.materials.get('rubber')); this.add(mesh, { surface: 'rubber', shadows: false });
  }

  buildLandmarks() {
    const signA = this.materials.createSign('SABLE MARKET', '#183e40', '#d9f4e8');
    const signB = this.materials.createSign('HOTEL ALBA', '#5e2c24', '#f1d29b');
    const signC = this.materials.createSign('KARIM AUTO', '#24364b', '#e0e8e3');
    this.box([0.08, 1.15, 4.2], [-6.72, 3.25, 6.6], signA, { surface: 'metal' });
    this.box([0.08, 1.0, 3.35], [6.7, 3.55, -3.1], signB, { surface: 'metal' });
    this.box([0.08, 0.85, 3.0], [-6.68, 2.5, -11.4], signC, { surface: 'metal' });
    // Clock and end-gate create a navigation anchor.
    const clockFace = new THREE.MeshStandardMaterial({ color: 0xd8d0b5, emissive: 0x6b5434, emissiveIntensity: 0.65, roughness: 0.55 }); this.localMaterials.push(clockFace);
    const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 28), clockFace); clock.position.set(0, 4.75, -18.42); clock.rotation.x = Math.PI / 2; this.add(clock, { surface: 'glass' });
    const hand = this.materials.get('metal'); this.box([0.055, 0.48, 0.035], [0, 4.89, -18.34], hand, { surface: 'metal', rotation: [0, 0, 0.42] }); this.box([0.05, 0.34, 0.035], [0.12, 4.72, -18.33], hand, { surface: 'metal', rotation: [0, 0, -0.78] });
  }

  buildDistantSkyline() {
    const material = new THREE.MeshBasicMaterial({ color: 0x1c2b36, fog: true }); this.localMaterials.push(material);
    for (let i = 0; i < 18; i += 1) { const x = -34 + i * 4; const h = 7 + (i * 7) % 12; this.box([3.6, h, 4], [x, h * 0.5 - 0.2, -36 - (i % 3) * 3], material, { surface: 'concrete' }); }
    for (const side of [-1, 1]) for (let i = 0; i < 12; i += 1) { const z = -30 + i * 5.4; const h = 6 + (i * 5) % 11; this.box([4, h, 4.8], [side * (24 + (i % 3) * 4), h * 0.5 - 0.2, z], material, { surface: 'concrete' }); }
  }

  mergeStaticMeshes() {
    const raycastSet = new Set(this.raycastTargets); const groups = new Map();
    for (const child of [...this.group.children]) {
      if (!child.isMesh || child.isInstancedMesh || Array.isArray(child.material) || child.material.transparent) continue;
      const surface = child.userData.surface ?? 'concrete';
      const key = `${child.material.uuid}:${surface}:${Number(child.castShadow)}:${Number(child.receiveShadow)}`;
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
      mesh.name = `static-merge-batch:${exemplar.userData.surface ?? 'surface'}`; mesh.userData.surface = exemplar.userData.surface; mesh.castShadow = exemplar.castShadow; mesh.receiveShadow = exemplar.receiveShadow;
      this.group.add(mesh); this.resources.add(geometry);
      let shouldRaycast = false;
      for (const member of members) { shouldRaycast ||= raycastSet.has(member); removed.add(member); this.group.remove(member); }
      if (shouldRaycast) mergedRaycast.push(mesh);
    }
    this.raycastTargets = this.raycastTargets.filter((mesh) => !removed.has(mesh)); this.raycastTargets.push(...mergedRaycast);
  }

  getColliders() { return this.colliders; }
  getCoverPoints() { return this.coverPoints; }
  surfaceAt(position) {
    if (position.x >= 6.9 && position.x <= 11.4 && position.z >= 3.4 && position.z <= 9.45) return 'tile';
    if (Math.abs(position.x) >= 5.75 && Math.abs(position.x) <= 8.0) return 'concrete';
    return 'asphalt';
  }
  appendRaycastTargets(targets) { for (const target of this.raycastTargets) targets.push(target); }
  reset() {}
  dispose() { this.scene.remove(this.group); for (const resource of this.resources) resource.dispose?.(); for (const material of this.localMaterials) material.dispose?.(); }
}
