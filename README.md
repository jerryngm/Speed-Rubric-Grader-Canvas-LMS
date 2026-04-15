# Canvas Rubric Grader - Chrome Extension

A Chrome extension for Canvas LMS that streamlines rubric grading by allowing instructors to grade multiple students at once in a modern, spreadsheet-like interface.

> **For Developers/AI Agents**: See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for comprehensive technical documentation, architecture details, and development guidelines.

---

## Features

### 🎯 Core Functionality
- **Bulk Grading**: Grade multiple students simultaneously in a single table view
- **Section Filtering**: Filter students by course sections with multi-select
- **Student Search**: Real-time search by name or SIS ID
- **Change Tracking**: Visual highlighting of modified cells with unsaved changes warning
- **Batch Save**: Save all changes at once with detailed progress indicator
- **Auto-save**: Saves unsaved table changes per course/assignment with a restore prompt and change preview

### 💾 State Management
- **Persistent Preferences**: Saves section selections and comment visibility per course
- **Export/Import**: Backup and restore all settings across Canvas instances
- **Storage Management**: View storage usage and manage saved courses
- **Domain-Aware**: Supports multiple Canvas instances (e.g., canvas.instructure.com, test.instructure.com)

### 📊 Table Interface
- **Students as Rows**: Each row represents one student with their SIS ID
- **Criteria as Columns**: Each column represents a rubric criterion
- **Frozen Student Column**: Student names stay visible when scrolling horizontally
- **Color-Coded Grades**: Visual feedback with red-to-green gradient based on score percentage

### ✏️ Grading Controls
- **+/- Buttons**: Quick increment/decrement of points
- **Direct Input**: Type points directly with validation
- **Comments**: Add/edit comments for each criterion per student
- **Point Validation**: Enforces min (0) and max (criterion points) limits
- **Comment Toggle**: Show/hide all comments with one click
- **Individual Expand**: Expand specific comments while others stay collapsed

### 📋 Criterion Details
- **Multi-line Headers**: Shows up to 3 lines of criterion description
- **View More Button**: Click info icon to see full criterion details
- **Detail Modal**: Shows complete description, long description, and max points

### ⚙️ Settings & Management
- **Modern Settings Modal**: Clean, organized interface for managing preferences
- **Course List**: View all saved courses with metadata (sections, comments state, last updated)
- **Individual Reset**: Reset preferences for specific courses
- **Clear All**: Remove all saved data with confirmation
- **Storage Usage**: Visual progress bar showing storage consumption
- **Inline Messages**: Non-intrusive success/error notifications

### 🎨 Modern UI/UX
- **Confirmation Modals**: No more obstructive alerts - all actions use modern modals
- **Loading States**: Visual feedback during operations
- **Error Handling**: Graceful error recovery with retry options
- **SVG Icons**: Clean, scalable icons throughout the interface
- **Smooth Animations**: Polished transitions and hover effects
- **Responsive Design**: Works on desktop, tablet, and touch devices

---

## Installation

### From Source
1. Clone or download this repository
2. Add icon images to the `icons/` folder (16x16, 48x48, 128x128 PNG)
3. Open Chrome → `chrome://extensions/`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked" → select the project folder
6. Navigate to a Canvas assignment with a rubric
7. Look for the "Open Bulk Grader" button

### Requirements
- Chrome or Edge browser (Manifest V3 compatible)
- Canvas LMS access (instructure.com domains)
- Valid Canvas session (must be logged in)

---

## Usage

### Basic Workflow
1. **Navigate** to a Canvas assignment with a rubric
2. **Click** the "Open Bulk Grader" button that appears on the page
3. **Select** sections to filter (optional)
4. **Click** "Load Data" to fetch student submissions
5. **Grade** students by entering points and comments
6. **Save** changes when done - a confirmation modal shows all changes
7. **Close** the modal when finished

### Section Filtering
- Click the section filter button to open the dropdown
- Select/deselect sections to filter students
- Use "Select All" to quickly select all sections
- Filter count shows how many sections are selected
- Preferences are automatically saved per course

### Comment Management
- Toggle all comments with the "Toggle Comments" button
- Expand individual comments by clicking on them
- Comments longer than 150 characters are truncated with "Show more" button
- Comment visibility preference is saved per course

### Settings & Backup
- Click the ⚙️ settings button in the modal header
- View all saved courses with their preferences
- Export settings to JSON file for backup
- Import settings from JSON file to restore
- Reset individual courses or clear all data
- Storage usage bar shows how much space is used

---

## Project Structure

```
Canvas Rubric Project/
├── manifest.json                    # Extension manifest (MV3)
├── icons/                           # Extension icons (16, 48, 128px)
├── README.md                        # This file (user guide)
├── PROJECT_CONTEXT.md              # Technical documentation for developers
└── src/
    ├── lib/
    │   ├── tabulator.min.js        # Tabulator library v6.3.0
    │   └── tabulator.min.css       # Tabulator styles
    ├── api/
    │   └── canvas-graphql.js       # GraphQL API client for Canvas
    ├── content/
    │   ├── content.js              # Content script (button injection)
    │   └── content.css             # Button styles
    ├── modal/
    │   ├── modal.js                # Main modal UI and logic (1300+ lines)
    │   └── modal.css               # Modal styling (2400+ lines)
    └── utils/
        └── state-manager.js        # Storage and state management
```

---

## Technical Overview

### Technology Stack
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Data Table**: Tabulator.js v6.3.0
- **API**: Canvas GraphQL API
- **Storage**: Chrome Storage API (chrome.storage.local)
- **Extension**: Chrome Extension Manifest V3

