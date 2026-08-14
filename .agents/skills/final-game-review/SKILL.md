---
name: final-game-review
description: Use before declaring the FPS vertical slice complete, before publishing a benchmark result, or after a large multi-subsystem development run.
---

# Final Game Review

Run in this order:

1. `git diff` / repository change audit.
2. `npm run build`.
3. `npm run harness:check`.
4. `npm run harness:playtest`.
5. `npm run harness:baseline`.
6. Run a second baseline in a separate output directory and prove reproducibility.
7. Open all canonical shots.
8. Use `visual_critic`.
9. Run `npm run harness:profile` at least 3 times for final reporting when time permits.
10. Use `performance_analyst`.
11. Use `gameplay_reviewer`.
12. Use `architecture_reviewer`.
13. Use `verification_auditor`.
14. Group findings by root cause.
15. Main agent fixes blocker/high-impact issues sequentially.
16. Repeat affected gates.
17. Run final build/playtest after the last code change.

Final report must distinguish:
- measured fact,
- reviewer judgement,
- known limitation.
