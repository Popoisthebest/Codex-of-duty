# First Prompt

아래 내용을 Codex에 한 번에 입력한다.

---

이 프로젝트를 `GAME_SPEC.md`에 정의된 현대 군사 브라우저 FPS로 완성해줘.

작업을 시작하기 전에 `AGENTS.md`, `ARCHITECTURE.md`, `GAME_SPEC.md`, `docs/QUALITY_BAR.md`, 현재 코드와 tools contract를 모두 읽어라.

목표는 단순한 데모가 아니라 플레이 가능한 vertical slice다. 이동, 시점 조작, 발사, ADS, 재장전, 적 AI, 충돌, 전투 피드백, HUD, 합성 오디오, procedural environment가 서로 연결되어 실제 게임처럼 동작해야 한다.

기본 실험 조건은 external art asset 없이 코드로 생성하는 방식이며 runtime dependency는 Three.js만 유지한다.

한 번에 많은 subsystem을 병렬 수정하지 마라. 강하게 결합된 관심사는 main agent가 sequential single-owner 방식으로 구현한다. subagent는 코드베이스 탐색, 독립 리뷰, 시각 비평, 테스트 감사, 성능 결과 해석처럼 충돌 위험이 낮은 작업에 사용한다.

각 주요 milestone마다 실제로 실행하고 검증하라. 최소한 다음을 사용한다.

- `npm run build`
- `npm run harness:check`
- `npm run harness:playtest`
- `npm run harness:baseline`
- `npm run harness:profile`

UI나 그래픽이 바뀌면 capture를 직접 확인하고, 시각 변경을 의도하지 않은 최적화에는 pixel diff를 사용하라.

평균 FPS 하나로 성능을 판단하지 말고 p50, p95, p99 frame time과 worst frame을 함께 본다. shader/program compilation이나 큰 hitch가 gameplay 중 발생하면 원인을 찾아 제거한다.

문제가 발견되면 나에게 넘기지 말고 합리적으로 해결 가능한 범위에서는 직접 원인을 분석하고 수정한 뒤 전체 검증을 반복한다.

`docs/QUALITY_BAR.md`의 completion gate를 만족할 때까지 작업을 계속하라.

최종 답변에는 구현 내용, 실제로 실행한 검증, 성능 측정 결과, 남아 있는 한계를 사실대로 짧게 보고하라.
