# Gameplay v3 Status — 6v6 TDM

Measured on the current build. Every number came from a tool in `tools/`.

## Gates

| Command | Result |
|---|---|
| `npm run build` | pass |
| `npm run harness:physics` | pass |
| `npm run harness:check` | pass |
| `npm run harness:playtest` | pass (exit 0, harness + normal-mode blocks) |
| `npm run gameplay:check` | pass (`tdm-core`) |
| `npm run gameplay:map-audit` | pass |

New tools this pass:

- `npm run harness:frame` — profiles the **production** `Engine.start()` loop.
- `node tools/gameplay-probe.mjs combat-soak` — pacing/routing telemetry.

---

## Pass 2 — the frame-time "problem" was a measurement artifact

The previously reported tail (frame p95 ~34 ms, ~180 long frames) came from
`tools/profile.mjs`. That tool awaits a `requestAnimationFrame`, then runs a
gameplay frame in a **promise continuation after the callback returns**, so the
interval it records includes promise scheduling and whole vsync intervals missed
by the harness driver rather than by the game.

`src/core/frame-profiler.js` now instruments the real loop, splitting each frame
into fixed / update / lateUpdate / unaccounted and sampling the JS heap.
Measured through the production loop, deploying via the real UI and playing with
real input:

| Metric | Harness profiler | Production loop |
|---|---|---|
| frames sampled | 900 | 1800 |
| frame p95 | ~34 ms | **14.2 ms** |
| frame p99 | ~49 ms | **20.4 ms** |
| frames > 25 ms | ~180 | **0** |
| frames > 50 ms | 4 | **0** |
| GC pauses during long frames | n/a | **0** |

Under load (median 19 world draw calls, max 156, up to 95k triangles, 12
combatants, three zones traversed) the production loop produced **zero frames
over 25 ms**. There is no production frame-time defect.

`tools/profile.mjs` no longer reports its rAF deltas as `frameMs`; they are now
`harnessRafDeltaMs` with a note pointing at `harness:frame`. Its CPU and renderer
metrics remain valid for regression tracking.

### Caveat on later CPU numbers — RESOLVED IN PASS 3

Profile runs later in that session showed CPU p50 rising from 0.9-1.3 ms to
3.5 ms. Pass 3 settled this with an interleaved A/B/A/B/A and a fixed synthetic
workload: **host state, not code.** See "Performance: settled with evidence"
below.

---

## Pass 2 — map flow and AI

### Defect: no bot had ever used any elevated position

`elevatedOccupancy` was empty and `maxYByBot` was 0.02 for every bot: across the
whole match not one combatant had been above 2 m. The map reports 5 vertical
levels and 27–62 elevated nav nodes per zone, all unused.

Three separate causes, found by instrumenting rather than guessing:

1. **Stair waypoints were skipped.** `PATH_ARRIVE` (1.1 m) exceeded stair-node
   spacing (~0.72 m), so a bot at the foot of a flight marked every tread
   "arrived" in one frame and walked past the stairs. Stair nodes now use a
   0.42 m arrival radius and a tighter height tolerance. An isolated trace now
   shows a clean climb: groundY 0 → 0.3 → 0.6 → 0.9 → 1.2 → 1.5.
2. **Upper floors were sealed boxes.** The bureau's second storey and the depot
   mezzanine had openings only at ground level, so nothing could see or shoot out
   of them — there was no reason to go up. Both now have real firing openings
   (holes in the collider, not decorative glass) overlooking the terrace and the
   freight yard.
3. **Elevation lost on node count.** Goals were drawn uniformly from a zone, and
   east-terrace has 368 nodes of which only 62 are elevated. Bots now prefer high
   ground (45% outdoors, 72% indoors) — a normal tactical preference, not forcing.

### Defect: sight range flattened the match into one brawl

`SIGHT_RANGE` was 62 m on a ~100 m map, so a bot could see across most of the
district and was almost always in an engage/search state — it rarely executed a
route at all. Reduced to 42 m (fire range 46 → 36).

### Results (120 s `combat-soak`, 12 participants)

| Metric | Before pass 2 | After |
|---|---|---|
| kills | 31 | 46 |
| zones with kills | 6 | 8 |
| largest single zone share | 32% (north-junction) | 30% |
| north-junction share (peak during tuning) | 48% | 24–30% |
| spawn deaths | 4 of 31 (13%) | 8 of 46 (17%) |
| respawn-to-contact | 5.7 s | 6.2 s |
| first contact | 2.1 s | 5.5 s |
| depot occupancy samples | 15 | 14–48 |
| east-offices occupancy samples | 2 | 17 |
| east-offices kills | 0 | 2 |
| bots reaching elevation | none | yes (max y 2.17) |

`MIN_SPAWN_DISTANCE` was raised 22 → 30 m so spawns sit outside the new 42 m
sight range, which pulled spawn deaths back from 20% to 17%.

---

## Pass 2 — combat feedback

**Directional damage indicators.** `player.damageDirection` was being computed
and never rendered — a Gate H requirement ("damage direction/readability") that
was silently missing. The player now publishes the attacker's world position and
the HUD re-derives the bearing every frame, so the wedge tracks the shooter while
you turn to face them. Four pooled slots, 1.35 s decay, intensity accumulating
per shooter.

Two defects fixed while building it:

