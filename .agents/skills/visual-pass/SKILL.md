---
name: visual-pass
description: Use for rendering, lighting, sky, materials, world art direction, viewmodel appearance, procedural hands, FX, post-processing, or HUD visual quality changes.
---

# Visual Pass

1. Define the visible defect before editing.
2. Identify the coupled visual concern.
3. Do not parallel-write render/sky/material/exposure changes.
4. Capture the relevant named shots before the change when possible.
5. Make one coherent pass.
6. Run build and capture again.
7. Open the screenshots and inspect them directly.
8. Use `visual_critic` for adversarial review.
9. Treat critic fixes as hypotheses, not commands.
10. Measure root cause when lighting/material/exposure can explain the same symptom.
11. If the change is supposed to be pixel-neutral, run image diff.
12. Profile when the change adds geometry, shader variants, passes, particles, or lights.
