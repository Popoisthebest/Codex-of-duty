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

---

## Pass 11 — production-rules gate, then the combat-feel phase opens

### Validation blind spot closed

No gate ran the configuration a player actually receives. `gameplay:check` used
score limit 12 with a 1.6 s respawn; the soak raised the limit to 100000 so the
match never ended. Both are correct for what they do, and neither proved the
shipped rules are winnable or that they terminate.

`npm run gameplay:production` (`tools/gameplay-production.mjs`) runs the shipped
rules **untouched** — the scenario's production mode calls `configureRules` not at
all, so the match uses its own `SCORE_LIMIT` 50 / `TIME_LIMIT` 600 /
`RESPAWN_SECONDS` 3.2 — across six deterministic seeds. It asserts the rules in
effect really are the production values, the roster is 6v6, the match reaches a
terminal state through a real rule, a winner is declared, restart returns a clean
match, damage/scoring/respawn went through production pipelines, and there are no
runtime errors or non-finite state. It is **added alongside** the fast gates, not
in place of them, and is wired into `gameplay:full`.

Its regression floors are deliberately far from measured values — minimum kills,
maximum spawn-death share, maximum single-participant kill share, minimum count of
distinct bots that scored. They catch a broken build, not drift.

**Result: 6/6 seeds pass, all ending by score limit** at 392–504 s inside a 600 s
clock. Scores are close (50–47, 50–46, 50–43, 50–42, 38–50, 50–45) and **both
teams win across the seed set**. That is a direct consequence of the pass-10
lethality fix: the reviewer had measured 5/5 alpha sweeps with zero lead changes.

Two related defects fixed:

- **`result.human` was built after the restart reset**, so its kill/death fields
  were structurally always 0. Now read before the reset.
- **Every match started from seed 1337** — boot and REMATCH replayed the same
  opening deployment and bot decision stream. Real play now draws a fresh seed;
  the harness still pins its own.

### Combat feel

- **Enemies had no reaction to being hit.** Nothing about a target changed when
  it was shot, so exchanges felt like shooting cardboard. Damage now applies a
  flinch impulse directed away from the shooter, scaled by damage and multiplied
  for headshots, decaying over ~150 ms, driving torso pitch/roll and the rifle.
- **Death snapped `rotation.z` to ±1.32 in a single frame.** Bodies flipped flat
  instantly. Dead bots were also skipped by the animation loop entirely. They now
  collapse over 550 ms on two eases — an ease-out fall for gravity, a smoothstep
  for the roll — with the legs giving way ahead of the torso and the fall
  direction taken from the incoming shot.
- **Impact debris was one colour.** A hit on a body threw the same amber
  fragments as a hit on concrete, so there was no way to tell at a glance whether
  fire was landing. Particles are now per-instance coloured by surface — flesh
  throws dark arterial red, metal/glass/wood/foliage take material tints — with
  per-fragment shade variation, and the impact flash tints to match.

### Character and movement

- **Bot gait was time-driven** at a fixed 6 rad/s and gated on AI state, so feet
  slid and a bot holding an angle walked on the spot. Gait now advances with
  measured ground speed, with footfall weight twice per stride, run lean and
  rifle counter-swing.
- **Player camera bob was time-driven too** — it kept its cadence as the player
  decelerated and never lined up with a footfall. Now distance-driven, with a
  lateral figure-eight at half the vertical frequency and a matching roll, which
  is what separates walking from an elevator. Landing dip and lean already
  existed and were left alone.

### Environment

- **Lit windows** were a flat emissive colour reading as an orange rectangle up
  close. Now a generated interior — ceiling falloff, off-centre bulb, blinds or
  curtain or furniture silhouette, grime, frame — in three variants so a facade
  is not a repeated stencil.

### Known limitations from this pass

- The death collapse and flinch are verified by code review and green gates, not
  by a captured frame: the canonical `combat` camera is a fixed pose and the
  bodies fall outside it. A body-level capture rig is still missing.
