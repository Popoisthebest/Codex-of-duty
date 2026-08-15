# Gameplay Quality Bar v3

## Purpose

This is the anti-tech-demo quality bar.

A beautiful screenshot is not evidence that the game is complete.

## Gate A — Complete match loop

Must be observable:

```text
launch
→ pre-match/ready
→ match start
→ movement/combat
→ kills
→ score progression
→ death
→ respawn
→ continued match
→ score limit or time end
→ victory/defeat
→ restart
→ clean new match
```

No manual page refresh should be required to start a new round.

## Gate B — 6v6 participation

Expected:
- 12 participants
- player + five allies
- six enemies
- all bots can enter combat
- dead bots return
- kills affect team score
- scoreboard is authoritative

A bot that exists only in metadata does not count.

## Gate C — Map is a combat map, not a showcase room

Minimum automated structure is defined in `GAME_SPEC.md`.

Manual questions:
- Can I name several distinct zones after one match?
- Are there several ways to move between major zones?
- Do routes reconnect?
- Is there a reason to choose one route over another?
- Are there short, medium and longer engagement opportunities?
- Are indoor/outdoor transitions meaningful?
- Is verticality tactically relevant?
- Can I recover after a fight?
- Is the map dense enough to avoid empty travel?
- Are there obvious spawn shooting lanes?

If most answers are no, the map gate is red even if its dimensions pass.

## Gate D — Encounter pacing

Red flags:
- >15 seconds of frequent aimless wandering
- repeated spawn death without a real decision
- most kills happening in one tiny location
- all bots converging into one permanent cluster
- enemy contact occurring only because enemies spawn nearby
- player repeatedly crossing the same route because alternatives are fake/dead ends

Target:
- action arrives quickly
- player still has route choices
- combat breathes enough to reload/reposition
- deaths create a new tactical situation rather than repeating the same one

## Gate E — Spawn quality

Required:
- several candidate spawns
- enemy proximity/visibility considered
- spawn choice varies
- no direct spawn-to-spawn sightline as a dominant pattern
- respawn returns the actor to valid state
- weapon/ammo/health/AI state are coherent

Track spawn deaths where practical.

## Gate F — AI match behavior

Bots should:
- move with purpose
- distribute across routes
- perceive and engage
- reposition
- recover from stuck state
- die and respawn
- create pressure in multiple zones

Bots do not need perfect human strategy for v3.

They do need to create the feeling that two teams are playing the same match.

## Gate G — Objective clarity

Within seconds of starting, the player should be able to infer:
- mode
- which team they belong to
- current score
- how to win
- whether they are winning/losing
- what happened when they died
- whether the match ended

## Gate H — Combat feel

Preserve the strong weapon work.

Review:
- aim responsiveness
- ADS clarity
- recoil/readability
- hit feedback
- kill confirmation
- damage direction/readability
- reload state
- audio/visual synchronization

## Gate I — Regression

Gameplay expansion cannot excuse:
- broken deterministic reset
- severe visual downgrade
- catastrophic frame-time regression
- browser errors
- non-finite physics/state
- broken input
- broken weapon loop

## Gate J — Replayability test

Before calling the milestone complete:

Play at least one representative match session or an equivalent accelerated but visually inspected sequence.

Ask:
- Did the match have a beginning, middle and end?
- Did different deaths lead to different encounters?
- Did I make route/position choices?
- Did bots create unexpected but plausible pressure?
- Did the score give context to fights?
- Would a user voluntarily start another round?

If it still feels like "walk around, shoot four bots, admire graphics", fail the gate.
