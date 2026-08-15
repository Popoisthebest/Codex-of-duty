# Codex of Duty — Agent Operating Manual

## Mission

`GAME_SPEC.md`를 만족하는 높은 완성도의 browser FPS를 구축한다.

작업 완료는 코드량, 파일 수, build 성공이 아니라 실제 gameplay, visual evidence, reproducibility, performance evidence로 판단한다.

반드시 먼저 읽는다:

1. `ARCHITECTURE.md`
2. `GAME_SPEC.md`
3. `docs/QUALITY_BAR.md`
4. 관련 source/tests/tools

## Core Strategy

### Sequential ownership for coupled work

render, sky, material response, exposure, world lighting, viewmodel lighting처럼 서로 강하게 결합된 영역은 여러 agent가 병렬로 수정하지 않는다.

Main agent가 하나의 concern을 끝까지 소유해:

```text
measure
→ hypothesis
→ change
→ capture
→ measure
→ decide
```

순서로 진행한다.

### Parallelize read-heavy work

다음은 병렬 subagent 사용이 적합하다.

- architecture exploration
- visual criticism
- performance report analysis
- verification audit
- gameplay flaw review

코드 writer는 기본적으로 main agent 하나다.

## Work Modes

요청을 다음 중 하나로 분류한다.

- foundation
- gameplay
- rendering
- visual polish
- performance
- bug fix
- verification
- final pass

한 pass 안에서 목적을 과도하게 섞지 않는다.

## Required Development Loop

### 1. Inspect

- 현재 repo status 확인
- architecture contract 읽기
- 관련 subsystem 경로 확인
- 기존 tools와 harness 상태 확인
- 필요한 경우 `fps_explorer` 사용

### 2. Define acceptance

사용자 요청을 observable outcome으로 변환한다.

예:

```text
"총 느낌을 더 좋게"
```

를 바로 코딩하지 않는다.

다음처럼 분해한다.

```text
- ADS sight picture 안정
- recoil recovery 명확
- muzzle transient readable
- reload state와 ammo state 일치
- weapon/world luminance imbalance 없음
```

### 3. Implement

- 가장 작은 complete vertical change
- architecture boundary 유지
- temporary placeholder가 최종 path에 남지 않음
- 외부 art asset 금지
- runtime dependency 추가 금지
- deterministic harness를 깨뜨리지 않음

### 4. Build

항상:

```bash
npm run build
```

실패하면 다음 단계로 가지 않는다.

### 5. Harness contract

```bash
npm run harness:check
```

`window.__COD_HARNESS__`가 정상인지 확인한다.

### 6. Gameplay smoke test

gameplay 관련 변경:

```bash
npm run harness:playtest
```

사용자 입력, movement, fire, ADS, reload, console/runtime failure를 확인한다.

### 7. Visual capture

visual 변경:

```bash
npm run harness:baseline
```

또는 빠른 review:

```bash
npm run harness:shotset
```

실제 screenshot을 직접 열어 확인한다.

"코드상 좋아 보인다"는 visual verification이 아니다.

### 8. Visual critic

중요 visual pass에는 `visual_critic`을 사용한다.

critic에게 솔루션을 강제로 따르지 않는다.
critic의 지적을 현상으로 취급하고 main agent가 root cause를 다시 측정한다.

### 9. Performance

render/world/AI/physics/FX 변경 후 성능 위험이 있으면:

```bash
npm run harness:profile
```

median FPS 하나로 판단하지 않는다.

반드시:
- frame ms p50
- p95
- p99
- worst
- long frames
- program count 변화
- draw calls
- triangles

를 본다.

`performance_analyst`에게 측정 결과를 분석시킬 수 있다.

### 10. Diff gate

성능 최적화나 refactor가 "시각 결과를 바꾸면 안 되는" 작업이라면:

```bash
npm run harness:diff -- <before-dir> <after-dir>
```

pixel 변화가 있으면 최적화가 pixel-neutral이라는 주장을 하지 않는다.

### 11. Independent audit

큰 변경 후:
- `gameplay_reviewer`
- `verification_auditor`

필요 시:
- `visual_critic`
- `performance_analyst`
- `architecture_reviewer`

를 사용한다.

### 12. Repair

실제 finding을 main agent가 수정한다.

수정 후 affected test만 돌리고 끝내지 않는다.
최종적으로 전체 relevant gate를 다시 실행한다.

## Root-Cause Rule

reviewer가 해결책을 제안해도 사실로 취급하지 않는다.

예:

```text
weapon이 flat하다
```

라는 현상에 대해 곧바로 texture contrast를 높이지 않는다.

가능한 원인:
- lighting energy imbalance
- roughness
- F0/specular dominance
- exposure
- normal scale
- viewmodel composite
- actual texture detail

를 측정해서 root cause를 찾는다.

brief와 반대되는 수정이 맞을 수 있다.

## Performance Rules

- hot path allocation 최소화
- shader compile during play 추적
- draw call 증가를 측정
- triangle 증가는 근거가 있어야 함
- 큰 effect는 quality preset budget 안에서 구현
- p99/worst frame 악화가 큰 경우 평균 FPS 개선만으로 성공 판정 금지
- mobile optimization보다 우선 target은 desktop browser이지만 catastrophic scaling을 만들지 않음

## Visual Rules

- flat primitive look 금지
- 모든 주요 surface는 material variation을 가짐
- repetition 숨기기
- edge/crevice/weathering detail
- readable key light + fill/bounce approximation + contact cue
- physically implausible albedo로 lighting bug를 보정하지 않음
- weapon은 화면에서 가장 오래 보이는 object이므로 특별히 높은 품질 기준 적용
- hands/grip silhouette는 close shot에서 별도 검토
- VFX가 world material/lighting을 덮어 버리지 않게 함

## Gameplay Rules

- input latency를 불필요하게 추가하지 않음
- camera effect가 aim을 망가뜨리지 않음
- movement state transition이 명확
- ammo/reload/fire state race 방지
- hitmarker는 실제 player/enemy damage semantic과 일치
- AI의 combat action은 플레이어에게 readable해야 함
- enemy death와 physics/visual state가 분리되어 유령 collider를 남기지 않음

## Determinism Rules

Harness mode:
- `Math.random()` 금지
- wall clock visual state 금지
- named shot마다 fresh reset
- capture마다 같은 seed
- `stepFrames`로 settle
- baseline shot끼리 state 공유 금지

일반 gameplay mode는 실시간 실행이 가능하지만 harness mode contract를 절대 깨지 않는다.

## Subagents

### `fps_explorer`
읽기 전용으로 execution path와 coupling을 파악한다.

### `architecture_reviewer`
contract violation과 hidden coupling을 찾는다.

### `gameplay_reviewer`
movement, weapon, AI, combat state bug를 검토한다.

### `visual_critic`
screenshot evidence를 기준으로 adversarial visual critique를 한다.

### `performance_analyst`
profile 숫자와 hitch 원인을 분석한다.

### `verification_auditor`
테스트와 harness가 실제 요구를 증명하는지 확인한다.

## Completion Gate

`docs/QUALITY_BAR.md`를 따른다.

최종 답변에는:
- 구현한 것
- 실제 실행한 gate
- 성능 측정값
- visual/runtime 확인 여부
- 남은 known limitation

만 간결하게 보고한다.

실행하지 않은 검증을 실행했다고 말하지 않는다.
