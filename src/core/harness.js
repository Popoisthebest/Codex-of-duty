export function createHarnessBridge({
  renderer,
  state,
  reset,
  setShot,
  stepFrames,
  snapshot,
}) {
  const params = new URLSearchParams(location.search);
  const harnessMode = params.get('harness') === '1';
  window.__COD_HARNESS_MODE__ = harnessMode;

  const bridge = {
    version: 2,
    ready: false,

    async reset(options = {}) {
      await reset?.(options);
      return bridge.snapshot();
    },

    async setShot(name) {
      await setShot?.(name);
      return bridge.snapshot();
    },

    async stepFrames(count) {
      await stepFrames?.(count);
      return bridge.snapshot();
    },

    snapshot() {
      return snapshot?.() ?? { frame: state?.frame ?? null };
    },

    getMetrics() {
      const info = renderer?.info;
      return {
        calls: info?.render?.calls ?? null,
        triangles: info?.render?.triangles ?? null,
        programs: Array.isArray(info?.programs) ? info.programs.length : null,
        textures: info?.memory?.textures ?? null,
        geometries: info?.memory?.geometries ?? null,
      };
    },
  };

  window.__COD_HARNESS__ = bridge;

  queueMicrotask(async () => {
    if (harnessMode) {
      const seed = Number(params.get('seed') ?? 1337);
      const scenario = params.get('scenario') ?? 'bootstrap';
      const shot = params.get('shot') ?? 'overview';
      await bridge.reset({ seed, scenario });
      await bridge.setShot(shot);
    }
    bridge.ready = true;
    window.dispatchEvent(new CustomEvent('cod:harness-ready'));
  });

  return bridge;
}
