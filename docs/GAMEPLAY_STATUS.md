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

## Remaining highest-impact problems

1. **Environment filler** (visual critic, still open): staging yards repeat five
   identical tents and six identical crates across 100 m; the north junction has
   six identical barricades; `addWreck` and `addSandbagLine` are each one
   silhouette reused 10-20 times. Composition and prop variety, not scale.
2. **Elevation use remains thin** — elevated occupancy averages 6.5 samples per
   150 s run across all zones.
3. **Indoor zones still lightly used** — arcade 1.3% and east-offices 2.7% of
   occupancy; the arcade has only 9 nav nodes and is really a corridor.
4. **Market lighting trade unresolved** — hemisphere 1.86 and fog 0.0138 were set
   for the new zones before the shadow cascade was fixed. Now that shadowing
   covers the engagement range, the ambient lift may no longer be needed. Should
   be judged by eye, not by pixel-diff percentage.
5. **respawn-to-contact 11.2 s** with a 28 s median life — roughly a third of a
   life is spent travelling.
6. Not started: animation quality, character presentation beyond team colour,
   death/respawn presentation.

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