- Bearing used `atan2(dx, dz)`, which puts "straight ahead" at 180° and pointed
  every indicator the wrong way. Now projected onto the player's forward/right
  axes.
- The first implementation used `conic-gradient` + CSS `mask` + `drop-shadow`;
  replaced with a plain rotated wedge (no filter, no mask) that costs
  essentially nothing to rasterise over the WebGL canvas.

---

## Map report (measured, not declared)

| Metric | Value | Floor |
|---|---|---|
| playableWidthM / playableDepthM | 97 / 99 | 80 / 80 |
| playableAreaM2 | 7776 | 7000 |
| zones (indoor / outdoor) | 9 (3 / 6) | 5 (2 / 2) |
| primaryRoutes / routeLoops | 3 / 6 | 3 / 2 |
| verticalLevels | 5 | 2 |
| spawnPoints / landmarks | 34 / 13 | 12 / 4 |
| indoorOutdoorTransitions | 21 | 2 |

Nav nodes by zone: alpha-yard 366, east-terrace 368, west-yard 253, bravo-yard
149, market 119, north-junction 105, depot 101, east-offices 73, arcade 9.
Elevated: east-terrace 62, east-offices 43, north-junction 36, depot 33,
west-yard 27.

---

---

## Pass 3 — spawn deaths, navigation, a settled performance question, polish

### Spawn deaths 17% -> 0. The metric was measuring the test driver.

Per-spawn-death telemetry (spawn score, distance to nearest enemy, travel before
death, killer) showed all 8 spawn deaths shared one killer: `player`. Spawns were
33-40 m from the nearest enemy, comfortably outside the floor. The soak's scripted
human was an aimbot — `drivePlayer` called `aimAtPoint` with perfect accuracy on
any visible opponent at unlimited range and fired instantly, sniping bots as they
re-entered.

The driver now has a 34 m engagement range, a reaction delay before opening fire,
and deterministic residual aim error; `getAimPoint()` takes a range cap.

| | before | after |
|---|---|---|
| spawn deaths | 8 of 46 (17%) | **0 of 28** |
| killsByTeam | alpha 20 / bravo 8 | alpha 17 / bravo 11 |

The second row is the tell: the lopsided team score was the same artifact.
**Spawn placement never needed tuning.** The earlier `MIN_SPAWN_DISTANCE` raise
from 22 to 30 m was made against this bad signal.

### Arch pillar and stuck clusters

`moveBot` committed to a fixed strafe sign when blocked, so a bot meeting the
market arch pillar slid back and forth across it instead of rounding it. Blocked
movement now evaluates both tangents and keeps whichever ends closest to the
bot's actual path node.

| | before | after |
|---|---|---|
| stuck recoveries / 120 s | 34 | **13** |
| arch cluster (x~5, z~-18) | 6 | 3 |
| max stall | 1.2 s | 1.2 s |

### Performance: settled with evidence, not attribution

Two independent experiments:

1. **Interleaved A/B/A/B/A** in one session. Variant B reverted the only two
   pass-2 changes touching render/update cost (indoor wall openings, the damage
   indicator). Result — A: cpu p50 3.7 / 3.5 / 3.5, B: 3.6 / 3.5. **No code
   effect.**
2. **Fixed synthetic CPU workload** with no dependency on game code, sampled by
   `npm run harness:frame`. Same session, hours apart: **75.9 ms -> 135.9 ms
   (1.79x slower host)**, while game CPU p50 moved 3.4 -> 4.0 ms (1.18x).

The host degraded 1.79x while the game's measured cost rose 1.18x, so per unit of
host capacity the game got *cheaper*. The earlier "CPU regression" was host state.
`cpuBenchmarkMs` is now recorded in every frame profile so this is never guessed
at again.

### Polish

- **Movement feel**: sprint drives an FOV kick and a lowered, canted weapon pose;
  landing drives a damped camera dip scaled by impact speed. The `player:landed`
  event previously had no consumer at all, so drops felt weightless.
- **Audio layering**: bot gunfire crossfades a near crack against a far thump
  with a longer wet tail, and the two teams get different timbres. Previously one
  identical sample played regardless of range or side.
- **Match presentation**: lead-change and match-point announcements derived from
  authoritative scores, with the match-point threshold proportional to the score
  limit.

## Pass 3 — independent review applied

The **visual critic** completed and its findings were applied by root cause.
The **gameplay director** hit the API session limit twice and has still never run.

| Finding | Root cause | Action |
|---|---|---|
| Hard lighting seam sliding across the world | Shadow cascade was 17 m on a map with 42 m sight range, so ~60% of visible geometry fell outside the shadow frustum and rendered fully lit | Cascade widened to 92 m at 4096 (2.2 cm/texel, matching the original density) |
| Facade pilasters/cornices invisible | I set `cast: false` on all trim for performance — a hypothesis my own later A/B disproved. Trim is only legible via its own shadow | Trim casts again |
| Texture density collapse on large surfaces | `repeat` is set per *material*, but box UVs run 0..1 per face whatever the face measures, so one tile stretched across a 100x9 m wall | Per-face UV scaling by world dimensions, baked into the size-keyed geometry cache |
| Teams indistinguishable | Alpha and Bravo uniforms differed by **1.9% luminance**, both inside the environment palette, while the HUD taught cyan/orange | Cool-teal vs warm-rust kits plus emissive marker bands matching the HUD language |

