# Codex of Duty — Game Specification v3

## Product goal

Create an original modern military browser FPS in Three.js whose quality is judged by the combination of:

- responsive controls
- convincing weapon handling
- strong rendering/material/audio feedback
- intelligent-enough combatants
- readable combat spaces
- a complete replayable match loop

The goal is not to reproduce proprietary Call of Duty content.

## Current primary mode

### Offline 6v6 Team Deathmatch

Team A:
- 1 human player
- 5 allied bots

Team B:
- 6 enemy bots

Default rules:
- score limit: 100 kills
- time limit: 10 minutes
- clean pre-match state
- active match
- victory / defeat
- restart/rematch

The exact UI treatment may evolve, but the authoritative state must exist.

## Match systems

Required:
- teams
- rosters
- match phase
- match clock
- score limit
- team scores
- kill attribution
- death attribution
- kill feed
- scoreboard
- match winner
- end state
- clean restart

UI and simulation must use the same authoritative match state.

## Spawn / respawn

Required:
- multiple spawn candidates per team
- spatial separation from active enemies
- avoid direct enemy line-of-sight where practical
- avoid repeatedly selecting one point
- death → respawn delay → spawn
- player state reset
- weapon state reset
- AI state reset/re-entry
- brief protection or equivalent anti-spawn-kill logic if needed

A player should re-enter meaningful combat quickly without being repeatedly killed at spawn.

## Map target

Build a medium-scale original urban combat map.

Automated floor for the v3 milestone:
- playable width >= 80 m
- playable depth >= 80 m
- playable area estimate >= 7,000 m²
- >= 5 recognizable combat zones
- >= 3 primary route families
- >= 2 route loops
- >= 2 meaningful elevation bands
- >= 12 spawn points/candidates total
- >= 4 navigation landmarks
- >= 2 indoor combat zones
- >= 2 outdoor combat zones
- >= 2 indoor/outdoor transitions

These numbers are a minimum anti-tech-demo gate, not a guarantee of good design.

The map must not be made artificially large with empty space.

## Map design qualities

Aim for:
- recognizable zone identity
- readable spawn ends
- central conflict areas
- at least one meaningful flank on both sides
- route intersections with tactical choices
- short/medium/long engagement opportunities
- cover chains rather than random clutter
- vertical sightline changes
- safe-ish recovery pockets
- no obvious permanent spawn-to-spawn kill lane
- landmark-based navigation

## Player

Required:
- WASD
- mouse look
- sprint
- crouch
- jump
- lean where useful
- responsive acceleration/deceleration
- collision
- health/damage/death
- respawn
- movement and camera feedback that support aiming

Optional/high-value:
- slide
- mantle/vault
- tactical sprint

Only add movement mechanics when they are reliable and improve map flow.

## Weapons

Preserve and improve the existing high-quality rifle path.

Required:
- fire
- ADS
- recoil
- reload
- ammo
- hit response
- damage
- kill attribution
- surface impact feedback

Weapon feedback should integrate with match feedback.

A second weapon/loadout is lower priority than completing the match loop.

## Team combat AI

All 11 bots should be actual match participants.

Required:
- team affiliation
- navigation
- target selection
- perception
- firing
- damage/death
- respawn
- team scoring
- repositioning
- basic use of cover or line-of-sight breaks
- anti-stuck recovery

Desired:
- lane/zone preference
- local tactical spread
- flanking
- support spacing
- sensible engagement distance
- pressure/recovery rhythm

Avoid:
- stationary target-dummy behavior
- permanent clustering
- spawn camping loops
- every bot taking exactly the same path
- globally omniscient targeting

## Encounter pacing

Target qualitative behavior:
- meaningful contact shortly after spawning
- limited empty wandering
- enough recovery time to make decisions
- repeated route choice
- fights in multiple zones rather than one permanent kill box

Telemetry should record:
- first-contact time
- respawn-to-contact time
- kills by zone
- spawn deaths
- bot stuck time
- active engagement count
- per-zone population where practical

Do not treat one target number as universal truth. Use telemetry to find obvious pacing failures.

## UI

Required:
- crosshair
- health/damage state
- ammo
- score
- match clock
- team score
- kill feed
- death/respawn feedback
- scoreboard
- victory/defeat
- restart/rematch
- compact navigation cue (compass/minimap/equivalent)

The player must understand the match objective without reading source code.

## Audio

Preserve existing audio work.

Gameplay-critical cues:
- player weapon
- enemy/allied weapon distinction where practical
- impacts
- footsteps
- reload
- damage/death
- kill confirmation
- match start/end
- UI score/state cues

External assets may be used only if lawfully licensed/allowed and documented.

## Visuals

Existing visual fidelity must not regress badly due to gameplay expansion.

New map areas should reuse a coherent modular material/prop kit.

Prefer fewer high-quality coherent zones over a huge low-detail landscape.

## Content/IP rule

Allowed:
- original content
- procedural content
- user-created content
- appropriately licensed assets/libraries when they materially improve the game

Not allowed:
- copied Call of Duty maps
- ripped models/textures/audio
- copied logos/trademarks
- copied UI artwork
- proprietary game data

## Deterministic harness

Harness mode must support:
- seeded/resettable simulation
- fixed or explicitly stepped frames
- stable named states
- production match logic
- production death/respawn logic
- production team scoring logic
- deterministic scenario runners for QA

Harness-only control may inject deterministic inputs/events, but may not fake pass results.

## Performance

Desktop browser is the primary target.

Report:
- frame p50/p95/p99/worst
- long frames
- draw calls
- triangles
- renderer programs
- AI cost where practical
- active actor count
- boot-to-ready

The 12-player match should remain responsive.

## Development order

1. preserve current working visual baseline
2. authoritative match/team systems
3. 6v6 actor lifecycle
4. death/respawn/spawn safety
5. map expansion and route structure
6. navigation and team AI participation
7. HUD/score/end/restart
8. encounter pacing
9. gameplay automated gates
10. actual playability review
11. performance repair
12. renewed visual/animation/audio polish
