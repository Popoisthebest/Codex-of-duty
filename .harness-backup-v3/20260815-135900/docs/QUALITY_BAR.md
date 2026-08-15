# Codex of Duty — Quality Bar

## Functional Gate

최소한 다음이 실제 browser에서 동작한다.

- player movement
- mouse look
- collision
- fire
- ADS
- reload
- ammo
- enemy engagement
- damage/death
- HUD
- synthesized audio
- restart/reset or deterministic harness reset

## Boot Gate

- `npm run build` pass
- `npm run harness:check` pass
- page error 없음
- unhandled rejection 없음
- harness ready timeout 없음

## Gameplay Gate

`npm run harness:playtest`가 pass한다.

playtest는 최소:
- movement input
- aim/mouse input
- fire
- ADS
- reload
- player state snapshot 변화
- console error

를 검증한다.

## Determinism Gate

같은 baseline command를 연속 두 번 실행했을 때 동일 shot이 동일 pixel 결과를 생성하는 것을 목표로 한다.

재현성이 깨지면:
- RNG
- wall clock
- animation
- exposure
- particles
- asynchronous load timing

을 먼저 조사한다.

## Visual Gate

11개 canonical shots:

1. overview
2. street
3. interior
4. weapon_hip
5. weapon_ads
6. combat
7. enemy
8. material_close
9. lighting
10. fx
11. hud

를 확인한다.

최종 pass에서 다음을 검사한다.

- weapon silhouette/detail
- hand/grip
- material response
- lighting hierarchy
- indirect/contact cue
- environmental density
- repeated pattern
- enemy readability
- particle/decal integration
- HUD polish
- temporal artifact evidence

## Performance Gate

한 번의 FPS 평균 대신 분포를 기록한다.

필수:
- frame ms p50
- frame ms p95
- frame ms p99
- worst frame
- > 33.3 ms frame count
- > 50 ms frame count
- > 100 ms frame count
- renderer programs
- draw calls
- triangles

가능하면 동일 hardware/viewport/DPR에서 before/after 3회 측정한다.

성능 최적화가 visual-neutral이라고 주장하려면 pixel diff gate를 통과한다.

## Architecture Gate

- subsystem 내부 직접 import 위반 없음
- event/interface가 `ARCHITECTURE.md`와 일치
- core contract를 subsystem 임의로 변경하지 않음
- circular hidden dependency 없음
- runtime dependency는 `three`만 유지
- dev tooling dependency는 game runtime bundle에 포함되지 않음

## Resource Gate

- obvious GPU resource leak 없음
- resize 시 render target leak 없음
- repeated reset에서 actor/particle/material이 무한 증가하지 않음
- event listener dispose 고려
- per-frame avoidable allocations가 performance-critical path에 쌓이지 않음

## Honesty Gate

최종 보고에 다음을 숨기지 않는다.

- 검증하지 못한 항목
- flaky capture
- poor performance tail
- visual weakness
- known root cause
- browser/hardware specific limitation

완성도가 목표에 못 미치면 "완료" 대신 현재 수준과 남은 핵심 defect를 보고하고 가장 큰 defect부터 다음 pass를 수행한다.