The team-identity item was a Gate H combat-fairness defect, not cosmetics.

### Regression introduced and fixed in this pass

Audio layering raised voices-per-shot from 2 to 4; with twelve combatants
bursting, the WebAudio renderer intermittently faulted and the match went silent
(caught by `harness:playtest`, 1 failure in 3 runs). Voices are now budgeted with
distance culling and per-layer priority; three consecutive playtest runs clean.

---

## Pass 4 — GPU instrumentation, multi-seed evidence, review fixes

### GPU timing: the real bottleneck was invisible to CPU profiling

`src/render/gpu-profiler.js` adds asynchronous `EXT_disjoint_timer_query_webgl2`
timing. No `gl.finish()`; queries are polled on later frames, and a
`GPU_DISJOINT` signal discards every in-flight sample rather than averaging it
in. The extension is available on this host and 3690 samples were collected with
**0 disjoint frames**.

First measurement, with CPU at 2.5 ms:

| pass | p50 | p95 |
|---|---|---|
| shadow | 2.7 ms | 6.0 ms |
| world | 14.9 ms | 16.5 ms |
| **total** | **21.3 ms** | **53.9 ms** |

The GPU was over a 16.7 ms budget while CPU used 2.5 ms. **Cause: 22 point lights
in a forward renderer** — three.js evaluates every scene light for every lit
fragment, so 22 lamps cost 22 light evaluations on every pixel of the district.

Fix: practical lights are registered as data and a fixed pool of 6 real
`PointLight`s is re-pointed at the nearest emitters each frame. The count stays
constant, so the shader program never recompiles (a varying light count would
cause recompilation hitches).

| | before | after |
|---|---|---|
| scene point lights | 22 | 6 |
| world pass p50 | 14.9 ms | **6.35 ms** |
| total GPU p50 | 21.3 ms | **14.7 ms** |
| total GPU p95 | 53.9 ms | **26.6 ms** |

The host was *slower* during the after-run (synthetic benchmark 47 -> 88 ms), so
the improvement is larger than the measurement, not smaller.

Caveats recorded honestly: per-pass attribution is unreliable on this TBDR GPU
(the viewmodel query absorbs pipeline drain from the world pass), so `total` is
the trustworthy figure. `TIME_ELAPSED_EXT` cannot nest, so `total` is the sum of
the frame's passes. No post-processing passes are registered, so post GPU time is
not reported rather than reported as a fabricated zero.

### Multi-seed soak replaces single-run conclusions

`npm run gameplay:soak` runs the production scenario across 6 seeds x 150 s and
reports mean/sd/min/max. Zone shares are normalised per run so a high-kill run
cannot dominate. New metrics: post-spawn lifetime, killer distance, and stuck
recoveries normalised by path advances.

| metric | mean | sd | range |
|---|---|---|---|
| kills | 29.8 | 5.9 | 22 – 39 |
| **spawn death rate** | **0.43%** | 0.96 | 0 – 2.56% |
| alpha kill share | 57.8% | 6.0 | 50 – 70% |
| killer distance p50 | 16.7 m | 1.9 | 13.5 – 19.3 |
| post-spawn lifetime p50 | 28.0 s | 6.2 | 14.7 – 34.2 |
| respawn-to-contact | 11.2 s | 2.7 | 7.6 – 14.7 |
| stuck / 1000 path advances | 20.5 | 8.3 | 6.5 – 29.6 |
| max stall | 1.18 s | 0.00 | — |

Spawn safety is confirmed across seeds, not a lucky run. Kill share by zone:
market 30%, north-junction 25%, west-yard 21%, east-terrace 13% — no kill box,
but the standard deviations (9-10 points) show why single-run tuning was unsound.

Alpha's 57.8% kill share is expected rather than a defect: the human slot is on
Alpha and contributes roughly its share of the difference.

### Visual review findings applied

| finding | root cause | fix |
|---|---|---|
| "Floating slats with no bases or tops" | `facade()` decorated the full wall span while `wallRun()` cut doorways in it, so pilasters, ribs and cornices were drawn **across every opening** | Facade takes the same opening list; bands split around doorways instead of crossing them |
| Same report's second half | The reported camera position was **inside a stacked container** | `stagePlayerView` now resolves the capture camera out of solids and onto the real floor, so a capture point cannot manufacture a false defect |
| Shadow seam sliding across the world | 17 m cascade vs 42 m sight range | 92 m cascade at 4096 (2.2 cm/texel, matching the original density) |
| Invisible facade trim | `cast: false` set on a hypothesis a later A/B disproved | Trim casts again |
| Texture stretched up to 11:1 | UV `repeat` is per material; box UVs are 0..1 per face regardless of face size | Per-face UV scaling by world dimensions, baked into the size-keyed geometry cache |
| Teams 1.9% luminance apart | Palettes both sat inside the environment range | Cool-teal vs warm-rust kits plus emissive marker bands matching the HUD's cyan/orange |

---

## Pass 5 — independent gameplay review landed, and it was right

The gameplay director completed after three blocked attempts. Verdict: *"a
competent tech demo wearing a match loop."* Its headline finding was one no
internal metric had caught, because every soak had been run at shortened
scenario rules rather than production rules.

### The advertised win condition was unreachable