- `tools/combat-shots.mjs` was added to photograph an engagement over time and is
  useful for HUD/FX checks, but it does not frame the fallen.
- Audio (priority 4) is untouched; footsteps are not yet synced to the new
  distance-driven stride phase, which is the obvious next win now that both the
  player and the bots carry a real gait phase.

---

## Pass 12 — character reaction verified from frames, footsteps put on the real gait

### The capture gap is closed

`runAction('stage_character')` + `tools/character-shots.mjs` stage one soldier in
three-quarter view and drive it through eight states: standing, walking, running,
torso hit, headshot, early collapse, mid collapse, final dead pose.

Everything runs through production systems — the real bot, the real `moveBot`
movement function stepped frame by frame, the real `combat:damage` event, the
real death path. **Nothing is posed directly for a screenshot.** The action also
returns a numeric pose readout (`AISystem.describePose`), so a frame that looks
wrong can be checked against numbers instead of argued about.

### Defects the rig found, all fixed

1. **Corpses floated.** Death set the root to `groundY + 0.25`, but rotating
   about the feet already carries the torso down to roughly knee height, so the
   offset was pure hover. Now `groundY + 0.02`.
2. **Bodies toppled into scenery.** Fall direction alternated on bot index with
   no regard for what was there. `chooseFallDirection()` now probes both sides
   and takes the one with room, preferring the shot direction when it fits. Probe
   distance is 2.3 m because a body sweeps ~1.75 m about the feet — an earlier
   1.9 m probe passed obstacles the body then hit.
3. **The first staged frame showed stale tracers**, left over from whatever ran
   before it. Staging now resets FX.
4. **The rifle buried itself in the chest on a flinch.** Swing coefficient
   1.6 -> 0.7.
5. **Flinch compounded to 35 degrees on a headshot.** `rotation.x` was damped
   *in place* toward the run lean, so each frame's flinch was fed back into the
   next frame's starting value even though `flinchPitch` itself is clamped to
   0.3. The lean is now tracked separately in `bot.leanX` and only composed into
   the transform at the end. Headshot flinch is 0.207 rad (12 deg), torso 0.097
   (5.6 deg).
6. **The capture rig itself was not deterministic** — the tool called `settle()`
   after staging, letting real time advance, so the collapse ran past the
   requested frame and at 18 frames the subject had *respawned out of shot*. The
   action now leaves the engine paused; the frame captured is the frame staged.

### Verified progression (measured, not asserted)

| state | rotZ | rotX | speed |
|---|---|---|---|
| stand | 0 | 0 | 0 |
| walk | 0 | 0.039 | 2.38 |
| run | 0 | 0.077 | 4.71 |
| hit torso | −0.008 | 0.097 | 0 |
| headshot | 0.128 | 0.207 | 0 |
| collapse early | 0.124 | 0.039 | — |
| collapse mid | 0.807 | 0.256 | — |
| dead final | 1.42 | 0.45 | — |

The collapse interpolates smoothly (0.004 → 0.124 → 0.427 → 0.807 → 1.42) and
completes at frame 33, matching the intended 0.55 s. Run lean is twice walk lean.
No snapping, no sliding, no rifle separation.

### Footsteps on the real gait

- **Player**: the camera bob and the footfall were two independent accumulators
  running at different rates, so the sound drifted against the motion. Both now
  derive from one `bobPhase`, advanced by `speed * (π / strideLength) * step`.
  A footfall fires each half cycle — exactly when `|sin|` bottoms out, which is
  the low point of the bob. Stride length is per stance (sprint 1.45, walk 1.72,
  crouch 2.1), so sprinting quickens cadence, slowing slackens it, stopping ends
  it at the `speed > 0.4` gate, and crouch is slower and heavier. Distance-based
  and inside the fixed step, so frame-rate variation cannot double-fire. Surface
  already drove the sound and still does.
