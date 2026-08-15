---
name: map-expansion
description: Expand and redesign the current small/simple map into a dense, interconnected medium 6v6 FPS combat map without destroying existing visual quality.
---

Before editing:
- inspect current map structure and navigation
- ask `map-director` to identify the biggest topology/spawn/pacing problems
- preserve polished existing zones where practical

Implement meaningful topology, not coordinate scaling.

Required:
- >= 5 combat zones
- >= 3 route families
- >= 2 route loops
- meaningful indoor/outdoor combat
- >= 2 elevation bands
- >= 12 spawn candidates
- >= 4 landmarks
- dense enough cover/geometry to avoid empty travel
- no dominant direct spawn-to-spawn lane

After implementation:
- update real world metadata used by the gameplay report
- run `npm run gameplay:map-audit`
- run standard harness/build gates
- inspect the map in-game
- request independent map review
- fix pacing/spawn/readability issues
