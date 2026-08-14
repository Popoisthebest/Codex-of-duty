---
name: implement-feature
description: Use for implementing a new feature or substantial behavior change from a user request. Do not use for explanation-only tasks.
---

# Feature Implementation Workflow

1. Convert the request into a short checklist of observable outcomes.
2. Inspect the existing architecture and reuse current patterns before creating new abstractions.
3. For a complex repository, delegate read-only mapping to `harness_explorer`.
4. Identify the smallest complete vertical slice that satisfies the request.
5. Implement the full behavior, including needed types, validation, error handling, and tests.
6. Run `./scripts/verify.sh`.
7. Validate behavior at runtime when build/test alone is insufficient.
8. For UI changes, invoke the `ui-review` skill.
9. For a substantial change, ask `reviewer` and `test_auditor` to inspect independently; use `ui_reviewer` when appropriate.
10. Fix substantive findings and rerun verification.
11. Only then report completion.

Never declare success from code inspection alone when executable validation is reasonably available.
