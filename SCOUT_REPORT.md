# Canvas Rubric Project - Codebase Scout Report

## Overview
Comprehensive UI component analysis for "Select Sections" dropdown, "Load Data" button, and related functionality.

---

## 1. SELECT SECTIONS DROPDOWN MENU

### HTML Structure (modal.js, lines 205-213)
```html
<div class="section-dropdown" id="section-dropdown" style="display: none;">
  <div class="section-dropdown-header">
    <span>Select Sections</span>
    <button class="section-select-all" id="section-select-all">Select All</button>
  </div>
  <div class="section-dropdown-list" id="section-dropdown-list">
    <div class="section-item-empty">Loading sections...</div>
  </div>
</div>
```

**Container HTML (Filter Button)** - lines 194-204:
```html
<div class="section-filter-container">
  <button class="rgm-filter-btn" id="section-filter-btn">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
    </svg>
    <span class="rgm-filter-btn-text">Sections</span>
    <span class="rgm-filter-count" id="section-filter-count" style="display: none;">0</span>
    <svg class="rgm-filter-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>
  <!-- Dropdown inserted here -->
</div>
```

### Section Rendering Code (modal.js, lines 1992-2013)
```javascript
function renderSectionDropdown() {
  const list = modalElement.querySelector('#section-dropdown-list');

  if (availableSections.length === 0) {
    list.innerHTML = '<div class="section-item-empty">No sections found</div>';
    return;
  }

  list.innerHTML = availableSections.map(section => `
    <label class="rgm-section-item">
      <input type="checkbox" value="${section._id}" class="rgm-section-checkbox"
        ${selectedSectionIds.includes(section._id) ? 'checked' : ''}>
      <span class="rgm-section-checkmark"></span>
      <span class="rgm-section-name">${section.name}</span>
    </label>
  `).join('');

  // Add event listeners
  list.querySelectorAll('.rgm-section-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', handleSectionChange);
  });
}
```

### Toggle Function (modal.js, lines 2044-2048)
```javascript
function toggleSectionDropdown() {
  const dropdown = modalElement.querySelector('#section-dropdown');
  const isVisible = dropdown.style.display !== 'none';
  dropdown.style.display = isVisible ? 'none' : 'block';
}
```

**Event Listener** (modal.js, line 627):
```javascript
modal.querySelector('#section-filter-btn').addEventListener('click', toggleSectionDropdown);
```

### Section Change Handler (modal.js, lines 2015-2028)
```javascript
async function handleSectionChange(e) {
  const sectionId = e.target.value;
  if (e.target.checked) {
    if (!selectedSectionIds.includes(sectionId)) {
      selectedSectionIds.push(sectionId);
    }
  } else {
    selectedSectionIds = selectedSectionIds.filter(id => id !== sectionId);
  }
  updateFilterCount();

  // SAVE STATE - Persist section selection
  await saveCurrentState();
}
```

### Select All Handler (modal.js, lines 2050-2067)
```javascript
async function selectAllSections() {
  const checkboxes = modalElement.querySelectorAll('.rgm-section-checkbox');
  const allSelected = selectedSectionIds.length === availableSections.length;

  if (allSelected) {
    // Deselect all
    selectedSectionIds = [];
    checkboxes.forEach(cb => cb.checked = false);
  } else {
    // Select all
    selectedSectionIds = availableSections.map(s => s._id);
    checkboxes.forEach(cb => cb.checked = true);
  }
  updateFilterCount();

  // SAVE STATE - Persist section selection
  await saveCurrentState();
}
```

**Event Listener** (modal.js, line 628):
```javascript
modal.querySelector('#section-select-all').addEventListener('click', selectAllSections);
```

---

## 2. LOAD DATA BUTTON

### HTML Structure (modal.js, line 215)
```html
<button class="rgm-btn-primary" id="rubric-grader-load">Load Data</button>
```

**Button ID**: `rubric-grader-load`
**Button Class**: `rgm-btn-primary`
**Parent Container Class**: `rubric-grader-filters` (line 193)

### Click Handler (modal.js, line 629)
```javascript
modal.querySelector('#rubric-grader-load').addEventListener('click', handleLoadData);
```

