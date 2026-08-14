---
name: performance-pass
description: Use when FPS, frame hitches, boot time, shader compilation, draw calls, geometry cost, particles, AI cost, or render scalability must be measured or optimized.
---

# Performance Pass

1. Establish a reproducible moving-gameplay scenario.
2. Record a before profile.
3. Use frame-time p50/p95/p99/worst and long-frame counts.
4. Record renderer metrics from harness when available.
5. Ask `performance_analyst` for evidence-backed bottleneck hypotheses.
6. Change one dominant bottleneck at a time.
7. Record after profile with the same settings.
8. If intended visual output is unchanged:
   - capture before/after under the same seed,
   - run pixel diff.
9. Reject optimizations that improve median while introducing severe tail hitches.
10. Re-run playtest after performance changes.