At production rules (limit 100, 600 s) the director ran five matches: **four
ended on the clock** at 45-68 kills. Measured leader throughput was ~0.107
kills/s, so reaching 100 needed ~937 s inside a 600 s match. Consequences:

- `MATCH POINT` required a team on 95 and **never fired in a real match**.
- The end card read `Time limit reached.` over a score that never approached the
  number the HUD promised on every frame.
- One lead change in ten minutes; matches decided in the first three.

Root cause: score limit, time limit and respawn delay were each set independently
and never validated against the kill rate the systems actually produce.

Fix — calibrated against measured throughput, then verified at production rules
across five seeds:

| seed | ends by | score | duration |
|---|---|---|---|
| 1337 | score-limit | 50-27 | 4.5 min |
| 11 | score-limit | 50-36 | 6.1 min |
| 777 | score-limit | 50-40 | 5.8 min |
| 20240 | score-limit | 50-31 | 4.4 min |
| 4242 | score-limit | 50-45 | 6.6 min |

**5 of 5 now end on the condition the player was given.** `MATCH POINT` is a
fixed five-kill run-in rather than 5% of the limit, so it fires in a real match.

Every statement of the win condition — HUD mode line, objective line, briefing —
is now rendered from `match.scoreLimit` instead of a hardcoded `100`. Changing
the rule can no longer leave the UI promising a different one.

### Respawn faced the map boundary

Spawn yaw was a per-team literal baked into the spawn point (`alpha 3.14`,
`bravo 0`) and never consulted the situation. Measured forward clearance along
each spawn's own yaw: **all 17 Bravo spawns under 15 m, median 5.8 m, minimum
1.0 m.** Players and bots re-entered nose-to-wall with the map behind them.

`chooseSpawnYaw` now evaluates twelve candidate facings per spawn, scoring
measured forward clearance first and bearing to the nearest live enemy second.

### Re-entry downtime and the end card

- `RESPAWN_SECONDS` 4.5 -> 3.2; spawn distance band 30/40 -> 26/34 m. The 30 m
  floor had been set against the aimbot-driver artifact.
- Spawn deaths stayed safe at the tighter band: **0.79% mean, 4.76% worst across
  six seeds**, inside the reviewer's 5% criterion on every seed.
- The end card printed **two team totals and nothing else** — a player finished a
  match never seeing their own kills or deaths. It now lists per-player K/D/PTS
  for both teams with the human row highlighted.

---

## Pass 6 — a driver that plays, and elevation that can be seen out of

### The scripted player now plays

`src/core/player-driver.js` replaces the old `drivePlayer`. It goes through the
production input path only: virtual movement actions, and **`input.injectLook`
for turning — the same channel the mouse feeds** — with a capped turn rate. It
never writes yaw or pitch directly.

It is deliberately not omniscient: it only notices opponents inside its own view
cone, within 46 m, with real line of sight, and needs a 0.28 s reaction before it
tracks one. Aim converges over time and keeps residual error that grows with
range, so it cannot headshot on sight.

| | old driver | new driver |
|---|---|---|
| zones visited | effectively 1 (camped) | **7.5 mean** (6-8) |
| distance travelled | 0 m | **615 m mean** |
| kills / deaths | n/a (aimbot or camper) | **10.2 / 3.8 mean** |
| blocked recoveries | walked into walls | 24.5 mean |

Two bugs found while building it, both mine:

- Movement was measured *within* one update, but the fixed step runs *between*
  updates, so travel always read zero and the stuck detector fired every frame
  (103 recoveries per run). Progress is now sampled against the previous update.
- Rewiring the driver dropped `recorder.pollScores(match)` from the step
  callback, which broke the `usedProductionScoring` evidence check. `gameplay:check`
  caught it.

### Player-facing pacing, measured by something that plays

Six seeds x 150 s. **These are one scripted human, kept separate from the
twelve-actor aggregates below.**

| human metric | mean | sd | range |
|---|---|---|---|
| kills / deaths | 10.2 / 3.8 | 6.3 / 2.1 | 0-21 / 0-7 |
| zones visited | 7.5 | 0.8 | 6-8 |
| distance travelled | 615 m | 146 | 302-734 |
| combat time | 15.1% | 8.0 | 0.4-25.8% |
| travel time | 77.2% | 11.7 | 66-99.6% |
| dead time | 7.7% | 4.3 | 0-14.1% |
| first contact | 7.0 s | 9.4 | 1.4-27.5 |
| respawn-to-contact p50 | 5.3 s | 3.7 | 2.7-12.4 |
| no-contact gap p90 | 26.4 s | 17.9 | 13.5-64.2 |

Twelve-actor aggregate, same runs: kills 35.7, spawn-death rate 2.07%,
respawn-to-contact 8.3 s, lifetime p50 27.9 s, killer distance p50 15.2 m.

The honest read: the player spends **77% of its time travelling and 15% fighting**,
and the p90 gap between contacts is 26 s. Gate D's ">15 s of aimless wandering"
flag is still firing.

### Elevation: sightlines fixed, usage not yet

Auditing every reachable elevated nav node with a 24-ray fan from the standing
eye position found the reviewer was right, and quantified it. It also exposed a
**structural bug in `wallRun`**: each wall segment resolved openings with
`.find()`, so it honoured only the *first* opening crossing it. A ground doorway
and an upper firing gallery overlapping in plan silently cancelled the gallery —
which is why upper floors measured as sealed boxes despite having galleries
authored into them.

