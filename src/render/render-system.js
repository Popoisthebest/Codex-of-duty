import * as THREE from 'three';

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
    this.renderer.render(ctx.scene, camera);
    if (this.showViewmodel && ctx.viewScene.children.length) {
      this.renderer.clearDepth();
      this.renderer.render(ctx.viewScene, ctx.viewCamera);
    }
  }

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
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: Array.isArray(info.programs) ? info.programs.length : null,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    };
  }

  dispose() {
    this.renderer.dispose();
  }
}
