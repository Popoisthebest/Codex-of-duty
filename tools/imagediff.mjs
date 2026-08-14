import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { canonicalShots } from './lib/common.mjs';

const [beforeDir, afterDir] = process.argv.slice(2);

if (!beforeDir || !afterDir) {
  console.error('Usage: node tools/imagediff.mjs <before-dir> <after-dir>');
  process.exit(2);
}

let totalChanged = 0;
let totalPixels = 0;
let worstDelta = 0;
const perShot = [];

for (const shot of canonicalShots) {
  const aPath = path.join(beforeDir, `${shot}.png`);
  const bPath = path.join(afterDir, `${shot}.png`);

  if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) {
    console.error(`Missing comparison file for shot: ${shot}`);
    process.exit(2);
  }

  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));

  if (a.width !== b.width || a.height !== b.height) {
    console.error(`${shot}: dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    process.exit(2);
  }

  let changed = 0;
  let maxDelta = 0;

  for (let i = 0; i < a.data.length; i += 4) {
    let pixelChanged = false;
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d !== 0) pixelChanged = true;
      if (d > maxDelta) maxDelta = d;
    }
    if (pixelChanged) changed += 1;
  }

  const pixels = a.width * a.height;
  totalChanged += changed;
  totalPixels += pixels;
  worstDelta = Math.max(worstDelta, maxDelta);

  perShot.push({
    shot,
    changedPixels: changed,
    totalPixels: pixels,
    changedPercent: (changed / pixels) * 100,
    maxChannelDelta: maxDelta,
  });
}

const report = {
  beforeDir,
  afterDir,
  totalChangedPixels: totalChanged,
  totalPixels,
  changedPercent: totalPixels ? (totalChanged / totalPixels) * 100 : 0,
  worstChannelDelta: worstDelta,
  shots: perShot,
};

console.log(JSON.stringify(report, null, 2));

if (totalChanged !== 0) {
  process.exit(1);
}