Open-arc (fraction of directions with 25 m+ clearance) from the eye position,
level look:

| zone | before | after |
|---|---|---|
| east-offices upper | 8.8% (best node 25%) | **36.3% (best 75%)** |
| depot mezzanine | 2.3% (best 8%) | 13.5% (best 29%) |
| east-terrace | 21.1% | 36.3% (best 71%) |
| west-yard catwalk | 33.6% | 49.1% (best 67%) |
| north-junction overpass | 40.4% | 64.7% (best 75%) |

**But elevation is still not used in combat**: elevated occupancy 4.8 samples per
run, human elevated time 1.3%. The positions are now worth occupying; nothing yet
routes actors to them often enough to prove it. This half of the task is not done.

---

## Pass 7 — why rational agents avoided elevation

### Instrumenting the decision instead of guessing

`AISystem` now traces the whole goal lifecycle — chosen goal, whether it was
elevated, route length, stair count, waypoints actually progressed, and the
reason the goal ended (`arrived` / `died` / `stuck`). `goalReport()` aggregates
it. That turned an unanswerable "elevation is unused" into a specific finding.

**Elevation was being chosen constantly and never reached.**

| elevated goal outcome | count | mean straight-line | mean path nodes | mean progressed | mean seconds |
|---|---|---|---|---|---|
| died | 13 | 47.5 m | 30.1 | 9.0 of 30 | 31.0 s |
| stuck | 7 | 58.4 m | 40.9 | 3.7 of 41 | 18.8 s |
| **arrived** | **0** | — | — | — | — |

Ground goals that *did* arrive averaged 19.7 m and 2.4 path nodes.

Root cause: goals were drawn uniformly from a zone, and zones are 30–60 m across.
An elevated objective was therefore ~50 m away down a 30–40 waypoint route — a
trip that outlasts a 28 s median life. Elevation was not rejected; it was
**unreachable within a life**. The earlier hard 45%/72% "prefer height"
probability could not fix that and was masking it.

### Fix: a utility model, not a probability

The height probability is gone. Goal selection now samples candidates and keeps
the best **value ÷ travel cost**:

- *value* = what the position overlooks (baked per nav node at world build time
  as an 8-ray open-arc fraction from standing eye height) plus a small premium
  for high ground.
- *cost* = distance, plus an extra penalty for climb, because stairs are slow and
  expose the climber.

Candidates come from the lane objective (two thirds) and the bot's current
surroundings (one third). Choosing the zone first and only then scoring inside it
meant every candidate was as far away as that zone happened to be, so a rooftop
two streets over never competed with a distant one.

Elevation now wins when it is close enough to be worth the climb — the same
judgement a player makes.

### Measured across six seeds x 150 s

| metric | pass 6 | pass 7 |
|---|---|---|
| elevated occupancy samples | 4.8 | **9.8** |
| stuck per 1000 path advances | 24.8 | **14.9** |
| human no-contact gap p90 | 26.4 s | **18.7 s** |
| human respawn-to-contact p50 | 5.3 s | **4.4 s** |
| human combat time | 15.1% | **19.3%** |
| spawn death rate | 2.07% | 1.63% |
| kills (12 actors) | 35.7 | 27.2 |
| largest zone kill share | market ~30% | west-yard 27.6% |

Indoor zones now take real kills (depot 7.1%, east-offices 5.0%) and no zone
exceeds 28% — the distribution did not collapse into a new kill box.

Kills fell ~24%. That is the honest cost of bots spending more time repositioning
and less time funnelled down one corridor; the human driver's combat time rose
over the same runs, so the match did not get quieter for the player.

### A tuning attempt that measured worse, and was reverted

Weighting local candidates 1-in-4 with a softer distance term (`GOAL_DISTANCE_SCALE`
24) produced kills 14 and elevated time 2.1%. Pure value÷cost with bounded value
and unbounded cost is myopic: near goals always win and bots stop pushing. The
1-in-3 / scale-16 configuration is kept because it measured better on both counts.

---

## Pass 8 — expected enemy presence: implemented, measured, reverted

### What was built

`src/match/combat-heat.js` is a decaying spatial field of **observed** combat
activity, fed only by things that are noticeable in the world:

- gunfire (`ai:fired`, `weapon:fired`) at the shooter's position
- deaths (`actor:died`) at the victim's position
- confirmed sightings (`combat:contact`) at the *seen* actor's position

Heat halves every 12 s, so it describes where the fight is rather than where it
was. It is kept as **one field per team**, recording where that team has been
observed acting. Nothing writes an unseen actor's position, so it cannot be used
as an enemy locator — it is the same information a player gets from gunfire, the
kill feed and their own eyes.

The field is retained and instrumented (`match.contactPressure(team, x, z)`,
`match.heatHotspots(team)`).

### Why it does not drive goal choice

Wiring it into the tactical-goal utility **measured worse on every axis that
matters**, across the same six-seed harness:

| metric | pass 7 (overlook only) | with contact pressure |
|---|---|---|
| bot kills | 27.2 | **13** |
| human combat time | 19.3% | **4.8%** |
| Gate D no-contact p90 | 18.7 s | **43.3 s** |
| elevated goal distance | 16.6 m | 10.3 m |

Two reasons, both diagnosable from the traces:

