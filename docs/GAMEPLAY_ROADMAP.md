# Gameplay-first Roadmap

## Phase 0 — Preserve baseline

Before large gameplay changes:
- capture current representative visuals
- record current build/harness status
- record current performance profile if practical

This gives a visual/performance regression reference.

## Phase 1 — Authoritative match state

Implement:
- Team
- Participant/roster identity
- MatchManager
- TDM rules
- score
- clock
- phase
- winner
- restart

No UI-only score state.

## Phase 2 — Actor lifecycle

Implement unified lifecycle:
- alive
- damage
- kill attribution
- death
- respawn timer
- spawn selection
- state reset
- re-entry

Use the same lifecycle for player and bots where practical.

## Phase 3 — 6v6

Scale to:
- player + 5 allies
- 6 enemies

Validate:
- AI ownership
- team target filtering
- performance
- audio/FX density
- kill attribution

## Phase 4 — Map expansion

Do not uniformly scale the existing map.

Build/extend modular combat zones:
1. team-side spawn/deployment zone
2. flank zone A
3. central conflict zone
4. indoor connector
5. flank zone B
6. opposing spawn/deployment zone

Create route loops and reconnectors.

## Phase 5 — Navigation + AI distribution

Add:
- nav representation for full map
- zone goals
- route variation
- anti-stuck
- local combat repositioning
- spawn re-entry

Avoid all bots selecting the same shortest route.

## Phase 6 — Gameplay UI

Implement:
- score + time
- team identity
- kill feed
- death/respawn state
- scoreboard
- victory/defeat
- rematch

## Phase 7 — Harness v3

Implement:
- `getGameplayReport()`
- `runScenario("tdm-core")`
- `runScenario("combat-soak")`

Then:

```bash
npm run gameplay:check
npm run gameplay:map-audit
```

## Phase 8 — Pacing pass

Collect:
- first contact
- respawn-to-contact
- kills by zone
- spawn deaths
- bot stuck events

Fix:
- dead zones
- spawn traps
- permanent kill boxes
- overly long traversal
- fake route choices

## Phase 9 — Performance pass

12 actors + larger map must remain responsive.

Optimize measured bottlenecks only.

## Phase 10 — Full polish

Only after gameplay works:
- animation
- richer character presentation
- second weapon/loadout
- audio layering
- VFX nuance
- material polish
- lighting refinement
- UI motion/presentation
