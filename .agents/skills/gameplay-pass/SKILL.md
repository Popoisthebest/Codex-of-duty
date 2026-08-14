---
name: gameplay-pass
description: Use for movement, player camera, weapons, ADS, recoil, reload, ballistics, AI combat, health, damage, or moment-to-moment FPS interaction changes.
---

# Gameplay Pass

1. Translate the request into observable player actions and state transitions.
2. Use `fps_explorer` if more than two subsystems are involved.
3. Implement sequentially through the main agent.
4. Preserve fixed-step gameplay where appropriate.
5. Add deterministic harness scenario support for the changed behavior.
6. Run:
   - `npm run build`
   - `npm run harness:check`
   - `npm run harness:playtest`
7. Ask `gameplay_reviewer` to review nontrivial changes.
8. Ask `verification_auditor` whether the smoke test actually proves the behavior.
9. Repair real findings and rerun all relevant gates.
