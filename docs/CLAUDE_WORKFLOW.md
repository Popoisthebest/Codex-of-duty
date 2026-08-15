# Claude Code Workflow

## Start

Use the Claude app's Claude Code mode at the repository root.

Confirm project memory loaded with `/context` if needed.

Useful project skills:

```text
/tdm-vertical-slice
/gameplay-pass
/map-expansion
/gameplay-audit
/final-playability-review
```

## Recommended subagent pattern

Main agent:
- owns implementation
- integrates changes
- runs final validation

Parallel/read-heavy:
- gameplay-director
- map-director
- ai-director
- qa-auditor
- visual-critic
- performance-analyst

Do not ask several agents to simultaneously rewrite MatchManager, spawn, AI state and map navigation.

## Evidence after a major gameplay pass

Collect:
- `npm run build`
- `npm run harness:check`
- `npm run harness:playtest`
- `npm run gameplay:check`
- `npm run gameplay:map-audit` for map changes
- representative screenshots
- relevant performance report
- short written observation from actual run/play

## Optional hard Stop hook

`extras/settings.gameplay-stop-hook.example.json` contains an optional prompt-based Stop hook.

It can force Claude to continue when it tries to stop after claiming a gameplay milestone without evidence.

Do not install it initially if you want to conserve usage. Prompt-based Stop hooks can consume additional model work and cause continuation loops.