### Load Data Function (modal.js, lines 2069-2110)
```javascript
async function handleLoadData() {
  const loading = modalElement.querySelector('.rubric-grader-loading');
  const tableContainer = modalElement.querySelector('#rubric-grader-table');
  const status = modalElement.querySelector('.rubric-grader-status');

  // New data load should not reuse the last "saved snapshot" (it can become stale).
  clearLastSavedChangesSnapshot();

  loading.style.display = 'block';
  loading.textContent = 'Loading rubric data...';
  tableContainer.innerHTML = '';
  status.textContent = '';

  // Close dropdown if open
  const dropdown = modalElement.querySelector('#section-dropdown');
  dropdown.style.display = 'none';

  try {
    const api = new CanvasGraphQLAPI();
    // Pass selected section IDs (empty array [] means all students)
    tableData = await api.fetchRubricData(assignmentId, selectedSectionIds);
    pointsPossible = tableData.assignment.pointsPossible || 0;

    modalElement.querySelector('.rubric-grader-title-text').textContent =
      `Speed Rubric Grader - ${tableData.assignment.name}`;

    storeOriginalData();
    renderTable();
    loading.style.display = 'none';

    const sectionText = selectedSectionIds.length > 0
      ? ` (${selectedSectionIds.length} sections)`
      : ' (all sections)';
    status.textContent = `${tableData.submissions.length} students loaded${sectionText}`;

    // If an autosave exists for this course+assignment, prompt to restore it.
    await maybeShowAutosavePrompt();
  } catch (error) {
    loading.textContent = `Error: ${error.message}`;
    console.error('Failed to load rubric data:', error);
  }
}
```

### Current Disabled State Handling
**Note**: The Load Data button is **NOT** currently set with a disabled attribute anywhere in the code. The button appears to be always enabled. 

---

## 3. STATE MANAGEMENT

### Global Variables (modal.js, lines 19-22)
```javascript
let availableSections = [];       // Array of section objects from Canvas API
let selectedSectionIds = [];      // Array of selected section IDs (strings)
let sectionsLoaded = false;       // Flag for tracking load state
let courseInfo = null;            // Stores course info
```

### Load Sections Function (modal.js, lines 1968-1990)
```javascript
async function loadSections() {
  const api = new CanvasGraphQLAPI();
  try {
    const result = await api.fetchCourseSections(courseId);
    availableSections = result.sections;

    renderSectionDropdown();
    sectionsLoaded = true;
  } catch (error) {
    console.error('Failed to load sections:', error);
    const list = modalElement.querySelector('#section-dropdown-list');
    list.innerHTML = '<div class="section-item-empty">Failed to load sections</div>';
  }
}
```

### Filter Count Update (modal.js, lines 2030-2042)
```javascript
function updateFilterCount() {
  const countEl = modalElement.querySelector('#section-filter-count');
  const btnText = modalElement.querySelector('.rgm-filter-btn-text');

  if (selectedSectionIds.length > 0) {
    countEl.textContent = selectedSectionIds.length;
    countEl.style.display = 'inline-flex';
    btnText.textContent = `Sections`;
  } else {
    countEl.style.display = 'none';
    btnText.textContent = 'Sections';
  }
}
```

### State Persistence (modal.js, lines 2669-2671)
```javascript
// LOAD SAVED STATE - Load preferences for this course
const savedPrefs = await window.StateManager.loadCoursePreferences(courseId);
selectedSectionIds = savedPrefs.selectedSectionIds || [];
```

---

## 4. EXISTING SEARCH/FILTER INPUTS IN MODAL

### Student Search Input (modal.js, lines 223-225)
```html
<div class="rubric-grader-search rubric-grader-search-student">
  <input type="text" id="rubric-grader-search-input" placeholder="Search Students..." autocomplete="off">
  <button class="search-clear-btn" aria-label="Clear search" title="Clear">&times;</button>
</div>
```

**ID**: `rubric-grader-search-input`
**Handler**: `handleSearch` (line 625)

### Criteria Search Input (modal.js, lines 228-230)
```html
<div class="rubric-grader-search rubric-grader-search-criteria">
  <input type="text" id="rubric-grader-criteria-search" placeholder="Search Criteria..." autocomplete="off">
  <button class="search-clear-btn" aria-label="Clear search" title="Clear">&times;</button>
</div>
```

**ID**: `rubric-grader-criteria-search`
**Handler**: `handleCriteriaSearch` (line 626)

---

## 5. CSS CLASSES AND STYLES

### Dropdown Container Classes (modal.css, lines 2382-2385)
```css
#rubric-grader-modal .section-filter-container {
  position: relative;
}
```

