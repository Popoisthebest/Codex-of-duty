import * as THREE from 'three';
import { GpuProfiler } from './gpu-profiler.js';

const SHOT_POSES = {
  overview: { position: [0, 13.5, 19], target: [0, 0.8, -5], fov: 58 },
  street: { position: [0.35, 1.72, 12], target: [-0.2, 1.5, -10], fov: 68 },
  interior: { position: [7.25, 1.55, 8.55], target: [10.75, 1.38, 6.2], fov: 66 },
  weapon_hip: { position: [0, 1.7, 8.5], target: [0, 1.5, -8], fov: 70 },
  weapon_ads: { position: [0, 1.7, 7.6], target: [0, 1.62, -9], fov: 54 },
  combat: { position: [-1.7, 1.65, 5.8], target: [-1.15, 1.42, -5.5], fov: 68 },
  enemy: { position: [1.8, 1.5, 2.5], target: [0, 1.42, -2.3], fov: 52 },
  material_close: { position: [2.72, 1.28, 7.55], target: [4.92, 0.72, 6.05], fov: 52 },
  lighting: { position: [4.0, 1.68, -7.0], target: [5.0, 2.15, -1.6], fov: 59 },
  fx: { position: [-2.1, 1.6, 4.3], target: [0.1, 1.25, -3.4], fov: 58 },
  hud: { position: [0, 1.7, 8.5], target: [0, 1.5, -8], fov: 70 },
};

export class RenderSystem {
  static id = 'render';

  async init(ctx) {
    this.ctx = ctx;
    this.renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.setClearColor(0x101923);
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = true;

    this.captureCamera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 500);
    this.screenSize = new THREE.Vector2(innerWidth, innerHeight);
    this.depthTexture = null;
    this.velocityTexture = null;
    this.passes = [];
    this.lights = [];
    this.useCaptureCamera = false;
    this.showViewmodel = true;
    this.gpu = new GpuProfiler(this.renderer);
  }

  // Live-match capture and playback follow the player camera rather than the
  // fixed canonical shot pose the v2 screenshot tools rely on.
  usePlayerCamera(enabled = true) {
    this.useCaptureCamera = !enabled;
    this.showViewmodel = true;
  }

  setShot(name, ctx) {
    const pose = SHOT_POSES[name];
    this.captureCamera.position.fromArray(pose.position);
    this.captureCamera.fov = pose.fov;
    this.captureCamera.updateProjectionMatrix();
    this.captureCamera.lookAt(...pose.target);
    this.useCaptureCamera = ctx.harness.active;
    this.showViewmodel = !ctx.harness.active || ['weapon_hip', 'weapon_ads', 'combat', 'fx', 'hud'].includes(name);
  }

  lateUpdate(_dt, ctx) {
    const camera = this.useCaptureCamera ? this.captureCamera : ctx.camera;
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    // The shadow map is rendered inside renderer.render(). Timing it separately
    // needs the shadow update to be a distinct submission, so while profiling the
    // shadow pass is driven explicitly and the world pass then reuses it. Outside
    // profiling the renderer keeps its normal automatic behaviour.
    if (this.gpu.enabled) {
      this.gpu.begin('shadow');
      this.renderer.shadowMap.autoUpdate = true;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(ctx.scene, this.shadowProbeCamera(camera));
      this.gpu.end();
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.clear();
    }
    this.gpu.begin('world');
    this.renderer.render(ctx.scene, camera);
    this.gpu.end();
    // renderer.info resets at the start of every render() call, so the world
    // pass has to be sampled here. Reading it after the viewmodel pass only ever
    // reports the gun, which makes a district look free.
    const info = this.renderer.info.render;
    this.worldCalls = info.calls;
    this.worldTriangles = info.triangles;
    if (this.showViewmodel && ctx.viewScene.children.length) {
      this.renderer.clearDepth();
      this.gpu.begin('viewmodel');
      this.renderer.render(ctx.viewScene, ctx.viewCamera);
      this.gpu.end();
    }
    // No post-processing passes are registered; `passes` is empty. Timing an
    // empty pass would report a fabricated zero, so it is simply not measured.
    if (this.gpu.enabled) {
      this.renderer.shadowMap.autoUpdate = true;
      this.gpu.poll();
      this.gpu.closeFrame();
    }
  }

  // A degenerate camera for the shadow-only submission: the shadow map is built
  // from the light's own frusta, so the view camera here only needs to be cheap.
  shadowProbeCamera(source) {
    this.shadowProbe ??= new THREE.PerspectiveCamera(1, 1, 0.05, 0.06);
    this.shadowProbe.position.copy(source.position);
    this.shadowProbe.quaternion.copy(source.quaternion);
    this.shadowProbe.updateMatrixWorld();
    return this.shadowProbe;
  }

  // The camera actually being rendered this frame, so other systems can do
  // camera-relative work (light pooling) without duplicating the shot logic.
  activeCamera(ctx) { return this.useCaptureCamera ? this.captureCamera : ctx.camera; }

  setGpuProfiling(enabled) { return this.gpu.setEnabled(enabled); }
  getGpuReport() { return this.gpu.report(); }

  resize(width, height, ctx) {
    const aspect = width / Math.max(1, height);
    ctx.camera.aspect = aspect;
    ctx.camera.updateProjectionMatrix();
    ctx.viewCamera.aspect = aspect;
    ctx.viewCamera.updateProjectionMatrix();
    this.captureCamera.aspect = aspect;
    this.captureCamera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.screenSize.set(width, height);
  }

  requestEnvironment() {
    return this.ctx.scene.environment;
  }

  registerPass(pass) {
    this.passes.push(pass);
    return () => {
      const index = this.passes.indexOf(pass);
      if (index >= 0) this.passes.splice(index, 1);
    };
  }

  registerLight(light) {
    this.lights.push(light);
    return () => {
      const index = this.lights.indexOf(light);
      if (index >= 0) this.lights.splice(index, 1);
    };
  }

  getMetrics() {
    const info = this.renderer.info;
    return {
      // The world pass is sampled in lateUpdate because renderer.info resets on
      // every render() call; `calls`/`triangles` here describe the viewmodel.
      worldCalls: this.worldCalls ?? null,
      worldTriangles: this.worldTriangles ?? null,
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: Array.isArray(info.programs) ? info.programs.length : null,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    };
  }

  dispose() {
    this.gpu.dispose();
    this.renderer.dispose();
  }
}
