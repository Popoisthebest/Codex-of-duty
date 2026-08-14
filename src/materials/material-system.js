import * as THREE from 'three';

const PALETTES = {
  asphalt: ['#353a3b', '#252a2b', '#505554'], concrete: ['#898780', '#696963', '#aaa79d'],
  plasterWarm: ['#a58d72', '#796957', '#c1aa8b'], plasterBlue: ['#587079', '#3d555d', '#789099'],
  brick: ['#815342', '#56382f', '#a26c54'], metal: ['#4d5555', '#252c2e', '#747b79'],
  rust: ['#754d34', '#3d322a', '#a56740'], wood: ['#72563b', '#473723', '#9a7550'],
  fabric: ['#665a43', '#453c2d', '#817156'], tile: ['#7b776b', '#57564f', '#aaa497'],
};

const hash2 = (x, y, seed) => {
  let value = Math.imul(x + seed * 31, 374761393) ^ Math.imul(y + seed * 17, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
};
const smoothNoise = (x, y, scale, seed) => {
  const gx = x / scale; const gy = y / scale; const x0 = Math.floor(gx); const y0 = Math.floor(gy);
  const tx = gx - x0; const ty = gy - y0; const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed); const b = hash2(x0 + 1, y0, seed); const c = hash2(x0, y0 + 1, seed); const d = hash2(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
};
const hexToRgb = (hex) => { const value = Number.parseInt(hex.slice(1), 16); return [(value >> 16) & 255, (value >> 8) & 255, value & 255]; };

export class MaterialSystem {
  static id = 'materials';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx; this.textures = []; this.materials = new Map();
    this.anisotropy = Math.min(8, ctx.get('render').renderer.capabilities.getMaxAnisotropy());
    for (const [name, palette] of Object.entries(PALETTES)) this.createSurface(name, palette);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9bb4b5, roughness: 0.16, metalness: 0.05, transmission: 0.15, transparent: true, opacity: 0.58, thickness: 0.08, envMapIntensity: 0.8 });
    const darkGlass = glass.clone(); darkGlass.color.set(0x16262c); darkGlass.opacity = 0.76;
    this.materials.set('glass', glass);
    this.materials.set('darkGlass', darkGlass);
    this.materials.set('warmWindow', new THREE.MeshStandardMaterial({ color: 0x44372e, emissive: 0xff8a3d, emissiveIntensity: 0.48, roughness: 0.5, metalness: 0.04 }));
    this.materials.set('emissive', new THREE.MeshStandardMaterial({ color: 0x2a4c4c, emissive: 0x6ee9df, emissiveIntensity: 2.8, roughness: 0.35 }));
    this.materials.set('lamp', new THREE.MeshStandardMaterial({ color: 0xffd39a, emissive: 0xff9b3d, emissiveIntensity: 4.5, roughness: 0.3 }));
    this.materials.set('rubber', new THREE.MeshStandardMaterial({ color: 0x171b1a, roughness: 0.82, metalness: 0.02 }));
  }

  createSurface(name, palette) {
    const size = 256;
    const base = document.createElement('canvas'); const detail = document.createElement('canvas');
    base.width = base.height = detail.width = detail.height = size;
    const colorCtx = base.getContext('2d'); const detailCtx = detail.getContext('2d');
    const image = colorCtx.createImageData(size, size); const height = detailCtx.createImageData(size, size); const colors = palette.map(hexToRgb);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4; const broad = smoothNoise(x, y, 52, name.length * 11); const medium = smoothNoise(x, y, 13, name.length * 23); const fine = hash2(x, y, name.length * 29);
      const target = broad < 0.5 ? colors[1] : colors[2]; const blend = Math.abs(broad - 0.5) * 0.46; const variation = (medium - 0.5) * 10 + (fine - 0.5) * 4;
      image.data[i] = Math.max(0, Math.min(255, colors[0][0] + (target[0] - colors[0][0]) * blend + variation)); image.data[i + 1] = Math.max(0, Math.min(255, colors[0][1] + (target[1] - colors[0][1]) * blend + variation)); image.data[i + 2] = Math.max(0, Math.min(255, colors[0][2] + (target[2] - colors[0][2]) * blend + variation)); image.data[i + 3] = 255;
      const h = Math.max(32, Math.min(224, 120 + (medium - 0.5) * 52 + (fine - 0.5) * 24 + (broad - 0.5) * 28)); height.data[i] = height.data[i + 1] = height.data[i + 2] = h; height.data[i + 3] = 255;
    }
    colorCtx.putImageData(image, 0, 0); detailCtx.putImageData(height, 0, 0); this.drawFeatures(name, colorCtx, detailCtx, size);
    const map = new THREE.CanvasTexture(base); map.colorSpace = THREE.SRGBColorSpace; const bump = new THREE.CanvasTexture(detail);
    map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    const repeat = name === 'brick' ? [3, 3] : name === 'wood' ? [2, 4] : name === 'fabric' ? [8, 8] : [4, 4]; map.repeat.set(...repeat); bump.repeat.set(...repeat);
    map.anisotropy = bump.anisotropy = this.anisotropy; this.textures.push(map, bump);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map, bumpMap: bump, bumpScale: name === 'brick' ? 0.075 : name === 'fabric' ? 0.025 : 0.045, roughness: name === 'metal' ? 0.48 : name === 'rust' ? 0.72 : name === 'wood' ? 0.66 : 0.84, roughnessMap: bump, metalness: name === 'metal' ? 0.72 : name === 'rust' ? 0.42 : 0.02, envMapIntensity: name === 'metal' ? 1.15 : 0.72 });
    this.materials.set(name, material);
  }

  drawFeatures(name, colorCtx, detailCtx, size) {
    if (name === 'brick') {
      colorCtx.strokeStyle = 'rgba(35,27,23,.58)'; detailCtx.strokeStyle = '#252525'; colorCtx.lineWidth = detailCtx.lineWidth = 4;
      for (let y = 0; y <= size; y += 32) { colorCtx.beginPath(); colorCtx.moveTo(0, y); colorCtx.lineTo(size, y); colorCtx.stroke(); detailCtx.beginPath(); detailCtx.moveTo(0, y); detailCtx.lineTo(size, y); detailCtx.stroke(); for (let x = (y / 32) % 2 ? 0 : 32; x <= size; x += 64) { colorCtx.beginPath(); colorCtx.moveTo(x, y); colorCtx.lineTo(x, y + 32); colorCtx.stroke(); detailCtx.beginPath(); detailCtx.moveTo(x, y); detailCtx.lineTo(x, y + 32); detailCtx.stroke(); } }
    } else if (name === 'wood') {
      colorCtx.strokeStyle = 'rgba(35,20,10,.32)'; colorCtx.lineWidth = 2; for (let y = 8; y < size; y += 32) { colorCtx.beginPath(); colorCtx.moveTo(0, y); colorCtx.bezierCurveTo(70, y + 8, 150, y - 7, size, y + 2); colorCtx.stroke(); }
    } else if (name === 'metal' || name === 'rust') {
      colorCtx.strokeStyle = 'rgba(210,220,215,.13)'; for (let i = 0; i < 90; i += 1) colorCtx.fillRect(hash2(i, 8, 23) * size, hash2(i, 3, 19) * size, 10 + hash2(i, 5, 7) * 60, 1);
      if (name === 'rust') { colorCtx.fillStyle = 'rgba(73,34,20,.38)'; for (let i = 0; i < 30; i += 1) { colorCtx.beginPath(); colorCtx.arc(hash2(i, 2, 5) * size, hash2(i, 7, 9) * size, 2 + hash2(i, 4, 3) * 12, 0, Math.PI * 2); colorCtx.fill(); } }
    } else if (name === 'asphalt' || name === 'concrete' || name.startsWith('plaster')) {
      colorCtx.strokeStyle = name === 'asphalt' ? 'rgba(12,15,15,.48)' : 'rgba(44,42,38,.25)'; colorCtx.lineWidth = name === 'asphalt' ? 1.35 : 0.7;
      const segments = name === 'asphalt' ? 4 : 3; const reach = name === 'asphalt' ? 13 : 8;
      for (let i = 0; i < 24; i += 1) { let x = hash2(i, 1, 17) * size; let y = hash2(i, 2, 23) * size; colorCtx.beginPath(); colorCtx.moveTo(x, y); for (let s = 0; s < segments; s += 1) { x += (hash2(i, s, 41) - 0.5) * reach; y += 3 + hash2(s, i, 13) * reach; colorCtx.lineTo(x, y); } colorCtx.stroke(); }
    } else if (name === 'fabric') {
      colorCtx.strokeStyle = 'rgba(230,220,185,.13)'; for (let i = 0; i < size; i += 8) { colorCtx.beginPath(); colorCtx.moveTo(i, 0); colorCtx.lineTo(i, size); colorCtx.stroke(); colorCtx.beginPath(); colorCtx.moveTo(0, i); colorCtx.lineTo(size, i); colorCtx.stroke(); }
    } else if (name === 'tile') {
      colorCtx.strokeStyle = 'rgba(35,35,33,.4)'; colorCtx.lineWidth = 3; for (let i = 0; i <= size; i += 64) { colorCtx.beginPath(); colorCtx.moveTo(i, 0); colorCtx.lineTo(i, size); colorCtx.stroke(); colorCtx.beginPath(); colorCtx.moveTo(0, i); colorCtx.lineTo(size, i); colorCtx.stroke(); }
    }
  }

  get(name) { const material = this.materials.get(name); if (!material) throw new Error(`Unknown procedural material: ${name}`); return material; }

  createSign(text, background = '#18383a', foreground = '#d8e9df') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const context = canvas.getContext('2d');
    context.fillStyle = background; context.fillRect(0, 0, 512, 128); context.strokeStyle = 'rgba(255,255,255,.25)'; context.lineWidth = 6; context.strokeRect(7, 7, 498, 114);
    context.fillStyle = foreground; context.font = '800 52px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 64);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = this.anisotropy; this.textures.push(texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: new THREE.Color(background).multiplyScalar(0.35), emissiveIntensity: 0.55, roughness: 0.58 }); this.materials.set(`sign:${text}`, material); return material;
  }

  dispose() { for (const material of this.materials.values()) material.dispose(); for (const texture of this.textures) texture.dispose(); }
}
