# Phase 01 — Update content script button injection

## Context links
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/content/content.js`
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/content/content.css`
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/manifest.json`

## Overview
- Priority: P2
- Status: completed
- Scope: smallest safe DOM-targeted change only

## Key insights
- Current feature entrypoints already centralized in one content script.
- Existing open behavior should be reused, not duplicated.
- New selector is not present in repo text; must treat as runtime Canvas DOM dependency.

## Requirements
- Add a new main button above `#enhanced-rubric-assignment-edit-mount-point`.
- Avoid duplicate injection during dynamic rerenders.
- Preserve existing behavior on pages where target node is absent.

## Architecture
- Add one new button id.
- Create one reusable button builder or a narrow new builder for the new placement.
- Insert before target mount point.
- Extend observer readiness check to include new target.

## Related code files
- Modify: `src/content/content.js`
- Modify: `src/content/content.css`
- Create: none
- Delete: none

## Implementation steps
1. Add new constant for assignment-page main button id.
2. Add button creation helper reusing current icon/text/click behavior.
3. In `injectButton()`, query `#enhanced-rubric-assignment-edit-mount-point`.
4. If found, insert new button before that node.
5. Decide whether to skip old `.rubric_title` insertion when new node exists.
6. Add css selector for new id to existing button rules.
7. Update observer disconnect condition to account for new DOM path.

## Todo list
- [x] Confirm final selector strategy
- [x] Add new button id + factory
- [x] Add insertion before target mount point
- [x] Preserve fallback behavior
- [x] Extend CSS selectors
- [x] Smoke test on assignment page

## Success criteria
- Button visible above target mount point
- Button opens existing modal
- No duplicate buttons after rerender
- Fallback still works when target missing

## Risk assessment
- Main risk: selector unstable across Canvas variants
- Mitigation: fallback to current injection path

## Security considerations
- No new permissions
- No new data flow
- DOM-only change

## Next steps
- Implement in content script only unless runtime testing shows layout-specific CSS tweaks needed

## Unresolved questions
- Suppress old main button when new mount point exists?
- Need spacing tweaks specific to Canvas assignment edit layout?
