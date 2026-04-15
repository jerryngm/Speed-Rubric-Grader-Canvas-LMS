# Canvas Rubric Grader - Project Context & Documentation

**Last Updated:** 2026-01-30
**Purpose:** Comprehensive documentation for AI agents and developers working on this Chrome extension

---

## Project Overview

## Messaging Modal Parity (StudentMessageModal)
- Per-student modal supports two tabs: submission comment + inbox message.
- File uploads are handled via FilePond in an iframe and must switch endpoints based on `uploadContext`.
- Comment flow includes confirmation + progress modal; message flow includes confirmation/preview modal.

## Session Notes (2026-01-30)
- Implemented message confirmation/preview modal and wired it into message submit flow.
- Ensured conversations API uses FormData with `recipients[]` and `attachment_ids[]`.

**Canvas Rubric Grader** is a Chrome Extension (Manifest V3) that enhances the Canvas LMS grading experience by providing a bulk rubric grading interface. It allows instructors to grade multiple students simultaneously using a spreadsheet-like table interface powered by Tabulator.js.

### Key Features
- **Bulk Grading Interface**: Grade multiple students at once in a table view
- **Section Filtering**: Filter students by course sections
- **Comment Management**: Toggle comment visibility, expand/collapse comments
- **Comment Suffix**: Append custom text (e.g., "Graded by John - 28/01/2026") to modified comments
- **Auto-save**: Debounced autosave of unsaved table edits per course+assignment, with restore prompt and change preview
- **State Persistence**: Saves user preferences (sections, comment visibility) per course
- **Export/Import**: Backup and restore settings across Canvas instances
- **Modern UI**: Clean, responsive design with confirmation modals

---

## Architecture

### Technology Stack
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Data Table**: Tabulator.js v6.3.0
- **API**: Canvas GraphQL API
- **Storage**: Chrome Storage API (chrome.storage.local)
- **Extension**: Chrome Extension Manifest V3

### File Structure

```
src/
├── api/
│   └── canvas-graphql.js       # GraphQL API client for Canvas LMS
├── content/
│   └── content.js              # Content script injected into Canvas pages
├── modal/
│   ├── modal.js                # Main modal UI and logic (1300+ lines)
│   └── modal.css               # Modal styling (2400+ lines)
├── utils/
│   └── state-manager.js        # Storage and state management
└── manifest.json               # Chrome extension manifest
```

---

## Core Components

### 1. Canvas GraphQL API Client (`canvas-graphql.js`)

**Purpose**: Handles all communication with Canvas LMS GraphQL API

**Key Methods**:
- `fetchRubricData(courseId, assignmentId, sectionIds)` - Fetches rubric structure and student submissions
- `fetchCourseSections(courseId)` - Returns course info AND sections array
- `saveRubricAssessment(submissionId, criterionId, points, comments)` - Saves individual grades
- `executeQuery(query)` - Base method for GraphQL requests

**Important Notes**:
- Uses `/api/graphql` endpoint on Canvas
- Requires valid Canvas session (cookies)
- Returns structured data with course info: `{ course: {...}, sections: [...] }`
- Error handling with try-catch and detailed error messages

**Recent Changes**:
- Modified `fetchCourseSections()` to return both course metadata (name, courseCode, courseNickname) and sections array instead of just sections
- This allows capturing course info earlier in the workflow

### 2. State Manager (`state-manager.js`)

**Purpose**: Manages persistent storage using Chrome Storage API

**Storage Keys Pattern**:
- Preferences: `rgm_prefs_{domain}_{courseId}`
- Autosaves: `rgm_autosave_{domain}_{courseId}_{assignmentId}`

**Key Methods**:
- `loadCoursePreferences(courseId)` - Load saved preferences
- `saveCoursePreferences(courseId, preferences, courseName, courseCode, courseNickname)` - Save preferences with course metadata
- `getAllCoursePreferences()` - Get all courses for current domain
- `clearCoursePreferences(courseId)` - Delete specific course data
- `clearAllPreferences()` - Delete all data for current domain
- `exportSettings()` - Export all data as JSON
- `importSettings(data)` - Import data from JSON
- `getStorageInfo()` - Get storage usage statistics
- `loadAutosave(courseId, assignmentId)` - Load autosave record for a course+assignment
- `saveAutosave(courseId, assignmentId, data)` - Save autosave record
- `clearAutosave(courseId, assignmentId)` - Delete autosave record
- `cleanupOldAutosaves()` - Remove autosaves older than 7 days

