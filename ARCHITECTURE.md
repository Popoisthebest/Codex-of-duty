# Codex of Duty — Engine Contract

모든 agent는 구현 전에 이 파일을 읽는다.

이 문서는 subsystem 경계, 공유 상태, event vocabulary, deterministic harness contract의 source of truth다.

## Global Rules

1. Main agent가 최종 writer다.
2. Subagent는 명시적으로 write ownership을 받은 경우를 제외하면 read-only다.
3. subsystem끼리 상대 subsystem의 내부 파일을 직접 import하지 않는다.
4. 공유 기능은 `ctx.get(id)` 또는 canonical event를 통해 연결한다.
5. gameplay와 capture에 `Math.random()`을 사용하지 않는다. `ctx.rng`를 사용한다.
6. fixed update가 필요한 gameplay state를 render delta에 묶지 않는다.
7. harness capture mode에서 `performance.now()` 또는 wall clock이 visual state를 바꾸지 않는다.
8. hot update loop에서 불필요한 object allocation을 만들지 않는다.
9. GPU resource를 생성한 subsystem이 dispose 책임을 가진다.
10. quality budget를 무시한 effect 추가를 금지한다.
11. 다른 subsystem contract가 필요하면 먼저 이 파일의 contract를 갱신한다.
12. coupling이 높은 render/material/sky/light 변화는 sequential pass로 다룬다.

## Runtime Context

권장 context:

```js
ctx = {
  scene,
  camera,
  viewScene,
  viewCamera,
  canvas,
  config,
  events,
  input,
  time,
  rng,
  get(id),
  peek(id),
  has(id),
  harness,
}
```

### Time

```js
ctx.time = {
  elapsed,
  dt,
  fixed,
  alpha,
  frame,
  scale,
}
```

gameplay simulation은 fixed step을 기본으로 한다.

## System Interface

각 subsystem은 다음 shape을 따른다.

```js
export class ExampleSystem {
  static id = 'example';
  static deps = [];

  async init(ctx) {}
  fixedUpdate(step, ctx) {}
  update(dt, ctx) {}
  lateUpdate(dt, ctx) {}
  resize(width, height, ctx) {}
  dispose() {}
}
```

필요 없는 method는 생략 가능하다.

## Ownership

| id | directory | responsibility |
|---|---|---|
| core | `src/core/` | engine loop, context, event bus, RNG, config, harness bridge |
| render | `src/render/` | renderer, render targets, shadows, post-processing, final composite |
| materials | `src/materials/` | procedural PBR textures/material library |
| sky | `src/sky/` | sky, sun/moon, environment lighting, fog/atmosphere |
| world | `src/world/` | level kit, props, static scene, static collision source |
| physics | `src/physics/` | collision, ray queries, dynamic bodies, projectile collision |
| player | `src/player/` | movement state, camera, health |
| weapons | `src/weapons/` | viewmodel, weapon state, recoil, reload, ballistics requests |
| fx | `src/fx/` | particles, decals, muzzle/impact/tracer visual effects |
| ai | `src/ai/` | actors, navigation, perception, combat decisions |
| ui | `src/ui/` | HUD, menus, help, overlays |
| audio | `src/audio/` | Web Audio synthesis, spatialization, mix |

`src/core/`와 tool contract 변경은 main agent가 직접 소유한다.

## Cross-System Access

금지:

```js
import { something } from '../physics/internal.js';
```

권장:

```js
const physics = ctx.get('physics');
physics.raycast(...);
```

또는:

```js
ctx.events.emit('combat:shot', payload);
```

## Canonical Events

payload는 plain object를 기본으로 한다.

| event | producer | purpose |
|---|---|---|
| `weapon:fired` | weapons | shot created |
| `weapon:reload` | weapons | reload phase/state |
| `weapon:dryfire` | weapons | empty trigger feedback |
| `projectile:impact` | physics | world/actor impact |
| `combat:damage` | physics/ai | damage request/result |
| `combat:hit` | ai | confirmed enemy damage semantic |
| `ai:fired` | ai | enemy shot feedback request |
| `actor:died` | ai/player | actor death |
| `player:landed` | player | landing feedback |
| `player:footstep` | player | surface footstep |
| `player:state` | player | health, pose, stance, sprint and grounded state |
| `fx:explosion` | gameplay system | explosion request |
| `game:ready` | core | harness-visible ready point |
| `game:reset` | core | deterministic scenario reset |
| `game:pause-changed` | ui | pointer-lock gameplay pause state |
| `game:restart-request` | ui | player-requested deterministic redeploy |

