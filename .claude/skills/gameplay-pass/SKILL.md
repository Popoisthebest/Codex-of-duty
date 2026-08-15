---
name: gameplay-pass
description: Run one coherent gameplay improvement pass from evidence to implementation and verification.
---

Execute one coherent gameplay improvement pass.

1. Read the current gameplay quality bar and relevant architecture.
2. Inspect actual current behavior and existing evidence.
3. Ask `gameplay-director` for an independent highest-impact finding when useful.
4. Choose one tightly related gameplay problem.
5. Define observable acceptance criteria.
6. Implement with a coherent main owner.
7. Run:
   - `npm run build`
   - `npm run harness:check`
   - `npm run harness:playtest`
   - `npm run gameplay:check` when relevant
8. Actually run/inspect the game.
9. Ask independent review.
10. Repair failures.
11. Do not stop on a red relevant gate.

Do not spend the pass on cosmetic polish unless gameplay gates are already green.
