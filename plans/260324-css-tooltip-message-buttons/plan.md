---
title: "Add CSS tooltip to message buttons"
description: "Minimal plan to reuse toolbar tooltip styling for all student message buttons."
status: pending
priority: P2
effort: 45m
branch: n/a
tags: [css, tooltip, modal, messaging]
created: 2026-03-24
---

# Minimal implementation plan

## Goal
Add instant CSS-only tooltips to all `.rgm-student-action-btn` message buttons, matching the existing `.toolbar-suffix-info` visual style, with minimal surface-area change.

## Research summary
- Existing tooltip pattern already exists in `src/modal/modal.css` via `.toolbar-suffix-info` + `::after` using `data-tip`.
- Message buttons are rendered in `src/modal/modal.js` in 2 places:
  1. save confirmation student header button around lines 1428-1435
  2. student-name cell message button around lines 2893-2899
- Current buttons use `title` + `aria-label`, but no CSS tooltip hook.
- `.rgm-student-action-btn` is shared by both message and set-all-scores buttons, so tooltip styling must avoid unintentionally affecting `.rgm-set-scores-btn` unless explicitly desired.
- Button styling lives mainly in `src/modal/modal.css`; `src/messaging/student-message-modal.css` also defines `.rgm-student-action-btn`, but that appears scoped to the message modal component and is not the primary target for the bulk-grader modal buttons.

## Step-by-step plan
1. Add a tooltip data attribute to message buttons only in `src/modal/modal.js`.
   - Reuse existing accessible label text, e.g. `data-tip="Message/Comment"`.
   - Update both message-button render sites.
   - Do not add the attribute to `.rgm-set-scores-btn` unless product wants that tooltip too.
2. Add shared CSS tooltip rules in `src/modal/modal.css` for `.rgm-student-action-btn[data-tip]`.
   - Reuse same visual tokens as `.toolbar-suffix-info::after`: dark background, white text, 12px font, 6px radius, subtle shadow, fade-in.
   - Keep it CSS-only with `::after`; no JS listeners.
3. Scope tooltip trigger to hover/focus-visible for instant display.
   - Hover gives mouse parity with `.toolbar-suffix-info`.
   - Focus-visible improves keyboard accessibility at near-zero cost.
4. Position tooltip above the button and center it.
   - Use `position: relative` on tooltip-capable button selector, not on every button globally if avoidable.
   - Keep `pointer-events: none` and high z-index like existing pattern.
5. Check overlap and clipping contexts.
   - Verify both contexts: table student cell and save confirmation header.
   - If clipping occurs, prefer tiny selector-level adjustments before broader layout changes.

## Target files
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/modal/modal.js`
  - Add `data-tip` to both message-button markup blocks.
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/modal/modal.css`
  - Add tooltip CSS for `.rgm-student-action-btn[data-tip]`.

## Likely selector shape
- Base: `#rubric-grader-modal .rgm-student-action-btn[data-tip]`
- Bubble: `#rubric-grader-modal .rgm-student-action-btn[data-tip]::after`
- Show state: `#rubric-grader-modal .rgm-student-action-btn[data-tip]:hover::after, #rubric-grader-modal .rgm-student-action-btn[data-tip]:focus-visible::after`

## Risks
- Shared class risk: `.rgm-student-action-btn` is reused by the set-all-scores button; broad selectors could add wrong tooltip behavior. Mitigation: gate on `[data-tip]`.
- Overflow/clipping risk: tooltip may be clipped inside table/header containers. Mitigation: test both render contexts before expanding scope.
- Duplicate style drift: copying `.toolbar-suffix-info::after` values inline may create future drift. Mitigation: keep copied block small, or refactor later only if needed. For this task, minimal duplication is acceptable.
- Native title conflict: browser `title` tooltip may still appear after delay in addition to CSS tooltip. Mitigation: decide whether to keep `title` for fallback/accessibility or remove it if double-tooltip UX is undesirable.

## Validation steps
1. Open bulk grader and load student data.
2. Hover message button in student-name cell; verify tooltip appears instantly and matches `.toolbar-suffix-info` styling.
3. Hover message button in save confirmation student header; verify same tooltip behavior.
4. Confirm set-all-scores button behavior unchanged.
5. Tab to message button with keyboard; verify tooltip appears on focus-visible if implemented.
6. Check no obvious clipping/z-index issue over table/header surfaces.
7. Confirm clicking button still opens existing message/comment flow.

## Unresolved questions
- Keep or remove existing `title` attributes once CSS tooltip exists?
- Should the same tooltip treatment also apply to `.rgm-set-scores-btn`, or message buttons only as requested?