1. **Recent-contact heat is a lagging signal.** By the time a bot walks to where
   fighting was observed, the fight has moved.
2. **It is self-reinforcing at short range.** A bot heats the cells it has just
   fought in, then scores nearby positions higher because of its own activity.
   Combined with a value ÷ cost score whose denominator is distance, that made
   goals *even more local* — elevated objectives fell to ~10 m away and bots
   stopped traversing the map at all.

A first attempt used a single shared field, which was worse still: it counted a
bot's own squad's gunfire as evidence of enemy presence, so teams walked toward
themselves. Making the field team-relative fixed that specific error but did not
rescue the outcome.

**The change was reverted rather than shipped.** A re-run after the revert
reproduces the pass-7 numbers exactly (kills 27.17, gap p90 18.73, elevated
occupancy 9.83), confirming no residue.

### What this means for the underlying problem

Elevation value needs a *predictive* signal — where fighting is about to happen —
not a record of where it has been. Candidates not yet tried: lane pressure from
both teams' current objectives, spawn-flow projection, or valuing a position by
how much of the enemy's likely approach route it covers. Recent-contact heat is
the wrong shape for this and the measurement says so.

Gate D was untouched by this pass and remains at p90 18.7 s.

### Gate D diagnosed: the cause is occlusion between adjacent zones, not pacing

The driver now classifies **every** no-contact frame by why nobody is visible,
and records where the blocking geometry sits along the ray. Six seeds:

| gap cause | share |
|---|---|
| `occluded` — enemy inside 46 m, geometry blocks the ray | **75.9%** |
| `behind` — clear line of sight, outside the view cone | 15.5% |
| `far` — nearest enemy beyond spotting range | **8.7%** |

Mean nearest enemy **during** a gap is **25.6 m**. So the two obvious levers are
both ruled out by measurement: the enemies are not far away (raising sight range
changes nothing when the ray is blocked) and they are not badly distributed
(moving spawns closer changes nothing at 25 m).

Two follow-up measurements narrowed it further:

- **Blocker position along the ray**: 43.4% near the player, 41.8% mid-ray,
  14.8% near the target. The mid-ray share is whole structures standing between
  two nearby combatants.
- **Clearance (nearest wall in 8 directions)**: 2.85 m during gaps vs 2.79 m
  during contact. Essentially identical, which **disproves** the hypothesis that
  routes hug walls and starve a travelling player of sightlines. That idea was
  dropped rather than implemented.

Gap seconds concentrate in market (163 s) and east-terrace (151 s) — two adjacent
zones sharing a 42 m boundary — and the longest gaps are all traffic between
them (`zone: east-terrace, goal: market`, 45 s, 84% occluded).

**Conclusion:** adjacent zones are mutually invisible. Combatants pass within
25 m of each other separated by continuous structure, so contact depends on
walking to a crossing point rather than seeing across. The fix is map topology —
lateral sightlines across the market/east-terrace boundary — not AI or pacing
tuning.

That change was **not** made in this pass. It is level surgery on the map's
busiest boundary and needs a full six-seed plus six-gate validation cycle to be
trustworthy; making it without that would be exactly the untested tuning this
project's process forbids. Gate D therefore remains at p90 18.7 s.

All six gates are green and the six-seed numbers are byte-identical to pass 7
(kills 27.17, gap p90 18.73, spawn deaths 1.63%), confirming the new telemetry is
measurement-only and changes no behaviour.

---

## Pass 9 — market ↔ east-terrace topology repaired, Gate D closed

### The actual defect

Runtime blocker attribution (every occluded sightline resolved to the specific
solid that blocked it) put the top boundary blocker at a single mass, and reading
the source explained why:

The market's **east building row** — `BUILDINGS` at x ≈ 9.0–9.35, z = 8 / −2.5 /
−13 — forms a near-continuous 31 m wall from z −18 to z +12.75. Its only
ground-level opening was the underpass at z −2.5. Worse, the east-terrace deck's
only market-side stair sat at **x 13.6, z −2.5 — the same z**. So every
market↔terrace crossing, on foot and by sightline, funnelled through one point.
That is the mechanism behind "combatants 25 m apart who never see each other".

### The change

Four openings, deliberately split between traversal and sight, and spread apart
so no single new angle dominates:

| change | kind | effect |
|---|---|---|
| collapsed shopfront through the z −13 block (z −15.8…−12.8, y 0…2.7) | traversal | second ground crossing, into the southern flank where no stairs are needed |
| window slot in the same block (z −10.6…−8.8, y 1.3…2.3) | sight only | see across the boundary without a route |
| northern stair onto the low deck (x 13.6, z 11.5) | traversal | the deck stops being single-entry; elevation becomes contestable |
| offices west-wall band (z −7…−3.5, y 2.4…3.6) | sight only | the ground floor stops being a solid block |

The baseline market buildings are **not** removed or moved. The monolithic box is
rebuilt as a wall run with openings — identical footprint, height and material —
so the preserved visual block keeps its identity. The breach gets rubble
shoulders for cover at both mouths and a lamp, so it reads as damage rather than
a hole.

### Result (6 seeds, production rules, realistic driver)