### Filter Button Classes (modal.css, lines 2386-2417)
```css
#rubric-grader-modal .rgm-filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #f8f9fa;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: all 0.2s;
  font-weight: 500;
}

#rubric-grader-modal .rgm-filter-btn:hover {
  border-color: #0374B5;
  background: #e8f5f9;
}

#rubric-grader-modal .rgm-filter-btn svg {
  flex-shrink: 0;
}

#rubric-grader-modal .rgm-filter-btn-text {
  font-weight: 500;
}

#rubric-grader-modal .rgm-filter-chevron {
  margin-left: 2px;
  opacity: 0.6;
}

#rubric-grader-modal .rgm-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #0374B5;
  color: white;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
}
```

### Dropdown Popup Classes (modal.css, lines 2433-2479)
```css
#rubric-grader-modal .section-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 280px;
  max-width: 350px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  overflow: hidden;
}

#rubric-grader-modal .section-dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

#rubric-grader-modal .section-select-all {
  background: none;
  border: none;
  color: #0374B5;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

#rubric-grader-modal .section-select-all:hover {
  background: rgba(3, 116, 181, 0.1);
}

#rubric-grader-modal .section-dropdown-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 8px 0;
}
```

### Section Item Classes (modal.css, lines 2481-2539)
```css
#rubric-grader-modal .rgm-section-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;
  font-size: 14px;
  color: #333;
}

#rubric-grader-modal .rgm-section-item:hover {
  background: #f5f5f5;
}

#rubric-grader-modal .rgm-section-item input[type="checkbox"] {
  display: none;
}

#rubric-grader-modal .rgm-section-checkmark {
  width: 20px;
  height: 20px;
  border: 2px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}

#rubric-grader-modal .rgm-section-item input[type="checkbox"]:checked + .rgm-section-checkmark {
  background: #0374B5;
  border-color: #0374B5;
}

#rubric-grader-modal .rgm-section-item input[type="checkbox"]:checked + .rgm-section-checkmark::after {
  content: '';
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}

#rubric-grader-modal .rgm-section-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#rubric-grader-modal .rgm-section-item-empty {
  padding: 20px 16px;
  text-align: center;
  color: #666;
  font-style: italic;
}
```

### Load Data Button Classes (modal.css, lines 2541-2566)
```css
#rubric-grader-modal .rubric-grader-filters .rgm-btn-primary {
  padding: 6px 14px;
  background: #0374B5;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(3, 116, 181, 0.3);
}

#rubric-grader-modal .rubric-grader-filters .rgm-btn-primary:hover {
  background: #025a8e;
  box-shadow: 0 2px 5px rgba(3, 116, 181, 0.4);
  transform: translateY(-1px);
}

#rubric-grader-modal .rubric-grader-filters .rgm-btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}
```

---

## 6. KEY FILES

| File | Purpose |
|------|---------|
| `src/modal/modal.js` | Main modal component, dropdown logic, section rendering |
| `src/modal/modal.css` | All styling for dropdown, buttons, and sections |
| `src/utils/state-manager.js` | Persistence of selected sections via `saveCoursePreferences()` |

---

## 7. SUMMARY OF DATA FLOW

```
1. Modal Opens
   ↓
2. loadSections() called (line 2700)
   → Fetches sections from Canvas API
   → Populates availableSections array
   ↓
3. Saved preferences loaded (line 2671)
   → selectedSectionIds populated from State Manager
   ↓
4. renderSectionDropdown() renders checkboxes
   → Uses availableSections for loop
   → Checks selectedSectionIds to mark checked items
   ↓
5. User selects/deselects sections
   → handleSectionChange() updates selectedSectionIds
   → updateFilterCount() updates badge count
   → saveCurrentState() persists changes
   ↓
6. User clicks "Load Data"
   → handleLoadData() passes selectedSectionIds to API
   → API.fetchRubricData(assignmentId, selectedSectionIds)
   → Displays results for filtered sections
```

---

## 8. CURRENT LIMITATIONS & NOTES

- **No Initial Disabled State**: The "Load Data" button is currently always enabled, even before sections are loaded
- **No Search in Dropdown**: The section dropdown does NOT have a search/filter input (unlike the student and criteria filters)
- **Sections Loaded Automatically**: Sections are fetched on modal open (line 2700), not triggered by any user action
- **No Validation**: No validation that sections actually exist before enabling the button
- **Always Available**: Button remains available even if `availableSections` is empty

---

