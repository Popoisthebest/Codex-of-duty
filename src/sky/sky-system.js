import * as THREE from 'three';

export class SkySystem {
  static id = 'sky';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx; this.resources = [];
    const skyGeometry = new THREE.SphereGeometry(180, 32, 18);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, toneMapped: true,
      uniforms: { topColor: { value: new THREE.Color(0x193b61) }, horizonColor: { value: new THREE.Color(0x737d8e) }, lowerColor: { value: new THREE.Color(0x273b49) }, sunDirection: { value: new THREE.Vector3(-0.55, 0.42, -0.72).normalize() }, sunColor: { value: new THREE.Color(0xffd4a0) } },
      vertexShader: `varying vec3 vWorld; void main(){ vec4 world=modelMatrix*vec4(position,1.0); vWorld=normalize(world.xyz-cameraPosition); gl_Position=projectionMatrix*viewMatrix*world; }`,
      fragmentShader: `varying vec3 vWorld; uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 lowerColor; uniform vec3 sunDirection; uniform vec3 sunColor; void main(){ float h=vWorld.y; float skyMix=smoothstep(-0.02,0.5,h); vec3 color=mix(horizonColor,topColor,skyMix); color=mix(lowerColor,color,smoothstep(-0.2,0.035,h)); float sun=max(dot(vWorld,sunDirection),0.0); color+=sunColor*pow(sun,900.0)*7.0+sunColor*pow(sun,24.0)*0.11; float band=exp(-abs(h)*15.0); color+=vec3(0.06,0.025,0.018)*band; gl_FragColor=vec4(color,1.0); }`,
    });
    this.sky = new THREE.Mesh(skyGeometry, skyMaterial); this.sky.renderOrder = -1000; ctx.scene.add(this.sky); this.resources.push(skyGeometry, skyMaterial);
    this.hemi = new THREE.HemisphereLight(0x9abed7, 0x352a22, 1.52); ctx.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd3a0, 3.55); this.sun.position.set(-18, 24, -12); this.sun.target.position.set(0, 0, -3); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.left = -22; this.sun.shadow.camera.right = 22; this.sun.shadow.camera.top = 24; this.sun.shadow.camera.bottom = -18; this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 70; this.sun.shadow.bias = -0.00028; this.sun.shadow.normalBias = 0.035;
    ctx.scene.add(this.sun, this.sun.target);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128; const context = canvas.getContext('2d'); const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, '#142d45'); gradient.addColorStop(0.52, '#596c76'); gradient.addColorStop(0.72, '#d18a5d'); gradient.addColorStop(1, '#2c3030'); context.fillStyle = gradient; context.fillRect(0, 0, 256, 128);
    const env = new THREE.CanvasTexture(canvas); env.mapping = THREE.EquirectangularReflectionMapping; env.colorSpace = THREE.SRGBColorSpace; ctx.scene.environment = env; ctx.viewScene.environment = env; ctx.scene.environmentIntensity = 0.7; ctx.viewScene.environmentIntensity = 0.8; ctx.scene.fog = new THREE.FogExp2(0x354957, 0.027); this.resources.push(env);
  }

  update() { this.sky.position.copy(this.ctx.camera.position); }
  dispose() {
    this.ctx.scene.remove(this.sky, this.hemi, this.sun, this.sun.target);
    this.ctx.scene.environment = null;
    this.ctx.viewScene.environment = null;
    this.ctx.scene.fog = null;
    for (const resource of this.resources) resource.dispose?.();
  }
}
