# Tooltip extension validation

## Scope
Validate latest CSS-only tooltip extension for `.rgm-set-scores-btn` and `.rgm-bulk-student-header-btn`.
No live browser run. Static/code-based assessment only.

## Test Results Overview
- Static checks run: 2
- Passed: 2
- Failed: 0
- Skipped: browser/manual validation, coverage, build pipeline

## Checks run
1. `node --check src/modal/modal.js`
   - Result: pass
2. CSS brace-balance check on `src/modal/modal.css`
   - Result: pass

## Change confirmation
- `.rgm-bulk-student-header-btn` now has `data-tip="Message students by progress"` in `src/modal/modal.js:2820`
- `.rgm-set-scores-btn` now has `data-tip="Set All Scores"` in `src/modal/modal.js:2910-2913`
- Shared tooltip CSS covers:
  - `.rgm-student-action-btn[data-tip]`
  - `.rgm-bulk-student-header-btn[data-tip]`
  - tooltip pseudo-element + hover/focus-visible states in `src/modal/modal.css:316-400`

## Likely clipping behavior
- Student-row action buttons: low clipping risk.
  - Tooltip moved to right side for `.student-name-cell` / `.student-name-cell-actions` buttons (`src/modal/modal.css:376-382`), which avoids top clipping from table/header containers.
- Bulk student header button: moderate clipping risk, but likely acceptable.
  - Tooltip moved to left side (`src/modal/modal.css:389-395`), avoids upward clipping near top edge.
  - Still depends on available horizontal space in the header container and any Tabulator header overflow rules not overridden here.
- Save confirmation header message button: some clipping risk remains.
  - Tooltip moved below button (`src/modal/modal.css:397-400`), which is sensible if top edge is tight.
- Global modal container uses `overflow: hidden` on `.rubric-grader-content` and `.rubric-grader-body` (`src/modal/modal.css:141-156`, `709-724`).
  - Tooltips are inside those bounds. Fine for interior controls, but near container edges they can still clip.

## Failed Tests
- None from executed static checks.

## Performance Metrics
- Negligible. Checks were lightweight and near-instant.

## Build Status
- No formal build system detected (`package.json` absent).
- Manifest present and JS/CSS files referenced normally.

## Critical Issues
- None blocking from static validation.

## Recommendations
- Run one manual browser check for 3 contexts:
  1. student row message button
  2. set-all-scores button
  3. bulk student header button
- Specifically verify narrow viewport / horizontal scroll cases for left/right-positioned tooltips.
- Consider whether `title` attributes remain on related buttons elsewhere; dual native + CSS tooltip can produce delayed duplicate UX.

## Next Steps
1. Manual hover/focus check in extension UI
2. Verify no clipping at table left/right extremes
3. If clipping seen, prefer tiny per-context offset/placement tweaks over broad overflow changes

## Unresolved questions
- Does Tabulator header/container overflow clip the bulk header tooltip in actual runtime?
- Is duplicate native tooltip behavior desired anywhere `title` still exists on tooltip-enabled buttons?
