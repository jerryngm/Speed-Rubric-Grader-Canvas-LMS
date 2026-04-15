# Implementation-ready spec: Per-student Message/Comment modal

## Decision: new module files (best practice)
Implement the new modal as separate modules instead of expanding the already-large [`src/modal/modal.js`](src/modal/modal.js:1).

Rationale:
- Keeps rubric-grading logic isolated from messaging/commenting UI.
- Easier to test and evolve (comment library, placeholders, file uploads are a feature cluster).
- Reduces risk of regressions in the grading UI.

We will add a small integration hook in [`src/modal/modal.js`](src/modal/modal.js:1) (student name formatter) to open the new modal.

---

## User-approved functional scope

### Row button
- Add an envelope icon button next to each student name in the Tabulator Student column.
- Tooltip: `Message/Comment`.
- Always enabled.

### Modal tabs
- 2 tabs:
  - Submission Comment: TinyMCE + attachments
  - Inbox Message: Subject + plain textarea + attachments
- No draft persistence.
- No last-used-tab persistence.

### Placeholders
Use the reference block from [`Other Project - For Ref/missing-tab.js:24`](Other Project - For Ref/missing-tab.js:24):
- `{{student_name}}`
- `{{student_given_name}}`
- `{{student_surname}}`
- `{{course_name}}`
- `{{course_nickname}}`
- `{{section_name}}`
- `{{assignment_name}}`
- `{{assignment_group}}`
- `{{assignment_link}}`
- `{{due_date}}` plus modifiers: `{{day.due_date}}`, `{{due_date.time}}`, `{{day.due_date.time}}`
- `{{term}}`

Best-effort mapping: if some values aren’t available in Rubric Grader, replace with empty string for now.

### Comment Library
Reuse reference GraphQL-backed comment bank behaviors:
- View/search comment library.
- Insert selected comment into TinyMCE.
- Add current TinyMCE content to comment library (Save-to-library flow with course selection).

### Canvas REST endpoints
Use exact reference logic:
- Submission comment: `PUT /api/v1/courses/:courseId/assignments/:assignmentId/submissions/:userId` with `comment[text_comment]` and `comment[file_ids][]`.
- Inbox message: `POST /api/v1/conversations` with `recipients[]`, `subject`, `body`, `attachment_ids[]`, `context_code=course_:courseId`.
- Uploads:
  - Comment attachments via `/api/v1/courses/:courseId/assignments/:assignmentId/submissions/:userId/comments/files`
  - Message attachments via `/files/pending` + conversation attachments folder resolution.

---

## File layout changes

### New files (move from reference, adapted)
- [`src/messaging/tinymce.html`](src/messaging/tinymce.html:1)
- [`src/messaging/tinymce.js`](src/messaging/tinymce.js:1)
- [`src/messaging/filepond-iframe.html`](src/messaging/filepond-iframe.html:1)
- [`src/messaging/filepond-iframe-script.js`](src/messaging/filepond-iframe-script.js:1)

### New JS modules (main feature)
- [`src/messaging/student-message-modal.js`](src/messaging/student-message-modal.js:1)
  - Owns open/close, tabs, variable tray, confirmation modals, progress UI.
- [`src/messaging/file-upload-manager.js`](src/messaging/file-upload-manager.js:1)
  - Parent-side `postMessage` plumbing to the FilePond iframe.
- [`src/messaging/comment-library.js`](src/messaging/comment-library.js:1)
  - GraphQL queries and two modals: Comment Library and Save to Comment Library.
- [`src/messaging/template-variables.js`](src/messaging/template-variables.js:1)
  - Exports TEMPLATE_VARIABLES and replacement functions.

### New CSS
- [`src/messaging/student-message-modal.css`](src/messaging/student-message-modal.css:1)
  - Scoped styles for the modal, variable tray, tabs, and comment-library modals.

### Existing files to modify
- [`manifest.json`](manifest.json:1)
  - Add the new JS modules to `content_scripts[].js` in correct order.
  - Add the new CSS file to `content_scripts[].css`.
  - Update `web_accessible_resources` to expose:
    - `src/messaging/tinymce.html`, `src/messaging/tinymce.js`
    - `src/messaging/filepond-iframe.html`, `src/messaging/filepond-iframe-script.js`
    - ensure `src/libs` resources used by those pages are also exposed if needed.
- [`src/modal/modal.js`](src/modal/modal.js:1)
  - Add envelope button to `studentNameFormatter`.
  - On click, call `window.StudentMessageModal.open({ courseId, assignmentId, studentRowData })`.
- [`src/modal/modal.css`](src/modal/modal.css:1)
  - Minimal additions only if needed for the row button alignment (prefer to keep in new css).
- [`src/api/canvas-rest.js`](src/api/canvas-rest.js:1)
  - Add `sendConversation` and `addSubmissionComment` wrappers (or equivalent), matching reference.
  - Potentially add helper: `getCurrentUserId` (reusing ENV pattern or `/api/v1/users/self`).

---

## Data mapping (Rubric Grader -> placeholder rowData)

In Rubric Grader, Tabulator row data currently includes at least:
- `userId` (row key)
- `name`
- `sisId` (and possibly section fields via GraphQL fetch)