**Important Notes**:
- Domain-aware: Uses `getDomain()` to extract Canvas instance name from hostname
- All methods have error handling for missing chrome.storage API
- Returns default values when storage unavailable
- Storage limit: 5MB (chrome.storage.local.QUOTA_BYTES)
- Autosave methods now use the same `chrome?.storage?.local` guards + try/catch as preferences

**Recent Changes**:
- Added comprehensive error handling with try-catch blocks
- Added checks for `chrome?.storage?.local` availability
- Created `getDefaultPreferences()` helper method
- Prevents crashes when extension context is lost

### 3. Content Script (`content.js`)

**Purpose**: Injected into Canvas pages, detects rubric grading context

**Functionality**:
- Detects when user is on a rubric grading page
- Extracts courseId and assignmentId from URL
- Injects "Open Bulk Grader" button into Canvas UI (multiple entry points)
- Handles modal opening/closing
- Manages extension lifecycle

**URL Pattern**: `/courses/{courseId}/gradebook/speed_grader?assignment_id={assignmentId}`

**Button Injection Strategy** (as of 2026-03-23):
- **Primary button** (`BUTTON_ASSIGNMENT_ID`): Injected above `#enhanced-rubric-assignment-edit-mount-point` when present (assignment edit page)
- **Fallback button** (`BUTTON_ID`): Injected above `.rubric_title` when assignment mount point is absent (older Canvas pages)
- **Navigation button** (`BUTTON_NAV_ID`): Always appended to `ul.page-action-list` for consistent access
- All buttons reuse the same `openGraderModal()` handler and styling
- MutationObserver watches for DOM readiness; disconnects once all applicable buttons are injected

### 4. Main Modal (`modal.js`)

**Purpose**: Core UI and business logic for the grading interface

**Size**: 1300+ lines - This is the heart of the application

#### Key Variables
```javascript
let modalElement = null;           // DOM reference to modal
let tableData = null;              // Current rubric data
let pointsPossible = 0;            // Total points for assignment
let courseId = null;               // Current course ID
let assignmentId = null;           // Current assignment ID
let tabulatorTable = null;         // Tabulator instance
let originalData = {};             // Original grades for change detection
let modifiedCells = new Map();     // Track modified cells
let commentsCollapsed = false;     // Global comment visibility state
let expandedCells = new Set();     // Track individually expanded cells
let availableSections = [];        // Course sections
let selectedSectionIds = [];       // Filtered sections
let sectionsLoaded = false;        // Section loading state
let courseInfo = null;             // Course metadata (name, code, nickname)
let autosaveWriteTimer = null;     // Debounce timer for autosave
let autosaveLastPayloadJson = null;// Prevent duplicate autosave writes
let autosaveBatchMode = false;     // Suppress autosave while bulk restoring
let activeAutosaveRecord = null;   // Loaded autosave record (if any)
let activeAutosaveSkippedChanges = null; // Skipped changes on restore
let lastSavedChangesByStudent = new Map(); // In-memory snapshot for rubric_changes_summary after successful save
```

#### Key Functions

**Initialization & Lifecycle**:
- `createModal()` - Creates modal HTML structure (lines 59-353)
- `open(data, cId, aId)` - Opens modal with data (lines 1261+)
- `close()` - Closes modal and cleanup
- `refresh()` - Reloads data from Canvas

**Data Loading**:
- `loadSections()` - Loads sections AND captures course info (lines 571-592)
- `loadData()` - Fetches rubric data from Canvas
- `renderTable()` - Creates Tabulator table with data
- `maybeShowAutosavePrompt()` - Show restore modal if autosave exists

**Section Filtering**:
- `toggleSectionDropdown()` - Show/hide section selector
- `selectAllSections()` - Select all sections
- `handleSectionChange()` - Update filtered students
- `updateFilterCount()` - Update UI with filter count

**Grading & Saving**:
- `saveChanges()` - Shows save confirmation modal
- `confirmAndSave()` - Executes save operation
- `performSave()` - Sends grades to Canvas API
- `saveCurrentState()` - Persists preferences to storage
- `scheduleAutosaveWrite()` / `flushAutosaveWrite()` - Debounced autosave persistence
- `restoreAutosaveIntoTable()` - Applies autosave values into the table