새 cross-system event를 만들면 이 표를 함께 갱신한다.

`weapons` requests an `instant-hitscan-with-tracer` projectile model from
`physics`: damage and impact resolve immediately at the fixed-step shot time,
while `fx` renders the short-lived tracer as feedback. Event vector fields are
plain `{ x, y, z }` objects rather than engine-class instances.

## Surface Vocabulary

공통 surface tag:

```text
concrete
tile
plaster
brick
metal
wood
glass
asphalt
dirt
sand
fabric
rubber
water
foliage
flesh
```

physics impact, material, footstep, impact FX, audio가 동일 vocabulary를 사용한다.

## Render Contract

`render`가 최소 제공:

```js
const render = ctx.get('render');

render.renderer
render.screenSize
render.depthTexture
render.velocityTexture
render.requestEnvironment()
render.registerPass(pass)
render.registerLight(light)
render.getMetrics()
```

다른 subsystem은 renderer global state를 frame 중 임의 변경하지 않는다.

## Viewmodel

first-person weapon은 world camera near clipping을 피하기 위해 별도 view scene 또는 동등한 안정적 방법을 사용할 수 있다.

world와 viewmodel의 exposure/light energy가 크게 분리되지 않도록 측정한다.
무기 albedo를 비물리적으로 어둡게 만들어 lighting bug를 숨기지 않는다.

## RNG

`src/core/rng.js`는 seedable deterministic generator를 제공한다.

subsystem별 stream이 필요하면:

```js
const rng = ctx.rng.fork('fx');
```

같은 seed와 같은 simulation steps에서는 같은 결과가 나와야 한다.

## Harness Contract

페이지가 harness mode로 실행되면:

```text
?harness=1&seed=1337
```

전역에 다음 object가 존재해야 한다.

```js
window.__COD_HARNESS__
```

필수 API:

```js
{
  version: 2,
  ready: boolean,

  reset({ seed, scenario }),
  setShot(name),
  stepFrames(count),
  snapshot(),
  getMetrics(),
}
```

### reset

동일 seed/scenario에서 deterministic state를 복원한다.

### setShot

named camera/game state를 구성한다.

필수 named shots:

```text
overview
street
interior
weapon_hip
weapon_ads
combat
enemy
material_close
lighting
fx
hud
```

### stepFrames

capture mode에서는 요청된 simulation frame만큼 진행한 뒤 deterministic하게 settle한다.

### snapshot

최소:

```js
{
  frame,
  player,
  weapon,
  enemiesAlive,
  scenario,
}
```

### getMetrics

가능한 경우:

```js
{
  calls,
  triangles,
  programs,
  textures,
  geometries,
}
```

값을 제공한다.

지원하지 않는 metric은 `null`이어도 된다.

## Harness Readiness

`ready = true`는 다음 이후에만 설정한다.

- renderer initialized
- world available
- player spawned
- core shader/material prewarm 완료 또는 의도적으로 생략됨
- named harness scenario를 받을 수 있음

## Per-Frame Allocation

성능 민감 update에서 다음 패턴을 피한다.

```js
update() {
  const v = new THREE.Vector3();
}
```

scratch object를 init 시 만들고 재사용한다.

실제 bottleneck 여부는 profiler로 확인한다.

## Shader/Program Stability

gameplay 중 shader/program permutation이 반복적으로 새로 생기면 hitch 원인이 될 수 있다.

가능한 경우:
- known material variants prewarm
- light count를 program key가 요동치지 않게 설계
- quality switching은 gameplay 중 무분별하게 하지 않음

최적화 전후 visual output이 동일해야 하는 변경은 pixel diff로 증명한다.

## Architecture Change Rule

새 기능이 contract를 요구하면:

1. 문제를 정의
2. 최소 interface를 이 문서에 추가
3. producer/consumer를 명확히 함
4. 구현
5. build + harness 검증

암묵적인 cross-directory dependency를 만들지 않는다.
