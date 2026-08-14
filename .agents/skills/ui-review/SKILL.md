---
name: ui-review
description: Use after creating or changing a user-visible web interface, layout, component, form, navigation flow, responsive behavior, or visual styling.
---

# UI Review Workflow

The goal is not merely that the frontend builds. The changed UI must work and look intentional in the running product.

## 1. Run the Product

Use the project's documented development command.

Prefer existing browser automation. If the OpenAI Playwright interactive skill is available, use it.

Do not add a heavyweight browser dependency solely for a trivial visual change if equivalent tooling already exists.

## 2. Exercise the Changed Flow

Visit every page/state materially affected by the request.

Test:
- navigation,
- buttons,
- forms,
- validation,
- save/cancel behavior,
- loading/error states,
- keyboard focus where relevant.

## 3. Responsive Check

At minimum inspect one desktop and one narrow/mobile viewport when the UI is responsive.

Check:
- overflow,
- overlap,
- clipped content,
- accidental horizontal scroll,
- unusable touch targets,
- broken wrapping,
- misplaced fixed/sticky elements.

## 4. Visual Quality

Compare against:
1. user-provided references,
2. existing design-system patterns,
3. surrounding product UI.

Check hierarchy, typography, spacing, alignment, density, states, and consistency.

Do not redesign unrelated areas.

## 5. Runtime Evidence

Check browser console errors if tooling permits.

If browser validation cannot be performed, state that limitation. Do not claim the screen was visually verified.

## 6. Independent Review

For a major UI change, ask `ui_reviewer` to inspect independently. Main agent owns any fixes.

## 7. Revalidate

After fixes:
- repeat the affected flow,
- rerun `./scripts/verify.sh`,
- ensure no regression was introduced.
