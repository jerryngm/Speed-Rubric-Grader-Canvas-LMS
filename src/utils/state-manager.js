// State Manager for Canvas Rubric Grader
const StateManager = {
  // Extract domain name from hostname (e.g., "canvas" from "canvas.instructure.com")
  getDomain() {
    const hostname = window.location.hostname;
    const match = hostname.match(/^([^.]+)\.instructure\.com/);
    return match ? match[1] : hostname.split('.')[0];
  },

  // Load preferences for a course
  async loadCoursePreferences(courseId) {
    try {
      // Check if chrome.storage is available
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return this.getDefaultPreferences(courseId);
      }

      const domain = this.getDomain();
      const key = `rgm_prefs_${domain}_${courseId}`;
      const result = await chrome.storage.local.get(key);
      return result[key] || this.getDefaultPreferences(courseId);
    } catch (error) {
      console.error('Error loading preferences:', error);
      return this.getDefaultPreferences(courseId);
    }
  },

  // Get default preferences structure
  getDefaultPreferences(courseId) {
    return {
      domain: this.getDomain(),
      courseId: courseId,
      courseName: null,
      courseCode: null,
      courseNickname: null,
      selectedSectionIds: [],
      commentsVisible: true,
      commentSuffix: '',
      lastUpdated: null
    };
  },

  // Save preferences for a course
  async saveCoursePreferences(courseId, preferences, courseName = null, courseCode = null, courseNickname = null) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const domain = this.getDomain();
      const key = `rgm_prefs_${domain}_${courseId}`;
      const data = {
        domain: domain,
        courseId: courseId,
        courseName: courseName,
        courseCode: courseCode,
        courseNickname: courseNickname,
        ...preferences,
        lastUpdated: Date.now()
      };
      await chrome.storage.local.set({ [key]: data });
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  },

  // Clear preferences for a specific course
  async clearCoursePreferences(courseId) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const domain = this.getDomain();
      const key = `rgm_prefs_${domain}_${courseId}`;
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.error('Error clearing preferences:', error);
    }
  },

  // Get all saved course preferences for current domain
  async getAllCoursePreferences() {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return [];
      }

      const domain = this.getDomain();
      const allData = await chrome.storage.local.get(null);
      const prefix = `rgm_prefs_${domain}_`;

      const courses = [];
      for (const [key, value] of Object.entries(allData)) {
        if (key.startsWith(prefix)) {
          courses.push(value);
        }
      }
      return courses.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    } catch (error) {
      console.error('Error getting all preferences:', error);
      return [];
    }
  },

  // Clear all preferences for current domain
  async clearAllPreferences() {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const domain = this.getDomain();
      const allData = await chrome.storage.local.get(null);
      const keysToRemove = [];

      for (const key of Object.keys(allData)) {
        if (key.startsWith(`rgm_prefs_${domain}_`) || key.startsWith(`rgm_autosave_${domain}_`)) {
          keysToRemove.push(key);
        }
      }

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.error('Error clearing all preferences:', error);
      throw error;
    }
  },

  // Get storage usage information
  async getStorageInfo() {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return {
          bytesUsed: 0,
          bytesLimit: 5242880,
          percentUsed: 0,
          mbUsed: '0.00',
          mbLimit: '5.00'
        };
      }

      const bytesInUse = await chrome.storage.local.getBytesInUse();
      const limit = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB default
      return {
        bytesUsed: bytesInUse,
        bytesLimit: limit,
        percentUsed: (bytesInUse / limit) * 100,
        mbUsed: (bytesInUse / 1024 / 1024).toFixed(2),
        mbLimit: (limit / 1024 / 1024).toFixed(2)
      };
    } catch (error) {
      console.error('Error getting storage info:', error);
      return {
        bytesUsed: 0,
        bytesLimit: 5242880,
        percentUsed: 0,
        mbUsed: '0.00',
        mbLimit: '5.00'
      };
    }
  },

  async loadBulkMessageFilter(courseId, assignmentId) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return null;
      }

      const domain = this.getDomain();
      const key = `rgm_bulk_msg_filter_${domain}_${courseId}_${assignmentId}`;
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    } catch (error) {
      console.error('Error loading bulk message filter:', error);
      return null;
    }
  },

  async saveBulkMessageFilter(courseId, assignmentId, data) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const domain = this.getDomain();
      const key = `rgm_bulk_msg_filter_${domain}_${courseId}_${assignmentId}`;
      await chrome.storage.local.set({
        [key]: {
          domain,
          courseId,
          assignmentId,
          operator: String(data?.operator || '>='),
          threshold: Number.isFinite(Number(data?.threshold)) ? Number(data.threshold) : 0,
          lastUpdated: Date.now()
        }
      });
    } catch (error) {
      console.error('Error saving bulk message filter:', error);
    }
  },

  // Future: Load autosave data
  async loadAutosave(courseId, assignmentId) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return null;
      }

      const domain = this.getDomain();
      const key = `rgm_autosave_${domain}_${courseId}_${assignmentId}`;
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    } catch (error) {
      console.error('Error loading autosave:', error);
      return null;
    }
  },

  // Future: Save autosave data
  async saveAutosave(courseId, assignmentId, data) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const domain = this.getDomain();
      const key = `rgm_autosave_${domain}_${courseId}_${assignmentId}`;
      await chrome.storage.local.set({
        [key]: {
          domain: domain,
          courseId: courseId,
          assignmentId: assignmentId,
          ...data,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('Error saving autosave:', error);
    }
  },

  // Future: Clear autosave data
  async clearAutosave(courseId, assignmentId) {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const domain = this.getDomain();
      const key = `rgm_autosave_${domain}_${courseId}_${assignmentId}`;
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.error('Error clearing autosave:', error);
    }
  },

  // Cleanup old autosave data (older than 7 days)
  async cleanupOldAutosaves() {
    try {
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage API not available');
        return;
      }

      const allKeys = await chrome.storage.local.get(null);
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const domain = this.getDomain();

      const keysToRemove = [];
      for (const [key, value] of Object.entries(allKeys)) {
        if (key.startsWith(`rgm_autosave_${domain}_`) && value?.timestamp && value.timestamp < sevenDaysAgo) {
          keysToRemove.push(key);
        }
      }

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.error('Error cleaning up autosaves:', error);
    }
  },

  // Export all preferences and settings to JSON
  async exportSettings() {
    const domain = this.getDomain();
    const allData = await chrome.storage.local.get(null);

    // Filter only data for current domain
    const exportData = {
      domain: domain,
      exportDate: new Date().toISOString(),
      version: '1.0',
      preferences: {},
      autosaves: {}
    };

    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith(`rgm_prefs_${domain}_`)) {
        exportData.preferences[key] = value;
      } else if (key.startsWith(`rgm_autosave_${domain}_`)) {
        exportData.autosaves[key] = value;
      }
    }

    return exportData;
  },

  // Import preferences and settings from JSON
  async importSettings(importData) {
    if (!importData || !importData.version) {
      throw new Error('Invalid import data format');
    }

    const domain = this.getDomain();

    // Validate that import is for the same domain
    if (importData.domain !== domain) {
      const confirmed = confirm(
        `This export is from domain "${importData.domain}" but you're currently on "${domain}".\n\n` +
        `Importing may cause conflicts. Continue anyway?`
      );
      if (!confirmed) {
        throw new Error('Import cancelled by user');
      }
    }

    // Import preferences
    const dataToImport = {};
    let importCount = 0;

    for (const [key, value] of Object.entries(importData.preferences || {})) {
      dataToImport[key] = value;
      importCount++;
    }

    for (const [key, value] of Object.entries(importData.autosaves || {})) {
      dataToImport[key] = value;
      importCount++;
    }

    if (importCount > 0) {
      await chrome.storage.local.set(dataToImport);
    }

    return {
      imported: importCount,
      preferences: Object.keys(importData.preferences || {}).length,
      autosaves: Object.keys(importData.autosaves || {}).length
    };
  }
};

window.StateManager = StateManager;
