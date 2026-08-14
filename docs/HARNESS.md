# Harness Architecture

```text
User prompt
    ↓
Main Codex
    ↓
AGENTS.md
    ↓
Understand + Plan
    ↓
Optional harness_explorer
    ↓
Implementation
    ↓
scripts/verify.sh
    ↓
Runtime / Browser validation
    ↓
Independent read-only reviewers
    ├─ reviewer
    ├─ test_auditor
    └─ ui_reviewer (UI only)
    ↓
Main Codex repairs findings
    ↓
Full verification again
    ↓
Completion gate
```

## 왜 single-writer인가

코드 수정 책임은 기본적으로 main agent 하나에 둡니다.

subagent는 탐색과 검토처럼 read-heavy 작업에 집중합니다. 이렇게 하면 여러 agent가 같은 파일을 동시에 수정할 때 생기는 충돌과 서로 다른 설계 방향의 혼합을 줄일 수 있습니다.

## 역할 분리

### Main Codex
최종 의사결정, 구현, 수정, 검증을 소유합니다.

### harness_explorer
구조 파악과 실행 경로 추적만 수행합니다.

### reviewer
구현을 독립적으로 공격적으로 검토합니다.

### test_auditor
"테스트가 통과한다"와 "기능이 맞다"를 구분합니다.

### ui_reviewer
화면과 interaction의 사용자 관점 문제를 찾습니다.

## 하네스를 프로젝트에 맞추는 가장 좋은 방법

범용 규칙을 계속 늘리기보다 프로젝트가 반복해서 틀리는 지점을 기록합니다.

예:

- 반드시 특정 API client를 재사용해야 함
- DB schema 변경 시 특정 migration 명령 필요
- 시뮬레이션 결과는 특정 tolerance 안이어야 함
- UI는 특정 breakpoint를 반드시 확인해야 함

이런 규칙은 `AGENTS.md` 또는 별도 Skill에 추가합니다.
