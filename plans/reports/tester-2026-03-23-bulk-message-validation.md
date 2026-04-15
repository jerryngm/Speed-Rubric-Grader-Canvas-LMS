# Tester Report: Bulk Student Message Button Validation
**Date:** 2026-03-23
**Scope:** `src/messaging/bulk-student-message-modal.js`, `src/utils/state-manager.js`, `src/modal/modal.js` (integration points), `src/messaging/student-message-modal.css`, `manifest.json`

---

## Test Results Overview

| Check | Result |
|---|---|
| JS syntax – bulk-student-message-modal.js | PASS |
| JS syntax – state-manager.js | PASS |
| JS syntax – modal.js | PASS |
| JS syntax – canvas-rest.js | PASS |
| JS syntax – template-variables.js | PASS |
| JS syntax – file-upload-manager.js | PASS |
| JSON syntax – manifest.json | PASS |
| Unit / integration tests | N/A (no test runner configured) |

---

## Build / Load-Order Status: PASS

Manifest `content_scripts.js` load order (confirmed correct):

```
tabulator → canvas-graphql → canvas-rest → state-manager →
template-variables → file-upload-manager → student-message-modal →
bulk-student-message-modal → modal.js → content.js
```

`bulk-student-message-modal.js` loads _before_ `modal.js`, so `window.BulkStudentMessageModal` is available when `modal.js` calls `openBulkStudentMessageModal()`.

---

## Integration: PASS with caveats

| Global | Defined in | Consumed by bulk modal | Status |
|---|---|---|---|
| `window.BulkStudentMessageModal` | bulk-student-message-modal.js | modal.js L2851 | OK |
| `window.StateManager.loadBulkMessageFilter` | state-manager.js L172 | bulk modal L287 | OK |
| `window.StateManager.saveBulkMessageFilter` | state-manager.js L189 | bulk modal L328 | OK |
| `window.StudentMessageTemplates.replaceTemplateVariables` | template-variables.js L88 | bulk modal L448/495 | OK |
| `window.StudentMessageTemplates.parseGivenSurname` | template-variables.js L144 | bulk modal L523 | OK |
| `window.CanvasRestAPI` | canvas-rest.js | bulk modal L443/491 | OK |
| `window.StudentMessageFileUploadManager` | file-upload-manager.js | bulk modal L101/281 | OK (singleton, guarded) |
| `window.RubricGraderModal.getCourseInfo()` | modal.js L3676 | bulk modal L525–526 | OK (null-safe) |

`getBulkMessageStudents()` builds correct student shape: `{ userId, name, sisId, progressPercent, assignmentName, assignmentGroup, dueDate, sectionName }` — all fields consumed by `buildCompatRowData()` are present.

---

## Issues Found

### MEDIUM – No error handling in submit flows
**Files:** `bulk-student-message-modal.js` L399–519 (`handleSubmit`, `sendBulkMessages`, `addBulkComments`)

None of these async methods have try/catch. A Canvas API error (network failure, CSRF expiry, 403, etc.) produces an uncaught promise rejection with no user feedback. The UI remains in a "loading" state or appears to succeed silently.

**Recommendation:** Wrap the `for...of` loop and post-loop `alert()` in try/catch; show a visible error count or status message.

---

### MEDIUM – Message-context file attachments will fail when userId is null
**Files:** `bulk-student-message-modal.js` L101–106, `file-upload-manager.js` L31, `filepond-iframe-script.js` L68

`BulkStudentMessageModal.open()` initializes `StudentMessageFileUploadManager` with `userId: null` (correct for the bulk context — no single student). When the **Send Inbox Message** tab is used with attachments, the filepond iframe builds the upload URL using `config.userId`:

```
/api/v1/users/${config.userId}/files/pending  →  /api/v1/users/null/files/pending
```

This will 404 at the Canvas API. The same `userId: null` pattern exists in `student-message-modal.js` (L1910–1912), so this is a pre-existing shared issue rather than a regression introduced by the bulk modal; it surfaces here because the bulk modal _does_ include attachment UI for messages.