**Comment Management**:
- `toggleComments()` - Global comment visibility toggle
- `expandComment()` - Expand individual comment
- `collapseComment()` - Collapse individual comment
- `getCommentSuffix()` - Retrieves suffix text from toolbar input
- `appendSuffixToComment()` - Appends suffix on new line to comments

**Settings Modal**:
- `openSettings()` - Opens settings modal
- `loadSavedCourses()` - Displays saved course list with modern UI
- `updateStorageInfo()` - Shows storage usage
- `exportSettings()` - Export with inline message
- `importSettings()` - Import with confirmation modal
- `resetCoursePreferences(courseId)` - Reset specific course with modal
- `clearAllPreferences()` - Clear all with confirmation modal
- `updateClearAllButton()` - Disable button when storage empty

**UI Helpers**:
- `showSettingsMessage(type, message)` - Inline success/error messages
- `showImportConfirmation()` - Import confirmation modal
- `showCriterionDetail()` - Show criterion details modal
- `renderAutosavePrompt()` - Autosave restore modal with change preview
- `renderChangesPreview()` - Shared change preview renderer (used by autosave prompt)

#### Recent Major Changes

**1. Course Information Capture (2026-01-29)**:
- Modified to capture course info (name, code, nickname) when sections load
- Added `courseInfo` variable to store metadata
- Updated `loadSections()` to extract course data from API response
- Modified `saveCurrentState()` to use `courseInfo` instead of waiting for table data

**2. Modal Confirmations (2026-01-29)**:
- Replaced all `alert()` and `confirm()` dialogs with modern modals
- Export now shows inline message instead of alert
- Import uses detailed confirmation modal
- Clear All uses warning modal with red theme
- Course Reset uses modal with course details display
- All modals have loading states and error handling

**3. UI Improvements (2026-01-29)**:
- Redesigned course items to be slimmer (12px padding vs 16px)
- Replaced emojis with clean SVG icons
- Reduced font sizes for better density
- Added hover effects and smooth transitions
- White background with subtle grey hover
- Icons: users (sections), message (comments), clock (date), trash (delete)

**4. Error Handling (2026-01-29)**:
- Added comprehensive error handling for chrome.storage API
- Prevents crashes when extension context is lost
- Graceful fallbacks for all storage operations

**5. Comment Suffix Feature (2026-01-29)**:
- Added textbox to toolbar for custom comment suffix
- Suffix automatically appended to modified comments on save
- Only applies to comments that have actually changed (not points-only changes)
- Suffix shown in save confirmation preview
- Appends on new line at end of comment
- Helper functions: `getCommentSuffix()`, `appendSuffixToComment()`
- Modified `performSave()` to apply suffix before API call
- Updated `showSaveConfirmation()` to preview final comment with suffix

**6. Autosave + Restore Prompt (2026-01-30)**:
- Added autosave storage per course+assignment with debounced writes
- Restore prompt appears after data load and shows a full change preview
- Restoring repopulates `modifiedCells` (yellow highlights + Save count)
- Skipped entries (students not visible) are reported and can be kept or discarded
- Autosave cleared on successful save; old autosaves auto-cleaned (7 days)

**7. Rubric Changes Summary Snapshot (2026-01-30)**:
- `{{rubric_changes_summary}}` (used by StudentMessageModal) pulls changes via `window.RubricGraderModal.getModifiedChangesForStudent(userId)`
- On a *successful* Canvas save we intentionally clear `modifiedCells` (no unsaved changes), which would otherwise make the summary empty
- Solution: capture a **session-only, in-memory snapshot** of the changes just before clearing `modifiedCells`
  - Stored in `lastSavedChangesByStudent` (Map keyed by `userId`)
  - Implemented by `captureLastSavedChangesSnapshot()` (called on full save success before `modifiedCells.clear()`)
  - Cleared by `clearLastSavedChangesSnapshot()` (called on `open()`, `handleLoadData()`, and `cleanupModal()`)
  - `getModifiedChangesForStudent()` returns live unsaved changes first, otherwise falls back to this snapshot
  - Snapshot is cleared on `open()`, `Load Data`, and modal cleanup so it can’t go stale
  - Snapshot stores the raw comment (no suffix); template rendering appends the suffix when generating message content
