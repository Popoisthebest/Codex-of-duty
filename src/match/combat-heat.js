// Where fighting has recently happened.
//
// Tactical position value previously used geometry alone: a rooftop overlooking
// an empty corner scored exactly as well as one overlooking the market. This
// supplies the missing term — expected enemy presence — without giving anyone
// omniscient knowledge.
//
// It is deliberately a record of *observable* events, not of enemy positions:
//   * a shot was fired here
//   * someone died here
//   * someone was seen here
//
// All three are things a player learns from gunfire, the kill feed and their own
// eyes. Nothing writes heat for an enemy that has not done something noticeable,
// so a bot can never read an unseen opponent's location off this field. Heat
// decays continuously, so it describes where the fight *is*, not where it was
// five minutes ago.

const CELL = 10;

export class CombatHeat {
  constructor(bounds, halfLifeSeconds = 12) {
    this.bounds = bounds;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 1;
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL) + 1;
    this.grid = new Float32Array(this.cols * this.rows);
    // Continuous exponential decay: heat halves every `halfLifeSeconds`.
    this.decayPerSecond = Math.log(2) / halfLifeSeconds;
    this.peak = 1;
  }

  reset() {
    this.grid.fill(0);
    this.peak = 1;
  }

  index(x, z) {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.bounds.minX) / CELL)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.bounds.minZ) / CELL)));
    return row * this.cols + col;
  }

  add(x, z, amount) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const value = this.grid[this.index(x, z)] + amount;
    this.grid[this.index(x, z)] = value;
    if (value > this.peak) this.peak = value;
  }

  decay(step) {
    const factor = Math.exp(-this.decayPerSecond * step);
    for (let i = 0; i < this.grid.length; i += 1) this.grid[i] *= factor;
    this.peak = Math.max(1, this.peak * factor);
  }

  at(x, z) { return this.grid[this.index(x, z)]; }

  // Heat within a radius, normalised to 0..1 against the current peak so the
  // value stays comparable as a match heats up or cools down.
  around(x, z, radius = 20) {
    const span = Math.ceil(radius / CELL);
    const col = Math.floor((x - this.bounds.minX) / CELL);
    const row = Math.floor((z - this.bounds.minZ) / CELL);
    let total = 0;
    for (let dr = -span; dr <= span; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= this.rows) continue;
      for (let dc = -span; dc <= span; dc += 1) {
        const c = col + dc;
        if (c < 0 || c >= this.cols) continue;
        // Nearer cells count for more; this is a soft field, not a lookup.
        total += this.grid[r * this.cols + c] / (1 + Math.hypot(dc, dr));
      }
    }
    return Math.min(1, total / Math.max(1, this.peak * 2));
  }

  // Debug/telemetry view: the hottest cells, in world coordinates.
  hotspots(limit = 6) {
    const entries = [];
    for (let i = 0; i < this.grid.length; i += 1) {
      if (this.grid[i] <= 0.01) continue;
      entries.push({
        x: Number((this.bounds.minX + (i % this.cols) * CELL + CELL / 2).toFixed(1)),
        z: Number((this.bounds.minZ + Math.floor(i / this.cols) * CELL + CELL / 2).toFixed(1)),
        heat: Number(this.grid[i].toFixed(2)),
      });
    }
    entries.sort((a, b) => b.heat - a.heat);
    return entries.slice(0, limit);
  }
}
