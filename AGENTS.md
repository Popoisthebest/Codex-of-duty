# Codex of Duty — Agent Operating Manual v3

## Mission

Build a high-quality browser FPS that is first and foremost a complete game.

The repository may already have excellent weapons, materials, lighting or environment art. Those are not sufficient for completion.

For the current milestone, gameplay completeness outranks additional cosmetic polishing.

Read:
1. `FIRST_PROMPT.md`
2. `ARCHITECTURE.md`
3. `GAME_SPEC.md`
4. `docs/GAMEPLAY_QUALITY_BAR.md`
5. `docs/GAMEPLAY_HARNESS_CONTRACT.md`
6. relevant source/tests/tools

## Priority stack

Until the v3 gameplay gates pass:

1. match loop
2. map layout and traversal
3. spawn / respawn
4. team AI participation
5. encounter pacing
6. scoring / win / loss / restart
7. combat feel and readability
8. regression-free visual quality
9. visual polish beyond the existing baseline

Do not spend large passes on bloom, micro-material variation, weapon cosmetics or other visual details while a fundamental gameplay gate is red.

## Single-writer rule for coupled systems

Main implementation ownership should remain coherent for:
- match state
- team state
- spawn system
- AI navigation/combat integration
- map/nav representation
- gameplay HUD state
- deterministic harness bridge

Subagents are strongly encouraged for:
- read-heavy exploration
- gameplay criticism
- map criticism
- AI behavior review
- visual regression review
- performance analysis
- QA audit

Avoid multiple agents concurrently editing tightly coupled gameplay state.

## Required loop

### 1. Inspect

- `git status`
- relevant recent changes
- current architecture
- current harness behavior
- existing screenshots / profiles / reports
- current actual gameplay

### 2. Define acceptance

Every pass must have observable success conditions.

Bad:
`make the map better`

Good:
- add two route loops between central and flank zones
- create two indoor/outdoor transitions
- add spawn-safe access from both team ends
- keep first-contact time within target without exposing direct spawn-to-spawn sightlines

### 3. Implement a coherent vertical change

Prefer a complete gameplay path over broad unfinished scaffolding.

Example:
`death → respawn selection → safe spawn → HUD reset → AI reacquisition`

is better than partially touching five unrelated systems.

### 4. Build

```bash
npm run build
```

### 5. Existing deterministic contract

```bash
npm run harness:check
```

Never weaken deterministic/reset checks to hide defects.

### 6. Existing smoke playtest

```bash
npm run harness:playtest
```

### 7. Gameplay contract

For match/gameplay changes:

```bash
npm run gameplay:check
```

For map/layout changes:

```bash
npm run gameplay:map-audit
```

### 8. Real play/run

Automated state checks do not prove fun.

Actually run the game. Observe:
- time to first meaningful combat
- downtime after respawn
- spawn deaths
- route choice
- sightline variety
- map landmark readability
- bot density
- team movement
- repetitive combat patterns
- whether the player understands how to win

### 9. Independent review

Use:
- `gameplay-director`
- `map-director`
- `ai-director`
- `qa-auditor`

As needed:
- `combat-designer`
- `visual-critic`
- `performance-analyst`

Reviewers should report symptoms and evidence. Main agent diagnoses root cause.

### 10. Repair and rerun

After fixes, rerun the full relevant gates.

A local targeted test is not final evidence.

## Gameplay milestone: 6v6 TDM

The player counts as one member of a six-person team.

Target:
- human + 5 allied bots
- 6 enemy bots
- score limit 100
- time limit
- authoritative match state
- kill / death attribution
- respawn
- scoreboard
- kill feed
- match end
- winner
- clean restart

The bots must be match participants, not decoration.

## Map rule

"Make the map larger" does not mean scaling coordinates or adding empty streets.

A successful map adds:
- recognizable zones
- interconnected routes
- flanking choices
- sightline variation
- cover rhythm
- indoor/outdoor transition
- vertical options
- spawn depth
- route loops
- navigation landmarks

Avoid one-room arenas, one-corridor streets and long empty travel.

## Encounter pacing

The player should not regularly wander for long stretches without a plausible combat decision.

Conversely, spawning into unavoidable fire is also failure.

Optimize:
- first-contact time
- respawn-to-contact time
- route diversity
- fight duration
- recovery opportunities
- spawn safety

Do not optimize "constant action" into chaotic spawn killing.

## AI rule

AI should:
- navigate intentionally
- seek useful positions
- acquire enemies
- engage at sensible ranges
- break line of sight when appropriate
- reposition rather than freeze
- avoid permanent deadlocks
- die and respawn
- contribute to team score
- spread through the map instead of forming one permanent blob

Perfect human imitation is not required for the first milestone. Match participation is.

## Harness truthfulness

Do not satisfy `getGameplayReport()` or `runScenario()` by fabricating metrics unrelated to production systems.

Harness scenarios must exercise the same authoritative game systems used during normal gameplay, with deterministic input/control replacing only user timing and randomness where necessary.

Do not mutate final score directly to simulate a kill.
Do not toggle `dead=true` directly to claim the damage pipeline works.
Do not return hard-coded pass values.

## Visual preservation

Existing strong visual work is an asset.

Gameplay expansion may reuse kits, modular geometry, materials and lighting.

Do not replace polished areas with huge amounts of visibly inferior filler merely to satisfy map scale.

When gameplay gates are green, resume aggressive visual refinement.

## Performance

A larger map and 12 active combatants create new performance risks.

Track:
- p50 / p95 / p99 frame time
- worst frame
- long frames
- draw calls
- triangles
- shader/program growth
- AI update cost
- boot/load time

Use LOD, instancing, spatial partitioning, AI update scheduling, pooling and visibility control where justified.

Never "optimize" by making gameplay empty.

## Completion rule

The project is not complete when:
- it builds
- it looks impressive in screenshots
- the weapon feels good
- four enemies can shoot
- the player can walk around a large environment

The gameplay milestone is complete when a user can launch the game, understand the goal, play a coherent 6v6 TDM match, die and re-enter combat, see score progression, reach a real victory/defeat state, restart, and want to play another round.
