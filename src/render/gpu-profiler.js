// Asynchronous GPU timing via EXT_disjoint_timer_query_webgl2.
//
// CPU frame timing cannot prove GPU cost, and the recent lighting work changed
// shadow coverage substantially (17 m -> 92 m cascade at 4096, plus trim that
// casts again). This measures the GPU side directly.
//
// Rules this obeys:
//   * No gl.finish() / synchronous readback. Queries are polled on later frames.
//   * A GPU_DISJOINT signal invalidates every in-flight sample; disjoint frames
//     are counted and discarded rather than averaged in.
//   * Only one TIME_ELAPSED query may be active at a time, so passes are timed
//     sequentially and never nested.

const MAX_PENDING = 48;
const RING = 900;

class Series {
  constructor() { this.values = new Float32Array(RING); this.count = 0; this.index = 0; }
  push(value) {
    this.values[this.index] = value;
    this.index = (this.index + 1) % RING;
    this.count += 1;
  }
  stats() {
    const total = Math.min(this.count, RING);
    if (!total) return null;
    const start = this.count > RING ? this.index : 0;
    const out = new Array(total);
    for (let i = 0; i < total; i += 1) out[i] = this.values[(start + i) % RING];
    out.sort((a, b) => a - b);
    const at = (p) => out[Math.min(total - 1, Math.max(0, Math.ceil(p * total) - 1))];
    return {
      samples: total,
      mean: Number((out.reduce((sum, value) => sum + value, 0) / total).toFixed(3)),
      p50: Number(at(0.5).toFixed(3)),
      p95: Number(at(0.95).toFixed(3)),
      p99: Number(at(0.99).toFixed(3)),
      worst: Number(out[total - 1].toFixed(3)),
    };
  }
}

export class GpuProfiler {
  constructor(renderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.gl = gl;
    this.ext = null;
    this.supported = false;
    this.reason = 'not initialised';
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      this.reason = 'context is not WebGL2';
      return;
    }
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!this.ext) {
      // Chromium commonly withholds this extension; that is a host capability
      // fact, not a measurement result, so it is reported rather than guessed at.
      this.reason = 'EXT_disjoint_timer_query_webgl2 unavailable';
      return;
    }
    this.supported = true;
    this.reason = 'ok';
    this.free = [];
    this.pending = [];
    this.active = null;
    this.enabled = false;
    this.series = new Map();
    this.frameTotal = 0;
    this.frameHasSample = false;
    this.disjointFrames = 0;
    this.discarded = 0;
    this.completed = 0;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled) && this.supported;
    if (!this.enabled) this.flush();
    else { this.series.clear(); this.disjointFrames = 0; this.discarded = 0; this.completed = 0; }
    return this.enabled;
  }

  obtainQuery() {
    return this.free.pop() ?? this.gl.createQuery();
  }

  begin(label) {
    if (!this.enabled || this.active) return;
    if (this.pending.length >= MAX_PENDING) return;
    const query = this.obtainQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { label, query };
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  // Called once per frame after submission. Results that are not ready yet stay
  // queued; nothing here blocks on the GPU.
  poll() {
    if (!this.enabled) return;
    const { gl } = this;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      // The GPU timer was disturbed (power state change, context switch). Every
      // in-flight measurement is untrustworthy, so all of them are dropped.
      this.disjointFrames += 1;
      this.discarded += this.pending.length;
      for (const entry of this.pending) this.free.push(entry.query);
      this.pending.length = 0;
      this.frameTotal = 0;
      this.frameHasSample = false;
      return;
    }
    let index = 0;
    while (index < this.pending.length) {
      const entry = this.pending[index];
      if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const nanoseconds = gl.getQueryParameter(entry.query, gl.QUERY_RESULT);
      const ms = nanoseconds / 1e6;
      if (!this.series.has(entry.label)) this.series.set(entry.label, new Series());
      this.series.get(entry.label).push(ms);
      this.completed += 1;
      this.free.push(entry.query);
      index += 1;
      // Passes are recorded in submission order, so a frame's total is the sum
      // of its passes. Nested queries are not permitted by the extension.
      if (entry.label === 'frameEnd') {
        this.frameTotal = 0;
        this.frameHasSample = false;
      } else {
        this.frameTotal += ms;
        this.frameHasSample = true;
      }
    }
    if (index) this.pending.splice(0, index);
  }

  // Records the summed per-pass time for a completed frame.
  closeFrame() {
    if (!this.enabled || !this.frameHasSample) return;
    if (!this.series.has('total')) this.series.set('total', new Series());
    this.series.get('total').push(this.frameTotal);
    this.frameTotal = 0;
    this.frameHasSample = false;
  }

  flush() {
    if (this.active) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.free.push(this.active.query); this.active = null; }
    for (const entry of this.pending) this.free.push(entry.query);
    this.pending.length = 0;
    this.frameTotal = 0;
    this.frameHasSample = false;
  }

  report() {
    if (!this.supported) return { supported: false, reason: this.reason };
    const passes = {};
    for (const [label, series] of this.series) passes[label] = series.stats();
    return {
      supported: true,
      enabled: this.enabled,
      passes,
      completedSamples: this.completed,
      disjointFrames: this.disjointFrames,
      discardedSamples: this.discarded,
      note: 'TIME_ELAPSED_EXT cannot nest, so `total` is the sum of the frame\'s passes. Disjoint frames are discarded, never averaged.',
    };
  }

  dispose() {
    this.flush();
    if (!this.supported) return;
    for (const query of this.free) this.gl.deleteQuery(query);
    this.free.length = 0;
  }
}
