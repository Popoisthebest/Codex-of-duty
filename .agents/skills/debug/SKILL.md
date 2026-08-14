---
name: debug
description: Use when a bug, error, failing test, crash, incorrect output, or unexpected behavior must be diagnosed and fixed.
---

# Debug Workflow

## Reproduce

First establish the failure with the smallest reliable reproduction.

Capture:
- expected behavior,
- actual behavior,
- exact error/log/test failure,
- conditions required to trigger it.

If the issue cannot be reproduced, gather evidence before editing.

## Trace

Find the real execution path and identify where observed state first diverges from expected state.

Use `harness_explorer` for large or unfamiliar code paths.

Avoid speculative edits.

## Hypothesis

Form a concrete root-cause hypothesis that predicts the observed failure.

Prefer one evidence-backed cause over many untested guesses.

## Fix

Make the smallest complete change that corrects the root cause.

Do not:
- swallow errors,
- remove assertions,
- disable tests,
- add arbitrary sleeps,
- hard-code one reproduction input,
unless that behavior is explicitly correct by design.

## Regression Test

Add or update a test that would fail before the fix and pass after it when practical.

## Verify

Run:
```bash
./scripts/verify.sh
```

Then rerun the original reproduction.

For browser bugs, verify in a real browser when tooling is available.

For nontrivial fixes, ask `reviewer` and `test_auditor` for independent read-only review, then repair real findings and verify again.
