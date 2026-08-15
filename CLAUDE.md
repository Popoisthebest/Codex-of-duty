# Codex of Duty — Claude Code Project Memory

@AGENTS.md
@GAME_SPEC.md
@docs/GAMEPLAY_QUALITY_BAR.md
@docs/GAMEPLAY_HARNESS_CONTRACT.md

## Mission override

This repository already contains substantial FPS rendering, weapon, material, map, AI, harness, and performance work.

Do not restart the project.

The current highest-priority defect is not visual fidelity. It is that the project risks behaving like a visually polished FPS technology demo instead of a complete game.

Until the gameplay gates in this repository pass, prioritize:

1. complete match loop
2. meaningful map scale and route structure
3. team combat and bot activity
4. spawn / death / respawn quality
5. score / victory / defeat / restart
6. encounter pacing and combat readability

Preserve strong existing weapon, rendering, material, FX, audio, and world work unless a gameplay requirement demands a change.

## Operating rule

Use subagents aggressively for independent inspection, criticism, map review, AI review, QA, visual review, and performance analysis.

Keep tightly coupled implementation changes under one coherent writer whenever possible.

Do not weaken a validation gate merely to make it pass.

Do not claim a gameplay milestone is complete from code inspection alone. Run the game and collect evidence.

## Required read order for a major pass

1. `FIRST_PROMPT.md`
2. `ARCHITECTURE.md`
3. `GAME_SPEC.md`
4. `docs/GAMEPLAY_QUALITY_BAR.md`
5. `docs/GAMEPLAY_HARNESS_CONTRACT.md`
6. `docs/GAMEPLAY_ROADMAP.md`
7. current git status / recent history
8. relevant source and artifacts
