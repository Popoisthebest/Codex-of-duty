You are continuing an existing Three.js first-person shooter that already has substantial work invested in weapon presentation, rendering, materials, environment art, effects, AI foundations, and automated validation.

The project currently looks much better than it plays.

Your primary job now is to transform it from a polished FPS technology demo into a genuinely playable modern military FPS game.

Do not restart the project, throw away strong existing systems, or spend the first major passes on cosmetic polish.

The highest-priority target is a complete offline 6v6 Team Deathmatch vertical slice:

- one human player plus five allied bots versus six enemy bots
- a real pre-match → active match → victory/defeat → restart loop
- 100-kill score limit and a sensible time limit
- deaths, respawns, spawn selection, spawn safety, team scoring and kill feed
- scoreboard and clear match-state UI
- bots that traverse the map, seek combat, reposition, use cover where appropriate, die and respawn
- a substantially larger and more tactically interesting map than a tech-demo arena
- multiple recognizable combat zones
- multiple routes between important areas
- indoor and outdoor combat
- meaningful sightline variation
- at least two meaningful elevation bands
- enough spawn locations and route loops that repeated deaths do not feel identical
- fast re-entry into combat without constant spawn killing
- continuous encounter pacing so the player is not wandering through an empty map
- a complete match that can actually be played for several minutes and has a meaningful goal

Preserve the existing visual quality. Reuse and extend the existing environment kit rather than replacing polished work with low-quality filler.

The map must become larger without becoming empty. Density, landmarks, routes, cover, sightlines and encounter pacing matter more than raw square meters.

Treat gameplay as a first-class engineering target. Add telemetry and deterministic harness support where needed so the following can be verified rather than asserted:

- match starts correctly
- kills change the correct team score
- death occurs through the real damage system
- respawn occurs through the real respawn system
- scoreboards agree with authoritative match state
- a match ends at the score limit
- a winner is declared
- restart returns to a clean new match
- 12 combatants participate in the 6v6 match
- the map meets the v3 scale/structure contract
- long-running combat does not produce non-finite state, dead AI loops, or catastrophic runtime errors

Read and follow:
- CLAUDE.md
- AGENTS.md
- ARCHITECTURE.md
- GAME_SPEC.md
- docs/GAMEPLAY_QUALITY_BAR.md
- docs/GAMEPLAY_HARNESS_CONTRACT.md
- docs/GAMEPLAY_ROADMAP.md

Use the existing visual/performance harness and the new gameplay harness.

Use subagents for independent reviews. A gameplay director should harshly assess whether the result is actually fun and complete. A map director should assess traversal, route choice, sightlines, spawn flow and combat density. An AI reviewer should assess whether bots behave like participants in a match instead of target dummies. A QA reviewer should independently challenge completion claims.

For tightly coupled implementation, prefer a coherent main owner over many agents editing the same systems concurrently.

Do not blindly implement reviewer prescriptions. Treat reviewer comments as symptoms, inspect evidence, find the actual root cause, then fix it.

Do not bypass or weaken tests to obtain green output.

Use legal/original/appropriately licensed assets or procedural content when useful. Never copy proprietary Call of Duty maps, models, textures, audio, logos or UI. The target is the class of responsiveness, polish and gameplay completeness, not copied content.

Required development loop:

inspect
→ define an observable gameplay acceptance target
→ implement one coherent gameplay pass
→ build
→ run harness checks
→ run gameplay checks
→ actually play/run the game
→ inspect screenshots/runtime evidence
→ ask independent reviewers
→ repair the highest-impact defects
→ repeat

Do not stop because the game launches.

Do not stop because the gun looks good.

Do not stop because bots can shoot.

Do not stop because a large map exists.

The milestone is complete only when it behaves like a real replayable 6v6 TDM match and passes the gameplay quality gates, while preserving the existing strong visual quality.