- This avoids writing “temp_*” records into `chrome.storage.local`, which could create confusing persistence and interfere with future change tracking

---

## Data Flow

### Opening the Grader
1. User clicks "Open Bulk Grader" button on Canvas page
2. `content.js` calls `RubricGraderModal.open()`
3. Modal loads saved preferences from `StateManager`
4. Modal loads course sections (captures course info here)
5. Modal applies saved section filters
6. User clicks "Load Data"
7. `canvas-graphql.js` fetches rubric data
8. Tabulator table renders with student data

### Saving Grades
1. User modifies grades/comments in table
2. Changes tracked in `modifiedCells` Map
3. User clicks "Save Changes"
4. Save confirmation modal shows all changes
5. User confirms
6. `performSave()` sends each change to Canvas API
7. Progress bar updates
8. Success/error messages displayed
9. On full success: capture a session snapshot of what was saved (for `{{rubric_changes_summary}}`), then update original data and clear `modifiedCells`

### Autosave + Restore
1. Any cell change updates `modifiedCells` and schedules an autosave write
2. Autosave is saved as a compact diff (only changed cells)
3. After “Load Data”, if an autosave exists, a restore modal appears
4. Restore applies saved values into the table and highlights them (same as manual edits)
5. If some students are not visible, those changes are skipped and can be kept for later
6. Autosave is cleared on full successful save

### State Persistence
1. Any preference change triggers `saveCurrentState()`
2. `StateManager.saveCoursePreferences()` saves to chrome.storage
3. Includes: selectedSectionIds, commentsVisible, course metadata
4. Next time modal opens, preferences auto-loaded
5. Settings modal shows all saved courses

---

## Storage Schema

### Course Preferences
```javascript
{
  domain: "canvas",                    // Canvas instance name
  courseId: "12345",                   // Course ID
  courseName: "Introduction to CS",    // Course name
  courseCode: "CS101",                 // Course code
  courseNickname: "Intro CS",          // Course nickname
  selectedSectionIds: ["1", "2"],      // Filtered sections
  commentsVisible: true,               // Comment visibility
  lastUpdated: 1706515200000          // Timestamp
}
```

### Autosave Data
```javascript
{
  domain: "canvas",
  courseId: "12345",
  assignmentId: "67890",
  version: "1.0",
  selectedSectionIds: ["1", "2"],
  changes: {
    "123": {
      "456": { points: 8.5, comments: "Great work!" },
      "789": { points: 6, comments: "" }
    }
  },
  timestamp: 1706515200000
}
```

### Export Format
```javascript
{
  version: "1.0",
  domain: "canvas",
  exportDate: "2026-01-29T12:00:00.000Z",
  preferences: {
    "rgm_prefs_canvas_12345": { /* course data */ }
  },
  autosaves: {
    "rgm_autosave_canvas_12345_67890": { /* autosave data */ }
  }
}
```

---

## UI Components

### Main Modal Structure
```
rubric-grader-modal (overlay)
└── rubric-grader-content
    ├── rubric-grader-header
    │   ├── title
    │   ├── settings button (⚙️)
    │   └── close button (×)
    ├── rubric-grader-toolbar
    │   ├── Data Source Group (Load Data, Refresh)
    │   ├── Filter Group (Section filter, Search)
    │   ├── Comment Suffix Input (textbox for appending to comments)
    │   └── Actions Group (Toggle Comments, Save)
    ├── rubric-grader-table-container
    │   └── Tabulator table
    └── save-confirmation-modal
        └── Shows all changes before saving
```

### Settings Modal Structure
```
settings-modal
├── settings-header
├── settings-body
│   ├── Storage Usage (progress bar)
│   ├── Saved Courses (list with reset buttons)
│   └── Backup & Restore
│       ├── Export button
│       ├── Import button
│       ├── Clear All button (disabled when empty)
│       └── Inline message container
└── settings-footer (Close button)
```

### Confirmation Modals
- **Import Confirmation**: Shows file details, domain, date, counts
- **Clear All Confirmation**: Red warning theme, lists what will be deleted
- **Course Reset Confirmation**: Shows course name/code, lists what will be cleared
- **Autosave Restore**: Shows autosave summary + full change preview, Restore/Discard actions, and optional “Keep/Discard skipped”

