import * as THREE from 'three';
import { createHarnessBridge } from './core/harness.js';

const root = document.querySelector('#app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x090b0d);
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1000);
camera.position.set(0, 1.7, 4);

const light = new THREE.HemisphereLight(0xbfd8ff, 0x20180f, 2.0);
scene.add(light);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const marker = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x626b73, roughness: 0.6 }),
);
marker.position.set(0, 0.5, 0);
scene.add(marker);

const state = {
  frame: 0,
  seed: 1337,
  scenario: 'bootstrap',
  shot: 'overview',
};

function applyShot(name) {
  state.shot = name;
  const presets = {
    overview: [4, 3, 5],
    street: [0, 1.7, 5],
    interior: [2, 1.7, 2],
    weapon_hip: [0, 1.7, 3],
    weapon_ads: [0, 1.7, 2.6],
    combat: [-2, 1.7, 3],
    enemy: [1.5, 1.6, 3],
    material_close: [0, 0.8, 1.6],
    lighting: [3, 2, 3],
    fx: [-3, 1.5, 2],
    hud: [0, 1.7, 4],
  };
  const p = presets[name] ?? presets.overview;
  camera.position.set(...p);
  camera.lookAt(0, 0.7, 0);
}

function renderOneFrame() {
  state.frame += 1;
  marker.rotation.y = state.frame * 0.0025;
  renderer.render(scene, camera);
}

createHarnessBridge({
  renderer,
  state,
  reset({ seed = 1337, scenario = 'bootstrap' } = {}) {
    state.seed = Number(seed) || 1337;
    state.scenario = scenario;
    state.frame = 0;
    applyShot('overview');
    renderOneFrame();
  },
  setShot(name) {
    applyShot(name);
    renderOneFrame();
  },
  stepFrames(count) {
    const n = Math.max(0, Math.min(10000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < n; i += 1) renderOneFrame();
  },
  snapshot() {
    return {
      frame: state.frame,
      scenario: state.scenario,
      shot: state.shot,
      player: {
        position: camera.position.toArray(),
        health: 100,
        stance: 'stand',
        ads: false,
        sprinting: false,
      },
      weapon: {
        id: 'bootstrap',
        ammo: 30,
        reserve: 120,
        reloading: false,
      },
      enemiesAlive: 0,
    };
  },
});

function loop() {
  if (!window.__COD_HARNESS_MODE__) {
    renderOneFrame();
  }
  requestAnimationFrame(loop);
}
applyShot('overview');
renderOneFrame();
loop();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
