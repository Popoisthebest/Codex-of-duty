# Gameplay v3 Status — 6v6 TDM vertical slice

Measured on the build at the time of writing. Every number here came from a tool
in `tools/`, not from reading code.

## Gates

| Command | Result |
|---|---|
| `npm run build` | pass |
| `npm run harness:physics` | pass |
| `npm run harness:check` | pass |
| `npm run harness:playtest` | pass (harness block + normal-mode block) |
| `npm run gameplay:check` | pass (`tdm-core`) |
| `npm run gameplay:map-audit` | pass |

## Map report (measured, not declared)

`playableAreaM2` is a 1 m occupancy sample of actually standable surface;
`playableWidthM`/`playableDepthM` are the extent of those cells. `routeLoops` is
the cyclomatic number of the zone-adjacency graph, and every edge in that graph
is a built opening.

| Metric | Value | Floor |
|---|---|---|
| playableWidthM | 97 | 80 |
| playableDepthM | 99 | 80 |
| playableAreaM2 | 7776 | 7000 |
| zones | 9 | 5 |
| primaryRoutes | 3 | 3 |
| routeLoops | 6 | 2 |
| verticalLevels | 5 | 2 |
| spawnPoints | 34 | 12 |
| landmarks | 13 | 4 |
| indoorZones | 3 | 2 |
| outdoorZones | 6 | 2 |
| indoorOutdoorTransitions | 21 | 2 |

Supporting: 1543 reachable nav nodes, 443 colliders, 230 post-merge world meshes.

## Pacing (120 s `combat-soak`, 12 participants)

| Metric | Value |
|---|---|
| kills / deaths / respawns | 31 / 31 / 31 |
| firstContactSeconds | 2.1 |
| averageRespawnToContactSeconds | 5.7 |
| spawnDeaths | 4 of 31 (13%) |
| maxStuckSeconds | 1.18 |
| stuckRecoveries | 33 |
| killsByZone | market 6, north-junction 10, east-terrace 5, west-yard 5, bravo-yard 4, alpha-yard 1 |

Kills land in six of nine zones with no zone above ~32%, so there is no single
kill box. At this rate a 100-kill match runs roughly 6–7 minutes, inside the
10-minute limit, so matches normally end on the score limit.

`averageRespawnToContactSeconds` counts only the **first** acquisition of each
life. It previously counted every acquisition, which folded long survivals into
the average and reported ~25 s for what is really ~6 s.

## Performance

1280x720, headless Chromium, 900 frames across sprint / ADS-fire / reload /
AI-only phases.

| Metric | Value |
|---|---|
| frame p50 | 16.7 ms (60 fps) |
| frame p95 | ~34 ms |
| frame p99 | ~49 ms |
| simulation step p50 / p95 / worst | 1.9 / 3.4 / 6.9 ms |
| world draw calls (first person) | 20–605 depending on viewpoint |
| world triangles (first person) | 8k–217k |
| boot to harness ready | ~436 ms |

The 12-combatant simulation is comfortably inside budget and is **faster** than
the pre-expansion measurement (p50 3.3 ms, p95 5.2 ms) because the movement
solver now rejects colliders by vertical span.

The frame-time tail is worse than an early-pass measurement (p95 18.6 ms) and is
**not fully explained**. A/B runs isolated each suspect: disabling the follow
shadow cascade (187 vs 189 long frames), disabling all new facade geometry (172),
and change-guarding every per-frame HUD DOM write (p99 49 -> 35 ms) each moved
only part of it. Disabling the shadow map entirely removed about a third
(177 -> 123). Draw calls are the dominant remaining render cost and are the right
target for the next performance pass.

Measured and rejected: splitting merged batches on a 32 m or 16 m spatial grid to
improve frustum culling. Sampled from five first-person viewpoints it lost every
time — market went 366 -> 460 -> 636 draw calls — because the extra draw calls
cost more than the culling saved. Batching stays per zone.

## Known weaknesses

- Draw calls (up to ~605 from the terrace) are the main render cost. Instancing
  the repeated kit pieces is the obvious next step.
- Indoor zones are traversed but lightly occupied (`depot` 15, `arcade` 9,
  `east-offices` 2 occupancy samples per soak vs `market` 161). Bots path through
  them rather than fighting in them.
- 33 stuck recoveries per 120 s across 11 bots. No single hot spot remains after
  the step-up fix; the residue is diffuse (1–3 per location) and each stall is
  capped at 1.2 s.
- Independent reviewer passes (gameplay-director, map-director, ai-director,
  qa-auditor, visual-critic) were launched but terminated early on a session
  limit, so their findings are **not** part of this evidence.

## Notable defects found and fixed this pass

- `resolveActor` pushed actors out of any overlapping solid including stair
  treads, so step-up never worked and bots oscillated at every flight
  (east-terrace stuck count 28 -> 2).
- Respawn did not reset the weapon; the player re-entered with a partial
  magazine.
- Opening-deployment deaths were counted as spawn deaths.
- `combat:contact` telemetry measured every acquisition, not the first per life.
- Two `getMetrics()` methods on `RenderSystem` meant world-pass draw metrics were
  silently never reported.