**Recommendation:** Pass the logged-in user's Canvas ID to `initialize()`. Retrieve it from `ENV.current_user_id` (injected by Canvas into `window.ENV`) or from the session. If not available, disable attachment UI for message context.

---

### LOW – Six `alert()` calls inconsistent with project UX direction
**File:** `bulk-student-message-modal.js` L402, 418, 455, 462, 482, 517

README documents that all `alert()` dialogs were replaced with modern confirmation modals in v1.3. The new bulk modal reverts to `alert()` for validation errors and success/failure feedback.

**Recommendation:** Replace with inline notices (`rgm-smm-notice`) or the existing progress-modal pattern already defined in `student-message-modal.css`.

---

### LOW – `loadSavedFilter()` called without `await` in `open()`
**File:** `bulk-student-message-modal.js` L99

The recipient list renders empty on initial display until the storage read resolves. This causes a brief visible flash. Not a crash; the list populates correctly once the Promise resolves.

**Recommendation:** Await `this.loadSavedFilter()` or render a skeleton/loading state in `#rgm-bulk-recipient-list` until the filter is applied.

---

### LOW – `subtitle.textContent` references destructured `students` directly
**File:** `bulk-student-message-modal.js` L53

```js
subtitle.textContent = `${students.length} students loaded`;
```

`this.state.students` is set to `students || []` on L27, but the subtitle uses the raw `students` parameter. If `open()` is ever called without the `students` key, this throws. All current callers pass a valid array, so not a live bug.

**Recommendation:** Change to `this.state.students.length`.

---

### INFORMATIONAL – CSS `.rgm-student-header-actions` only sets `align-items`
**File:** `src/messaging/student-message-modal.css` L29–31

```css
.rgm-student-header-actions {
  align-items: center;
}
```

`align-items` only takes effect if `display: flex` (or `grid`) is already applied by the parent `.criterion-header` rule in `modal.css`. Review `modal.css` to confirm `.criterion-header` establishes a flex context; if not, the button may not center correctly.

---

## CSS: PASS (no structural issues)

- Scoped BEM-style class naming with `rgm-smm-` and `rgm-bulk-smm-` prefixes — no conflicts expected
- Responsive breakpoint at `960px` collapses grid from sidebar+main to single column
- All class names referenced in JS (`rgm-smm-backdrop`, `rgm-bulk-smm-modal`, `rgm-bulk-smm-body`, `rgm-bulk-smm-sidebar`, `rgm-bulk-smm-main-pane`) exist in CSS

---

## Performance Observations

- **Filter duplicates logic:** `updateSubmitButton()` re-runs the same student filter loop that `applyFilter()` already ran. The matched count recalculated on every checkbox change. At typical class sizes this is negligible, but could be deduplicated.
- **TinyMCE iframe GET_CONTENT** uses a 5-second timeout — adequate.
- **File upload timeout:** 5 minutes per file in `FileUploadManager.uploadFile` — appropriate for large files.

---

## Recommendations (Prioritized)

1. **Add try/catch to `handleSubmit`/`sendBulkMessages`/`addBulkComments`** — show inline error banners instead of swallowing failures (MEDIUM)
2. **Fix message-context attachment userId** — use `window.ENV?.current_user_id` or disable attachment UI in message tab (MEDIUM)
3. **Replace `alert()` calls** with existing modal/notice patterns for UX consistency (LOW)
4. **Await `loadSavedFilter()`** or render a loading skeleton (LOW)
5. **Defensive fix for `students.length`** — use `this.state.students.length` (LOW)

---

## Next Steps

- No test suite is configured; add at minimum unit tests for `applyFilter()` logic (operator/threshold combinations) and `buildCompatRowData()` field mapping
- Validate message attachment upload end-to-end in a real Canvas environment with a known user ID
- Confirm `.criterion-header` has `display: flex` in `modal.css`

---

## Unresolved Questions

- Is there a reliable browser-accessible way to get the logged-in Canvas user's numeric ID (for message attachment upload)? `window.ENV.current_user_id` is the typical Canvas approach but not confirmed available in this extension's content-script context.
- Are there plans to add a progress modal (like the save flow) for bulk send? Currently success is a bare `alert()` after all sends complete sequentially.
