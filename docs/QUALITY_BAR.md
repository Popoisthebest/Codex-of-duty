# Quality Bar v3

## Current milestone weighting

Until the complete 6v6 TDM loop passes:

```text
Gameplay completeness   30%
Map / encounter design  20%
AI match participation  15%
Combat feel             15%
Visual fidelity         10%
Performance/stability   10%
```

After the gameplay milestone is green, visual fidelity can regain a larger share.

## Automatic minimum gates

Must pass:
- build
- deterministic harness
- smoke playtest
- gameplay match-loop contract
- map structure audit
- no catastrophic runtime errors

## Human/agent review minimum gates

Must demonstrate:
- understandable objective
- coherent beginning/middle/end of match
- repeated combat in several zones
- low empty wandering
- tolerable spawn quality
- route choices
- bots behaving as participants
- preserved weapon quality
- no severe visual collapse

## Anti-cheating principle

Do not make metrics green by disconnecting them from production systems.

The harness is evidence, not theater.