---

## Styling Conventions

### Color Palette
- Primary Blue: `#0374B5` (Canvas brand color)
- Success Green: `#4caf50`
- Error Red: `#f44336`, `#d32f2f`
- Warning Orange: `#ff9800`
- Grey Scale: `#333`, `#666`, `#888`, `#ccc`, `#e0e0e0`, `#f5f5f5`

### Button Classes
- `.rgm-btn-primary` - Blue, for primary actions
- `.rgm-btn-secondary` - White/grey, for secondary actions
- `.rgm-btn-danger` - Red, for destructive actions

### Layout Patterns
- Modal overlays: `rgba(0, 0, 0, 0.6)` background
- Border radius: 6-12px for modern look
- Padding: 12-16px for compact, 20-24px for spacious
- Transitions: `0.2s` for smooth interactions
- Hover effects: `translateY(-1px)` + box-shadow

---

## Important Patterns & Conventions

### 1. Error Handling
Always wrap chrome.storage calls in try-catch:
```javascript
try {
  if (!chrome?.storage?.local) {
    console.warn('Chrome storage API not available');
    return defaultValue;
  }
  // ... storage operation
} catch (error) {
  console.error('Error:', error);
  return defaultValue;
}
```

### 2. Modal Patterns
- Use modals instead of `alert()` or `confirm()`
- Show loading states during operations
- Provide retry buttons on errors
- Use inline messages for non-critical feedback

### 3. State Management
- Always save state after user actions
- Use domain-aware keys for multi-instance support
- Include metadata (courseName, courseCode, etc.) in saves
- Auto-load preferences on modal open

### 4. UI Updates
- Disable buttons during operations
- Show progress indicators for long operations
- Update button states based on data (e.g., disable Clear All when empty)
- Use smooth transitions and hover effects
- Reuse change-preview UI (save-confirmation styles) for consistency

---

## Known Issues & Considerations

### 1. Extension Context Loss
- Chrome extensions can lose context when updated or reloaded
- All storage operations have error handling for this
- Returns default values when chrome.storage unavailable

### 2. Storage Limits
- Chrome storage limit: 5MB
- Large courses with many autosaves can approach limit
- Export/import feature allows backup before clearing
- Autosaves are compact diffs (only changed cells) and auto-clean after 7 days

### 3. Canvas API Rate Limiting
- Canvas may rate limit GraphQL requests
- Batch saves are done sequentially to avoid overwhelming API
- Progress bar shows save progress

### 4. Section Loading Timing
- Course info now captured when sections load (early)
- Fallback to table data if sections not loaded yet
- Ensures course metadata always available for display

---

## Development Guidelines

### Adding New Features
1. Update modal HTML structure in `createModal()`
2. Add event listeners after modal creation
3. Implement handler functions
4. Add CSS styling in `modal.css`
5. Update state persistence if needed
6. Test with empty storage and full storage

### Modifying Storage Schema
1. Update `StateManager` methods
2. Consider backwards compatibility
3. Update export/import logic
4. Update documentation

### UI Changes
1. Follow existing color palette and spacing
2. Use SVG icons instead of emojis for professional look
3. Add hover effects and transitions
4. Test responsive behavior
5. Ensure accessibility (aria labels, keyboard navigation)

---

## Testing Checklist

### Basic Functionality
- [ ] Modal opens and closes correctly
- [ ] Data loads from Canvas API
- [ ] Table renders with all students and criteria
- [ ] Grades can be modified
- [ ] Comments can be edited
- [ ] Save operation works
- [ ] Changes persist after save

### Section Filtering
- [ ] Sections load correctly
- [ ] Course info captured (name, code, nickname)
- [ ] Filter updates student list
- [ ] "All Sections" works
- [ ] Filter count displays correctly

### State Persistence
- [ ] Preferences save automatically
- [ ] Preferences load on modal open
- [ ] Settings modal shows saved courses
- [ ] Course items display correctly (name, code, sections, etc.)
- [ ] Export creates valid JSON file
- [ ] Import restores data correctly
- [ ] Autosave writes on edits and restores on load
- [ ] Restore shows preview and highlights restored cells
- [ ] Skipped changes can be kept/discarded