We will construct a `templateData` object when opening the modal:
- `student_name`: rowData.name
- `student_given_name` / `student_surname`: best-effort parse from name (fallback empty)
- `course_name`: from courseInfo in RubricGraderModal state (it already captures course info during section load)
- `course_nickname`: if available in courseInfo else empty
- `section_name`: if rowData has section name (or if the selected section filter is single) else empty
- `assignment_name`: from assignment details if already fetched; else empty
- `assignment_group`: empty (unless readily available)
- `assignment_link`: `${origin}/courses/${courseId}/assignments/${assignmentId}`
- `due_date`: empty unless assignment due date is available via existing GraphQL; else empty
- `term`: from courseInfo.termName if present else empty

These keys map to the `dataKey` names used in the reference replace function. In our implementation we can either:
- keep reference `dataKey` names and build a `rowData` shaped like missing-tab’s data model, OR
- adjust `TEMPLATE_VARIABLES` `dataKey` values to match our `templateData`.

Recommendation (simpler): keep `TEMPLATE_VARIABLES` as-is, and build a compatibility `rowDataCompat` object with the expected dataKeys:
- `stdname`, `student_given_name`, `student_surname`, `coursename`, `coursenickname`, `student_section_name`, `assignment_name`, `assignment_group`, `assignment_link`, `assignment_duedate`, `term`.

---

## Event flows

### Open modal from table
1. User clicks envelope button in Student cell.
2. Handler reads row data via Tabulator cell/row API.
3. Calls [`window.StudentMessageModal.open()`](src/messaging/student-message-modal.js:1) with:
   - `courseId`, `assignmentId`
   - `userId`, `studentName`, plus `rowDataCompat` for variables

### Comment tab submit
1. Get TinyMCE HTML via `postMessage` (`GET_CONTENT` -> `TMCE_CONTENT`).
2. Expand variables using `replaceVariables(html, rowDataCompat)`.
3. Get files list from FilePond iframe manager.
4. For each file, upload using comment upload endpoint (per-student) -> collect `fileIds`.
5. Call REST `PUT submissions/:userId` with `comment[text_comment]` + `comment[file_ids][]`.
6. Show per-student progress UI (even though single student, keep structure for future batch).

### Message tab submit
1. Read subject + body (plain).
2. Expand variables for subject/body.
3. Upload attachments via `/files/pending` (message context) -> collect ids.
4. Call `POST /api/v1/conversations`.

### Comment Library
- Open library modal from comment tab.
- Fetch comment bank items via GraphQL.
- Insert selected comment into TinyMCE using `INSERT_CONTENT`.
- Add-to-library:
  - Pull TinyMCE HTML.
  - Process/minify HTML (same as reference).
  - Open Save-to-library modal.
  - Fetch user courses via GraphQL.
  - Choose course; run mutation to save.

---

## Integration touchpoints

### Tabulator formatter: add envelope button
Update [`studentNameFormatter()`](src/modal/modal.js:1606) to:
- Keep existing display (name + sisId, progress).
- Add a small icon button aligned to right of the student name row.
- Attach click handler that does `e.stopPropagation()` to avoid table row selection behavior.

### Modal coexistence
Rubric Grader already has overlay/close confirmation patterns in [`RubricGraderModal`](src/modal/modal.js:6).
- New modal overlays must use unique IDs/classes to avoid CSS collisions.
- Ensure new modal `Escape` key handling does not break existing modal’s keydown handler.
  - Prefer local event listeners attached on open, removed on close.

---

## Minimal success criteria + edge cases

### Success criteria
- Envelope button renders for each student row.
- Modal opens reliably, with tabs switching.
- Comment tab: can insert variables, use comment library, attach files, submit comment successfully.
- Message tab: subject/body + attachments, submit message successfully.

### Edge cases to handle
- Missing userId in row data: show error toast and do not submit.
- Canvas CSRF token missing: show error.
- Rate limiting / transient failures: show readable error; no auto-retry for now.
- Variables not available: replaced with empty string.

---

## Test checklist (manual)

1. Open Canvas assignment with rubric and open Rubric Grader modal.
2. Verify envelope button appears next to student names.
3. Open modal for a student.
4. Comment tab:
   - insert `{{student_name}}` and `{{due_date}}` variants
   - open comment library, insert a saved comment
   - add to comment library
   - attach 1+ files
   - submit, verify comment appears in SpeedGrader submission comments.
5. Message tab:
   - subject/body plain text
   - attach files
   - submit, verify message appears in Canvas Inbox sent.

---

## Code mode implementation order

1. Create the new messaging module files.
2. Wire manifest: scripts, styles, web_accessible_resources.
3. Add Tabulator student row button + open handler.
4. Implement modal UI shell + tab switching.
5. Implement TinyMCE iframe integration.
6. Implement FilePond iframe integration + parent manager.
7. Implement REST calls in [`src/api/canvas-rest.js`](src/api/canvas-rest.js:1).
8. Implement variables tray + replace logic.
9. Implement comment library + save-to-library.
10. Polish styling and fix any collisions.
