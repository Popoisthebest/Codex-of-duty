/goal Build a first-person shooter at the level of the most recent Call of Duty games. Do not stop until the game is as close as practically achievable to AAA quality and all available visual, gameplay, and performance validation has been repeatedly used to improve it.

I want you to build a first-person shooter at the level of the most recent Call of Duty games. It should be utterly exceptional, visually beautiful, with every single thing done at AAA quality—from textures and materials to lighting, animation, physics, gunplay, AI, audio, VFX, UI, environments, and anything else that contributes to the final game experience.

Use the project's AGENTS.md, ARCHITECTURE.md, GAME_SPEC.md, Skills, reviewers, playtest, screenshot, image-diff, and profiling harness throughout development.

Use sub-agents aggressively for independent exploration, gameplay review, visual criticism, performance analysis, architecture review, and verification. For tightly coupled systems such as rendering, lighting, sky, exposure, materials, and viewmodel lighting, keep implementation under a sequential single owner so agents do not break each other's assumptions.

Continuously iterate on every important part of the game. After each meaningful visual pass, use a separate sub-agent as an extremely harsh visual critic. It should judge the result against the visual quality bar of a current Call of Duty game. If it does not look AAA, identify the largest visible weaknesses, determine their actual root causes, improve them, capture the result again, and repeat.

Do the same for gameplay. Movement, aiming, ADS, recoil, firing, reloads, hit feedback, enemy behavior, animation, physics, audio, and combat flow should feel like parts of one polished game rather than independent technical features.

Actually run the game throughout development. Use the browser playtest, deterministic screenshots, visual review, image diff when visual output must remain unchanged, and gameplay profiling. Do not judge visual quality from code alone.

Do not optimize for benchmark numbers at the expense of the game. Performance matters because the game must feel smooth during real gameplay. Pay special attention to frame-time p95/p99, worst-frame hitches, shader compilation during gameplay, and other stalls that damage the player experience.

Do not blindly follow critic suggestions. Treat criticism as evidence of a visible problem, investigate the root cause, and make the change that actually improves the final result even when that change is different from what the critic initially suggested.

Keep improving the largest remaining weaknesses first. Do not stop simply because all requested systems exist. Stop only when further meaningful improvement is no longer reasonably achievable with the available environment and tools, all major validation gates have been run after the final changes, and the result is a genuinely polished playable FPS.

Do this in Three.js.

The goal is not to reproduce Call of Duty's copyrighted maps, characters, logos, models, audio, textures, or other proprietary content. Create original game content while targeting the same class of visual fidelity, responsiveness, weapon feel, combat feedback, environmental density, and overall AAA polish.