### Confirmation Modals
- [ ] Import shows file details
- [ ] Clear All shows warning
- [ ] Course Reset shows course info
- [ ] All modals have working cancel buttons
- [ ] Loading states display during operations
- [ ] Error states show retry buttons

### Edge Cases
- [ ] Empty storage (no saved courses)
- [ ] Clear All button disabled when empty
- [ ] Extension context loss handled gracefully
- [ ] Large datasets (100+ students)
- [ ] Storage near limit
- [ ] Network errors during API calls

---

## API Reference

### Canvas GraphQL Queries

**GetRubricData**:
```graphql
query GetRubricData {
  assignment(id: "123") {
    rubric {
      criteria { _id, description, longDescription, points }
      title
    }
    course {
      name
      courseCode
      courseNickname
    }
  }
  course(id: "456") {
    submissionsConnection(filter: {sectionIds: ["1","2"]}) {
      nodes {
        _id
        user { _id, name, sisId }
        rubricAssessmentsConnection {
          nodes {
            _id
            assessmentRatings { _id, criterion { _id }, points, comments }
          }
        }
      }
    }
  }
}
```

**GetCourseSections**:
```graphql
query GetCourseSections {
  course(id: "456") {
    courseCode
    courseNickname
    name
    sectionsConnection {
      nodes { _id, name }
    }
  }
}
```

**SaveRubricAssessment**:
```graphql
mutation SaveRubricAssessment {
  createRubricAssessment(input: {
    submissionId: "123"
    assessmentRatings: [{
      criterionId: "456"
      points: 8.5
      comments: "Great work!"
    }]
  }) {
    rubricAssessment { _id }
  }
}
```

---

## Troubleshooting

### "Cannot read properties of undefined (reading 'local')"
- **Cause**: Extension context lost or chrome.storage unavailable
- **Fix**: Error handling added to all storage methods
- **Prevention**: Always check `chrome?.storage?.local` before use

### Settings modal shows no courses
- **Cause**: No preferences saved yet OR storage empty
- **Check**: Open browser DevTools > Application > Storage > Extension
- **Fix**: Grade an assignment to create first preference

### Clear All button not working
- **Cause**: Button should be disabled when storage empty
- **Check**: `updateClearAllButton()` called after operations
- **Fix**: Ensure function runs after `loadSavedCourses()`

### Course info not displaying
- **Cause**: Course metadata not captured
- **Check**: `courseInfo` variable populated in `loadSections()`
- **Fix**: Ensure `fetchCourseSections()` returns course object

---

## Future Enhancements

### Potential Features
- Bulk comment templates
- Grade distribution analytics
- Keyboard shortcuts for grading
- Offline mode with sync
- Multi-assignment grading
- Custom rubric templates
- Grade history/audit log
- Collaboration features (multiple graders)

### Technical Improvements
- TypeScript migration
- Unit tests with Jest
- E2E tests with Playwright
- Build system (webpack/vite)
- Code splitting for performance
- Service worker optimization
- IndexedDB for larger storage

---

## Version History

### v1.0 (Initial Release)
- Basic bulk grading interface
- Tabulator table integration
- Canvas GraphQL API integration
- Section filtering
- Comment management

### v1.1 (State Persistence)
- Added StateManager for preferences
- Domain-aware storage
- Auto-save functionality
- Settings modal

### v1.2 (Export/Import)
- Export settings to JSON
- Import settings from JSON
- Storage usage display
- Course list in settings

### v1.3 (UX Improvements - 2026-01-29)
- Replaced alerts with modals
- Inline messages for export
- Confirmation modals for import/reset/clear
- Improved course item UI (slimmer, SVG icons)
- Clear All button disabled when empty
- Comprehensive error handling
- Course info captured earlier (on section load)
- **Comment Suffix Feature**: Added textbox to toolbar for appending custom text to modified comments

### v1.4 (Autosave Restore - 2026-01-30)
- Autosave per course+assignment with debounced writes
- Restore modal with change preview
- Restored cells populate `modifiedCells` and show yellow highlight
- Skipped entries can be kept for later or discarded

---

## Contact & Support

This is a Chrome extension for Canvas LMS. For issues or questions:
1. Check this documentation first
2. Review code comments in source files
3. Test in Chrome DevTools console
4. Check Chrome extension logs

---

**End of Documentation**

*This file is maintained for AI agents and developers. Keep it updated when making significant changes to the codebase.*