- **Bots had no footsteps at all** — an enemy could close to knife range in
  silence. They now emit `ai:footstep` off the same `gaitPhase` that drives the
  legs, gated on alive, moving faster than 0.6 m/s, and grounded. Audio plays it
  spatially through the existing panner with distance attenuation, culled beyond
  26 m, at `priority: -1` so footsteps are dropped before gunfire under voice
  pressure. The existing `VOICE_BUDGET` protection is untouched.

All six gates and the production gate pass after these changes.

### Known limitations

- The soldier's shoulder marker bands read as slightly wide from three-quarter
  view; whether that is splayed arm geometry or just the team-ID banding is not
  resolved, and geometry was left alone rather than changed on a guess.
- Combat audio layering (priority 3) is not started: rifle voicing, near/far
  gunfire, indoor/outdoor response and impact/reload/kill cues are unchanged.

---

## Pass 13 — combat audio: two real bugs found by instrumenting first

### Audit

The gunfire near/far crossfade, team timbre, occlusion lowpass, distance rolloff
and reverb send were already in place from an earlier pass and were left alone.
The gaps were elsewhere, and instrumenting before changing anything found two
defects that had been silently shaping every firefight.

### Defect 1 — the voice priority formula was inverted

```js
if (this.activeVoices >= VOICE_BUDGET - priority * 8) return false;
```

A *higher* priority produced a *lower* allowance. At `priority: 3` the limit
computes to **zero**, so the distant gunfire tail — the layer that makes far-off
combat sound like a battlefield — **could never play at all**. Meanwhile the bot
footsteps added last pass at `priority: -1` were allowed 32, above the budget of
24, which is how the measured peak reached 32.

Now `limit = max(4, VOICE_BUDGET - (MAX_PRIORITY - priority) * 4)`: higher
priority gets more of the budget, and `VOICE_BUDGET` is a hard ceiling for
everything. Measured peak dropped 32 → 24.

### Defect 2 — the player's own footsteps outranked gunfire

Set to the top priority they could consume the entire budget alone and mask the
shots being fired at the player. Demoted below gunfire. In the load test that
moved gunfire voices from **0 to non-zero** while shots were being fired.

### Sound work

- **Player rifle**: every shot was byte-identical and responded the same indoors
  as in the open. Now four layers — mechanical transient (2.6 kHz, 12 ms), blast
  body, low-frequency weight, and a tail that carries the room — each varied
  ±6% per shot. Indoors the tail is louder, longer and darker (gain 0.26 vs 0.11,
  0.46 s vs 0.3 s, reverb 0.5 vs 0.18). Indoor state is sampled every 15 frames
  from `world.zoneAt`, not queried per shot.
- **Impacts** were one burst with two branches, so concrete, wood and glass were
  indistinguishable and a body hit sounded like a wall hit. Now a per-material
  table (flesh / metal / glass / wood / concrete / brick / foliage / fabric) with
  per-hit variation, and flesh gets an extra low thud so it reads as mass.
- **Near-miss crack**: enemy rounds that miss are projected onto their own shot
  line to find closest approach to the listener; inside 3.2 m they crack. Costs
  one dot product per missed shot, no new ballistics.
- **Player feedback** that had no audio at all: kill confirmation (higher and
  doubled for headshots), player death (descending body plus a long dark wash),
  respawn, deployment, victory and defeat stings, low-health ringing under 35 hp,
  and match-point / lead-change stingers. The UI announcement path was visual
  only; it now emits `match:announce` so audio can sting it without re-deriving
  lead state.
- **Reload** was one anonymous rustle; it is now three mechanical moments so the
  player can hear where in the cycle the weapon is.

### Instrumentation and the load test

`npm run audio:load` (`tools/audio-load.mjs`) launches with autoplay permitted,
unlocks the context with a real gesture, and runs 90 s of 6v6 combat. The normal
gates cannot catch audio faults: headless harness runs never unlock a context, so
`state` stays `uninitialized` and every counter reads zero.

Reported: peak voices vs budget, drops split by budget vs distance, voices by
category, peak and average spatial voices, and context state. It fails on a
faulted context, a peak above the ceiling, silence during combat, or gunfire
being starved while shots are fired.

