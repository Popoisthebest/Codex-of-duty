---
name: reproducible-capture
description: Use when creating visual baselines, comparing screenshots, diagnosing nondeterministic captures, or proving a change has zero visual output difference.
---

# Reproducible Capture

1. Use `npm run harness:baseline`.
2. Every named shot must open in a fresh browser context/page.
3. Reset with explicit seed.
4. Set the named shot.
5. Advance a fixed number of harness frames.
6. Capture at fixed viewport and DPR.
7. Repeat the same baseline into another directory.
8. Run image diff.
9. If identical runs differ, do not use image diff as an optimization gate yet.
10. Investigate:
   - wall-clock animation,
   - uncontrolled RNG,
   - async readiness,
   - exposure history,
   - particles,
   - transient buffers,
   - browser/environment mismatch.
