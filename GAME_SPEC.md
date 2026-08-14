# Codex of Duty — Game Specification

## Product Goal

브라우저 안에서 실행되는 modern military first-person shooter vertical slice를 만든다.

목표는 특정 상용 게임의 콘텐츠를 복제하는 것이 아니다.
현대 AAA FPS에서 기대하는 반응성, 조작의 무게감, 재료 표현, 조명, 전투 피드백, 공간 밀도와 시스템 통합 수준을 품질 기준으로 삼는다.

## Experiment Constraint

기본 비교 실험 조건:

- WebGL2
- Three.js
- external art asset 없음
- image/model/HDRI/audio 파일 없음
- network runtime fetch 없음
- texture, mesh, animation, environment, sound는 runtime code에서 procedural generation
- runtime dependency는 `three` 하나
- build/test 도구는 devDependency로 허용
- offline gameplay 가능

이 제약은 Codex와 다른 agent harness의 순수 코드 생성 능력을 비교하기 위한 것이다.

## Playable Slice

최종 vertical slice에는 최소 다음이 있어야 한다.

### Player

- WASD movement
- mouse look
- sprint
- crouch
- jump
- lean
- smooth acceleration/deceleration
- head/camera motion that supports gameplay without excessive nausea
- collision-safe movement
- health and damage response

### Weapon

최소 하나의 완성도 높은 rifle을 구현한다.

필수:
- fire
- recoil
- muzzle response
- ADS
- reload
- ammo state
- hit feedback
- ballistic travel or a clearly defined fast projectile model
- surface-aware impact response

총기 시각 표현은 단순 box primitive 조합에서 멈추지 않는다.
실루엣, 재료 분리, mechanical detail, sight picture, hand placement를 반복 개선한다.

### Combat AI

- enemy perception
- navigation
- basic cover/reposition behavior
- aiming/firing
- damage/death
- deterministic-enough harness scenario

AI가 단순히 정지한 target dummy로 보이지 않아야 한다.

### Environment

한 개의 밀도 높은 urban combat block 또는 market/street environment를 만든다.

- indoor/outdoor transition
- cover geometry
- recognizable navigation landmarks
- varied elevation or sightlines
- repeated kit를 숨기는 variation
- collision
- gameplay-readable routes

### Rendering

품질 방향:

- HDR internal lighting pipeline
- stable shadows
- ambient/contact depth cues
- physically plausible PBR ranges
- atmospheric depth
- temporal stability
- bloom/exposure/grade where justified
- high-quality first-person weapon presentation

모든 고급 효과는 실제 frame-time 비용을 측정한다.
효과 자체가 gameplay를 망가뜨리면 품질 향상이 아니다.

### Materials

procedural surface는 최소:
- base color variation
- roughness variation
- normal/height detail
- scale-aware close-range detail

를 가져야 한다.

다양한 concrete, plaster, asphalt, metal, wood, glass, fabric 계열을 제공한다.

### FX

- muzzle flash
- tracer or projectile visualization
- impact particles
- decals
- shell or equivalent weapon feedback
- smoke/dust where appropriate
- damage feedback

모든 action은 시각/오디오/카메라 중 적절한 피드백 조합을 가져야 한다.

### Audio

Web Audio API로 합성한다.

- weapon transient/body/tail
- footsteps
- impacts
- reload/mechanical layer
- environmental space/reverb approximation
- spatialization
- occlusion approximation when practical

외부 audio file은 사용하지 않는다.

### UI

- crosshair
- ammo
- health or damage state
- hit confirmation
- simple compass/minimap or equivalent navigation cue
- kill/engagement feedback
- pause/help controls

## Controls

기본:

```text
WASD      move
Mouse     aim
LMB       fire
RMB       ADS
R         reload
Shift     sprint
Ctrl/C    crouch
Space     jump
Q/E       lean
Esc       release pointer lock / pause
```

실제 구현에서 충돌하면 UI에 표시되는 최종 controls와 일치시킨다.

## Determinism

Harness mode에서는 재현성이 일반 gameplay보다 우선한다.

- seedable RNG 사용
- capture mode에서 wall-clock 기반 animation 금지
- fixed-step 또는 harness frame stepping 지원
- named shot은 동일 seed/state에서 같은 결과를 만들어야 함
- screenshot에 영향을 주는 transient state를 shot 간 공유하지 않음

## Performance

개발 시 성능 기준은 hardware-dependent이므로 절대 FPS 하나만 pass/fail로 고정하지 않는다.

반드시 기록:
- frame time p50
- p95
- p99
- worst frame
- long frames count
- renderer program count when available
- draw calls/triangles when available
- boot-to-ready time

최종 최적화에서는 median보다 hitch와 tail latency를 우선적으로 본다.

## Quality Strategy

순서:

1. functional skeleton
2. tactile gameplay
3. visual hierarchy
4. material/world richness
5. combat readability
6. deterministic capture
7. tail-latency performance
8. adversarial visual review
9. focused repair passes

기능, 그래픽, 성능을 한 번에 무질서하게 수정하지 않는다.
