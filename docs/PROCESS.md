# Process

## Pass 0 — Foundation

- engine/context
- deterministic RNG
- system registry
- input
- fixed timestep
- harness bridge
- minimal renderer
- minimal world

Gate:
- build
- harness check
- deterministic reset

## Pass 1 — Playable Combat

- player controller
- weapon state
- physics queries
- one enemy
- damage
- HUD
- basic audio

Gate:
- playtest

## Pass 2 — Visual Foundation

- procedural material system
- lighting/environment
- denser world
- weapon/viewmodel
- hands
- core FX

Gate:
- 11-shot baseline

## Pass 3 — Combat Quality

- recoil/camera
- movement transitions
- AI cover/reposition
- impact feedback
- audio layering

Gate:
- playtest + visual critique

## Pass 4 — Performance

- profile in motion
- identify p99/worst hitches
- shader/program stability
- prewarm where needed
- allocations/draw calls/triangles

Gate:
- profile + pixel diff if visual-neutral

## Pass 5 — Adversarial Review

Independent critics:
- visual
- gameplay
- verification
- architecture
- performance

Main agent groups defects by root cause and fixes one coupled concern at a time.

## Pass 6 — Final

- clean boot
- clean build
- playtest
- deterministic baseline twice
- diff reproducibility
- 3 profile runs
- known limitation report
