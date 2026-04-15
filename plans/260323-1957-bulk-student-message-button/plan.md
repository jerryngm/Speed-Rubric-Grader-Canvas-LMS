---
title: "Bulk student message button in Student header"
description: "Plan to add a Student column header action that opens bulk messaging with progress-based preselection and assignment-scoped saved filters."
status: pending
priority: P2
effort: 5h
branch: no-git
tags: [messaging, modal, tabulator, state, canvas]
created: 2026-03-23
---

# Overview
Add a bulk message action to the Student column header. Reuse existing student messaging flows where cheap, but keep bulk recipient selection/filtering isolated to avoid destabilizing the current single-student UX.

## Key files to change
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/modal/modal.js`
  - Add Student header button
  - Compute candidate students from loaded table data
  - Launch bulk modal with assignment/course context and current student list
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/messaging/student-message-modal.js`
  - Extract shared messaging form/render/send helpers where useful
  - Keep single-student open path working unchanged
- `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/utils/state-manager.js`
  - Add assignment-scoped bulk message filter load/save helpers using same chrome.storage pattern
- Likely style file: `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/modal/modal.css` or messaging CSS if modal styles live there
  - Add header button + bulk modal/sidebar/selection styles
- Optional new module recommended: `/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Code/Canvas Rubric Project/src/messaging/bulk-student-message-modal.js`
  - Own bulk-specific UI, selection state, filter logic

## Minimal architecture approach
1. In `buildColumns()` for the Student column, replace plain `title: 'Student'` with a header formatter/title formatter that renders:
   - label `Student`
   - bulk message icon/button
2. On click, gather students from current loaded `tableData.submissions` + current row data semantics already used by `studentNameFormatter`:
   - `userId`
   - `name`
   - `sisId`
   - computed progress percent from `calculateStudentTotal(grades)` / `pointsPossible`
3. Open bulk modal with payload like:
   - `courseId`
   - `assignmentId`
   - `students: [{ userId, name, sisId, progressPercent }]`
4. Bulk modal owns:
   - left filter sidebar with operator + numeric progress input
   - derived matching set from currently loaded students for the active assignment/selected sections only
   - preselected recipients from current filter
   - manual deselection tracking
   - send-blocking warning when zero selected
   - info/warning text that filtering is based on original fetched grades, not unsaved table edits
   - first-selected-student preview note for variableized content, with clear copy that variables expand per recipient at send time
   - last-used assignment filter persistence
5. Reuse from existing student modal where low-risk:
   - same two tabs as current modal: submission comment + inbox message
   - confirmation dialogs
   - message/comment submit helpers after recipient list resolved
   - template variable replacement and file upload plumbing

## Recommendation
Create a separate bulk modal module, but extract shared submit/render helpers from `StudentMessageModal` only where trivial and low-risk.

Why:
- Existing `StudentMessageModal.open({ courseId, assignmentId, student })` is strongly single-student shaped in state, subtitle, confirmation copy, upload context, preview context, and API calls.
- File already large; extending it directly increases risk and breaks the <200 LOC guidance further.
- Bulk flow adds recipient sidebar, selection state, filter persistence, zero-match prevention, first-selected preview semantics, and different confirmation/progress copy.
- Shared logic can still be reused by small extraction functions rather than forcing one modal to handle both state models.

Best split:
- Keep `student-message-modal.js` for single-student UX.
- Add `bulk-student-message-modal.js` for bulk-only UX.
- Extract only small shared helpers if duplication is obvious.

## Implementation phases

### Phase 1 — Table header trigger
- Add Student header formatter/button in `src/modal/modal.js`
- Match visual style of existing per-student action button family
- Ensure click does not trigger sort/filter side effects
- Build bulk student payload from currently loaded submissions for the active assignment/selected sections only
- Use Canvas `userId` as canonical recipient id; map any row `odId` references explicitly when needed

### Phase 2 — Assignment-scoped filter persistence
- Add `loadBulkMessageFilter(courseId, assignmentId)` and `saveBulkMessageFilter(courseId, assignmentId, data)` in `src/utils/state-manager.js`
- Storage key pattern should mirror existing domain-aware style, eg `rgm_bulk_msg_filter_${domain}_${courseId}_${assignmentId}`
- Persist only minimal fields:
  - operator
  - threshold value
  - lastUpdated/timestamp

### Phase 3 — Bulk modal UI
- Create bulk modal module with:
  - header/title
  - left sidebar for progress filter controls
  - right pane reusing familiar message/comment UX layout
  - recipient list with checked state, count, and manual deselect support
- On open:
  - load last-used filter
  - compute matches
  - preselect matched students
  - render warning if none match

### Phase 4 — Selection/filter behavior
- Supported operators: `<`, `>`, `<=`, `>=`, `=`
- Compare against normalized numeric progress percent
- Reapplying filter should refresh auto-selected set from matches; manual deselects apply after auto-selection for current session
- Show selected count and matched count clearly
- Disable send/add-comment action when selected count is 0

### Phase 5 — Send integration
- Both tabs from current modal:
  - **Inbox message tab**: iterate selected students and call `CanvasRestAPI.sendConversation()` once per student so each student receives an individual message thread
  - **Submission comment tab**: iterate selected students and reuse existing per-student add-comment flow
  - reuse per-student template expansion for each recipient at send time
  - upload/resolve attachments in a way compatible with per-student sends, then attach them to each individual message send
  - update confirmation/progress UI for many students
- Preserve current single-student modal behavior untouched

### Phase 6 — Polish and validation
- Validate empty filter input, NaN, percentages outside expected range, and exact-match decimals
- Warning text when no students match and prevent send
- Confirm manual deselection survives textarea edits/tab switches during same modal session
- Confirm saved filter reloads per assignment, not globally

## Risks / edge cases
- Progress source is intentionally based on original fetched rubric grades, not unsaved table edits. Bulk modal must show a clear note so teachers do not assume live unsaved values are included.
- Recipient scope is all loaded submissions for the active assignment/selected sections only; not transient table search-hidden rows.
- Operator `=` with decimals: exact float compare can surprise. Recommend compare against displayed floored integer percent. Safer: compare against displayed floored integer if UI shows whole %.
- Zero-point assignment: `pointsPossible` may be 0; current code yields 0%. Bulk filter should treat all as 0 and avoid divide-by-zero.
- Section filtering: bulk modal should only target currently loaded students, not hidden/unloaded course students.
- Manual deselection vs filter changes: filter recomputes baseline selection; manual deselections apply only to current computed set until filter changes again. Manual deselections persist only for current modal session; never saved to chrome.storage.
- Large classes: recipient list rerenders can get noisy; keep DOM simple.
- Existing file size: `student-message-modal.js` already big. Avoid stuffing more bulk-specific state there.
- Confirmation wording: single-student strings currently hardcoded. Bulk flow needs pluralized copy.
- Inbox message sends must iterate students individually, not one conversation with many recipients. Each student receives their own message thread with personalized template expansion.
- Submission comment sends already iterate per-student; bulk flow reuses that pattern.
- Attachments: for inbox messages, attachments must be uploaded once then attached to each individual send. For submission comments, attachments are per-student already.
- Template variable preview: show first-selected student as example with clear warning that variables expand per recipient at send time.

## Unresolved questions
- None currently.
