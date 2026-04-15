---
title: "Add main assignment-page Speed Rubric Grader button"
description: "Implementation complete: added primary entry button above enhanced rubric assignment edit mount point."
status: completed
priority: P2
effort: 1h
branch: n/a
tags: [planning, content-script, canvas, button-injection]
created: 2026-03-23
completed: 2026-03-23
---

# Plan

## Goal
Add another main `Speed Rubric Grader` button above `enhanced-rubric-assignment-edit-mount-point` on Canvas assignment pages, while keeping current launch behavior unchanged.

## Implementation Summary
- **Phase 01**: ✅ Completed — Content script button injection updated
- **Files Modified**:
  - `src/content/content.js` — Added new button id, factory, and insertion logic
  - `src/content/content.css` — Extended selectors for new button styling
- **Validation**: New button appears above target mount point; click opens modal; fallback works on older pages

## Findings
- Current injection logic is isolated in `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/content/content.js`.
- Existing buttons:
  - primary button inserted before `.rubric_title`
  - nav button appended to `ul.page-action-list`
- Shared styling lives in `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/content/content.css`.
- Content script already loads on assignment pages via `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/manifest.json`.
- No literal `enhanced-rubric-assignment-edit-mount-point` string exists in repo now. Likely DOM node comes from Canvas page HTML, not extension code.

## Smallest safe implementation path
1. In `src/content/content.js`, add a third button id + factory for the new assignment-page insertion point.
2. Extend `injectButton()` to query `#enhanced-rubric-assignment-edit-mount-point` first and insert the new button immediately before it.
3. Keep existing `.rubric_title` and `ul.page-action-list` injections as fallback / secondary entry points.
4. Reuse existing `openGraderModal()` click handler.
5. Update `waitForRubric()` to also watch for the new mount point before disconnecting.
6. Extend `src/content/content.css` selectors so the new button inherits current button styles.

## Likely files
- Modify: `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/content/content.js`
- Modify: `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/content/content.css`
- No manifest change expected.

## Key insertion points
- `src/content/content.js`
  - constant block near lines 8-9 for new button id
  - button factory section near `createGraderButton()` / `createNavGraderButton()`
  - `injectButton()` near lines 59-77
  - `waitForRubric()` near lines 95-113
- `src/content/content.css`
  - grouped selectors near lines 3-24

## Validation
- On assignment page with `#enhanced-rubric-assignment-edit-mount-point`, confirm new main button appears above it.
- Confirm click opens same modal as existing buttons.
- Confirm no duplicate button after Canvas partial rerenders.
- Confirm older pages still show existing `.rubric_title` / nav button if new mount point absent.

## Risks
- Canvas may render the target mount point asynchronously; MutationObserver path must remain active until found.
- If both old and new main insertion points render together, product decision needed: keep both main buttons or suppress old `.rubric_title` button when new mount point exists.

## Recommended implementation choice
Prefer: if `#enhanced-rubric-assignment-edit-mount-point` exists, inject only the new main button there and keep nav button. Fall back to `.rubric_title` only when new mount point is absent.

## Unresolved questions
- Should the old `.rubric_title` main button remain when the new mount point exists, or should it be replaced by the new placement?
- Is the target selector definitely an id (`#enhanced-rubric-assignment-edit-mount-point`) on all relevant Canvas assignment pages?