### Canvas API Integration
- **GraphQL**: Fetches rubric structure, student submissions, and course data
- **Mutations**: Saves rubric assessments with points and comments
- **Authentication**: Uses existing Canvas session cookies
- **Error Handling**: Comprehensive error handling with user-friendly messages

### Data Flow
1. User clicks "Open Bulk Grader" button on Canvas page
2. Extension loads saved preferences from chrome.storage
3. Extension fetches course sections (captures course metadata)
4. User selects sections and clicks "Load Data"
5. GraphQL query fetches rubric data and submissions
6. Tabulator renders interactive table with data
7. User modifies grades/comments (tracked in memory)
8. Save button shows confirmation modal with all changes
9. Changes sent to Canvas API sequentially with progress bar
10. Success/failure feedback displayed
11. Preferences automatically saved

### Storage
- **Limit**: 5MB (chrome.storage.local quota)
- **Keys**: Domain-aware (e.g., `rgm_prefs_canvas_12345`)
- **Data**: Course preferences, autosaves (coming soon)
- **Export**: JSON format for backup/restore

---

## Browser Compatibility

- ✅ Chrome 88+ (Manifest V3)
- ✅ Edge 88+ (Chromium-based)
- ✅ Tested on Canvas LMS (instructure.com domains)
- ❌ Firefox (requires Manifest V2 port)
- ❌ Safari (requires Safari extension port)

---

## Use Cases

### 📚 Bulk Grading Workflow
- Grade all students for one criterion at a time
- Compare student performance across criteria
- Ensure grading consistency
- Add comments efficiently

### 🔍 Student Progress Tracking
- Search for specific student by name or ID
- View all their grades in one row
- Identify struggling areas quickly
- Perfect for parent-teacher conferences

### 📊 Section-Based Grading
- Filter by specific sections (e.g., morning vs afternoon class)
- Grade one section at a time
- Compare performance across sections
- Preferences saved per course

### 💾 Multi-Instance Management
- Work across multiple Canvas instances (production, test, etc.)
- Export settings from one instance
- Import to another instance
- Domain-aware storage keeps data separate

---

## Recent Updates (v1.3 - 2026-01-29)

### UX Improvements
- ✨ Replaced all alert() dialogs with modern confirmation modals
- ✨ Export now shows inline success message instead of alert
- ✨ Import uses detailed confirmation modal with file info
- ✨ Clear All and Course Reset use warning modals
- ✨ All modals have loading states and error recovery

### UI Enhancements
- 🎨 Redesigned course items to be slimmer and more modern
- 🎨 Replaced emojis with clean SVG icons
- 🎨 Improved spacing and typography
- 🎨 Added smooth hover effects and transitions
- 🎨 Better visual hierarchy in settings modal

### Technical Improvements
- 🔧 Course info now captured when sections load (earlier in workflow)
- 🔧 Comprehensive error handling for chrome.storage API
- 🔧 Clear All button disabled when storage is empty
- 🔧 Graceful fallbacks when extension context is lost
- 🔧 Better state management and persistence

---

## Troubleshooting

### Extension not appearing
- Ensure you're on a Canvas assignment page with a rubric
- Check that the extension is enabled in chrome://extensions/
- Refresh the Canvas page after installing

### "Cannot read properties of undefined" error
- This happens when extension context is lost
- Reload the extension in chrome://extensions/
- Refresh the Canvas page
- Error handling now prevents crashes

### Data not loading
- Check your Canvas session (make sure you're logged in)
- Check browser console for API errors
- Verify the assignment has a rubric
- Try refreshing the page

### Settings not saving
- Check chrome.storage permissions in manifest.json
- Check storage quota (5MB limit)
- Export settings as backup if near limit
- Clear old autosaves to free space (autosaves auto-clean after 7 days)

### Clear All button not working
- Button is disabled when storage is empty (by design)
- Grade an assignment first to create preferences
- Check that you have saved courses in the list

---

## Future Enhancements

### Planned Features
- ⌨️ Keyboard shortcuts for faster grading
- 📊 Grade distribution analytics
- 📝 Bulk comment templates
- 📤 Export to CSV
- 🔍 Advanced filtering options
- 📱 Mobile app version
- 👥 Collaboration features (multiple graders)

### Technical Improvements
- TypeScript migration for better type safety
- Unit tests with Jest
- E2E tests with Playwright
- Build system (webpack/vite)
- Service worker optimization
- IndexedDB for larger storage capacity

---

## Development

### For Developers
See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for:
- Detailed architecture documentation
- Component descriptions and interactions
- Storage schema and data flow
- API reference and examples
- Development guidelines
- Testing checklist
- Troubleshooting guide

### Contributing
1. Read PROJECT_CONTEXT.md for technical details
2. Follow existing code patterns and conventions
3. Add error handling for all storage operations
4. Use modals instead of alerts/confirms
5. Test with empty storage and full storage
6. Update documentation for significant changes

---

## License

MIT License - See LICENSE file for details

---

## Support

For issues, questions, or feature requests:
1. Check this README and PROJECT_CONTEXT.md
2. Review code comments in source files
3. Test in Chrome DevTools console
4. Open an issue on GitHub (if applicable)

---

## Credits

- **Tabulator.js**: Oleg Kiriljuk (http://tabulator.info)
- **Canvas LMS**: Instructure, Inc.
- **Icons**: Custom SVG icons

---

**Last Updated**: 2026-01-29
**Version**: 1.3
**Manifest**: V3
