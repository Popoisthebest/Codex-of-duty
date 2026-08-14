import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { createHarnessBridge } from './core/harness.js';
import { RenderSystem } from './render/render-system.js';
import { WorldSystem } from './world/world-system.js';
import { PlayerSystem } from './player/player-system.js';
import { PhysicsSystem } from './physics/physics-system.js';
import { WeaponSystem } from './weapons/weapon-system.js';
import { AISystem } from './ai/ai-system.js';
import { FXSystem } from './fx/fx-system.js';
import { UISystem } from './ui/ui-system.js';
import { AudioSystem } from './audio/audio-system.js';
import { MaterialSystem } from './materials/material-system.js';
import { SkySystem } from './sky/sky-system.js';

const root = document.querySelector('#app');
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Codex of Duty game view');
root.appendChild(canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.04, 500);
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 20);
const pageParams = new URLSearchParams(location.search);

const engine = new Engine({ scene, camera, viewScene, viewCamera, canvas, config: { staticBatch: pageParams.get('batch') !== '0' } });
engine.ctx.harness.active = pageParams.get('harness') === '1';
engine
  .register(new RenderSystem())
  .register(new MaterialSystem())
  .register(new SkySystem())
  .register(new WorldSystem())
  .register(new PhysicsSystem())
  .register(new PlayerSystem())
  .register(new WeaponSystem())
  .register(new AISystem())
  .register(new FXSystem())
  .register(new UISystem())
  .register(new AudioSystem());

await engine.init();
await engine.reset({ seed: 1337, scenario: 'default', render: false });
if (!engine.ctx.harness.active) engine.setPaused(true);
const pauseOff = engine.ctx.events.on('game:pause-changed', ({ paused }) => {
  if (!engine.ctx.harness.active) engine.setPaused(paused);
});
const restartOff = engine.ctx.events.on('game:restart-request', async () => {
  if (engine.ctx.harness.active) return;
  engine.setPaused(true);
  await engine.reset({ seed: 1337, scenario: 'default', render: false });
  engine.setPaused(document.pointerLockElement !== canvas);
  engine.start();
});

const render = engine.ctx.get('render');
createHarnessBridge({
  renderer: render.renderer,
  state: engine.ctx.time,
  reset: (options) => engine.reset(options),
  setShot: (name) => engine.setShot(name),
  stepFrames: (count) => engine.stepFrames(count),
  snapshot: () => engine.snapshot(),
  runAction: (name, options) => engine.runAction(name, options),
  listShots: () => engine.listShots(),
  listScenarios: () => ['default', 'contract-check', 'playtest', 'profile'],
  bootstrap: async ({ seed, scenario, shot }) => {
    if (!engine.listShots().includes(shot)) throw new Error(`Unknown canonical shot: ${shot}`);
    await engine.reset({ seed, scenario, render: false });
    await engine.applyShot(shot, true);
  },
  onReady: () => engine.ctx.events.emit('game:ready', { harness: engine.ctx.harness.active }),
});

if (!engine.ctx.harness.active) engine.start();

addEventListener('resize', () => engine.resize(innerWidth, innerHeight));
addEventListener('beforeunload', () => { pauseOff(); restartOff(); engine.dispose(); }, { once: true });
