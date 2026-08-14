function hashString(value) {
  let hash = 2166136261 >>> 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class DeterministicRng {
  constructor(seed = 1337) {
    this.seed = 0;
    this.state = 0;
    this.setSeed(seed);
  }

  setSeed(seed) {
    const numeric = Number(seed);
    this.seed = Number.isFinite(numeric) ? numeric >>> 0 : 1337;
    this.state = (this.seed ^ 0x9e3779b9) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
    return this;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, maxExclusive) {
    return Math.floor(this.range(min, maxExclusive));
  }

  fork(label) {
    return new DeterministicRng((this.seed ^ hashString(label)) >>> 0);
  }
}
