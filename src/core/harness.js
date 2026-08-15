export function createHarnessBridge({
  renderer,
  state,
  reset,
  setShot,
  stepFrames,
  snapshot,
  runAction,
  getGameplayReport,
  worldMetrics,
  runScenario,
  stagePlayerView,
  enterMatchMode,
  listShots,
  listScenarios,
  onReady,
  bootstrap,
}) {
  const params = new URLSearchParams(location.search);
  const harnessMode = params.get('harness') === '1';
  window.__COD_HARNESS_MODE__ = harnessMode;

  let sequence = Promise.resolve();
  const serialize = (operation) => {
    const current = sequence.then(operation, operation);
    sequence = current.catch(() => {});
    return current;
  };

  const bridge = {
    version: 2,
    ready: false,

    async reset(options = {}) {
      return serialize(async () => {
        await reset?.({ seed: options.seed, scenario: options.scenario });
        return bridge.snapshot();
      });
    },

    async setShot(name) {
      return serialize(async () => {
        await setShot?.(name);
        return bridge.snapshot();
      });
    },

    async stepFrames(count) {
      return serialize(async () => {
        await stepFrames?.(count);
        return bridge.snapshot();
      });
    },

    snapshot() {
      return snapshot?.() ?? { frame: state?.frame ?? null };
    },

    getMetrics() {
      const info = renderer?.info;
      return {
        // World-pass counts come from the render system, which samples them
        // before the viewmodel pass overwrites renderer.info.
        ...(worldMetrics?.() ?? {}),
        calls: info?.render?.calls ?? null,
        triangles: info?.render?.triangles ?? null,
        programs: Array.isArray(info?.programs) ? info.programs.length : null,
        textures: info?.memory?.textures ?? null,
        geometries: info?.memory?.geometries ?? null,
      };
    },

    async runAction(name, options = {}) {
      return serialize(async () => {
        const result = await runAction?.(name, options);
        return result ?? bridge.snapshot();
      });
    },

    // v3 gameplay contract. The bridge stays at version 2 so existing v2 tools
    // keep working; the gameplay report carries its own version.
    getGameplayReport() {
      return getGameplayReport?.() ?? null;
    },

    async runScenario(name, options = {}) {
      return serialize(async () => runScenario?.(name, options));
    },

    stagePlayerView(options = {}) {
      return stagePlayerView?.(options) ?? null;
    },

    async enterMatchMode() {
      return serialize(async () => enterMatchMode?.() ?? null);
    },

    listShots() {
      return listShots?.() ?? [];
    },

    listScenarios() {
      return listScenarios?.() ?? ['default'];
    },
  };

  window.__COD_HARNESS__ = bridge;

  queueMicrotask(async () => {
    if (harnessMode) {
      const seed = Number(params.get('seed') ?? 1337);
      const scenario = params.get('scenario') ?? 'bootstrap';
      const shot = params.get('shot') ?? 'overview';
      if (bootstrap) await bootstrap({ seed, scenario, shot });
      else {
        await bridge.reset({ seed, scenario });
        await bridge.setShot(shot);
      }
    }
    bridge.ready = true;
    await onReady?.();
    window.dispatchEvent(new CustomEvent('cod:harness-ready'));
  });

  return bridge;
}
