---
name: final-review
description: Use before completing a substantial implementation, submission-critical project change, multi-file feature, or complex bug fix.
---

# Final Review Gate

Run this only after implementation is believed to be complete.

## Requirement Audit

Re-read the user's request and map every meaningful requirement to:
- implemented behavior,
- relevant file,
- validation evidence.

Look specifically for requirements that were discussed but never implemented.

## Diff Audit

Inspect the final diff.

Reject:
- unrelated edits,
- temporary logging,
- commented-out code,
- disabled tests,
- accidental generated files,
- credentials or secrets,
- broad refactors unrelated to the goal.

## Automated Verification

Run:
```bash
./scripts/verify.sh
```

All applicable checks must pass.

## Independent Review

For substantial changes, delegate in parallel when useful:

- `reviewer`: correctness, regression, security, maintainability
- `test_auditor`: verification gaps and edge cases
- `ui_reviewer`: only for user-visible UI changes

Wait for all requested reviews.

Main agent evaluates findings; not every suggestion must be implemented. Fix every credible blocker/high issue and any medium issue that affects the user's stated goal.

## Runtime Validation

Confirm the changed behavior using the most direct executable evidence available.

## Final Gate

Do not mark complete unless:
- requested behavior exists,
- automated checks pass,
- runtime behavior was checked when practical,
- serious review findings are resolved,
- remaining limitations are explicitly disclosed.
