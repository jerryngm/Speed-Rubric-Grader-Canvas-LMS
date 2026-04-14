/**
 * Rubric Grader Modal - Tabulator Version
 * Displays a grading table with students as rows and rubric criteria as columns
 */

const RubricGraderModal = (function() {
  'use strict';

  let modalElement = null;
  let tableData = null;
  let pointsPossible = 0;
  let courseId = null;
  let assignmentId = null;
  let tabulatorTable = null;
  let originalData = {};
  let modifiedCells = new Map();
  let commentsCollapsed = false;
  let expandedCells = new Set(); // Track individually expanded cells
  let availableSections = [];
  let selectedSectionIds = [];
  let sectionsLoaded = false;
  let courseInfo = null; // Store course name, code, and nickname
  let autosaveWriteTimer = null;
  let autosaveLastPayloadJson = null;
  let autosaveBatchMode = false;
  let activeAutosaveRecord = null;
  let activeAutosaveSkippedChanges = null;
  let lastSavedChangesByStudent = new Map();
  let bulkHeaderTooltipEl = null;

  const AUTOSAVE_VERSION = '1.0';
  const AUTOSAVE_DEBOUNCE_MS = 1000;

  function clearLastSavedChangesSnapshot() {
    lastSavedChangesByStudent.clear();
  }

  /**
   * Capture a snapshot of changes before clearing modifiedCells after successful save.
   * This snapshot is used by the messaging system's {{rubric_changes_summary}} template variable.
   *
   * IMPORTANT: Comment Suffix Flow
   * 1. During save (performSave), the suffix is appended to comments before sending to Canvas API
   * 2. This snapshot stores the RAW comment WITHOUT suffix
   * 3. When template variables render {{rubric_changes_summary}}, they append the suffix again
   * 4. This prevents suffix duplication while ensuring it appears in both Canvas and messages
   *
   * The snapshot is cleared on modal open, data load, and cleanup to prevent stale data.
   */
  function captureLastSavedChangesSnapshot() {
    // Snapshot is in-memory only. It is used as a fallback for the messaging
    // template variable `{{rubric_changes_summary}}` after a successful save
    // clears `modifiedCells`.
    const snapshot = new Map();
    if (!tableData?.criteria || modifiedCells.size === 0) {
      lastSavedChangesByStudent = snapshot;
      return;
    }

    modifiedCells.forEach(({ userId, criterionId, data }) => {
      const userKey = String(userId);
      if (!snapshot.has(userKey)) snapshot.set(userKey, []);

      const criterion = tableData.criteria.find(c => String(c._id) === String(criterionId));

      snapshot.get(userKey).push({
        criterionId,
        criterionName: criterion?.description || 'Unknown Criterion',
        points: data?.points ?? null,
        maxPoints: criterion?.points ?? null,
        // IMPORTANT: Store the raw comment (without suffix); the template variable renderer
        // appends the suffix when generating the message preview/content.
        comment: data?.comments ?? ''
      });
    });

    // Stable ordering by criterion name
    snapshot.forEach((changes) => {
      changes.sort((a, b) => String(a.criterionName).localeCompare(String(b.criterionName)));
    });

    lastSavedChangesByStudent = snapshot;
  }

  function ensureBulkHeaderTooltip() {
    if (bulkHeaderTooltipEl?.isConnected) return bulkHeaderTooltipEl;

    bulkHeaderTooltipEl = document.createElement('div');
    bulkHeaderTooltipEl.className = 'rgm-floating-tooltip';
    document.body.appendChild(bulkHeaderTooltipEl);
    return bulkHeaderTooltipEl;
  }

  function hideBulkHeaderTooltip() {
    if (!bulkHeaderTooltipEl) return;
    bulkHeaderTooltipEl.classList.remove('visible');
  }

  function showBulkHeaderTooltip(target) {
    const text = target?.dataset?.tip;
    if (!text) return;

    const tooltip = ensureBulkHeaderTooltip();
    if (!tooltip) return;

    tooltip.textContent = text;
    tooltip.style.left = '-9999px';
    tooltip.style.top = '-9999px';
    tooltip.classList.add('visible');

    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.right - tooltipRect.width, window.innerWidth - tooltipRect.width - margin));
    let top = rect.bottom + 6;

    if (top + tooltipRect.height > window.innerHeight - margin) {
      top = rect.top - tooltipRect.height - 6;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(margin, top)}px`;
  }

  function getGradeColor(percentage) {
    // Handle edge cases
    if (percentage === null || percentage === undefined || isNaN(percentage)) {
      return '#666'; // Gray for ungraded
    }

    // Clamp percentage between 0 and 100
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    // Modern color palette using HSL
    // 0% = Red (hue 0), 50% = Yellow (hue 50), 100% = Green (hue 120)
    // Using a non-linear scale for better visual distribution
    let hue;
    if (clampedPercentage < 50) {
      // 0-50%: Red to Yellow (hue 0 to 50)
      hue = clampedPercentage;
    } else {
      // 50-100%: Yellow to Green (hue 50 to 120)
      hue = 50 + ((clampedPercentage - 50) * 1.4);
    }

    // Modern palette: 70% saturation, 45% lightness for vibrant but readable colors
    return `hsl(${hue}, 70%, 45%)`;
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.id = 'rubric-grader-modal';
    modal.className = 'rubric-grader-modal';
    modal.innerHTML = `
      <div class="rubric-grader-overlay"></div>
      <div class="rubric-grader-content">
        <div class="rubric-grader-header">
          <h2 class="rubric-grader-title">
            <img src="${chrome.runtime.getURL('icons/icon.svg')}" width="48" height="48" alt="" style="flex-shrink: 0;">
            <span class="rubric-grader-title-text">Speed Rubric Grader</span>
          </h2>
          <div class="rubric-grader-header-actions">
            <span class="rubric-grader-status"></span>
            <button class="rgm-btn-secondary" id="rubric-grader-help" title="Help" aria-label="Help">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <path d="M12 17h.01"></path>
              </svg>
            </button>
            <button class="rgm-btn-secondary" id="rubric-grader-settings" title="Settings" aria-label="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button class="rubric-grader-close" aria-label="Close">&times;</button>
          </div>
        </div>
        <div class="rubric-grader-toolbar">
          <div class="toolbar-collapse-wrapper">
            <button class="toolbar-collapse-toggle" id="toolbar-collapse-toggle" type="button" data-tip="Collapse toolbar" aria-label="Toggle toolbar">
              <svg class="toolbar-collapse-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <span class="toolbar-collapse-label" id="toolbar-collapse-label">Minimise</span>
          </div>

          <!-- Data Source Group -->
          <div class="toolbar-group toolbar-group-source">
            <span class="toolbar-group-title">Data Source</span>
            <div class="rubric-grader-filters">
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
                <div class="section-dropdown" id="section-dropdown" style="display: none;">
                  <div class="section-dropdown-header">
                    <span>Select Sections</span>
                    <button class="section-select-all" id="section-select-all">Select All</button>
                  </div>
                  <div class="section-dropdown-search">
                    <input type="text" id="section-search-input" class="section-search-input" placeholder="Search sections..." autocomplete="off">
                  </div>
                  <div class="section-dropdown-list" id="section-dropdown-list">
                    <div class="section-item-empty">Loading sections...</div>
                  </div>
                </div>
              </div>
              <div class="load-btn-wrapper" id="load-btn-wrapper">
                <button class="rgm-btn-primary" id="rubric-grader-load" disabled>Load Data</button>
                <div class="load-btn-tooltip" id="load-btn-tooltip">Select at least one section to load data</div>
              </div>
            </div>
          </div>

          <!-- Filters Group -->
          <div class="toolbar-group toolbar-group-filters">
            <span class="toolbar-group-title">Filters</span>
            <div class="rubric-grader-search-group">
              <div class="rubric-grader-search rubric-grader-search-student">
                <input type="text" id="rubric-grader-search-input" placeholder="Search Students..." autocomplete="off">
                <button class="search-clear-btn" aria-label="Clear search" title="Clear">&times;</button>
              </div>
              <div class="search-divider"></div>
              <div class="rubric-grader-search rubric-grader-search-criteria">
                <input type="text" id="rubric-grader-criteria-search" placeholder="Search Criteria..." autocomplete="off">
                <button class="search-clear-btn" aria-label="Clear search" title="Clear">&times;</button>
              </div>
              <label class="toggle-switch-container" for="rubric-grader-toggle-comments" data-tip="Toggle comments visibility">
                <span class="rgm-toggle-label" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </span>
                <input type="checkbox" id="rubric-grader-toggle-comments" checked aria-label="Toggle comments visibility">
                <span class="rgm-toggle-slider" aria-hidden="true"></span>
              </label>
            </div>
          </div>

          <!-- Comment Suffix -->
          <div class="toolbar-group toolbar-group-suffix">
            <span class="toolbar-group-title">
              Auto-append to Comments
              <span class="toolbar-suffix-info" data-tip="Appended to the end of every comment that was added or changed during this session">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <circle cx="12" cy="8" r="0.5" fill="currentColor"></circle>
                </svg>
              </span>
            </span>
            <div class="rubric-grader-suffix-wrapper">
              <input type="text" id="rubric-grader-comment-suffix" placeholder="e.g., - Graded by John" autocomplete="off">
              <button class="search-clear-btn" aria-label="Clear suffix" title="Clear">&times;</button>
            </div>
          </div>

          <!-- Actions Group -->
          <div class="toolbar-group toolbar-group-actions">
            <span class="toolbar-group-title">Actions</span>
            <div class="rubric-grader-actions">
              <button class="rgm-btn-secondary" id="rubric-grader-refresh" aria-label="Refresh data" title="Refresh">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
              </button>
              <button class="rgm-btn-primary" id="rubric-grader-save" disabled>Save</button>
            </div>
          </div>
        </div>
        <div class="rubric-grader-body">
          <div class="rubric-grader-loading">Loading rubric data...</div>
          <div id="rubric-grader-table"></div>
        </div>
      </div>
      <div id="criterion-detail-modal" class="criterion-detail-modal" style="display: none;">
        <div class="criterion-detail-overlay"></div>
        <div class="criterion-detail-content">
          <div class="criterion-detail-header">
            <h3 class="criterion-detail-title"></h3>
            <button class="criterion-detail-close" aria-label="Close">&times;</button>
          </div>
          <div class="criterion-detail-body">
            <div class="criterion-detail-section">
              <h4>Description</h4>
              <p class="criterion-detail-description"></p>
            </div>
            <div class="criterion-detail-section criterion-detail-long" style="display: none;">
              <h4>Details</h4>
              <p class="criterion-detail-long-description"></p>
            </div>
            <div class="criterion-detail-section">
              <h4>Points</h4>
              <p class="criterion-detail-points"></p>
            </div>
          </div>
        </div>
      </div>
	      <div id="save-confirmation-modal" class="save-confirmation-modal" style="display: none;">
	        <div class="save-confirmation-overlay"></div>
	        <div class="save-confirmation-content">
	          <div class="save-confirmation-header">
	            <h3 class="save-confirmation-title">Review Changes</h3>
	            <button class="save-confirmation-close" aria-label="Close">&times;</button>
	          </div>
	          <div class="save-confirmation-body">
	            <div class="save-confirmation-summary"></div>
	            <div class="save-confirmation-changes"></div>
	          </div>
	          <div class="save-confirmation-footer">
	            <button class="rgm-btn-secondary" id="save-confirmation-cancel">Cancel</button>
	            <button class="rgm-btn-primary" id="save-confirmation-confirm">Confirm & Save</button>
	          </div>
	        </div>
	      </div>

	      <!-- Autosave Restore Modal -->
	      <div id="autosave-confirmation-modal" class="autosave-confirmation-modal" style="display: none;">
	        <div class="autosave-confirmation-overlay"></div>
	        <div class="autosave-confirmation-content">
	          <div class="autosave-confirmation-header">
	            <h3 class="autosave-confirmation-title">Restore Autosave?</h3>
	          </div>
	          <div class="autosave-confirmation-body">
	            <p class="autosave-confirmation-message" id="autosave-confirmation-message"></p>
	            <p class="autosave-confirmation-submessage" id="autosave-confirmation-submessage" style="display: none;"></p>
	            <div class="autosave-confirmation-summary" id="autosave-confirmation-summary"></div>
	            <div class="autosave-confirmation-changes" id="autosave-confirmation-changes"></div>
	          </div>
	          <div class="autosave-confirmation-footer" id="autosave-confirmation-footer"></div>
	        </div>
	      </div>

	      <!-- Settings Modal -->
	      <div id="settings-modal" class="settings-modal" style="display: none;">
	        <div class="settings-overlay"></div>
	        <div class="settings-content">
          <div class="settings-header">
            <h3 class="settings-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              Preferences & Storage
            </h3>
            <button class="settings-close" aria-label="Close">&times;</button>
          </div>
          <div class="settings-body">
            <!-- Storage Usage Section -->
            <div class="settings-section">
              <h4 class="settings-section-title">Storage Usage</h4>
              <div class="storage-info">
                <div class="storage-bar-container">
                  <div class="storage-bar">
                    <div class="storage-bar-fill" id="storage-bar-fill" style="width: 0%;"></div>
                  </div>
                  <div class="storage-text" id="storage-text">Loading...</div>
                </div>
              </div>
            </div>

            <!-- Saved Courses Section -->
            <div class="settings-section">
              <h4 class="settings-section-title">Saved Course Preferences</h4>
              <div class="settings-courses-list" id="settings-courses-list">
                <div class="settings-loading">Loading preferences...</div>
              </div>
            </div>

            <!-- Export/Import Section -->
            <div class="settings-section">
              <h4 class="settings-section-title">Backup & Restore</h4>
              <div class="settings-export-import">
                <button class="rgm-btn-secondary settings-action-btn" id="settings-export">

                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  Export Settings
                </button>
                <button class="rgm-btn-secondary settings-action-btn" id="settings-import">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Import Settings
                </button>
                <input type="file" id="settings-import-file" accept=".json" style="display: none;">
              </div>
              <div class="settings-message" id="settings-message" style="display: none;"></div>
            </div>
          </div>
          <div class="settings-footer">
            <button class="rgm-btn-secondary" id="settings-clear-all">Clear All Preferences</button>
            <button class="rgm-btn-primary" id="settings-done">Done</button>
          </div>
        </div>
      </div>
      <!-- Help Modal -->
      <div id="help-modal" class="help-modal" style="display: none;">
        <div class="help-overlay"></div>
        <div class="help-content">
          <div class="help-header">
            <h3 class="help-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              Help & Documentation
            </h3>
            <button class="help-close" aria-label="Close">&times;</button>
          </div>
          <div class="help-body">
            <iframe id="help-iframe" src="" style="width: 100%; height: 100%; border: none;"></iframe>
          </div>
        </div>
      </div>

      <!-- Import Confirmation Modal -->
      <div id="import-confirmation-modal" class="import-confirmation-modal" style="display: none;">
        <div class="import-confirmation-overlay"></div>
        <div class="import-confirmation-content">
          <div class="import-confirmation-header">
            <h3 class="import-confirmation-title">Import Settings</h3>
            <button class="import-confirmation-close" aria-label="Close">&times;</button>
          </div>
          <div class="import-confirmation-body">
            <div class="import-file-info">
              <div class="import-info-row">
                <span class="import-info-label">File:</span>
                <span class="import-info-value" id="import-file-name"></span>
              </div>
              <div class="import-info-row">
                <span class="import-info-label">Domain:</span>
                <span class="import-info-value" id="import-domain"></span>
              </div>
              <div class="import-info-row">
                <span class="import-info-label">Export Date:</span>
                <span class="import-info-value" id="import-date"></span>
              </div>
            </div>
            <div class="import-summary">
              <h4>This will import:</h4>
              <ul class="import-summary-list">
                <li><span class="import-count" id="import-prefs-count">0</span> course preferences</li>
                <li><span class="import-count" id="import-autosaves-count">0</span> autosaves</li>
              </ul>
              <p class="import-note">Existing data will be preserved unless there are conflicts.</p>
            </div>
            <div class="import-result" id="import-result" style="display: none;"></div>
          </div>
          <div class="import-confirmation-footer">
            <button class="rgm-btn-secondary" id="import-cancel">Cancel</button>
            <button class="rgm-btn-primary" id="import-confirm">Import</button>
          </div>
        </div>
      </div>

      <!-- Close Confirmation Modal -->
      <div id="close-confirmation-modal" class="close-confirmation-modal" style="display: none;">
        <div class="close-confirmation-overlay"></div>
        <div class="close-confirmation-content">
          <div class="close-confirmation-header">
            <div class="close-confirmation-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#ff9800" stroke="#ff9800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <line x1="12" y1="9" x2="12" y2="13" stroke="#fff" stroke-width="2" stroke-linecap="round"></line>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="#fff" stroke-width="2" stroke-linecap="round"></line>
              </svg>
            </div>
            <h3 class="close-confirmation-title">Close Modal</h3>
          </div>
          <div class="close-confirmation-body">
            <p class="close-confirmation-message" id="close-confirmation-message">Are you sure you want to close?</p>
            <p class="close-confirmation-hint" id="close-confirmation-hint">Any unsaved changes will be lost.</p>
          </div>
          <div class="close-confirmation-footer">
            <button class="rgm-btn-secondary" id="close-cancel">Cancel</button>
            <button class="rgm-btn-danger" id="close-confirm">Close</button>
          </div>
        </div>
      </div>

      <!-- Set All Scores Modal -->
      <div id="set-all-scores-modal" class="set-all-scores-modal" style="display: none;">
        <div class="set-all-scores-overlay"></div>
        <div class="set-all-scores-content">
          <div class="set-all-scores-header">
            <h3 class="set-all-scores-title">Set All Scores</h3>
            <button class="set-all-scores-close" aria-label="Close">&times;</button>
          </div>
          <div class="set-all-scores-body">
            <p class="set-all-scores-message" id="set-all-scores-message"></p>
            <div class="set-all-scores-options" role="radiogroup" aria-label="Set all scores option">
              <button class="set-all-scores-option" type="button" data-mode="max" aria-pressed="false">
                <span class="set-all-scores-option-title">Set all to max</span>
                <span class="set-all-scores-option-text">Apply each rubric criterion's maximum score.</span>
              </button>
              <button class="set-all-scores-option" type="button" data-mode="zero" aria-pressed="false">
                <span class="set-all-scores-option-title">Set all to 0</span>
                <span class="set-all-scores-option-text">Apply zero to every rubric criterion score.</span>
              </button>
            </div>
            <div class="set-all-scores-warning">
              <strong>Warning</strong>
              <p>This will overwrite all existing numeric rubric scores for this student. Comments will not be changed.</p>
            </div>
          </div>
          <div class="set-all-scores-footer">
            <button class="rgm-btn-secondary" id="set-all-scores-cancel">Cancel</button>
            <button class="rgm-btn-primary" id="set-all-scores-confirm" disabled>Confirm</button>
          </div>
        </div>
      </div>

      <!-- Clear All Confirmation Modal -->
      <div id="clear-all-confirmation-modal" class="reset-confirmation-modal" style="display: none;">
        <div class="reset-confirmation-overlay"></div>
        <div class="reset-confirmation-content">
          <div class="reset-confirmation-header">
            <div class="reset-confirmation-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#ff9800" stroke="#ff9800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <line x1="12" y1="9" x2="12" y2="13" stroke="#fff" stroke-width="2" stroke-linecap="round"></line>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="#fff" stroke-width="2" stroke-linecap="round"></line>
              </svg>
            </div>
            <h3 class="reset-confirmation-title">Clear All Preferences</h3>
          </div>
          <div class="reset-confirmation-body">
            <p class="reset-warning-text">This will permanently delete all saved data for this Canvas instance:</p>
            <ul class="reset-warning-list">
              <li>All saved section selections</li>
              <li>All comment visibility preferences</li>
              <li>All saved data for all courses</li>
            </ul>
            <p class="reset-danger-text">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="none" style="vertical-align: middle; margin-right: 4px;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#d32f2f" stroke="#d32f2f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <line x1="12" y1="9" x2="12" y2="13" stroke="#fff" stroke-width="2" stroke-linecap="round"></line>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="#fff" stroke-width="2" stroke-linecap="round"></line>
              </svg>
              This action cannot be undone!
            </p>
          </div>
          <div class="reset-confirmation-footer">
            <button class="rgm-btn-secondary" id="clear-all-cancel">Cancel</button>
            <button class="rgm-btn-danger" id="clear-all-confirm">Clear All</button>
          </div>
        </div>
      </div>

      <!-- Course Reset Confirmation Modal -->
      <div id="course-reset-confirmation-modal" class="reset-confirmation-modal" style="display: none;">
        <div class="reset-confirmation-overlay"></div>
        <div class="reset-confirmation-content">
          <div class="reset-confirmation-header">
            <div class="reset-confirmation-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </div>
            <h3 class="reset-confirmation-title">Reset Course Preferences</h3>
          </div>
          <div class="reset-confirmation-body">
            <div class="reset-course-info">
              <div class="reset-course-name" id="reset-course-name"></div>
              <div class="reset-course-subtitle" id="reset-course-subtitle"></div>
            </div>
            <p class="reset-warning-text">This will clear the following for this course:</p>
            <ul class="reset-warning-list">
              <li>Section selections</li>
              <li>Comment visibility settings</li>
            </ul>
            <p class="reset-danger-text">This action cannot be undone.</p>
          </div>
          <div class="reset-confirmation-footer">
            <button class="rgm-btn-secondary" id="course-reset-cancel">Cancel</button>
            <button class="rgm-btn-danger" id="course-reset-confirm">Reset</button>
          </div>
        </div>
      </div>
    `;
    modal.querySelector('.rubric-grader-overlay').addEventListener('click', () => close());
    modal.querySelector('.rubric-grader-close').addEventListener('click', () => close());
    modal.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.rgm-bulk-student-header-btn[data-tip]');
      if (!btn || !modal.contains(btn)) return;
      showBulkHeaderTooltip(btn);
    });
    modal.addEventListener('mouseout', (e) => {
      const btn = e.target.closest('.rgm-bulk-student-header-btn[data-tip]');
      if (!btn || !modal.contains(btn)) return;
      if (e.relatedTarget && btn.contains(e.relatedTarget)) return;
      hideBulkHeaderTooltip();
    });
    modal.addEventListener('focusin', (e) => {
      const btn = e.target.closest('.rgm-bulk-student-header-btn[data-tip]');
      if (!btn || !modal.contains(btn)) return;
      showBulkHeaderTooltip(btn);
    });
    modal.addEventListener('focusout', (e) => {
      const btn = e.target.closest('.rgm-bulk-student-header-btn[data-tip]');
      if (!btn || !modal.contains(btn)) return;
      hideBulkHeaderTooltip();
    });
    modal.querySelector('#rubric-grader-toggle-comments').addEventListener('change', toggleComments);
    modal.querySelector('#rubric-grader-settings').addEventListener('click', openSettings);
    modal.querySelector('#rubric-grader-help').addEventListener('click', openHelp);
    modal.querySelector('#rubric-grader-refresh').addEventListener('click', refresh);
    modal.querySelector('#rubric-grader-save').addEventListener('click', saveChanges);
    modal.querySelector('#rubric-grader-search-input').addEventListener('input', handleSearch);
    modal.querySelector('#rubric-grader-criteria-search').addEventListener('input', handleCriteriaSearch);
    modal.querySelector('#section-filter-btn').addEventListener('click', toggleSectionDropdown);
    modal.querySelector('#section-search-input').addEventListener('input', filterSectionDropdown);
    modal.querySelector('#section-select-all').addEventListener('click', selectAllSections);
    modal.querySelector('#rubric-grader-load').addEventListener('click', handleLoadData);
    modal.querySelector('.criterion-detail-overlay').addEventListener('click', closeCriterionDetail);
    modal.querySelector('.criterion-detail-close').addEventListener('click', closeCriterionDetail);
    modal.querySelector('.save-confirmation-overlay').addEventListener('click', closeSaveConfirmation);
    modal.querySelector('.save-confirmation-close').addEventListener('click', closeSaveConfirmation);
    modal.querySelector('#save-confirmation-cancel').addEventListener('click', closeSaveConfirmation);
    modal.querySelector('#save-confirmation-confirm').addEventListener('click', confirmAndSave);
    modal.querySelector('.set-all-scores-overlay').addEventListener('click', closeSetAllScoresModal);
    modal.querySelector('.set-all-scores-close').addEventListener('click', closeSetAllScoresModal);
    modal.querySelector('#set-all-scores-cancel').addEventListener('click', closeSetAllScoresModal);
    modal.querySelector('#set-all-scores-confirm').addEventListener('click', confirmSetAllScores);
    modal.querySelector('.settings-overlay').addEventListener('click', closeSettings);
    modal.querySelector('.settings-close').addEventListener('click', closeSettings);
    modal.querySelector('#settings-done').addEventListener('click', closeSettings);
    modal.querySelector('.help-overlay').addEventListener('click', closeHelp);
    modal.querySelector('.help-close').addEventListener('click', closeHelp);
    modal.querySelector('#settings-clear-all').addEventListener('click', clearAllPreferences);
    modal.querySelector('#settings-export').addEventListener('click', exportSettings);
    modal.querySelector('#settings-import').addEventListener('click', () => {
      modal.querySelector('#settings-import-file').click();
    });
    modal.querySelector('#settings-import-file').addEventListener('change', importSettings);
    modal.querySelector('.import-confirmation-overlay').addEventListener('click', closeImportConfirmation);
    modal.querySelector('.import-confirmation-close').addEventListener('click', closeImportConfirmation);
    modal.querySelector('#import-cancel').addEventListener('click', closeImportConfirmation);
    modal.querySelector('#import-confirm').addEventListener('click', confirmImport);
    modal.querySelector('#clear-all-cancel').addEventListener('click', closeClearAllConfirmation);
    modal.querySelector('#clear-all-confirm').addEventListener('click', confirmClearAll);
    modal.querySelector('#course-reset-cancel').addEventListener('click', closeCourseResetConfirmation);
    modal.querySelector('#course-reset-confirm').addEventListener('click', confirmCourseReset);
    modal.querySelector('.reset-confirmation-overlay').addEventListener('click', (e) => {
      if (e.target.closest('#clear-all-confirmation-modal')) {
        closeClearAllConfirmation();
      } else if (e.target.closest('#course-reset-confirmation-modal')) {
        closeCourseResetConfirmation();
      }
    });
    document.addEventListener('keydown', handleKeydown);

    // Toolbar collapse/expand toggle
    setupToolbarCollapse(modal);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const container = modal.querySelector('.section-filter-container');
      const dropdown = modal.querySelector('#section-dropdown');
      if (container && !container.contains(e.target) && dropdown.style.display !== 'none') {
        dropdown.style.display = 'none';
      }
    });

    return modal;
  }

  function showCriterionDetail(criterion) {
    const detailModal = modalElement.querySelector('#criterion-detail-modal');
    const title = detailModal.querySelector('.criterion-detail-title');
    const description = detailModal.querySelector('.criterion-detail-description');
    const longDescription = detailModal.querySelector('.criterion-detail-long-description');
    const longSection = detailModal.querySelector('.criterion-detail-long');
    const points = detailModal.querySelector('.criterion-detail-points');

    title.textContent = criterion.description;
    description.textContent = criterion.description;
    points.textContent = `Maximum: ${criterion.points} points`;

    if (criterion.longDescription) {
      longDescription.textContent = criterion.longDescription;
      longSection.style.display = 'block';
    } else {
      longSection.style.display = 'none';
    }

    detailModal.style.display = 'block';
  }

  function closeCriterionDetail() {
    const detailModal = modalElement.querySelector('#criterion-detail-modal');
    detailModal.style.display = 'none';
  }

  function closeSaveConfirmation() {
    const confirmModal = modalElement.querySelector('#save-confirmation-modal');
    confirmModal.style.display = 'none';

    // Check if we should close the main modal after save
    if (window._closeAfterSave) {
      window._closeAfterSave = false;
      // Close the main modal
      if (modalElement) {
        modalElement.classList.remove('visible');
        document.body.style.overflow = '';
      }
    }
  }

  function closeSetAllScoresModal() {
    const modal = modalElement?.querySelector('#set-all-scores-modal');
    if (!modal) return;
    modal.style.display = 'none';
    delete modal.dataset.userId;
    delete modal.dataset.studentName;
    delete modal.dataset.selectedMode;

    const confirmBtn = modal.querySelector('#set-all-scores-confirm');
    if (confirmBtn) confirmBtn.disabled = true;

    modal.querySelectorAll('.set-all-scores-option').forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-pressed', 'false');
    });
  }

  function selectSetAllScoresMode(mode) {
    const modal = modalElement?.querySelector('#set-all-scores-modal');
    if (!modal) return;

    modal.dataset.selectedMode = mode;
    modal.querySelectorAll('.set-all-scores-option').forEach((option) => {
      const isSelected = option.dataset.mode === mode;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });

    const confirmBtn = modal.querySelector('#set-all-scores-confirm');
    if (confirmBtn) confirmBtn.disabled = !mode;
  }

  function showSetAllScoresModal(userId, studentName) {
    const modal = modalElement?.querySelector('#set-all-scores-modal');
    if (!modal) return;

    modal.dataset.userId = String(userId);
    modal.dataset.studentName = studentName || '';

    const messageEl = modal.querySelector('#set-all-scores-message');
    if (messageEl) {
      const safeStudentName = studentName || 'this student';
      messageEl.innerHTML = `Choose how to update all rubric scores for <strong>${safeStudentName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</strong>.`;
    }

    modal.querySelectorAll('.set-all-scores-option').forEach((option) => {
      if (option.dataset.bound === '1') return;
      option.dataset.bound = '1';
      option.addEventListener('click', () => selectSetAllScoresMode(option.dataset.mode));
    });

    selectSetAllScoresMode('');
    modal.style.display = 'block';
  }

  function confirmSetAllScores() {
    const modal = modalElement?.querySelector('#set-all-scores-modal');
    if (!modal) return;

    const userId = modal.dataset.userId;
    const mode = modal.dataset.selectedMode;
    if (!userId || !mode) {
      return;
    }

    applySetAllScores(userId, mode);
    closeSetAllScoresModal();
  }

  function applySetAllScores(userId, mode) {
    if (!tabulatorTable || !tableData?.criteria?.length) return;

    const row = tabulatorTable.getRow(userId);
    if (!row) return;

    const rowData = row.getData();
    autosaveBatchMode = true;

    try {
      tableData.criteria.forEach((criterion) => {
        const field = `criterion_${criterion._id}`;
        const currentData = rowData[field] || { points: null, comments: '' };
        const newPoints = mode === 'max' ? criterion.points : 0;
        const newData = { ...currentData, points: newPoints, maxPoints: criterion.points };

        rowData[field] = newData;

        const original = originalData[userId]?.[criterion._id];
        const key = `${userId}-${criterion._id}`;
        const isChanged = !original ||
          newData.points !== original.points ||
          newData.comments !== original.comments;

        if (isChanged) {
          modifiedCells.set(key, { userId, criterionId: criterion._id, data: newData });
        } else {
          modifiedCells.delete(key);
        }
      });

      row.reformat();
      applyModifiedClasses();
      updateStudentProgress(row);
      updateSaveButton();
      scheduleAutosaveWrite();
    } finally {
      autosaveBatchMode = false;
    }
  }

  function updateStudentProgress(row) {
    if (!row || !tableData?.criteria?.length) return;

    const rowData = row.getData();
    const progressFill = row.getElement().querySelector('.student-progress-fill');
    const scoreText = row.getElement().querySelector('.student-score-text');
    if (!progressFill || !scoreText) return;

    let totalScore = 0;
    tableData.criteria.forEach((criterion) => {
      const points = rowData[`criterion_${criterion._id}`]?.points;
      if (points !== null && points !== undefined && !Number.isNaN(points)) {
        totalScore += points;
      }
    });

    const percentage = pointsPossible > 0 ? (totalScore / pointsPossible) * 100 : 0;
    progressFill.style.width = `${percentage}%`;
    progressFill.style.backgroundColor = getGradeColor(percentage);
    scoreText.textContent = `${Math.floor(percentage)}%`;
  }

  function formatAutosaveTimestamp(ts) {
    if (!ts) return 'an earlier session';
    try {
      const date = new Date(ts);
      const datePart = date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      const timePart = date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `${datePart} • ${timePart}`;
    } catch (_e) {
      return 'an earlier session';
    }
  }

  function countAutosaveChanges(changes) {
    if (!changes || typeof changes !== 'object') return 0;
    let count = 0;
    Object.values(changes).forEach((perStudent) => {
      if (!perStudent || typeof perStudent !== 'object') return;
      count += Object.keys(perStudent).length;
    });
    return count;
  }

  function closeAutosaveConfirmation() {
    const modal = modalElement?.querySelector('#autosave-confirmation-modal');
    if (modal) modal.style.display = 'none';
    activeAutosaveRecord = null;
    activeAutosaveSkippedChanges = null;
  }

  function attachCommentExpandHandlers(container) {
    setTimeout(() => {
      container.querySelectorAll('.save-comment-expand').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const button = e.target;
          const commentBox = button.closest('.save-comment-box');
          const commentDiv = commentBox.querySelector('.save-comment-old, .save-comment-new');
          const isExpanded = commentDiv.classList.contains('expanded');

          if (isExpanded) {
            // Collapse
            const truncateLength = 150;
            const fullText = commentDiv.dataset.fullText;
            commentDiv.textContent = fullText.substring(0, truncateLength) + '...';
            commentDiv.classList.remove('expanded');
            button.textContent = 'Show more';
          } else {
            // Expand
            commentDiv.textContent = commentDiv.dataset.fullText;
            commentDiv.classList.add('expanded');
            button.textContent = 'Show less';
          }
        });
      });
    }, 100);
  }

  function buildChangesByStudentFromAutosave(record) {
    const changesByStudent = new Map();
    const changes = record?.changes || {};

    Object.entries(changes).forEach(([userId, perStudent]) => {
      const items = [];
      Object.entries(perStudent || {}).forEach(([criterionId, data]) => {
        items.push({ criterionId, data });
      });
      if (items.length > 0) changesByStudent.set(String(userId), items);
    });

    // Sort by student name when possible, fallback to userId
    const studentNameById = new Map();
    tableData?.submissions?.forEach((s) => {
      studentNameById.set(String(s.userId), s.name || '');
    });

    const sortedEntries = Array.from(changesByStudent.entries()).sort(([aId], [bId]) => {
      const aName = studentNameById.get(String(aId)) || '';
      const bName = studentNameById.get(String(bId)) || '';
      if (aName && bName) return aName.localeCompare(bName);
      if (aName && !bName) return -1;
      if (!aName && bName) return 1;
      return String(aId).localeCompare(String(bId));
    });

    return new Map(sortedEntries);
  }

  function renderChangesPreview({ changesByStudent, summaryTarget, changesTarget, includeProgress = false, progressTotal = 0 }) {
    if (!summaryTarget || !changesTarget) return;

    const criteriaIds = new Set();
    let totalChanges = 0;
    changesByStudent.forEach((changes) => {
      totalChanges += changes.length;
      changes.forEach(({ criterionId }) => criteriaIds.add(criterionId));
    });

    summaryTarget.innerHTML = `
      <div class="save-summary-stats">
        <div class="save-stat">
          <span class="save-stat-number">${totalChanges}</span>
          <span class="save-stat-label">Total Changes</span>
        </div>
        <div class="save-stat">
          <span class="save-stat-number">${changesByStudent.size}</span>
          <span class="save-stat-label">Students</span>
        </div>
        <div class="save-stat">
          <span class="save-stat-number">${criteriaIds.size}</span>
          <span class="save-stat-label">Criteria</span>
        </div>
      </div>
      ${includeProgress ? `
        <div class="save-progress-bar-container" style="display: none;">
          <div class="save-progress-bar">
            <div class="save-progress-fill" style="width: 0%;"></div>
          </div>
          <div class="save-progress-text">Saving 0/${progressTotal}...</div>
        </div>
        <div class="save-overall-result" style="display: none;"></div>
      ` : ''}
    `;

    if (totalChanges === 0) {
      changesTarget.innerHTML = '<div class="save-changes-list"><div class="settings-empty">No changes to display.</div></div>';
      return;
    }

    let changesHTML = '<div class="save-changes-list">';

    changesByStudent.forEach((changes, userId) => {
      const student = tableData?.submissions?.find(s => String(s.userId) === String(userId));
      const studentName = student ? student.name : `Student ${userId}`;

      changesHTML += `
        <div class="save-student-group" data-user-id="${userId}">
          <div class="save-student-header">
            <span class="save-student-status-icon">👤</span>
            <span class="save-student-name">${studentName}</span>
            <span class="save-student-count">${changes.length} change${changes.length > 1 ? 's' : ''}</span>
            <span class="save-student-status"></span>
          </div>
          <div class="save-student-changes">
      `;

      changes.forEach(({ criterionId, data }) => {
        const criterion = tableData?.criteria?.find(c => String(c._id) === String(criterionId));
        const criterionName = criterion ? criterion.description : 'Unknown Criterion';
        const maxPoints = criterion ? criterion.points : 0;
        const original = originalData?.[userId]?.[criterionId] || { points: null, comments: '' };

        const pointsChanged = original.points !== data.points;
        const commentsChanged = original.comments !== data.comments;

        changesHTML += `
          <div class="save-change-item">
            <div class="save-criterion-name">${criterionName}</div>
            <div class="save-change-details">
        `;

        if (pointsChanged) {
          const oldPoints = original.points !== null ? original.points : '-';
          const newPoints = data.points !== null ? data.points : '-';
          changesHTML += `
            <div class="save-change-row">
              <span class="save-change-label">Points:</span>
              <span class="save-change-value">
                <span class="save-old-value">${oldPoints}</span>
                <span class="save-arrow">→</span>
                <span class="save-new-value">${newPoints}</span>
                <span class="save-max-points">/ ${maxPoints}</span>
              </span>
            </div>
          `;
        }

        if (commentsChanged) {
          const oldComment = original.comments || '(no comment)';
          const commentSuffix = getCommentSuffix();
          let newComment = data.comments || '(no comment)';
          if (commentSuffix && data.comments) {
            newComment = appendSuffixToComment(data.comments, commentSuffix);
          }

          const truncateLength = 150;
          const oldCommentTruncated = oldComment.length > truncateLength ? oldComment.substring(0, truncateLength) + '...' : oldComment;
          const newCommentTruncated = newComment.length > truncateLength ? newComment.substring(0, truncateLength) + '...' : newComment;
          const oldNeedsTruncation = oldComment.length > truncateLength;
          const newNeedsTruncation = newComment.length > truncateLength;

          changesHTML += `
            <div class="save-change-row">
              <span class="save-change-label">Comment:</span>
              <div class="save-comment-change">
                <div class="save-comment-box">
                  <div class="save-comment-old ${oldNeedsTruncation ? 'truncated' : ''}" data-full-text="${oldComment.replace(/"/g, '&quot;')}">${oldCommentTruncated}</div>
                  ${oldNeedsTruncation ? '<button class="save-comment-expand" data-target="old">Show more</button>' : ''}
                </div>
                <div class="save-arrow">→</div>
                <div class="save-comment-box">
                  <div class="save-comment-new ${newNeedsTruncation ? 'truncated' : ''}" data-full-text="${newComment.replace(/"/g, '&quot;')}">${newCommentTruncated}</div>
                  ${newNeedsTruncation ? '<button class="save-comment-expand" data-target="new">Show more</button>' : ''}
                </div>
              </div>
            </div>
          `;
        }

        changesHTML += `
            </div>
          </div>
        `;
      });

      changesHTML += `
          </div>
        </div>
      `;
    });

    changesHTML += '</div>';
    changesTarget.innerHTML = changesHTML;

    attachCommentExpandHandlers(changesTarget);
  }

  function setAutosaveFooterButtons(buttons) {
    const footer = modalElement.querySelector('#autosave-confirmation-footer');
    footer.innerHTML = '';

    buttons.forEach((btnDef) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnDef.className;
      btn.textContent = btnDef.label;
      btn.addEventListener('click', btnDef.onClick);
      footer.appendChild(btn);
    });
  }

  function renderAutosavePrompt(record) {
    const modal = modalElement.querySelector('#autosave-confirmation-modal');
    const messageEl = modal.querySelector('#autosave-confirmation-message');
    const subMessageEl = modal.querySelector('#autosave-confirmation-submessage');
    const summaryEl = modal.querySelector('#autosave-confirmation-summary');
    const changesEl = modal.querySelector('#autosave-confirmation-changes');

    activeAutosaveRecord = record;
    activeAutosaveSkippedChanges = null;

    const changeCount = countAutosaveChanges(record?.changes);
    const when = formatAutosaveTimestamp(record?.timestamp);

    messageEl.innerHTML = `
      <div class="autosave-toast autosave-toast-warning">
        <div class="autosave-toast-title">Autosave found</div>
        <div class="autosave-toast-text">Saved ${when} • ${changeCount} unsaved change${changeCount === 1 ? '' : 's'}</div>
      </div>
    `;
    subMessageEl.style.display = 'none';
    subMessageEl.textContent = '';

    const changesByStudent = buildChangesByStudentFromAutosave(record);
    renderChangesPreview({
      changesByStudent,
      summaryTarget: summaryEl,
      changesTarget: changesEl
    });

    setAutosaveFooterButtons([
      {
        label: 'Discard',
        className: 'rgm-btn-secondary',
        onClick: async () => {
          try {
            await window.StateManager.clearAutosave(courseId, assignmentId);
          } catch (err) {
            console.warn('[Autosave] Failed to clear autosave', err);
          } finally {
            closeAutosaveConfirmation();
          }
        }
      },
      {
        label: 'Restore',
        className: 'rgm-btn-primary',
        onClick: async () => {
          await handleAutosaveRestore();
        }
      }
    ]);

    modal.style.display = 'block';
  }

  function buildAutosavePayloadFromModifiedCells() {
    const entries = Array.from(modifiedCells.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)));
    const changes = {};

    entries.forEach(([_key, value]) => {
      const userId = String(value?.userId ?? '');
      const criterionId = String(value?.criterionId ?? '');
      if (!userId || !criterionId) return;

      if (!changes[userId]) changes[userId] = {};
      changes[userId][criterionId] = {
        points: value?.data?.points ?? null,
        comments: value?.data?.comments ?? ''
      };
    });

    return {
      version: AUTOSAVE_VERSION,
      selectedSectionIds: Array.isArray(selectedSectionIds) ? [...selectedSectionIds] : [],
      changes
    };
  }

  async function flushAutosaveWrite() {
    if (!courseId || !assignmentId) return;
    if (!window.StateManager?.saveAutosave) return;
    if (autosaveBatchMode) return;

    if (modifiedCells.size === 0) {
      try {
        await window.StateManager.clearAutosave(courseId, assignmentId);
        autosaveLastPayloadJson = null;
      } catch (err) {
        console.warn('[Autosave] Failed to clear autosave', err);
      }
      return;
    }

    const payload = buildAutosavePayloadFromModifiedCells();
    const json = JSON.stringify(payload);
    if (json === autosaveLastPayloadJson) return;

    try {
      await window.StateManager.saveAutosave(courseId, assignmentId, payload);
      autosaveLastPayloadJson = json;
    } catch (err) {
      console.warn('[Autosave] Failed to save autosave', err);
    }
  }

  function scheduleAutosaveWrite({ immediate = false } = {}) {
    if (!courseId || !assignmentId) return;
    if (autosaveBatchMode) return;

    if (autosaveWriteTimer) {
      clearTimeout(autosaveWriteTimer);
      autosaveWriteTimer = null;
    }

    if (immediate) {
      void flushAutosaveWrite();
      return;
    }

    autosaveWriteTimer = setTimeout(() => {
      autosaveWriteTimer = null;
      void flushAutosaveWrite();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function maybeShowAutosavePrompt() {
    if (!courseId || !assignmentId) return;
    if (!window.StateManager?.loadAutosave) return;

    try {
      const record = await window.StateManager.loadAutosave(courseId, assignmentId);
      const changeCount = countAutosaveChanges(record?.changes);
      if (!record || changeCount <= 0) return;
      renderAutosavePrompt(record);
    } catch (err) {
      console.warn('[Autosave] Failed to load autosave', err);
    }
  }

  async function restoreAutosaveIntoTable(record) {
    if (!tabulatorTable || !tableData) {
      throw new Error('Table not loaded yet');
    }

    const changes = record?.changes || {};
    const skipped = {};
    let restoredEntries = 0;

    autosaveBatchMode = true;
    try {
      // Reset modified state before applying
      modifiedCells.clear();
      applyModifiedClasses();
      updateSaveButton();

      const maybeBlock = typeof tabulatorTable.blockRedraw === 'function';
      if (maybeBlock) tabulatorTable.blockRedraw();

      const affectedRows = new Set();
      const userIds = Object.keys(changes).sort();
      userIds.forEach((userId) => {
        const perStudent = changes[userId] || {};
        const row = tabulatorTable.getRow(userId);
        if (!row) {
          skipped[userId] = perStudent;
          return;
        }

        const criterionIds = Object.keys(perStudent).sort();
        criterionIds.forEach((criterionId) => {
          const field = `criterion_${criterionId}`;
          const cell = row.getCell(field);
          if (!cell) {
            if (!skipped[userId]) skipped[userId] = {};
            skipped[userId][criterionId] = perStudent[criterionId];
            return;
          }

          const saved = perStudent[criterionId] || {};
          const rowData = row.getData();
          const existing = rowData[field] || { points: null, comments: '' };
          const updated = {
            ...existing,
            points: saved.points ?? null,
            comments: saved.comments ?? ''
          };

          // Update the underlying data without triggering cell re-render
          rowData[field] = updated;

          markCellModified(cell);
          affectedRows.add(row);
          restoredEntries++;
        });
      });

      const maybeRestore = typeof tabulatorTable.restoreRedraw === 'function';
      if (maybeRestore) tabulatorTable.restoreRedraw();

      // Reformat affected rows to update the visual display
      affectedRows.forEach(row => row.reformat());
    } finally {
      autosaveBatchMode = false;
    }

    // Ensure the UI matches modifiedCells state after restore
    rebuildModifiedCellsFromTable();
    applyModifiedClasses();
    updateSaveButton();

    return {
      restoredEntries,
      skippedChanges: skipped,
      skippedCount: countAutosaveChanges(skipped),
      unsavedChangesCount: modifiedCells.size
    };
  }

  async function handleAutosaveRestore() {
    const modal = modalElement.querySelector('#autosave-confirmation-modal');
    const messageEl = modal.querySelector('#autosave-confirmation-message');
    const subMessageEl = modal.querySelector('#autosave-confirmation-submessage');
    const footer = modal.querySelector('#autosave-confirmation-footer');

    footer.innerHTML = '<button class="rgm-btn-secondary" disabled>Restoring…</button>';
    subMessageEl.style.display = 'none';
    subMessageEl.textContent = '';

    let result;
    try {
      result = await restoreAutosaveIntoTable(activeAutosaveRecord);
    } catch (err) {
      messageEl.textContent = `Failed to restore autosave: ${err?.message || String(err)}`;
      setAutosaveFooterButtons([
        { label: 'Close', className: 'rgm-btn-primary', onClick: closeAutosaveConfirmation }
      ]);
      return;
    }

    activeAutosaveSkippedChanges = result.skippedChanges;

    // Immediately persist the currently visible unsaved changes.
    // This ensures restored changes are recoverable even if the user closes the grader later.
    await flushAutosaveWrite();

    const skippedCount = result.skippedCount;
    const restoredEntries = result.restoredEntries;
    const unsavedCount = result.unsavedChangesCount;

    messageEl.innerHTML = `
      <div class="autosave-toast autosave-toast-success">
        <div class="autosave-toast-title">Restored</div>
        <div class="autosave-toast-text">${restoredEntries} saved ${restoredEntries === 1 ? 'entry' : 'entries'} applied</div>
      </div>
      <div class="autosave-toast autosave-toast-warning">
        <div class="autosave-toast-title">Not saved to Canvas yet</div>
        <div class="autosave-toast-text">Changes are restored in the table. Click “Save Changes” when you’re ready.</div>
      </div>
    `;

    if (skippedCount > 0) {
      subMessageEl.textContent =
        `Skipped ${skippedCount} because those students aren’t visible in the table right now (they may be in a different section or their enrollment may have changed).`;
      subMessageEl.style.display = 'block';

      setAutosaveFooterButtons([
        {
          label: 'Discard skipped',
          className: 'rgm-btn-secondary',
          onClick: async () => {
            // Storage already contains the currently visible changes (written after restore).
            // Discarding skipped just closes this autosave prompt.
            closeAutosaveConfirmation();
          }
        },
        {
          label: 'Keep skipped',
          className: 'rgm-btn-primary',
          onClick: async () => {
            footer.innerHTML = '<button class="rgm-btn-secondary" disabled>Saving…</button>';

            try {
              const merged = buildAutosavePayloadFromModifiedCells();
              const skipped = activeAutosaveSkippedChanges || {};
              Object.keys(skipped).forEach((userId) => {
                if (!merged.changes[userId]) merged.changes[userId] = {};
                Object.keys(skipped[userId] || {}).forEach((criterionId) => {
                  merged.changes[userId][criterionId] = skipped[userId][criterionId];
                });
              });

              await window.StateManager.saveAutosave(courseId, assignmentId, merged);
              autosaveLastPayloadJson = JSON.stringify(merged);
            } catch (err) {
              console.warn('[Autosave] Failed to save skipped autosave', err);
            }

            messageEl.textContent = 'Skipped changes saved for later.';
            subMessageEl.style.display = 'none';
            subMessageEl.textContent = '';

            setAutosaveFooterButtons([
              { label: 'Close', className: 'rgm-btn-primary', onClick: closeAutosaveConfirmation }
            ]);
          }
        }
      ]);
    } else {
      setAutosaveFooterButtons([
        { label: 'Close', className: 'rgm-btn-primary', onClick: closeAutosaveConfirmation }
      ]);
    }
  }

  function showSaveConfirmation() {
    const confirmModal = modalElement.querySelector('#save-confirmation-modal');
    const summaryDiv = confirmModal.querySelector('.save-confirmation-summary');
    const changesDiv = confirmModal.querySelector('.save-confirmation-changes');
    const footer = confirmModal.querySelector('.save-confirmation-footer');

    // Build summary statistics
    const modifiedStudentIds = new Set([...modifiedCells.values()].map(v => v.userId));
    const modifiedCriteriaIds = new Set([...modifiedCells.values()].map(v => v.criterionId));

    summaryDiv.innerHTML = `
      <div class="save-summary-stats">
        <div class="save-stat">
          <span class="save-stat-number">${modifiedCells.size}</span>
          <span class="save-stat-label">Total Changes</span>
        </div>
        <div class="save-stat">
          <span class="save-stat-number">${modifiedStudentIds.size}</span>
          <span class="save-stat-label">Students</span>
        </div>
        <div class="save-stat">
          <span class="save-stat-number">${modifiedCriteriaIds.size}</span>
          <span class="save-stat-label">Criteria</span>
        </div>
      </div>
      <div class="save-progress-bar-container" style="display: none;">
        <div class="save-progress-bar">
          <div class="save-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="save-progress-text">Saving 0/${modifiedStudentIds.size}...</div>
      </div>
      <div class="save-overall-result" style="display: none;"></div>
    `;

    // Reset footer to initial state
    footer.innerHTML = `
      <button class="rgm-btn-secondary" id="save-confirmation-cancel">Cancel</button>
      <button class="rgm-btn-primary" id="save-confirmation-confirm">Confirm & Save</button>
    `;
    footer.querySelector('#save-confirmation-cancel').addEventListener('click', closeSaveConfirmation);
    footer.querySelector('#save-confirmation-confirm').addEventListener('click', confirmAndSave);

    // Group changes by student
    const changesByStudent = new Map();
    modifiedCells.forEach(({ userId, criterionId, data }) => {
      if (!changesByStudent.has(userId)) {
        changesByStudent.set(userId, []);
      }
      changesByStudent.get(userId).push({ criterionId, data });
    });

    // Build changes HTML grouped by student
    let changesHTML = '<div class="save-changes-list">';

    changesByStudent.forEach((changes, userId) => {
      const student = tableData.submissions.find(s => s.userId === userId);
      const studentName = student ? student.name : 'Unknown Student';
      const studentRow = tabulatorTable?.getRow?.(userId);
      const studentRowData = studentRow?.getData?.();
      const sisId = studentRowData?.sisId || student?.sisId || '';

      changesHTML += `
        <div class="save-student-group" data-user-id="${userId}">
          <div class="save-student-header">
            <span class="save-student-status-icon">👤</span>
            <span class="save-student-name">${studentName}</span>
            <button
              class="rgm-student-action-btn"
              type="button"
              data-tip="Message/Comment"
              aria-label="Message/Comment"
              data-user-id="${userId}"
              data-student-name="${String(studentName).replace(/"/g, '&quot;')}"
              data-sis-id="${String(sisId).replace(/"/g, '&quot;')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
            </button>
            <span class="save-student-count">${changes.length} change${changes.length > 1 ? 's' : ''}</span>
            <span class="save-student-status"></span>
          </div>
          <div class="save-student-changes">
      `;

      changes.forEach(({ criterionId, data }) => {
        const criterion = tableData.criteria.find(c => c._id === criterionId);
        const criterionName = criterion ? criterion.description : 'Unknown Criterion';
        const maxPoints = criterion ? criterion.points : 0;
        const original = originalData[userId]?.[criterionId] || { points: null, comments: '' };

        const pointsChanged = original.points !== data.points;
        const commentsChanged = original.comments !== data.comments;

        changesHTML += `
          <div class="save-change-item">
            <div class="save-criterion-name">${criterionName}</div>
            <div class="save-change-details">
        `;

        if (pointsChanged) {
          const oldPoints = original.points !== null ? original.points : '-';
          const newPoints = data.points !== null ? data.points : '-';
          changesHTML += `
            <div class="save-change-row">
              <span class="save-change-label">Points:</span>
              <span class="save-change-value">
                <span class="save-old-value">${oldPoints}</span>
                <span class="save-arrow">→</span>
                <span class="save-new-value">${newPoints}</span>
                <span class="save-max-points">/ ${maxPoints}</span>
              </span>
            </div>
          `;
        }

        if (commentsChanged) {
          const oldComment = original.comments || '(no comment)';
          const commentSuffix = getCommentSuffix();
          let newComment = data.comments || '(no comment)';
          if (commentSuffix && data.comments) {
            newComment = appendSuffixToComment(data.comments, commentSuffix);
          }

          // Longer truncation length (150 characters)
          const truncateLength = 150;
          const oldCommentTruncated = oldComment.length > truncateLength ? oldComment.substring(0, truncateLength) + '...' : oldComment;
          const newCommentTruncated = newComment.length > truncateLength ? newComment.substring(0, truncateLength) + '...' : newComment;
          const oldNeedsTruncation = oldComment.length > truncateLength;
          const newNeedsTruncation = newComment.length > truncateLength;

          changesHTML += `
            <div class="save-change-row">
              <span class="save-change-label">Comment:</span>
              <div class="save-comment-change">
                <div class="save-comment-box">
                  <div class="save-comment-old ${oldNeedsTruncation ? 'truncated' : ''}" data-full-text="${oldComment.replace(/"/g, '&quot;')}">${oldCommentTruncated}</div>
                  ${oldNeedsTruncation ? '<button class="save-comment-expand" data-target="old">Show more</button>' : ''}
                </div>
                <div class="save-arrow">→</div>
                <div class="save-comment-box">
                  <div class="save-comment-new ${newNeedsTruncation ? 'truncated' : ''}" data-full-text="${newComment.replace(/"/g, '&quot;')}">${newCommentTruncated}</div>
                  ${newNeedsTruncation ? '<button class="save-comment-expand" data-target="new">Show more</button>' : ''}
                </div>
              </div>
            </div>
          `;
        }

        changesHTML += `
            </div>
          </div>
        `;
      });

      changesHTML += `
          </div>
        </div>
      `;
    });

    changesHTML += '</div>';
    changesDiv.innerHTML = changesHTML;

    // Add event listeners for per-student message/comment buttons
    setTimeout(() => {
      changesDiv.querySelectorAll('.rgm-student-action-btn').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (!window.StudentMessageModal || typeof window.StudentMessageModal.open !== 'function') {
            console.warn('[StudentMessage] StudentMessageModal not loaded');
            return;
          }

          const userId = btn.dataset.userId;
          const name = btn.dataset.studentName || '';
          const sisId = btn.dataset.sisId || '';

          window.StudentMessageModal.open({
            courseId,
            assignmentId,
            student: {
              userId,
              name,
              sisId
            }
          });
        });
      });
    }, 0);

    // Add event listeners for comment expand buttons
    attachCommentExpandHandlers(changesDiv);

    // Show modal
    confirmModal.style.display = 'block';
  }

  async function confirmAndSave() {
    // Don't close the modal - show progress instead
    const confirmModal = modalElement.querySelector('#save-confirmation-modal');
    const footer = confirmModal.querySelector('.save-confirmation-footer');
    const progressContainer = confirmModal.querySelector('.save-progress-bar-container');

    // Disable buttons and show progress bar
    footer.innerHTML = `
      <button class="rgm-btn-secondary" disabled>Saving...</button>
    `;
    progressContainer.style.display = 'block';

    await performSave();
  }

  function handleKeydown() {
    // ESC key disabled - users should use the close button for explicit closing
    // This prevents accidental data loss and provides better UX
  }

  function showCloseConfirmation() {
    const closeModal = modalElement.querySelector('#close-confirmation-modal');

    if (!closeModal) {
      console.error('[Close Confirmation] Modal element not found!');
      return;
    }

    const messageEl = modalElement.querySelector('#close-confirmation-message');
    const hintEl = modalElement.querySelector('#close-confirmation-hint');
    const footer = closeModal.querySelector('.close-confirmation-footer');
    const overlay = closeModal.querySelector('.close-confirmation-overlay');

    // Update message based on whether there are changes
    const hasChanges = modifiedCells.size > 0;
    if (hasChanges) {
      messageEl.innerHTML = `You have <strong>${modifiedCells.size}</strong> unsaved changes.`;
      hintEl.textContent = 'If you close now without keeping autosave, these changes will be lost.';
      footer.innerHTML = `
        <button class="rgm-btn-secondary" id="close-discard">Close & Discard Changes</button>
        <button class="rgm-btn-secondary" id="close-cancel">Cancel</button>
        <button class="rgm-btn-primary" id="close-keep">Close (Keep Autosave)</button>
      `;
    } else {
      messageEl.textContent = 'Are you sure you want to close?';
      hintEl.textContent = '';
      footer.innerHTML = `
        <button class="rgm-btn-secondary" id="close-cancel">Cancel</button>
        <button class="rgm-btn-primary" id="close-confirm">Close</button>
      `;
    }

    // Show modal
    closeModal.style.display = 'block';

    const cancelBtn = footer.querySelector('#close-cancel');
    const confirmBtn = footer.querySelector('#close-confirm');
    const discardBtn = footer.querySelector('#close-discard');
    const keepBtn = footer.querySelector('#close-keep');

    // Handle cancel
    const handleCancel = () => {
      closeModal.style.display = 'none';
      cleanup();
    };

    // Handle confirm close (no changes)
    const handleConfirm = () => {
      closeModal.style.display = 'none';
      cleanup();
      close(true); // Force close without checking for unsaved changes
    };

    // Close while keeping autosave (already persisted)
    const handleKeep = async () => {
      try {
        await flushAutosaveWrite();
      } catch (_e) {
        // ignore
      }
      closeModal.style.display = 'none';
      cleanup();
      close(true);
    };

    // Close and discard autosave
    const handleDiscard = async () => {
      try {
        if (window.StateManager?.clearAutosave) {
          await window.StateManager.clearAutosave(courseId, assignmentId);
        }
      } catch (_e) {
        // ignore
      }
      closeModal.style.display = 'none';
      cleanup();
      close(true);
    };

    // Cleanup function to remove event listeners
    const cleanup = () => {
      if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
      if (confirmBtn) confirmBtn.removeEventListener('click', handleConfirm);
      if (discardBtn) discardBtn.removeEventListener('click', handleDiscard);
      if (keepBtn) keepBtn.removeEventListener('click', handleKeep);
      if (overlay) overlay.removeEventListener('click', handleOverlayClick);
    };

    // Add event listeners
    if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
    if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm);
    if (discardBtn) discardBtn.addEventListener('click', handleDiscard);
    if (keepBtn) keepBtn.addEventListener('click', handleKeep);

    // Close on overlay click
    const handleOverlayClick = () => {
      closeModal.style.display = 'none';
      cleanup();
    };
    if (overlay) overlay.addEventListener('click', handleOverlayClick);
  }

  /**
   * Setup toolbar collapse/expand toggle.
   * CSS handles all layout changes via [data-collapsed] attribute.
   */
  function setupToolbarCollapse(modal) {
    const toolbar = modal.querySelector('.rubric-grader-toolbar');
    const toggleBtn = modal.querySelector('#toolbar-collapse-toggle');
    const collapseLabel = modal.querySelector('#toolbar-collapse-label');

    // Inject collapsed styles once as a <style> tag
    injectCollapsedStyles(modal);

    // Collapse/expand toggle
    const toggleCollapse = () => {
      const isCollapsed = toolbar.getAttribute('data-collapsed') === 'true';
      toolbar.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
      toggleBtn.dataset.tip = isCollapsed ? 'Collapse toolbar' : 'Expand toolbar';
      if (collapseLabel) collapseLabel.textContent = isCollapsed ? 'Minimise' : 'Expand';
      if (toggleBtn.matches(':hover') || toggleBtn === document.activeElement) {
        showBulkHeaderTooltip(toggleBtn);
      }
    };
    const showTooltip = () => showBulkHeaderTooltip(toggleBtn);
    toggleBtn.addEventListener('mouseenter', showTooltip);
    toggleBtn.addEventListener('mouseleave', hideBulkHeaderTooltip);
    toggleBtn.addEventListener('focus', showTooltip);
    toggleBtn.addEventListener('blur', hideBulkHeaderTooltip);
    toggleBtn.addEventListener('click', toggleCollapse);
    if (collapseLabel) collapseLabel.addEventListener('click', toggleCollapse);

    // Search clear buttons
    setupSearchClearButtons(modal);
  }

  /** Add has-value class and clear button logic for search inputs and suffix */
  function setupSearchClearButtons(modal) {
    const containers = modal.querySelectorAll('.rubric-grader-search, .rubric-grader-suffix-wrapper');
    containers.forEach(container => {
      const input = container.querySelector('input');
      const clearBtn = container.querySelector('.search-clear-btn');
      if (!input || !clearBtn) return;

      input.addEventListener('input', () => {
        container.classList.toggle('has-value', input.value.length > 0);
      });

      clearBtn.addEventListener('click', () => {
        input.value = '';
        container.classList.remove('has-value');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
    });
  }

  /**
   * Inject collapsed toolbar styles as a <style> tag inside the modal.
   * This guarantees override of Canvas LMS global styles without inline CSS.
   */
  function injectCollapsedStyles(modal) {
    if (modal.querySelector('#toolbar-collapsed-styles')) return;
    const style = document.createElement('style');
    style.id = 'toolbar-collapsed-styles';
    style.textContent = `
      /* Fix Canvas LMS global margin on inputs */
      #rubric-grader-modal .rubric-grader-search input,
      #rubric-grader-modal #rubric-grader-comment-suffix {
        margin: 0 !important;
      }
      /* Collapsed toolbar: compact single row */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] {
        flex-wrap: nowrap !important;
        align-items: center !important;
        padding: 6px 16px !important;
        gap: 12px !important;
        min-height: auto !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-group {
        flex-direction: row !important;
        align-items: center !important;
        gap: 0 !important;
      }
      /* Hide non-essential elements */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-group-source,
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-group-title,
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toggle-switch-container,
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] #rubric-grader-refresh,
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .search-divider,
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-collapse-label {
        display: none !important;
      }
      /* Show clear button in collapsed mode when input has value */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-search.has-value .search-clear-btn {
        display: flex !important;
        width: 16px !important;
        height: 16px !important;
        right: 6px !important;
        font-size: 10px !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-search.has-value input {
        padding-right: 26px !important;
      }
      /* Filters group: 60% (split 30/30 between student + criteria) */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-group-filters {
        flex: 3 1 0 !important;
        min-width: 0 !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-search-group {
        flex: 1 !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        gap: 12px !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-search {
        flex: 1 1 0 !important;
        min-width: 0 !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-search input {
        padding: 6px 10px 6px 38px !important;
        margin: 0 !important;
        font-size: 13px !important;
        height: 28px !important;
        box-sizing: border-box !important;
        width: 100% !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-search::before {
        top: 50% !important;
        width: 20px !important;
        height: 20px !important;
      }
      /* Suffix group: 40% */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-group-suffix {
        flex: 2 1 0 !important;
        min-width: 0 !important;
        width: 100% !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-suffix-wrapper {
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        width: 100% !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-suffix-wrapper::before {
        left: 8px !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] #rubric-grader-comment-suffix {
        padding: 6px 10px 6px 38px !important;
        margin: 0 !important;
        font-size: 13px !important;
        height: 28px !important;
        box-sizing: border-box !important;
        width: 100% !important;
      }
      /* Show suffix clear button in collapsed mode when input has value */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-suffix-wrapper.has-value .search-clear-btn {
        display: flex !important;
        width: 16px !important;
        height: 16px !important;
        right: 6px !important;
        font-size: 10px !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-suffix-wrapper.has-value #rubric-grader-comment-suffix {
        padding-right: 26px !important;
      }
      /* Actions group: save button only */
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .toolbar-group-actions {
        flex: 0 0 auto !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] .rubric-grader-actions {
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
      }
      #rubric-grader-modal .rubric-grader-toolbar[data-collapsed="true"] #rubric-grader-save {
        height: 28px !important;
        padding: 0 14px !important;
        font-size: 13px !important;
        line-height: 28px !important;
        box-sizing: border-box !important;
      }
    `;
    modal.appendChild(style);
  }

  function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    if (tabulatorTable) {
      if (searchTerm) {
        // Custom filter function to search both name and sisId
        tabulatorTable.setFilter(function(data) {
          const name = (data.name || '').toLowerCase();
          const sisId = (data.sisId || '').toLowerCase();
          return name.includes(searchTerm) || sisId.includes(searchTerm);
        });
      } else {
        tabulatorTable.clearFilter();
      }
    }
  }

  function handleCriteriaSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    if (!tabulatorTable || !tableData) return;

    tableData.criteria.forEach(criterion => {
      const field = `criterion_${criterion._id}`;
      const description = (criterion.description || '').toLowerCase();
      const longDescription = (criterion.longDescription || '').toLowerCase();

      // Show column if search is empty or matches description/longDescription
      const shouldShow = !searchTerm ||
        description.includes(searchTerm) ||
        longDescription.includes(searchTerm);

      if (shouldShow) {
        tabulatorTable.showColumn(field);
      } else {
        tabulatorTable.hideColumn(field);
      }
    });
  }

  async function loadSections() {
    const api = new CanvasGraphQLAPI();
    try {
      const result = await api.fetchCourseSections(courseId);
      availableSections = result.sections;

      // Store course information for later use
      if (result.course) {
        courseInfo = {
          name: result.course.name,
          courseCode: result.course.courseCode,
          courseNickname: result.course.courseNickname
        };
      }

      renderSectionDropdown();
      sectionsLoaded = true;
    } catch (error) {
      console.error('Failed to load sections:', error);
      const list = modalElement.querySelector('#section-dropdown-list');
      list.innerHTML = '<div class="section-item-empty">Failed to load sections</div>';
    }
  }

  function renderSectionDropdown() {
    const list = modalElement.querySelector('#section-dropdown-list');

    if (availableSections.length === 0) {
      list.innerHTML = '<div class="section-item-empty">No sections found</div>';
      updateLoadButton();
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

    updateLoadButton();
  }

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
    updateLoadButton();

    // SAVE STATE - Persist section selection
    await saveCurrentState();
  }

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

  function updateLoadButton() {
    const btn = modalElement.querySelector('#rubric-grader-load');
    const tooltip = modalElement.querySelector('#load-btn-tooltip');
    const hasSelection = selectedSectionIds.length > 0;
    btn.disabled = !hasSelection;
    tooltip.style.display = hasSelection ? 'none' : '';
  }

  function filterSectionDropdown() {
    const query = modalElement.querySelector('#section-search-input').value.toLowerCase().trim();
    const items = modalElement.querySelectorAll('#section-dropdown-list .rgm-section-item');
    let visibleCount = 0;

    items.forEach(item => {
      const name = item.querySelector('.rgm-section-name').textContent.toLowerCase();
      const matches = name.includes(query);
      item.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });

    // Show "no results" message when nothing matches
    let noResults = modalElement.querySelector('#section-search-no-results');
    if (visibleCount === 0 && query) {
      if (!noResults) {
        noResults = document.createElement('div');
        noResults.id = 'section-search-no-results';
        noResults.className = 'section-item-empty';
        noResults.textContent = 'No sections match your search';
        modalElement.querySelector('#section-dropdown-list').appendChild(noResults);
      }
      noResults.style.display = '';
    } else if (noResults) {
      noResults.style.display = 'none';
    }
  }

  function toggleSectionDropdown() {
    const dropdown = modalElement.querySelector('#section-dropdown');
    const isVisible = dropdown.style.display !== 'none';
    dropdown.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      // Clear search when opening
      const searchInput = modalElement.querySelector('#section-search-input');
      searchInput.value = '';
      filterSectionDropdown();
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  async function selectAllSections() {
    // Only operate on currently visible checkboxes (respects search filter)
    const visibleCheckboxes = modalElement.querySelectorAll('#section-dropdown-list .rgm-section-item:not([style*="display: none"]) .rgm-section-checkbox');
    const visibleIds = Array.from(visibleCheckboxes).map(cb => cb.value);
    const allVisibleSelected = visibleIds.every(id => selectedSectionIds.includes(id));

    if (allVisibleSelected) {
      // Deselect visible
      selectedSectionIds = selectedSectionIds.filter(id => !visibleIds.includes(id));
      visibleCheckboxes.forEach(cb => cb.checked = false);
    } else {
      // Select visible
      visibleIds.forEach(id => {
        if (!selectedSectionIds.includes(id)) selectedSectionIds.push(id);
      });
      visibleCheckboxes.forEach(cb => cb.checked = true);
    }
    updateFilterCount();
    updateLoadButton();

    // SAVE STATE - Persist section selection
    await saveCurrentState();
  }

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

  async function toggleComments() {
    const checkbox = modalElement.querySelector('#rubric-grader-toggle-comments');
    commentsCollapsed = !checkbox.checked;

    // Clear expanded cells when toggling
    expandedCells.clear();

    if (tabulatorTable) {
      tabulatorTable.redraw(true); // Force re-render all cells
      applyModifiedClasses(); // Reapply cell-modified classes after redraw
    }

    // SAVE STATE - Persist toggle state
    await saveCurrentState();
  }

  // Helper function to save current state to storage
  async function saveCurrentState() {
    if (!courseId) return; // Don't save if no course context

    const toggleCheckbox = modalElement?.querySelector('#rubric-grader-toggle-comments');
    const commentsVisible = toggleCheckbox ? toggleCheckbox.checked : true;

    // Get course info from courseInfo (captured when sections loaded) or fallback to table data
    const courseName = courseInfo?.name || tableData?.assignment?.courseName || null;
    const courseCode = courseInfo?.courseCode || tableData?.assignment?.courseCode || null;
    const courseNickname = courseInfo?.courseNickname || tableData?.assignment?.courseNickname || null;

    await window.StateManager.saveCoursePreferences(courseId, {
      selectedSectionIds: selectedSectionIds,
      commentsVisible: commentsVisible
    }, courseName, courseCode, courseNickname);
  }

  // Open settings modal
  async function openSettings() {
    const settingsModal = modalElement.querySelector('#settings-modal');
    settingsModal.style.display = 'block';

    // Load and display storage info
    await updateStorageInfo();

    // Load and display saved courses
    await loadSavedCourses();

    // Update Clear All button state
    updateClearAllButton();
  }

  // Close settings modal
  function closeSettings() {
    const settingsModal = modalElement.querySelector('#settings-modal');
    settingsModal.style.display = 'none';
  }

  // Open help modal
  function openHelp() {
    const helpModal = modalElement.querySelector('#help-modal');
    const helpIframe = modalElement.querySelector('#help-iframe');
    helpIframe.src = chrome.runtime.getURL('help.html');
    helpModal.style.display = 'block';
  }

  // Close help modal
  function closeHelp() {
    const helpModal = modalElement.querySelector('#help-modal');
    const helpIframe = modalElement.querySelector('#help-iframe');
    helpModal.style.display = 'none';
    helpIframe.src = '';
  }

  // Update storage usage display
  async function updateStorageInfo() {
    const storageInfo = await window.StateManager.getStorageInfo();
    const fillEl = modalElement.querySelector('#storage-bar-fill');
    const textEl = modalElement.querySelector('#storage-text');

    fillEl.style.width = `${storageInfo.percentUsed}%`;

    // Color code based on usage
    if (storageInfo.percentUsed < 50) {
      fillEl.style.background = '#4CAF50'; // Green
    } else if (storageInfo.percentUsed < 80) {
      fillEl.style.background = '#FF9800'; // Orange
    } else {
      fillEl.style.background = '#f44336'; // Red
    }

    textEl.textContent = `${storageInfo.mbUsed} MB / ${storageInfo.mbLimit} MB (${storageInfo.percentUsed.toFixed(1)}%)`;
  }

  // Load and display saved courses
  async function loadSavedCourses() {
    const listEl = modalElement.querySelector('#settings-courses-list');
    const courses = await window.StateManager.getAllCoursePreferences();

    if (courses.length === 0) {
      listEl.innerHTML = '<div class="settings-empty">No saved preferences yet</div>';
      return;
    }

    listEl.innerHTML = courses.map(course => {
      const lastUpdated = course.lastUpdated
        ? new Date(course.lastUpdated).toLocaleDateString()
        : 'Unknown';
      const courseName = course.courseName || `Course ${course.courseId}`;
      const courseCode = course.courseCode || '';
      const courseNickname = course.courseNickname || '';
      const sectionCount = course.selectedSectionIds?.length || 0;
      const commentsState = course.commentsVisible ? 'Visible' : 'Hidden';

      // Build subtitle with code and nickname
      let subtitle = '';
      if (courseCode && courseNickname) {
        subtitle = `${courseCode} • ${courseNickname}`;
      } else if (courseCode) {
        subtitle = courseCode;
      } else if (courseNickname) {
        subtitle = courseNickname;
      }

      return `
        <div class="settings-course-item" data-course-id="${course.courseId}">
          <div class="settings-course-info">
            <div class="settings-course-name">${courseName}</div>
            ${subtitle ? `<div class="settings-course-subtitle">${subtitle}</div>` : ''}
            <div class="settings-course-details">
              <span class="settings-course-detail">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                ${sectionCount}
              </span>
              <span class="settings-course-detail">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                ${commentsState}
              </span>
              <span class="settings-course-detail">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${lastUpdated}
              </span>
            </div>
          </div>
          <button class="settings-course-reset" data-course-id="${course.courseId}" title="Reset this course">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    // Add event listeners for individual reset buttons
    listEl.querySelectorAll('.settings-course-reset').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const targetCourseId = e.target.closest('.settings-course-reset').dataset.courseId;
        await resetCoursePreferences(targetCourseId);
      });
    });
  }

  // Update Clear All button state based on storage
  function updateClearAllButton() {
    const clearAllBtn = modalElement.querySelector('#settings-clear-all');
    const courses = modalElement.querySelectorAll('.settings-course-item');

    if (courses.length === 0) {
      clearAllBtn.disabled = true;
      clearAllBtn.style.opacity = '0.5';
      clearAllBtn.style.cursor = 'not-allowed';
    } else {
      clearAllBtn.disabled = false;
      clearAllBtn.style.opacity = '1';
      clearAllBtn.style.cursor = 'pointer';
    }
  }

  // Reset preferences for a specific course
  let pendingResetCourseId = null;

  async function resetCoursePreferences(targetCourseId) {
    // Get course info from saved preferences
    const courses = await window.StateManager.getAllCoursePreferences();
    const courseData = courses.find(c => c.courseId === targetCourseId);

    // Show confirmation modal
    const modal = modalElement.querySelector('#course-reset-confirmation-modal');
    const nameEl = modal.querySelector('#reset-course-name');
    const subtitleEl = modal.querySelector('#reset-course-subtitle');

    if (courseData) {
      nameEl.textContent = courseData.courseName || `Course ${targetCourseId}`;

      // Build subtitle with code and nickname
      const subtitleParts = [];
      if (courseData.courseCode) subtitleParts.push(courseData.courseCode);
      if (courseData.courseNickname) subtitleParts.push(courseData.courseNickname);
      subtitleEl.textContent = subtitleParts.length > 0 ? subtitleParts.join(' • ') : '';
      subtitleEl.style.display = subtitleParts.length > 0 ? 'block' : 'none';
    } else {
      nameEl.textContent = `Course ${targetCourseId}`;
      subtitleEl.textContent = '';
      subtitleEl.style.display = 'none';
    }

    pendingResetCourseId = targetCourseId;
    modal.style.display = 'block';
  }

  // Close course reset confirmation modal
  function closeCourseResetConfirmation() {
    const modal = modalElement.querySelector('#course-reset-confirmation-modal');
    modal.style.display = 'none';
    pendingResetCourseId = null;
  }

  // Confirm and execute course reset
  async function confirmCourseReset() {
    if (!pendingResetCourseId) return;

    const targetCourseId = pendingResetCourseId;
    const modal = modalElement.querySelector('#course-reset-confirmation-modal');
    const footer = modal.querySelector('.reset-confirmation-footer');

    // Disable buttons during operation
    footer.innerHTML = `
      <button class="rgm-btn-secondary" disabled>Resetting...</button>
    `;

    try {
      await window.StateManager.clearCoursePreferences(targetCourseId);

      // If we're resetting the current course, update UI
      if (targetCourseId === courseId) {
        selectedSectionIds = [];
        const toggleCheckbox = modalElement.querySelector('#rubric-grader-toggle-comments');
        toggleCheckbox.checked = true;
        commentsCollapsed = false;
        updateFilterCount();
        await loadSections();
        if (tabulatorTable) {
          tabulatorTable.redraw(true);
          applyModifiedClasses();
        }
      }

      // Refresh the settings modal
      await updateStorageInfo();
      await loadSavedCourses();

      // Close modal
      closeCourseResetConfirmation();

      // Update Clear All button state
      updateClearAllButton();

      // Show success message
      showSettingsMessage('success', '✅ Course preferences reset successfully');
    } catch (error) {
      // Show error and restore buttons
      footer.innerHTML = `
        <button class="rgm-btn-secondary" id="course-reset-cancel-retry">Cancel</button>
        <button class="rgm-btn-danger" id="course-reset-confirm-retry">Retry</button>
      `;
      footer.querySelector('#course-reset-cancel-retry').addEventListener('click', closeCourseResetConfirmation);
      footer.querySelector('#course-reset-confirm-retry').addEventListener('click', confirmCourseReset);

      showSettingsMessage('error', `❌ Failed to reset course: ${error.message}`);
    }
  }

  // Clear all preferences
  async function clearAllPreferences() {
    // Show confirmation modal instead of alert
    const modal = modalElement.querySelector('#clear-all-confirmation-modal');
    modal.style.display = 'block';
  }

  // Close clear all confirmation modal
  function closeClearAllConfirmation() {
    const modal = modalElement.querySelector('#clear-all-confirmation-modal');
    modal.style.display = 'none';
  }

  // Confirm and execute clear all
  async function confirmClearAll() {
    const modal = modalElement.querySelector('#clear-all-confirmation-modal');
    const footer = modal.querySelector('.reset-confirmation-footer');

    // Disable buttons during operation
    footer.innerHTML = `
      <button class="rgm-btn-secondary" disabled>Clearing...</button>
    `;

    try {
      await window.StateManager.clearAllPreferences();

      // Reset current course UI
      selectedSectionIds = [];
      const toggleCheckbox = modalElement.querySelector('#rubric-grader-toggle-comments');
      toggleCheckbox.checked = true;
      commentsCollapsed = false;
      updateFilterCount();
      await loadSections();
      if (tabulatorTable) {
        tabulatorTable.redraw(true);
        applyModifiedClasses();
      }

      // Refresh the settings modal
      await updateStorageInfo();
      await loadSavedCourses();

      // Close modal
      closeClearAllConfirmation();

      // Update Clear All button state
      updateClearAllButton();

      // Show success message
      showSettingsMessage('success', '✅ All preferences cleared successfully');
    } catch (error) {
      // Show error and restore buttons
      footer.innerHTML = `
        <button class="rgm-btn-secondary" id="clear-all-cancel-retry">Cancel</button>
        <button class="rgm-btn-danger" id="clear-all-confirm-retry">Retry</button>
      `;
      footer.querySelector('#clear-all-cancel-retry').addEventListener('click', closeClearAllConfirmation);
      footer.querySelector('#clear-all-confirm-retry').addEventListener('click', confirmClearAll);

      showSettingsMessage('error', `❌ Failed to clear preferences: ${error.message}`);
    }
  }

  // Export settings to JSON file
  async function exportSettings() {
    const messageEl = modalElement.querySelector('#settings-message');

    try {
      const exportData = await window.StateManager.exportSettings();

      // Create filename with domain and date
      const date = new Date().toISOString().split('T')[0];
      const filename = `canvas-rubric-grader-${exportData.domain}-${date}.json`;

      // Create blob and download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Show success message
      showSettingsMessage('success', `✅ Settings exported successfully! File: <strong>${filename}</strong> (${Object.keys(exportData.preferences).length} courses)`);
    } catch (error) {
      showSettingsMessage('error', `❌ Export failed: ${error.message}`);
      console.error('Export error:', error);
    }
  }

  // Show inline message in settings modal
  function showSettingsMessage(type, message) {
    const messageEl = modalElement.querySelector('#settings-message');
    messageEl.className = `settings-message settings-message-${type}`;
    messageEl.innerHTML = message;
    messageEl.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 5000);
  }

  // Store import data temporarily
  let pendingImportData = null;
  let pendingImportFile = null;

  // Import settings from JSON file
  async function importSettings(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // Validate import data
      if (!importData || !importData.version) {
        showSettingsMessage('error', '❌ Invalid import file format');
        e.target.value = '';
        return;
      }

      // Store data for confirmation
      pendingImportData = importData;
      pendingImportFile = file;

      // Show confirmation modal
      showImportConfirmation(file.name, importData);
    } catch (error) {
      showSettingsMessage('error', `❌ Failed to read file: ${error.message}`);
      console.error('Import error:', error);
      e.target.value = '';
    }
  }

  // Show import confirmation modal
  function showImportConfirmation(filename, importData) {
    const modal = modalElement.querySelector('#import-confirmation-modal');
    const fileNameEl = modal.querySelector('#import-file-name');
    const domainEl = modal.querySelector('#import-domain');
    const dateEl = modal.querySelector('#import-date');
    const prefsCountEl = modal.querySelector('#import-prefs-count');
    const autosavesCountEl = modal.querySelector('#import-autosaves-count');
    const resultEl = modal.querySelector('#import-result');
    const footer = modal.querySelector('.import-confirmation-footer');

    // Reset modal state
    resultEl.style.display = 'none';
    footer.innerHTML = `
      <button class="rgm-btn-secondary" id="import-cancel">Cancel</button>
      <button class="rgm-btn-primary" id="import-confirm">Import</button>
    `;
    footer.querySelector('#import-cancel').addEventListener('click', closeImportConfirmation);
    footer.querySelector('#import-confirm').addEventListener('click', confirmImport);

    // Populate modal with import data
    fileNameEl.textContent = filename;
    domainEl.textContent = importData.domain || 'Unknown';
    dateEl.textContent = importData.exportDate ? new Date(importData.exportDate).toLocaleString() : 'Unknown';
    prefsCountEl.textContent = Object.keys(importData.preferences || {}).length;
    autosavesCountEl.textContent = Object.keys(importData.autosaves || {}).length;

    // Show domain warning if different
    const currentDomain = window.StateManager.getDomain();
    if (importData.domain !== currentDomain) {
      const warningDiv = document.createElement('div');
      warningDiv.className = 'import-warning';
      warningDiv.innerHTML = `
        <strong>⚠️ Domain Mismatch</strong>
        <p>This export is from domain "<strong>${importData.domain}</strong>" but you're currently on "<strong>${currentDomain}</strong>". Importing may cause conflicts.</p>
      `;
      modal.querySelector('.import-confirmation-body').insertBefore(warningDiv, modal.querySelector('.import-summary'));
    }

    modal.style.display = 'block';
  }

  // Close import confirmation modal
  function closeImportConfirmation() {
    const modal = modalElement.querySelector('#import-confirmation-modal');
    const fileInput = modalElement.querySelector('#settings-import-file');
    const warningDiv = modal.querySelector('.import-warning');

    modal.style.display = 'none';
    fileInput.value = ''; // Reset file input
    pendingImportData = null;
    pendingImportFile = null;

    // Remove warning if exists
    if (warningDiv) {
      warningDiv.remove();
    }
  }

  // Confirm and perform import
  async function confirmImport() {
    if (!pendingImportData) return;

    const modal = modalElement.querySelector('#import-confirmation-modal');
    const resultEl = modal.querySelector('#import-result');
    const footer = modal.querySelector('.import-confirmation-footer');

    // Disable buttons during import
    footer.innerHTML = `
      <button class="rgm-btn-secondary" disabled>Importing...</button>
    `;

    try {
      const result = await window.StateManager.importSettings(pendingImportData);

      // Refresh the settings modal
      await updateStorageInfo();
      await loadSavedCourses();

      // Show success result
      resultEl.className = 'import-result import-result-success';
      resultEl.innerHTML = `
        <div class="import-result-icon">✅</div>
        <div class="import-result-text">
          <strong>Import successful!</strong>
          <p>Imported ${result.imported} items: ${result.preferences} course preferences and ${result.autosaves} autosaves</p>
        </div>
      `;
      resultEl.style.display = 'flex';

      // Update footer with close button
      footer.innerHTML = `
        <button class="rgm-btn-primary" id="import-done">Done</button>
      `;
      footer.querySelector('#import-done').addEventListener('click', closeImportConfirmation);

      // Also show message in settings modal
      showSettingsMessage('success', `✅ Import successful! Imported ${result.imported} items`);
    } catch (error) {
      // Show error result
      resultEl.className = 'import-result import-result-error';
      resultEl.innerHTML = `
        <div class="import-result-icon">❌</div>
        <div class="import-result-text">
          <strong>Import failed</strong>
          <p>${error.message}</p>
        </div>
      `;
      resultEl.style.display = 'flex';

      // Update footer with retry and close buttons
      footer.innerHTML = `
        <button class="rgm-btn-secondary" id="import-close">Close</button>
        <button class="rgm-btn-primary" id="import-retry">Retry</button>
      `;
      footer.querySelector('#import-close').addEventListener('click', closeImportConfirmation);
      footer.querySelector('#import-retry').addEventListener('click', () => {
        resultEl.style.display = 'none';
        confirmImport();
      });

      console.error('Import error:', error);
    }
  }

  async function open(cId, aId) {
    courseId = cId;
    assignmentId = aId;
    modifiedCells.clear();
    originalData = {};
    clearLastSavedChangesSnapshot();
    sectionsLoaded = false;
    autosaveLastPayloadJson = null;
    if (autosaveWriteTimer) {
      clearTimeout(autosaveWriteTimer);
      autosaveWriteTimer = null;
    }

    // LOAD SAVED STATE - Load preferences for this course
    const savedPrefs = await window.StateManager.loadCoursePreferences(courseId);
    selectedSectionIds = savedPrefs.selectedSectionIds || [];

    if (!modalElement) {
      modalElement = createModal();
      document.body.appendChild(modalElement);
    }

    updateSaveButton();

    // RESTORE TOGGLE STATE - Apply saved comment visibility preference
    const toggleCheckbox = modalElement.querySelector('#rubric-grader-toggle-comments');
    toggleCheckbox.checked = savedPrefs.commentsVisible;
    commentsCollapsed = !savedPrefs.commentsVisible;

    modalElement.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Show initial state - no data loaded yet
    const loading = modalElement.querySelector('.rubric-grader-loading');
    const tableContainer = modalElement.querySelector('#rubric-grader-table');
    const status = modalElement.querySelector('.rubric-grader-status');
    loading.style.display = 'block';
    loading.textContent = 'Select sections and click "Load Data" to begin...';
    tableContainer.innerHTML = '';

    // Update filter UI to reflect loaded state
    updateFilterCount();
    updateLoadButton();

    // Load sections for the filter
    await loadSections();

    // Update status
    status.textContent = `${availableSections.length} sections available`;

    // Best-effort cleanup of old autosaves
    if (window.StateManager?.cleanupOldAutosaves) {
      void window.StateManager.cleanupOldAutosaves();
    }
  }

  function close(force = false) {
    // Always show confirmation modal when closing (unless forced)
    if (!force) {
      showCloseConfirmation();
      return;
    }

    // Force close - close immediately
    if (modalElement) {
      // Close dropdown if open
      const dropdown = modalElement.querySelector('#section-dropdown');
      if (dropdown) dropdown.style.display = 'none';

      // Cleanup state and table
      cleanupModal();

      modalElement.classList.remove('visible');
      document.body.style.overflow = '';
    }
  }

  function cleanupModal() {
    hideBulkHeaderTooltip();
    if (bulkHeaderTooltipEl) {
      bulkHeaderTooltipEl.remove();
      bulkHeaderTooltipEl = null;
    }

    // Stop autosave timer
    if (autosaveWriteTimer) {
      clearTimeout(autosaveWriteTimer);
      autosaveWriteTimer = null;
    }

    // Tear down Tabulator
    if (tabulatorTable) {
      try {
        tabulatorTable.destroy();
      } catch (_e) {
        // ignore
      }
      tabulatorTable = null;
    }

    // Reset in-memory state
    modifiedCells.clear();
    originalData = {};
    tableData = null;
    expandedCells.clear();
    commentsCollapsed = false;
    autosaveBatchMode = false;
    activeAutosaveRecord = null;
    activeAutosaveSkippedChanges = null;
    clearLastSavedChangesSnapshot();

    // Reset UI bits if modal exists
    if (modalElement) {
      const tableContainer = modalElement.querySelector('#rubric-grader-table');
      if (tableContainer) tableContainer.innerHTML = '';
      const status = modalElement.querySelector('.rubric-grader-status');
      if (status) status.textContent = '';
      updateSaveButton();
    }
  }

  function storeOriginalData() {
    originalData = {};
    tableData.submissions.forEach(student => {
      originalData[student.userId] = JSON.parse(JSON.stringify(student.grades));
    });
  }

  async function refresh() {
    modifiedCells.clear();
    originalData = {};
    updateSaveButton();
    await handleLoadData();
  }

  function renderTable() {
    const columns = buildColumns();
    const data = buildTableData();
    if (tabulatorTable) tabulatorTable.destroy();
    tabulatorTable = new Tabulator('#rubric-grader-table', {
      data: data,
      columns: columns,
      layout: 'fitDataFill',
      height: '100%',
      frozenRows: 0,
      placeholder: 'No students found',
      cellEdited: handleCellEdit,
      renderVertical: 'basic'
    });

    // Add event listeners for criterion "view more" buttons
    setTimeout(() => {
      document.querySelectorAll('.criterion-view-more').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const criterionId = btn.dataset.criterionId;
          const criterion = tableData.criteria.find(c => c._id === criterionId);
          if (criterion) {
            showCriterionDetail(criterion);
          }
        });
      });
    }, 100);
  }

  function buildColumns() {
    const columns = [
      {
        title: 'Student',
        titleFormatter: studentHeaderFormatter,
        field: 'name',
        frozen: true,
        width: 200,
        minWidth: 100,
        headerFilter: false,
        formatter: studentNameFormatter
      }
    ];
    tableData.criteria.forEach(criterion => {
      columns.push({
        title: criterion.description,
        field: `criterion_${criterion._id}`,
        titleFormatter: criterionHeaderFormatter,
        titleFormatterParams: { criterion: criterion },
        width: 180,
        minWidth: 180,
        formatter: gradeFormatter,
        formatterParams: { maxPoints: criterion.points, criterionId: criterion._id },
        cellClick: handleGradeCellClick,
        headerVertical: false,
        sorter: function(a, b) {
          // Extract points from the cell data objects
          const aPoints = a && a.points !== null ? a.points : -1;
          const bPoints = b && b.points !== null ? b.points : -1;
          return aPoints - bPoints;
        }
      });
    });
    return columns;
  }

  function criterionHeaderFormatter(_cell, formatterParams) {
    const criterion = formatterParams.criterion;
    const description = criterion.description;
    const truncated = description.length > 120 ? description.substring(0, 120) + '...' : description;

    return `
      <div class="criterion-header">
        <div class="criterion-header-text">${truncated}</div>
        <button class="criterion-view-more" data-criterion-id="${criterion._id}" title="View details" aria-label="View details">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 6 15 12 9 18"></polyline>
          </svg>
        </button>
      </div>
    `;
  }

  function studentHeaderFormatter() {
    const buttonId = 'rgm-bulk-student-message-btn';

    setTimeout(() => {
      const btn = document.getElementById(buttonId);
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';

      const showTooltip = () => showBulkHeaderTooltip(btn);
      btn.addEventListener('mouseenter', showTooltip);
      btn.addEventListener('mouseleave', hideBulkHeaderTooltip);
      btn.addEventListener('focus', showTooltip);
      btn.addEventListener('blur', hideBulkHeaderTooltip);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideBulkHeaderTooltip();
        openBulkStudentMessageModal();
      });
    }, 0);

    return `
      <div class="criterion-header rgm-student-header-wrapper">
        <div class="criterion-header-text">Student</div>
        <button class="criterion-view-more rgm-bulk-student-header-btn" id="${buttonId}" type="button" data-tip="Message students by progress" aria-label="Message students by progress">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </button>
      </div>
    `;
  }

  function getBulkMessageStudents() {
    if (!tableData?.submissions) return [];

    return tableData.submissions.map((student) => {
      const totalScore = calculateStudentTotal(student.grades || {});
      const progressPercent = pointsPossible > 0 ? Math.floor((totalScore / pointsPossible) * 100) : 0;

      return {
        userId: student.userId,
        name: student.name || 'Unknown Student',
        sisId: student.sisId || '',
        progressPercent,
        assignmentName: tableData?.assignment?.name || '',
        assignmentGroup: tableData?.assignment?.assignmentGroup || '',
        dueDate: tableData?.assignment?.dueAt || tableData?.assignment?.dueDate || '',
        sectionName: student.sectionName || ''
      };
    });
  }

  function openBulkStudentMessageModal() {
    if (!window.BulkStudentMessageModal || typeof window.BulkStudentMessageModal.open !== 'function') {
      console.warn('[BulkStudentMessage] BulkStudentMessageModal not loaded');
      return;
    }

    const students = getBulkMessageStudents();
    if (students.length === 0) {
      alert('Load student data before sending bulk messages.');
      return;
    }

    window.BulkStudentMessageModal.open({
      courseId,
      assignmentId,
      students
    });
  }

  function studentNameFormatter(cell) {
    const row = cell.getRow();
    const data = row.getData();
    const name = data.name || 'Unknown Student';
    const sisId = data.sisId || '';

    // Calculate student's total score
    const student = tableData.submissions.find(s => s.userId === data.odId);
    const totalScore = student ? calculateStudentTotal(student.grades) : 0;
    const percentage = pointsPossible > 0 ? (totalScore / pointsPossible) * 100 : 0;
    const progressColor = getGradeColor(percentage);

    // Build progress bar HTML with percentage at the end
    const progressBar = `
      <div class="student-progress-container">
        <div class="student-progress-bar">
          <div class="student-progress-fill" style="width: ${percentage}%; background-color: ${progressColor};"></div>
        </div>
        <div class="student-score-text">${Math.floor(percentage)}%</div>
      </div>
    `;

    // per-student message/comment button (envelope icon)
    const btnId = `rgm-msg-btn-${data.odId}`;
    const actionButton = `
      <button
        class="rgm-student-action-btn"
        type="button"
        data-tip="Message/Comment"
        aria-label="Message/Comment"
        data-user-id="${data.odId}"
        id="${btnId}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
      </button>
    `;

    // per-student set all scores button
    const setScoresBtnId = `rgm-set-scores-btn-${data.odId}`;
    const setScoresButton = `
      <button
        class="rgm-student-action-btn rgm-set-scores-btn"
        type="button"
        data-tip="Set All Scores"
        aria-label="Set All Scores"
        data-user-id="${data.odId}"
        id="${setScoresBtnId}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"></path>
        </svg>
      </button>
    `;

    // Attach click handler for message button after Tabulator renders this cell
    setTimeout(() => {
      const btn = document.getElementById(btnId);
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!window.StudentMessageModal || typeof window.StudentMessageModal.open !== 'function') {
          console.warn('[StudentMessage] StudentMessageModal not loaded');
          return;
        }
        window.StudentMessageModal.open({
          courseId,
          assignmentId,
          student: {
            userId: data.odId,
            name,
            sisId
          }
        });
      });
    }, 0);

    // Attach click handler for set scores button
    setTimeout(() => {
      const btn = document.getElementById(setScoresBtnId);
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSetAllScoresModal(data.odId, name);
      });
    }, 0);

    // SpeedGrader link for student
    const speedGraderUrl = `/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${data.odId}`;
    const externalLinkIcon = `<svg class="student-name-external-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

    if (sisId) {
      return `
        <div class="student-name-cell">
          <div class="student-name-cell-actions">
            ${actionButton}
            ${setScoresButton}
          </div>
          <div class="student-name-cell-content">
            <a href="${speedGraderUrl}" target="_blank" class="student-name" title="Open in SpeedGrader">${name}${externalLinkIcon}</a>
            <div class="student-sis-id">${sisId}</div>
            ${progressBar}
          </div>
        </div>
      `;
    } else {
      return `
        <div class="student-name-cell">
          <div class="student-name-cell-actions">
            ${actionButton}
            ${setScoresButton}
          </div>
          <div class="student-name-cell-content">
            <a href="${speedGraderUrl}" target="_blank" class="student-name" title="Open in SpeedGrader">${name}${externalLinkIcon}</a>
            ${progressBar}
          </div>
        </div>
      `;
    }
  }

  /**
   * Calculate total score for a student
   * @param {object} grades - Student's grades object
   * @returns {number} - Total points earned
   */
  function calculateStudentTotal(grades) {
    let total = 0;
    Object.values(grades).forEach(grade => {
      if (grade.points !== null && grade.points !== undefined) {
        total += grade.points;
      }
    });
    return total;
  }

  function buildTableData() {
    return tableData.submissions.map(student => {
      const row = {
        id: student.userId,
        odId: student.userId,
        name: student.name,
        sisId: student.sisId || ''
      };
      tableData.criteria.forEach(criterion => {
        const grade = student.grades[criterion._id];
        row[`criterion_${criterion._id}`] = {
          points: grade.points,
          comments: grade.comments,
          maxPoints: criterion.points
        };
      });
      return row;
    });
  }

  function gradeFormatter(cell, formatterParams) {
    const row = cell.getRow();
    const rowData = row.getData();
    const field = cell.getField();
    // Read from rowData directly to get the latest value (cell.getValue() returns cached value)
    const data = rowData[field] || { points: null, comments: '' };
    const maxPoints = formatterParams.maxPoints;
    const pointsDisplay = data.points !== null ? data.points : '-';

    // Check if cell is modified by looking at modifiedCells Map
    const userId = rowData.odId;
    const criterionId = formatterParams.criterionId;
    const cellKey = `${userId}-${criterionId}`;
    const isModified = modifiedCells.has(cellKey);
    const modClass = isModified ? 'modified' : '';

    // Escape HTML in comments to prevent XSS
    const escapedComments = (data.comments || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Calculate color based on percentage score
    let gradeColor = '#666'; // Default gray for ungraded
    if (data.points !== null && maxPoints > 0) {
      const percentage = (data.points / maxPoints) * 100;
      gradeColor = getGradeColor(percentage);
    } else if (data.points === 0 && maxPoints > 0) {
      // Zero points should be red
      gradeColor = getGradeColor(0);
    }

    const gradeControls = `
      <div class="grade-controls">
        <button class="rgm-grade-btn rgm-minus-btn" data-action="minus">−</button>
        <span class="grade-value" style="background-color: ${gradeColor}; color: white;">${pointsDisplay}</span>
        <button class="rgm-grade-btn rgm-plus-btn" data-action="plus">+</button>
        <span class="grade-max">/${maxPoints}</span>
      </div>
    `;

    // Check if this specific cell is expanded
    const isExpanded = expandedCells.has(cellKey);

    if (commentsCollapsed && !isExpanded) {
      const hasComment = data.comments && data.comments.trim().length > 0;
      const commentPreview = hasComment ? escapedComments.substring(0, 30) + (escapedComments.length > 30 ? '...' : '') : '';
      return `
        <div class="grade-cell-content ${modClass}">
          ${gradeControls}
          <button class="rgm-expand-comment-btn" data-has-comment="${hasComment}" title="${commentPreview}">
            ${hasComment ? '💬 View Comment' : '💬 Add Comment'}
          </button>
        </div>
      `;
    } else {
      return `
        <div class="grade-cell-content ${modClass}">
          ${gradeControls}
          <div class="comment-wrapper">
            <textarea class="rgm-comment-input" rows="4" placeholder="Comment...">${escapedComments}</textarea>
            ${commentsCollapsed && isExpanded ? '<button class="rgm-collapse-comment-btn" title="Collapse">×</button>' : ''}
          </div>
        </div>
      `;
    }
  }

  function handleGradeCellClick(e, cell) {
    const target = e.target;

    // Handle expand comment button click
    if (target.classList.contains('rgm-expand-comment-btn')) {
      const row = cell.getRow();
      const field = cell.getField();
      const criterionId = field.replace('criterion_', '');
      const cellKey = `${row.getData().odId}-${criterionId}`;

      expandedCells.add(cellKey);
      cell.getElement().classList.add('cell-expanded');

      // Reformat just this row instead of redrawing entire table
      row.reformat();
      applyModifiedClasses(); // Reapply cell-modified classes after reformat

      // Focus the textarea after reformat
      setTimeout(() => {
        const cellElement = cell.getElement();
        if (cellElement && cellElement.querySelector) {
          const textarea = cellElement.querySelector('.rgm-comment-input');
          if (textarea) textarea.focus();
        }
      }, 50);
      return;
    }

    // Handle collapse comment button click
    if (target.classList.contains('rgm-collapse-comment-btn')) {
      const row = cell.getRow();
      const field = cell.getField();
      const criterionId = field.replace('criterion_', '');
      const cellKey = `${row.getData().odId}-${criterionId}`;

      expandedCells.delete(cellKey);
      cell.getElement().classList.remove('cell-expanded');

      // Reformat just this row instead of redrawing entire table
      row.reformat();
      applyModifiedClasses(); // Reapply cell-modified classes after reformat

      return;
    }

    if (target.classList.contains('rgm-grade-btn')) {
      const action = target.dataset.action;
      const field = cell.getField();
      const criterionId = field.replace('criterion_', '');
      const criterion = tableData.criteria.find(c => c._id === criterionId);
      const maxPoints = criterion ? criterion.points : 1;
      const row = cell.getRow();
      const rowData = row.getData();

      // Read from rowData directly to get the latest value (cell.getValue() returns cached value)
      const data = rowData[field] || { points: null, comments: '' };
      let newPoints = data.points !== null ? data.points : 0;
      if (action === 'plus') {
        newPoints = Math.min(newPoints + 1, maxPoints);
      } else {
        newPoints = Math.max(newPoints - 1, 0);
      }
      const newData = { ...data, points: newPoints };

      // Update modifiedCells BEFORE setValue so gradeFormatter sees the correct state
      const userId = rowData.odId;
      const key = `${userId}-${criterionId}`;
      const original = originalData[userId]?.[criterionId];
      const isChanged = !original ||
        newData.points !== original.points ||
        newData.comments !== original.comments;

      if (isChanged) {
        modifiedCells.set(key, { userId, criterionId, data: newData });
      } else {
        modifiedCells.delete(key);
      }

      // Update the underlying data without triggering cell re-render
      rowData[field] = newData;

      // Manually update just the grade display elements
      const cellElement = cell.getElement();
      const gradeValue = cellElement.querySelector('.grade-value');
      if (gradeValue) {
        gradeValue.textContent = newPoints;

        // Update color using the same getGradeColor function as gradeFormatter
        const percentage = (newPoints / maxPoints) * 100;
        const gradeColor = getGradeColor(percentage);
        gradeValue.style.backgroundColor = gradeColor;
      }

      // Update both outer cell-modified class and inner modified class
      const gradeCellContent = cellElement.querySelector('.grade-cell-content');
      if (isChanged) {
        cellElement.classList.add('cell-modified');
        if (gradeCellContent) gradeCellContent.classList.add('modified');
      } else {
        cellElement.classList.remove('cell-modified');
        if (gradeCellContent) gradeCellContent.classList.remove('modified');
      }

      updateSaveButton();
      scheduleAutosaveWrite();
    }
    if (target.classList.contains('rgm-comment-input')) {
      target.addEventListener('change', function handler() {
        // Update the underlying data without triggering cell re-render
        const row = cell.getRow();
        const field = cell.getField();
        const rowData = row.getData();

        // Read from rowData directly to get the latest value (cell.getValue() returns cached value)
        const data = rowData[field] || { points: null, comments: '' };
        const newData = { ...data, comments: target.value };

        rowData[field] = newData;

        // Manually update change tracking (like grade button handler)
        const userId = rowData.odId;
        const criterionId = field.replace('criterion_', '');
        const key = `${userId}-${criterionId}`;
        const original = originalData[userId]?.[criterionId];
        const isChanged = !original ||
          newData.points !== original.points ||
          newData.comments !== original.comments;

        // Update both outer cell-modified class and inner modified class
        const cellElement = cell.getElement();
        const gradeCellContent = cellElement.querySelector('.grade-cell-content');
        if (isChanged) {
          modifiedCells.set(key, { userId, criterionId, data: newData });
          cellElement.classList.add('cell-modified');
          if (gradeCellContent) gradeCellContent.classList.add('modified');
        } else {
          modifiedCells.delete(key);
          cellElement.classList.remove('cell-modified');
          if (gradeCellContent) gradeCellContent.classList.remove('modified');
        }

        updateSaveButton();
        scheduleAutosaveWrite();

        target.removeEventListener('change', handler);
      }, { once: true });

      // Handle textarea resize to adjust row height
      console.log('[Textarea Resize] Setting up ResizeObserver for textarea');
      let resizeTimeout;
      let resizeCount = 0;
      const resizeObserver = new ResizeObserver((entries) => {
        resizeCount++;
        const newHeight = entries[0].contentRect.height;
        console.log(`[Textarea Resize] Resize detected (count: ${resizeCount})`, {
          width: entries[0].contentRect.width,
          height: newHeight,
          target: target
        });

        // Skip if height is 0 (element being removed/hidden)
        if (newHeight === 0) {
          console.log('[Textarea Resize] Skipping - height is 0');
          return;
        }

        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          console.log('[Textarea Resize] Adjusting row height');
          try {
            const row = cell.getRow();
            const rowElement = row.getElement();

            // Get the tallest cell content in this row
            const cells = rowElement.querySelectorAll('.tabulator-cell');
            let maxHeight = 0;
            cells.forEach(cellEl => {
              const content = cellEl.querySelector('.grade-cell-content');
              if (content) {
                maxHeight = Math.max(maxHeight, content.offsetHeight);
              }
            });

            console.log('[Textarea Resize] Max content height:', maxHeight);

            // Set row height to accommodate the tallest content
            if (maxHeight > 0) {
              rowElement.style.height = (maxHeight + 20) + 'px'; // Add padding
              // Also update all cells in the row
              cells.forEach(cellEl => {
                cellEl.style.height = (maxHeight + 20) + 'px';
              });
              console.log('[Textarea Resize] Row height set to:', maxHeight + 20);
            }
          } catch (error) {
            console.error('[Textarea Resize] Error adjusting row height:', error);
          }
        }, 50);
      });
      resizeObserver.observe(target);
      console.log('[Textarea Resize] ResizeObserver attached successfully');

      // Clean up observer when cell is destroyed
      target.addEventListener('blur', () => {
        console.log('[Textarea Resize] Textarea blur - disconnecting ResizeObserver');
        resizeObserver.disconnect();
      }, { once: true });
    }
  }

  function handleCellEdit(cell) {
    markCellModified(cell);
  }

  function markCellModified(cell) {
    const row = cell.getRow();
    const rowData = row.getData();
    const userId = rowData.odId;
    const field = cell.getField();
    if (!field.startsWith('criterion_')) return;
    const criterionId = field.replace('criterion_', '');
    const key = `${userId}-${criterionId}`;
    // Read from rowData directly to get the latest value (cell.getValue() returns cached value)
    const currentData = rowData[field] || { points: null, comments: '' };
    const original = originalData[userId]?.[criterionId];
    const isChanged = !original ||
      currentData.points !== original.points ||
      currentData.comments !== original.comments;
    if (isChanged) {
      modifiedCells.set(key, { userId, criterionId, data: currentData });
      if (!autosaveBatchMode) cell.getElement().classList.add('cell-modified');
    } else {
      modifiedCells.delete(key);
      if (!autosaveBatchMode) cell.getElement().classList.remove('cell-modified');
    }
    if (!autosaveBatchMode) {
      updateSaveButton();
      scheduleAutosaveWrite();
    }
  }

  function applyModifiedClasses() {
    // First, remove cell-modified class from ALL criterion cells and inner modified class
    document.querySelectorAll('#rubric-grader-table .tabulator-cell').forEach(cellEl => {
      cellEl.classList.remove('cell-modified');
      const gradeCellContent = cellEl.querySelector('.grade-cell-content');
      if (gradeCellContent) gradeCellContent.classList.remove('modified');
    });

    // Then, add cell-modified class only to cells that are in the modifiedCells Map
    modifiedCells.forEach(({ userId, criterionId }) => {
      const row = tabulatorTable.getRow(userId);
      if (row) {
        const cell = row.getCell(`criterion_${criterionId}`);
        if (cell) {
          const cellEl = cell.getElement();
          cellEl.classList.add('cell-modified');
          const gradeCellContent = cellEl.querySelector('.grade-cell-content');
          if (gradeCellContent) gradeCellContent.classList.add('modified');
        }
      }
    });
  }

  function rebuildModifiedCellsFromTable() {
    if (!tabulatorTable || !tableData) return;

    modifiedCells.clear();

    tableData.submissions.forEach(student => {
      const userId = student.userId;
      const row = tabulatorTable.getRow(userId);
      if (!row) return;

      const rowData = row.getData();

      tableData.criteria.forEach(criterion => {
        const criterionId = criterion._id;
        const cellVal = rowData[`criterion_${criterionId}`] || { points: null, comments: '' };
        const original = originalData[userId]?.[criterionId] || { points: null, comments: '' };

        if (cellVal.points !== original.points || cellVal.comments !== original.comments) {
          const key = `${userId}-${criterionId}`;
          modifiedCells.set(key, { userId, criterionId, data: cellVal });
        }
      });
    });
  }

  function updateSaveButton() {
    const saveBtn = modalElement.querySelector('#rubric-grader-save');
    const count = modifiedCells.size;
    saveBtn.disabled = count === 0;
    saveBtn.textContent = count > 0 ? `Save Changes (${count})` : 'Save Changes';
  }

  function getCommentSuffix() {
    const suffixInput = modalElement.querySelector('#rubric-grader-comment-suffix');
    return suffixInput ? suffixInput.value.trim() : '';
  }

  /**
   * Append comment suffix to a comment
   * IMPORTANT: This is called during the save operation to append the suffix to comments
   * before sending to Canvas API. The suffix is NOT stored in the snapshot - the snapshot
   * stores the raw comment without suffix. When template variables render the
   * {{rubric_changes_summary}}, they will append the suffix again for display purposes.
   *
   * @param {string} comment - The original comment text
   * @param {string} suffix - The suffix to append
   * @returns {string} - Comment with suffix appended on a new line
   */
  function appendSuffixToComment(comment, suffix) {
    if (!suffix) return comment;
    if (!comment || comment.trim() === '') return suffix;
    return comment + '\n' + suffix;
  }

  async function saveChanges() {
    showSaveConfirmation();
  }

  async function performSave() {
    const saveBtn = modalElement.querySelector('#rubric-grader-save');
    const status = modalElement.querySelector('.rubric-grader-status');
    const confirmModal = modalElement.querySelector('#save-confirmation-modal');
    const progressFill = confirmModal.querySelector('.save-progress-fill');
    const progressText = confirmModal.querySelector('.save-progress-text');
    const overallResult = confirmModal.querySelector('.save-overall-result');
    const footer = confirmModal.querySelector('.save-confirmation-footer');

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // Get the comment suffix to append to modified comments
    const commentSuffix = getCommentSuffix();

    // Get unique student IDs that have modifications
    const modifiedStudentIds = new Set();
    modifiedCells.forEach(({ userId }) => {
      modifiedStudentIds.add(userId);
    });

    // For each modified student, collect ALL their criteria grades
    const studentGrades = {};
    modifiedStudentIds.forEach(userId => {
      studentGrades[userId] = {};

      // Get all criteria grades for this student from the table
      tableData.criteria.forEach(criterion => {
        const row = tabulatorTable.getRow(userId);
        if (row) {
          const cellData = row.getData()[`criterion_${criterion._id}`];
          let finalComments = cellData.comments || '';

          // IMPORTANT: Append suffix only if this cell's comment was actually modified
          // This ensures the suffix is only added to comments that changed, not all comments.
          // The suffix is appended here before sending to Canvas API.
          const cellKey = `${userId}-${criterion._id}`;
          if (modifiedCells.has(cellKey) && commentSuffix) {
            const original = originalData[userId]?.[criterion._id];
            if ((original?.comments || '') !== (cellData.comments || '')) {
              finalComments = appendSuffixToComment(cellData.comments || '', commentSuffix);
            }
          }

          studentGrades[userId][criterion._id] = {
            points: cellData.points !== null ? cellData.points : 0,
            comments: finalComments
          };
        }
      });
    });

    console.log('Modified students:', Array.from(modifiedStudentIds));
    console.log('Complete grades to save:', studentGrades);

    const api = new CanvasRestAPI(courseId);
    const gradesArray = Object.entries(studentGrades).map(([userId, grades]) => ({ userId, grades }));

    console.log('Grades array for batch save:', gradesArray);

    // Update student status in modal
    function updateStudentStatus(userId, statusType, errorMsg = null) {
      const studentGroup = confirmModal.querySelector(`.save-student-group[data-user-id="${userId}"]`);
      if (!studentGroup) return;

      const statusIcon = studentGroup.querySelector('.save-student-status-icon');
      const statusText = studentGroup.querySelector('.save-student-status');
      const header = studentGroup.querySelector('.save-student-header');

      // Remove previous status classes
      studentGroup.classList.remove('saving', 'success', 'error');
      studentGroup.classList.add(statusType);

      if (statusType === 'saving') {
        statusIcon.textContent = '⏳';
        statusText.textContent = 'Saving...';
        statusText.className = 'save-student-status saving';
      } else if (statusType === 'success') {
        statusIcon.textContent = '✅';
        statusText.textContent = 'Saved';
        statusText.className = 'save-student-status success';

        // Add SpeedGrader link
        const speedGraderUrl = `/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${userId}`;
        if (!header.querySelector('.save-speedgrader-link')) {
          const linkBtn = document.createElement('a');
          linkBtn.href = speedGraderUrl;
          linkBtn.target = '_blank';
          linkBtn.className = 'save-speedgrader-link';
          linkBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            SpeedGrader
          `;
          header.appendChild(linkBtn);
        }
      } else if (statusType === 'error') {
        statusIcon.textContent = '❌';
        statusText.textContent = errorMsg ? `Error: ${errorMsg}` : 'Failed';
        statusText.className = 'save-student-status error';
      }
    }

    try {
      const results = await api.batchSaveAssessments(assignmentId, gradesArray, (current, total, userId, statusType, errorMsg) => {
        // Update progress bar
        const percentage = (current / total) * 100;
        progressFill.style.width = `${percentage}%`;
        progressText.textContent = `Saving ${current}/${total}...`;

        // Update individual student status
        updateStudentStatus(userId, statusType, errorMsg);

        // Update main status bar
        status.textContent = `Saving ${current}/${total}...`;
      });

      // Show overall result
      const successCount = results.success.length;
      const failedCount = results.failed.length;

      if (failedCount > 0) {
        status.textContent = `Saved with ${failedCount} errors`;
        overallResult.innerHTML = `
          <div class="save-result-error">
            <span class="save-result-icon">⚠️</span>
            <div class="save-result-text">
              <strong>${successCount} saved successfully, ${failedCount} failed</strong>
              <p>Some assessments could not be saved. Check the errors above and try again.</p>
            </div>
          </div>
        `;
        overallResult.style.display = 'block';
        console.error('Failed saves:', results.failed);
        // Ensure autosave reflects remaining unsaved changes
        scheduleAutosaveWrite({ immediate: true });
      } else {
        status.textContent = `Successfully saved ${successCount} assessments`;
        overallResult.innerHTML = `
          <div class="save-result-success">
            <span class="save-result-icon">🎉</span>
            <div class="save-result-text">
              <strong>All ${successCount} assessments saved successfully!</strong>
              <p>Click the SpeedGrader links above to review individual submissions.</p>
            </div>
          </div>
        `;
        overallResult.style.display = 'block';

        // Keep an in-memory snapshot of what was saved so the messaging template
        // variable `{{rubric_changes_summary}}` can still display the last saved
        // changes even after we clear `modifiedCells`.
        captureLastSavedChangesSnapshot();

        // Update original data and clear modified cells
        gradesArray.forEach(({ userId, grades }) => {
          Object.entries(grades).forEach(([criterionId, data]) => {
            if (!originalData[userId]) originalData[userId] = {};
            originalData[userId][criterionId] = { ...data };
          });
        });
        modifiedCells.clear();
        document.querySelectorAll('.cell-modified').forEach(el => el.classList.remove('cell-modified'));

        // Clear autosave on full success
        try {
          await window.StateManager.clearAutosave(courseId, assignmentId);
          autosaveLastPayloadJson = null;
        } catch (err) {
          console.warn('[Autosave] Failed to clear autosave after save', err);
        }
      }

      // Update footer with close button
      footer.innerHTML = `
        <button class="rgm-btn-primary" id="save-confirmation-done">Done</button>
      `;
      footer.querySelector('#save-confirmation-done').addEventListener('click', closeSaveConfirmation);

    } catch (error) {
      status.textContent = `Error: ${error.message}`;
      overallResult.innerHTML = `
        <div class="save-result-error">
          <span class="save-result-icon">❌</span>
          <div class="save-result-text">
            <strong>Save failed</strong>
            <p>${error.message}</p>
          </div>
        </div>
      `;
      overallResult.style.display = 'block';

      // Update footer with retry and close buttons
      footer.innerHTML = `
        <button class="rgm-btn-secondary" id="save-confirmation-close">Close</button>
        <button class="rgm-btn-primary" id="save-confirmation-retry">Retry</button>
      `;
      footer.querySelector('#save-confirmation-close').addEventListener('click', closeSaveConfirmation);
      footer.querySelector('#save-confirmation-retry').addEventListener('click', confirmAndSave);

      console.error('Save failed:', error);
    }
    updateSaveButton();
  }

  function getModifiedChangesForStudent(userId) {
    const changes = [];

    // Prefer the Tabulator row data (it contains the most up-to-date values)
    // but fall back to modifiedCells if needed.
    const row = tabulatorTable?.getRow?.(userId);
    const rowData = row?.getData?.();

    if (rowData && tableData?.criteria) {
      tableData.criteria.forEach(criterion => {
        const cellKey = `${userId}-${criterion._id}`;
        if (!modifiedCells.has(cellKey)) return;

        const cellVal = rowData[`criterion_${criterion._id}`] || { points: null, comments: '' };

        changes.push({
          criterionId: criterion._id,
          criterionName: criterion?.description || 'Unknown Criterion',
          points: cellVal?.points ?? null,
          maxPoints: criterion?.points ?? null,
          comment: cellVal?.comments ?? ''
        });
      });
    } else {
      // Fallback: use stored modifiedCells data
      modifiedCells.forEach(({ userId: cellUserId, criterionId, data }) => {
        if (String(cellUserId) !== String(userId)) return;

        const criterion = tableData?.criteria?.find(c => String(c._id) === String(criterionId));
        const criterionName = criterion?.description || 'Unknown Criterion';

        changes.push({
          criterionId,
          criterionName,
          points: data?.points ?? null,
          maxPoints: criterion?.points ?? null,
          comment: data?.comments ?? ''
        });
      });
    }

    // Stable ordering by criterion name
    changes.sort((a, b) => String(a.criterionName).localeCompare(String(b.criterionName)));

    if (changes.length > 0) return changes;

    const snapshot = lastSavedChangesByStudent.get(String(userId));
    if (!snapshot || snapshot.length === 0) return [];

    // Return a defensive copy.
    return snapshot.map(change => ({ ...change }));
  }

  function getCourseInfo() {
    return courseInfo ? { ...courseInfo } : null;
  }

  return { open, close, getModifiedChangesForStudent, getCourseInfo };
})();

window.RubricGraderModal = RubricGraderModal;