Result: **context `running`, peak 24 against a budget of 24, no fault** across
90 s of sustained combat.

One measurement bug fixed on the way: the tool first read the post-run bridge
snapshot, but `runCombatSoak` builds its result and *then* does a verification
`engine.reset()` which zeroes every counter — so it was measuring the reset. Same
class of bug as the `result.human` defect in pass 11. It now reads the scenario's
own snapshot.

### Known limitations

- **Per-category voice mix under the load test is not representative.** The
  scenario simulates synchronously, so the main thread never yields and WebAudio
  cannot deliver a single `ended` callback for the entire run — no voice ever
  retires, the budget saturates early, and 1500+ later sounds are dropped. Peak
  and ceiling are meaningful because `canPlay` gates on the same counter;
  steady-state mix is not. Measuring that properly needs a chunked scenario that
  yields, which was not built.
- Audio is verified by measurement and code review, not by listening.
- Priorities 4-7 (weapon presentation, character presentation, match
  presentation, environment polish) are not started.

---

## Pass 14 — weapon presentation

### Architecture diagnosis first

The viewmodel is a **single rigid group**. Rifle, gloved hands, fingers, knuckle
plates and sleeves are all added to `this.group` via `makePart`, so nothing can
move independently of anything else. Staged hand animation — a support hand that
actually pulls a magazine — would require re-parenting the hands and magazine
into their own sub-groups.

Per the instruction not to fabricate hand animation the architecture cannot
support cleanly, that re-parenting was **not** attempted. The reload was improved
within what a rigid group can express, and the limitation is recorded rather than
papered over.

One suspected defect was investigated and **dismissed**: what looked like a
floating detached hand in the hip-idle frame is the tan `accent` magazine, which
is where it belongs. The hands and sleeves are correctly placed and connected.
No geometry was changed on the strength of a misread frame.

### Fixed

- **Weapon bob was time-driven** (`sin(t * 7.7)`, `cos(t * 15.4)`) — the third
  instance of this defect after the camera and the bots. The weapon rose while
  the footstep fell. It now rides the player's own `bobPhase`, the same phase
  driving the camera and the footstep audio, so all three are locked together.
- **No inertia at all.** The rifle was welded to the camera, so whipping the view
  moved the weapon as if painted on the lens. It now lags the view: angular
  velocity of yaw/pitch drives damped sway (clamped so a fast flick cannot throw
  it off screen), plus translation drift so starting and stopping has weight.
  ADS tightens sway to 28%, since an aimed weapon is braced.
- **Recoil was translation only** — the rifle slid but never rotated, which is
  what made repeated fire read as a moving prop. Firing now adds a rotational
  kick about the grip plus a little roll, recovering on a slower curve (damp 11)
  than the positional recoil (damp 18), so a burst climbs and settles instead of
  buzzing symmetrically. ADS halves the visual kick.
- **Reload was one sine arc across the full 1.95 s** — the definition of
  procedural motion. It is now staged against the same timeline the audio uses:
  cant over (t<0.3), held clear while the magazine drops (t<0.52), firm push back
  to level as the fresh magazine seats (t<0.78), then a short sharp charging
  handle jolt. Verified from frames: the magazine-clear beat drops the rifle well
  out of the sight line, clearly distinct from hip idle.
- **No muzzle smoke.** Sustained fire produced a flash and nothing else, so the
  barrel never read as hot. Smoke now puffs off the muzzle on roughly 45% of
  shots, reusing the existing smoke pool so no new voices or draw calls.

### Capture rig

`runAction('stage_weapon')` + `tools/weapon-shots.mjs` capture 14 states: hip
idle, walk, sprint, ADS in, ADS idle, single shot, burst, recoil recovery, ADS
shot, three reload beats, turn inertia and landing.

