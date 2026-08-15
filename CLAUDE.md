@AGENTS.md

# Claude Code instructions

This project was previously developed with Codex and is being continued with Claude Code.

The repository itself is the source of truth. Do not restart completed systems.

Before substantial work, read:

- FIRST_PROMPT.md
- ARCHITECTURE.md
- GAME_SPEC.md
- docs/QUALITY_BAR.md
- docs/PROCESS.md
- docs/HARNESS_CONTRACT.md

Preserve and use the existing harness.

For every meaningful implementation pass:

1. Inspect the current repository state.
2. Identify the highest-impact remaining quality problem.
3. Implement the fix or improvement.
4. Run the appropriate build and harness validation.
5. Investigate failures rather than bypassing or weakening validation.
6. Visually inspect generated artifacts when relevant.
7. Continue toward the goal in FIRST_PROMPT.md.

The primary goal is the highest achievable modern AAA military FPS quality and gameplay feel in this Three.js project.

Do not blindly follow critic suggestions. Diagnose root causes using code, measurements, screenshots, and runtime evidence.

Use subagents for independent exploration, review, visual criticism, and performance analysis when useful. Avoid multiple agents concurrently editing tightly coupled systems.
