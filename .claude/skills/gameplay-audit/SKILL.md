---
name: gameplay-audit
description: Independently audit whether the current project is actually a complete replayable game and whether the v3 harness evidence is trustworthy.
---

Do not begin by proposing features.

First collect evidence:
- build
- harness check
- harness playtest
- gameplay check
- map audit
- current screenshots/runtime state
- current implementation and match state

Use:
- `gameplay-director`
- `map-director`
- `ai-director`
- `qa-auditor`

Synthesize the reviews.

Return:
1. PASS/FAIL for complete 6v6 TDM
2. top 3 blockers ordered by gameplay impact
3. exact evidence
4. next single coherent improvement pass

Do not call the game complete because visuals are strong.
