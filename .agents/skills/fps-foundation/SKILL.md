---
name: fps-foundation
description: Use when bootstrapping or repairing the core engine, deterministic context, subsystem registry, input loop, renderer foundation, or browser harness bridge.
---

# FPS Foundation

1. Read `ARCHITECTURE.md`.
2. Keep core APIs minimal and stable.
3. Establish deterministic RNG and fixed-step simulation before gameplay complexity.
4. Make `window.__COD_HARNESS__` real early.
5. Keep a minimal world and player spawn available during foundation work.
6. Run:
   - `npm run build`
   - `npm run harness:check`
7. Confirm two resets with the same seed return equivalent snapshot structure.
8. Do not build advanced visuals before boot/harness reliability exists.