| metric | pass 8 | pass 9 |
|---|---|---|
| **human no-contact p90** | 18.73 s | **11.18 s** |
| human no-contact max | 45 s (longest single gap) | **17.8 s** |
| human no-contact p50 | — | 3.6 s |
| human combat time | 19.3% | **20.8%** |
| elevated occupancy | 9.83 | **18.50** |
| stuck per 1k path advances | 14.86 | **9.14** |
| bot kills | 27.17 | 24.83 |
| spawn death rate | 1.63% | 3.70% |

**Gate D passes** (p90 11.2 s against the 15 s flag).

The mechanism is worth recording because it is not the obvious one: overall
occlusion barely moved (75.9% → 73.4%), but `behind` — clear line of sight, just
outside the view cone — rose 15.5% → 19.8%. Sightlines now *exist*; the long tail
was the funnel, not raw occlusion. That is why opening four small holes halved a
p90 that raising sight range could never have touched.

### Kill-box check (the change had to be rejected if it merely relocated kills)

Kill positions are now recorded. Of 149 kills across six seeds:

- within 8 m of the new breach: **9.4%**
- within 8 m of the new northern stair: **1.3%**
- within 8 m of the old underpass: 3.4%
- across the whole modified band (x 6…20, 14 m wide): 28.9%
- densest 10 m cell anywhere: (20, −20) at 10.7% — existing terrace ground, not
  new geometry

No new location dominates. Zone shares moved from west-yard-led (28%) to
east-terrace-led (31%), which is redistribution toward a previously dead flank,
not concentration.

### Costs, stated plainly

- **Bot kills 27.2 → 24.8** (−8.6%, against a seed sd of 5.2). Not a collapse,
  but throughput did not improve; more of the map is in play per fight.
- **Spawn deaths 1.63% → 3.70%.** All five sampled events have
  `killer: 'player'` — the human driver now meets fresh spawns more often
  because it travels further. No bot-caused spawn deaths. Worth rechecking if it
  climbs.

### Visual check

Both sides of every opening captured at player eye height
(`tools/boundary-shots.mjs`, `artifacts/boundary/`). The breach reads as a lit
passage with cover at both mouths; the deck approach is not an overpowered
overlook — the market's east row still blocks the deck's westward view at z ≈ 4,
so the new elevation is useful without being dominant.

Unrelated artifact noticed: lit windows (`warmWindow`) render as flat untextured
orange panels at close range. Pre-existing, logged for the polish pass.

### Tooling added this pass

- `physics.raycastWorldBlocker()` — resolves a blocked ray to the specific solid
- driver blocker attribution, boundary-pair detection, clearance sampling
- `match.telemetry.killSpots` — kill positions, for kill-box tests
- `runAction('inspect_from')` — place the player and render through their own
  camera, for eye-height inspection
- `tools/boundary-shots.mjs`

---

## Pass 10 — pass-9 defect repair, then the real blocker: combatant lethality

### Defects the map reviewer found in pass 9 (all mine, all fixed)

1. **Rubble shoulders were entombed inside the wall.** They were offset along z
   from the wall centre, so both landed inside the solid flanks. The cover pass 9
   claimed to deliver did not exist. The mouths are the two *x* faces; they now
   flank each mouth in x, placed outside the opening in z.
   A first correction put them in the bore and turned the 3 m passage into a
   chicane — no-contact p90 regressed 11.2 → 23.2 s. Caught by measurement, and
   the final placement leaves the bore clear.
2. **`facade()` drew trim across the breach.** The rear-elevation call never
   received `b.openings`, so a base course ran across the full mouth and a 0.55 m
   pilaster sat dead centre. Both are mesh-only, so they blocked the player's
   bullets and sight while AI collider rays passed straight through — the gun
   appears not to work. `openings` is now passed through.
