// Production-loop frame instrumentation.
//
// The v2 profiler measures the harness stepping loop: it waits for a rAF, then
// runs a gameplay frame in a promise continuation *after* the callback returns.
// That attributes promise scheduling and vsync misses to the game. This profiler
// measures the real `Engine.start()` loop instead, splitting a frame into the
// phases that can actually be optimised, and samples the JS heap so a garbage
// collection pause is distinguishable from real work.

const RING = 1800;

export class FrameProfiler {
  constructor() {
    this.enabled = false;
    this.systemNames = [];
    this.reset();
  }

  reset() {
    this.count = 0;
    this.index = 0;
    this.frame = new Float32Array(RING);
    this.fixedMs = new Float32Array(RING);
    this.updateMs = new Float32Array(RING);
    this.lateMs = new Float32Array(RING);
    this.idleMs = new Float32Array(RING);
    this.steps = new Uint8Array(RING);
    this.heapMb = new Float32Array(RING);
    this.systemMs = new Map();
    this.marks = [];
  }

  setSystems(names) {
    this.systemNames = names;
    for (const name of names) {
      if (!this.systemMs.has(name)) this.systemMs.set(name, { fixed: 0, update: 0, late: 0 });
    }
  }

  accumulate(name, phase, ms) {
    const entry = this.systemMs.get(name);
    if (entry) entry[phase] += ms;
  }

  record({ frameMs, fixedMs, updateMs, lateMs, steps }) {
    if (!this.enabled) return;
    const i = this.index;
    this.frame[i] = frameMs;
    this.fixedMs[i] = fixedMs;
    this.updateMs[i] = updateMs;
    this.lateMs[i] = lateMs;
    this.idleMs[i] = Math.max(0, frameMs - fixedMs - updateMs - lateMs);
    this.steps[i] = Math.min(255, steps);
    // performance.memory is Chromium-only and coarse, but a sawtooth in used
    // heap aligned with long frames is the signature of a GC pause.
    this.heapMb[i] = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;
    this.index = (i + 1) % RING;
    this.count += 1;
  }

  mark(label) {
    if (!this.enabled) return;
    this.marks.push({ label, frame: this.count });
  }

  series(buffer) {
    const total = Math.min(this.count, RING);
    const out = new Array(total);
    const start = this.count > RING ? this.index : 0;
    for (let i = 0; i < total; i += 1) out[i] = buffer[(start + i) % RING];
    return out;
  }

  static stats(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
    const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
    return {
      count: sorted.length,
      mean: Number(mean.toFixed(3)),
      p50: Number(at(0.5).toFixed(3)),
      p95: Number(at(0.95).toFixed(3)),
      p99: Number(at(0.99).toFixed(3)),
      worst: Number(sorted[sorted.length - 1].toFixed(3)),
    };
  }

  report() {
    const frame = this.series(this.frame);
    const fixed = this.series(this.fixedMs);
    const update = this.series(this.updateMs);
    const late = this.series(this.lateMs);
    const idle = this.series(this.idleMs);
    const heap = this.series(this.heapMb);
    const steps = this.series(this.steps);
    const frames = frame.length;

    // A long frame whose measured CPU work is small is a stall outside our JS:
    // GPU backpressure, compositor, or a GC pause.
    const longIndices = [];
    for (let i = 0; i < frames; i += 1) if (frame[i] > 25) longIndices.push(i);
    const longDetail = longIndices.slice(0, 40).map((i) => ({
      frame: i,
      frameMs: Number(frame[i].toFixed(2)),
      cpuMs: Number((fixed[i] + update[i] + late[i]).toFixed(2)),
      idleMs: Number(idle[i].toFixed(2)),
      steps: steps[i],
      heapDeltaMb: i > 0 ? Number((heap[i] - heap[i - 1]).toFixed(2)) : 0,
    }));
    let heapDrops = 0;
    let heapDropDuringLong = 0;
    for (let i = 1; i < frames; i += 1) {
      if (heap[i] >= heap[i - 1] - 0.5) continue;
      heapDrops += 1;
      if (frame[i] > 25) heapDropDuringLong += 1;
    }
    const perSystem = {};
    const totalFrames = Math.max(1, this.count);
    for (const [name, entry] of this.systemMs) {
      perSystem[name] = {
        fixedMsPerFrame: Number((entry.fixed / totalFrames).toFixed(4)),
        updateMsPerFrame: Number((entry.update / totalFrames).toFixed(4)),
        lateMsPerFrame: Number((entry.late / totalFrames).toFixed(4)),
      };
    }
    return {
      frames,
      frameMs: FrameProfiler.stats(frame),
      cpuMs: FrameProfiler.stats(frame.map((_, i) => fixed[i] + update[i] + late[i])),
      fixedMs: FrameProfiler.stats(fixed),
      updateMs: FrameProfiler.stats(update),
      lateUpdateMs: FrameProfiler.stats(late),
      unaccountedMs: FrameProfiler.stats(idle),
      longFrames: {
        over25ms: longIndices.length,
        over33ms: frame.filter((value) => value > 33.3).length,
        over50ms: frame.filter((value) => value > 50).length,
      },
      // If most long frames carry little CPU work, optimising JS will not help.
      longFrameCpuShare: longIndices.length
        ? Number((longIndices.reduce((total, i) => total + (fixed[i] + update[i] + late[i]) / frame[i], 0) / longIndices.length).toFixed(3))
        : null,
      heap: {
        startMb: Number((heap[0] ?? 0).toFixed(1)),
        endMb: Number((heap[frames - 1] ?? 0).toFixed(1)),
        peakMb: Number(Math.max(0, ...heap).toFixed(1)),
        collections: heapDrops,
        collectionsDuringLongFrames: heapDropDuringLong,
      },
      perSystem,
      longDetail,
      marks: this.marks,
    };
  }
}