Every state is reached by driving the same virtual inputs a player uses — `fire`,
`ads`, `reload`, `sprint`, and a real `injectLook` flick for the turn — with no
viewmodel pose written directly. The engine is left paused so the captured frame
is the staged frame, the same discipline the character rig needed. The action
returns the weapon snapshot, so ADS blend and ammo are checkable per frame
(measured: ADS 0.00 → 0.70 → 1.00, ammo decrementing, reload engaged).

### Known limitations

- Independent hand/magazine animation needs the viewmodel split into sub-groups.
  Not attempted this pass; the reload reads as staged but the hands still move
  rigidly with the rifle.
- Combat-feedback synchronisation (trigger → flash → audio → tracer → impact →
  hitmarker) was reviewed in code and is single-frame coherent, but was not
  measured frame-by-frame against a timeline.
- Priorities 5-7 (character presentation, match presentation, environment polish)
  are not started.

---

## Pass 15 — character presentation, then the worst environment zone

### Character: two suspected defects investigated, one real

The rig was extended with the states the previous pass lacked — `aim`, `fire`,
`aim-move`, `decel` — all driven through production paths (the bot is given a
real target and left to run its own engage behaviour; `decel` accelerates under
`moveBot` then stops so the gait's response is visible).

**Dismissed after inspection**: the rifle appeared to be held in a lowered carry
during firing. It is not — the rifle group sits at chest height with
`rotation.x = -0.08`, essentially level, and what read as "pointing down" was
foreshortening from the three-quarter camera. No geometry was changed. This is
the second time a frame-read alone would have caused a wrong rebuild (the first
was the "floating hand" that turned out to be the magazine), which is why the
capture rig reports numbers alongside the image.

**Real and fixed**: the rifle transform was *identical* whether the bot was
idling, walking or shooting, and it never pitched toward a target's elevation —
a bot on the street engaged the terrace with a perfectly level weapon. There is
now an `aimBlend` that tucks the rifle toward the shoulder (x 0.16 → 0.07,
y 1.2 → 1.29) and pitches it to the target's elevation, clamped to ±0.5 rad,
with gait sway on the weapon fading out as it comes up.

The offsets are deliberately small. **Architecture limit**: the arms are baked
into the merged body mesh — only `legs` and `rifle` are separate groups — so the
arms cannot follow the weapon. Moving the rifle further would tear it away from
the hands. A proper shouldered aim needs an upper-body group holding torso, arms
and rifle together; that is the minimum safe structural change and it was **not**
attempted here.

### Environment: alpha-yard

The zone map-director measured as the worst on the map — **25.9% of walkable
area for 0.49% of kills** — and the capture confirmed it: a flat pale slab, one
unbroken wall of repeated pilasters, a single sign. No props, no cover, no
vertical reference, no ground detail.

The existing staging clutter was all within 16 m of the front line; the rear half
was the 6 m deep, 90 m wide clear band that had been measured. Added, clustered
into two readable groups rather than scattered:

- an open-sided **vehicle canopy** per side, with fuel drums and pallet stacks
- a **comms mast** — the yard's landmark and its only vertical reference — with
  a generator and cable run at its base
- **floodlight masts** washing the back wall
- **painted bay markings** on ground that previously had no detail at all

Both yards get this; it is scaled as a fraction of yard depth because alpha is
24 m deep and bravo only 11 m. A first attempt used fixed offsets and put the
canopy at z 46 and the mast at z 54 — outside the yard and, for bravo, outside
the map. Caught by capture, not by the gates.

### Validation

All six fast gates, the production gate (**6/6 seeds ending by score limit**),
audio load (context running, peak 24/24), and both capture rigs (12 character
frames, 14 weapon frames) are green.

### Known limitations

- Bot arms cannot follow the rifle without an upper-body group (above).
- Match presentation (priority 6) was reviewed rather than rebuilt: the loop
  already carries briefing, deploy countdown, HUD, kill feed, scoreboard, death
  card, per-player end card and rematch, and the independent gameplay review
  called it the strongest part of the project. No changes made.
- Environment polish covered alpha-yard and bravo-yard only. north-junction's
  cover gap (p90 12.5 m to cover, 25.7% of nodes over 6 m), the perimeter
  margins, the arcade's isolation and facade repetition elsewhere are untouched.
- The yards' ground is still a large flat expanse away from the new markings.

---

## Pass 16 — final adversarial review and repair

Three independent reviews were run against the live build: **qa-auditor**,
**visual-critic**, **combat-designer**. Each re-ran gates itself rather than
trusting this document.

### qa-auditor — PASS, one gap closed

Re-ran every gate independently and reproduced the capture rigs' numeric tables
exactly. Confirmed the production gate is not vacuous (production mode skips
`configureRules` entirely), found **no further instances** of the post-reset-read
bug class, and confirmed the capture rigs drive production systems rather than
posing for the camera.

One real gap, now fixed: `tools/gameplay-production.mjs` discarded the `errors`
array from `newHarnessPage`, so six ~400-600 s production matches — the longest
runs in the suite — could not fail on a browser-level error. It now asserts, like
the soak and check gates.

### visual-critic — three defects, all fixed, two of them my own regressions

1. **Every sign on the map was UV-destroyed; 5 of 9 rendered blank.** `box()`
   applied `scaleBoxUvs` unconditionally, but `createSign` produces *fitted*
   512x128 canvases that must map 0..1. With clamp-to-edge the text row fell
   outside the face entirely. A regression from the per-face UV work in `a0a669e`,
   proven against a pre-regression artifact. Fixed with a `fitUv` opt-out applied
   at all 9 sign sites — **including the geometry cache key**, or a sign would
   have shared cached geometry with a same-sized wall. ALPHA/BRAVO STAGING now
   read in full; previously cropped to 18% of the face.
2. **Ten poles built through the tents in both spawn yards.** My pass-15 staging
   placed the canopy, mast and floodlights as fractions of yard depth while the
   tent row stayed at a fixed 8 m offset. In bravo's 11 m yard the fractions
   collapsed onto the tents and skewered all four legs of the comms mast — the
   zone's own registered landmark — through the centre tent. Tents now derive
   from the same fraction, sit between the pole lines, and skip any slot a pole
   claims.
3. **The yards were lit as daylight inside a night map.** Ground luminance
   measured 172 against a sky of 17 (10.2x) while the market sits at 1.2x. Root
   cause was not a light bug: the yards floor 100 m x 24 m of unoccluded ground
   in `concrete`, 2.3x the albedo of the market's asphalt, under a midday sun rig
   the market hides behind buildings. Fixed with a dedicated darker `yardSlab`
   material — **the market is untouched**. Now 47.6 against sky 12.7 (3.8x); some
   gap is correct, since a yard is genuinely open where a street is shaded.

### combat-designer — three defects, all fixed

Measured on the live build through production systems, not read from code.

1. **Recoil never recovered.** `applyRecoil` added to `this.pitch` and nothing
   anywhere subtracted it: a held trigger climbed **+16.05 degrees** over one
   magazine, monotonically, and stayed there after release — **3 of 30 rounds
   landed**. Worse, the viewmodel's own kick *did* damp back, so the player
   watched the rifle settle onto the crosshair while their aim was 16 degrees
   into the sky. Now `applyRecoil` records the debt and `recoverRecoil` returns it
   after a short delay, with player look input paying the debt down first so
   pulling against the climb is not undone a moment later.
2. **90% of body hits reported `fabric`/`metal`/`glass`, not `flesh`.** Only the
   bare head sphere and neck carried flesh, and both sat *inside* a larger metal
   helmet. So a torso hit threw world-dust particles and smoke, stamped a bullet
   decal into the air where the man's chest was, and played `fabric` at gain 0.09
   — quieter than concrete. The blood tint and flesh thud added in passes 13-14
   were unreachable in normal play. All character parts now report flesh; the
   held rifle keeps its own material. Also fixed: `spawnDecal` was declared with
   two parameters and called with three, silently discarding the surface.
3. **Incoming fire produced no world impact at all.** `fireAt` resolved damage by
   a dice roll and never touched the world — measured 27 rounds fired at the
   player, **0 impact events**. No dust off the wall, no decals, no impact audio,
   and nothing at all before the first hit landed. Misses now cast one ray and
   emit a real `projectile:impact`; hits emit a flesh impact at the target.

### Final validation

| check | result |
|---|---|
| 5 fast gates | all exit 0 |
| production gate | **6/6 seeds by score limit**, now asserting browser errors |
| multi-seed soak | kills 32.8, human K/D 0.93, human share 20.8%, spawn deaths 1.62% |
| audio load | context running, peak 24/24 |
| capture rigs | 12 character, 14 weapon frames |

### Honest limitations

- **The recoil fix is verified by construction and by green gates, not by
  re-running the reviewer's live measurement.** I could not reproduce their probe
  harness in the remaining budget; my own probe never triggered fire (peak read
  0 degrees, i.e. no recoil applied at all), so it measured nothing either way.
  This should be re-measured before the next milestone.
- **Player-vs-bot TTK remains asymmetric: 0.176 s against 4.73 s (~27x).** Pass
  10's rebalance was tuned against the deliberately handicapped scripted driver,
  not against the two weapon models directly. Matches between bot teams are
  competitive (both teams win across seeds) but a 1v1 against a human is not a
  duel. This needs real-human tuning data the harness cannot produce.
- Recorded, not fixed: tracers and muzzle flashes ignore team while audio uses
  it; the crosshair widens with movement though spread does not; the rifle fires
  at 600 RPM not the declared 680 (sub-step remainder discarded); the three
  reload timelines (viewmodel / HUD / audio) do not align; bot LOS is a single
  chest ray so partial cover is binary; one shared impact sprite across all
  combatants; player camera has no interpolated `update`, so aim is quantized to
  60 Hz.

---

## Pass 17 — both blockers closed; milestone assessment

### Priority 1 — recoil recovery independently verified

The previous probe failed because `stage_weapon` leaves the engine paused, so the
follow-up `runAction('fire')` advanced nothing and silently reported zero
displacement either way. The fix was the measurement, not the recoil.

`npm run recoil:verify` (`tools/recoil-verify.mjs` + `runAction('measure_recoil')`)
fires a controlled magazine through the real input and weapon path — nothing
writes pitch directly — and reports its own diagnostics so a run that fails to
fire is visible rather than silent.

| point | displacement |
|---|---|
| round 1 | 0.495 deg |
| round 6 | 3.165 deg |
| round 15 | 8.386 deg |
| at release (30 rounds) | **15.969 deg** |
| +250 ms | **0.000 deg** |
| +500 ms / +1 s / +2 s | 0.000 deg |
| **final residual** | **0** |

It reproduces the reviewer's +16 deg climb exactly and then recovers completely.
The gate also fails if the magazine does not fire, if recoil does not displace
aim, if residual exceeds 1 deg, or if the viewmodel reads settled while the aim
is still displaced. **The implementation was correct and has been left alone.**

One bug in the rig itself was fixed on the way: peak tracking compared a radian
pitch against a value already converted to degrees, so the peak froze after frame
one and under-reported 15.97 deg as 0.495.

### Priority 2 — the 27x asymmetry was two unrelated combat models

Audited separately:

| | player | bot (before) |
|---|---|---|
| resolution | deterministic hitscan | capped dice roll |
| damage | 34 | 16-21 (10% head x1.7) |
| effective rate | ~11 shots/s continuous | **~3.3 shots/s** |
| duty cycle | 100% | burst 0.36 s, pause up to 1.15 s — **~70% silent** |
| to-hit ceiling | player-controlled | 0.54 |
| target state | n/a | **ignored entirely** |

The dominant terms were the duty cycle and the fact that **nothing about the
target's behaviour entered the roll** — moving, crouching and using cover changed
a bot's hit chance by exactly nothing, so the player had no way to influence
incoming fire except by leaving line of sight altogether.

Fixed by changing the model, not the numbers:

- to-hit becomes `clamp(0.78 - 0.011d - evasion*0.3 - crouch*0.08, 0.14, 0.66)`,
  where evasion is the target's own speed normalised to a sprint
- inter-burst pause 0.55-1.15 s -> 0.32-0.62 s, so sustained contact is sustained;
  the burst structure is kept because it is what makes several shooters readable
  as separate sources
- **damage is unchanged**, and the player's weapon is untouched

### Duel benchmark (new, deliberately separate from the soak)

`npm run duel:bench` measures the combat *model* under controlled conditions —
the scripted-human soak measures how well a handicapped driver plays a match,
which is the wrong instrument for "is being shot at dangerous". 3 seeds x 6 cases.

| case | before | after |
|---|---|---|
| bot TTK, stationary 5 m | 4.73 s | **1.80 s** |
| bot TTK, stationary 20 m | — | 2.14 s |
| bot TTK, moving 5 m | — | **2.48 s (1.38x survival)** |
| breaking LOS | — | **survived 3/3 at full health** |
| player TTK vs bot | 0.176 s | 0.259 s |
| **model ratio** | **27x** | **7.0x** |

Its thresholds come from design intent, not from what the build happens to do: an
exposed stationary player must die inside 3 s but not under 0.8 s, movement must
buy at least 15% more life, breaking line of sight must work, and the model ratio
must stay under 12x.

### Final validation

| check | result |
|---|---|
| 5 fast gates | all exit 0 |
| production gate | 5/6 by score limit, 1 by time limit at 39-37; both teams win |
| multi-seed soak | kills 29.7, human K/D 1.12, share 26.4%, spawn deaths 2.04%, no-contact p90 **11.9 s** |
| recoil verification | residual 0 deg |
| duel benchmark | all cases pass, ratio 7.0x |
| audio load | context running, peak 24/24 |
| character / weapon capture | 12 / 14 frames |

Gate D also came back under its 15 s flag (19.2 -> 11.9 s) as a side effect of
bots contesting ground more consistently.

## Final assessment

**1. Does it feel like a complete game rather than a tech demo?**
Yes, with one geographic caveat. A player boots into a briefing, deploys, fights
a 6v6 match that reliably resolves on the real score limit in 6-10 minutes, dies,
respawns, reads a kill feed and scoreboard, reaches a real victory or defeat with
per-player statistics, and can rematch into a differently-seeded match. Both teams
win across seeds. The preserved Sable Market reads as a finished game; the
deployment yards, though much improved this milestone, still read as the weakest
ground.

**2. Three strongest aspects.**
- The match loop and its presentation — independently called the strongest part
  of the project, and it now runs on verified production rules.
- The weapon: layered audio with indoor response, inertia, rotational recoil that
  recovers, staged reload, muzzle smoke, stride-locked bob.
- The validation suite itself: eight independent gates, every one of which has
  caught a real defect that code review missed.

**3. Three most obvious remaining weaknesses.**
- Bot arms are baked into the merged body mesh, so they cannot follow the rifle;
  aim posture is a compromise within that limit.
- Tracers and muzzle flashes ignore team while the audio uses it.
- The deployment yards remain the weakest zones visually, and 11 of 66 bots still
  finish a soak run without scoring.

**4. Is anything severe enough to block the milestone?**
No. Both blockers raised by the final review are closed and independently
measured. Everything remaining is a quality gap, not a broken system.

**5. What should be deferred rather than polished now?**
Splitting the character viewmodel into an upper-body group; team-coloured tracers
and muzzle flashes; the crosshair advertising a movement penalty that spread does
not implement; 600 vs the declared 680 RPM (sub-step remainder discarded); the
three unaligned reload timelines; single-ray bot LOS making partial cover binary;
one shared impact sprite; the player camera having no interpolated update, so aim
is quantised to 60 Hz; north-junction's cover gap; empty perimeter margins;
arcade isolation.

**Milestone declared complete.**

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