3. **Two drainpipes stood inside openings** (one through the window slot, one in
   the breach's east mouth), the same mesh/collider mismatch. `clearOfOpenings()`
   now nudges decoration out of any doorway.

### The actual blocker: an approximately 20x lethality gap

The gameplay reviewer measured what nine passes of honest aggregate telemetry had
hidden:

| | player | bot (before) |
|---|---|---|
| TTK, 5 m, clear LOS, stationary target | 0.217 s | **12.51 s** |
| hits needed per kill | 3.8 | 10.5 |
| expected damage per shot | 34 | **~4.9** |

Bots had a to-hit cap of 46% for 8–12 damage. A bot needed twelve and a half
seconds of unbroken line of sight to kill a stationary target, so bot-versus-bot
fights essentially never resolved. The consequence, per-participant:

- the human took **59% of their team's score** and 35.5% of all kills in a match
- ally bots averaged 4.1 kills; one finished a match 0/4
- the human's team won **5 of 5** production matches, with 0 lead changes in 3

This is a damage-model defect, not a driver artifact: the scripted driver's
*accuracy* edge is only 1.35x. It was authored per-actor — the player weapon
tuned for feel, the AI weapon tuned so "a fight is a decision" — and the two were
never validated against each other.

### The change

Bot to-hit `clamp(0.6 − 0.012d, 0.15, 0.46)` → `clamp(0.68 − 0.011d, 0.18, 0.54)`,
damage 8–12 → 16–21, inter-burst pause 0.95–1.60 s → 0.70–1.15 s. Player weapon
untouched — the strong weapon feel is the baseline and the gap is closed from the
weak side.

**Health regeneration added** (`REGEN_DELAY` 4.5 s, 18 hp/s, suspended by
incoming fire). There was none anywhere: the player never lost a *fight*, they
bled out by chip damage accumulated across a whole life, which made every duel
consequence-free and every death arbitrary.

### Result (6 seeds, production rules)

| metric | pass 9 | pass 10 |
|---|---|---|
| total kills | 24.83 | **29.17** |
| human share of all kills | 35.5% | **17.1%** |
| kills per ally bot per run | 0.83 | **2.20** |
| bots finishing with 0 kills | 8/66 | 5/66 |
| human K/D | ~3.0 | 0.86 |
| spawn death rate | 3.70% | **0.52%** |
| stuck per 1k | 9.14 | 8.61 |
| no-contact p90 | 11.18 s | 16.28 s |
| largest zone kill share | 31% (east-terrace) | 29% (east-terrace 29 / market 28) |

Throughput went **up**, not down: making eleven props into combatants adds more
fights than the player loses. Kill distribution is also flatter.

### Known issues, accepted

Per direction, structural chasing stops here. Recorded, not fixed:

- **Human K/D 0.86 against a 1.2–2.0 target.** The scripted driver is
  deliberately handicapped (54° cone, 0.28 s reaction, residual aim error); a
  real player performs better. Bot lethality was already pulled back one notch
  from a first setting that gave K/D 0.67.
- **No-contact p90 16.3 s, above the 15 s flag.** This is a *different*
  mechanism from the pass-9 wandering: the player now dies more, so the gap is
  respawn downtime, not failure to find a fight. Topology is not the cause.
- **alpha-yard is 25.9% of walkable area for 0.49% of kills** (density index
  0.02); bravo-yard 0.27. The depot is fine (1.37). north-junction is
  over-concentrated at 3.92 and is also the least-covered zone on the map
  (p90 12.5 m to cover, 25.7% of nodes over 6 m).
- **The low deck's south lip** (x 15–34, z −13) is the strongest overwatch on the
  map and covers both breach mouths. The new north stair is 3x more exposed than
  the old underpass for a destination that cannot see the market.
- **Zero elevated nav nodes** in market, alpha-yard or bravo-yard — 45% of
  walkable area with no second level. `elevatedCombatTimePct` ~0.09%: bots
  transit elevation, nobody fights from it. Occupancy was the wrong proxy.
- **The arcade** — the polished visual baseline interior — carries 0.0% of route
  traffic and is visible from 2 of 468 sampled positions.
- **Every match starts from seed 1337** (`src/main.js`), so boot and REMATCH
  begin with identical bot deployment.
- **`runTdmCore` builds `result.human` after its restart-verification reset**, so
  those kill/death fields are structurally always 0.
- **No gate runs production rules**: `gameplay:check` uses scoreLimit 12, the
  soak uses 100000. Win-condition reachability is not covered by CI.

### Quality phase, started

- **Lit windows** were a flat emissive colour that read as an orange rectangle up
  close. Now a generated interior — ceiling falloff, off-centre bulb, blinds or
  curtain or furniture silhouette, grime — in three variants so a facade is not a
  repeated stencil.
- **Bot locomotion** was a fixed 6 rad/s leg swing gated on AI state, so feet slid
  and bots walked on the spot while holding an angle. Gait now advances with
  measured ground speed, with footfall weight twice per stride, run lean, and
  rifle counter-swing.

## Remaining highest-impact problems

1. **Elevated combat** — occupancy 4.8 -> 9.8 (pass 7) -> 18.5 (pass 9, from
   giving the deck a second approach). Topology moved this far more than the
   utility model did. `elevatedCombatTimePct` is still low; a *predictive*
   presence term is still missing (recent-contact heat was tried in pass 8 and
   measured worse).
2. **Gate D cleared in pass 9** (p90 11.2 s). Watch spawn deaths (1.6% -> 3.7%,
   all player-caused) and bot kill throughput (27.2 -> 24.8) on the next soak.
3. **Bot kill throughput** 27.2 mean, down from 35.7 before the pass-7 goal
   model. Zone spread improved in exchange; worth a longer run to confirm the
   trade.
4. **Zone budget** — bravo-yard and alpha-yard each under 2% of kills.
5. **Market navigation blackspot** still present.
6. **Lead changes (Gate B)** — matches still decided early.
7. **Environment filler**, market lighting trade — unchanged since pass 4.
8. Not started: animation, character presentation, death/respawn presentation,
   audio layering beyond distance/team, match-flow presentation.

## Defects found and fixed (cumulative)

Pass 1: `resolveActor` blocked stair step-up; respawn didn't reset the weapon;
opening deployments counted as spawn deaths; `combat:contact` measured every
acquisition instead of the first per life; duplicate `getMetrics()` on
`RenderSystem` hid world draw metrics.

Pass 3: soak driver was an aimbot and invalidated the spawn-death and
team-balance metrics; fixed-sign strafe wedged bots on the arch pillar; shadow
cascade too small for the engagement range; facade trim non-casting and therefore
invisible; per-material UV repeat collapsed texture density on large surfaces;
team palettes 1.9% apart; WebAudio voice overload.

Pass 2: harness profiler mislabelled scheduling as frame time; stair waypoints
skipped by arrival radius; indoor upper floors sealed; goal selection ignored
elevation; sight range suppressed routing; damage direction never rendered;
damage bearing inverted; expensive HUD compositing.
