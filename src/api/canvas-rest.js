/**
 * Canvas REST API Service
 * Handles saving rubric assessments via REST API
 */

class CanvasRestAPI {
  constructor(courseId) {
    this.courseId = courseId;
    this.baseUrl = `/api/v1/courses/${courseId}`;
  }

  /**
   * Save rubric assessment for a submission
   * @param {string} assignmentId - Assignment ID
   * @param {string} userId - User ID
   * @param {object} rubricAssessment - Rubric assessment data
   * @returns {Promise<object>} - API response
   */
  async saveRubricAssessment(assignmentId, userId, rubricAssessment) {
    const url = `${this.baseUrl}/assignments/${assignmentId}/submissions/${userId}`;

    // Get CSRF token
    const csrfToken = CanvasRestAPI.getCsrfToken();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const body = {
      rubric_assessment: rubricAssessment
    };

    console.log('Saving rubric assessment:', {
      url,
      userId,
      assignmentId,
      hasCsrfToken: !!csrfToken,
      body: JSON.stringify(body, null, 2)
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Save failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        url,
        userId
      });
      throw new Error(`Failed to save assessment for user ${userId}: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Save successful:', result);
    return result;
  }

  /**
   * Get CSRF token from Canvas page
   */
  static getCsrfToken() {
    // Try meta tag first
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      return metaTag.getAttribute('content');
    }

    // Try cookie as fallback
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === '_csrf_token') {
        return decodeURIComponent(value);
      }
    }

    return null;
  }

  // Backwards/alternate casing used by messaging modules
  static getCSRFToken() {
    return CanvasRestAPI.getCsrfToken();
  }

  /**
   * Send an Inbox conversation message
   * Reference: [`Other Project - For Ref/missing-tab.js:2193`](Other Project - For Ref/missing-tab.js:2193)
   */
  async sendConversation(recipientIds, subject, body, attachmentIds = [], contextCode = null) {
    // Canvas expects form-encoded params for conversations (matches reference implementation).
    // Reference: [`Other Project - For Ref/missing-tab.js:2193`](Other Project - For Ref/missing-tab.js:2193)
    const url = '/api/v1/conversations';
    const csrfToken = CanvasRestAPI.getCsrfToken();

    const headers = {
      'Accept': 'application/json'
    };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const form = new FormData();
    (recipientIds || []).forEach(id => form.append('recipients[]', String(id)));
    form.append('subject', String(subject || ''));
    form.append('body', String(body || ''));

    if (contextCode) form.append('context_code', String(contextCode));
    (attachmentIds || []).forEach(id => form.append('attachment_ids[]', String(id)));

    const response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send conversation: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Add a submission comment
   * Reference: [`Other Project - For Ref/missing-tab.js:2983`](Other Project - For Ref/missing-tab.js:2983)
   */
  async addCommentToSubmission(assignmentId, userId, commentText, fileIds = []) {
    const url = `${this.baseUrl}/assignments/${assignmentId}/submissions/${userId}`;
    const csrfToken = CanvasRestAPI.getCsrfToken();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const body = {
      comment: {
        text_comment: commentText,
        file_ids: fileIds
      }
    };

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add submission comment: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Build rubric assessment object from grades data
   * Format: { criterion_id: { points: X, comments: "..." } }
   */
  static buildRubricAssessment(grades) {
    const assessment = {};

    for (const [criterionId, data] of Object.entries(grades)) {
      // Keep criterion ID as-is (including underscore prefix if present)
      assessment[criterionId] = {
        points: data.points !== null ? data.points : 0,
        comments: data.comments || ''
      };
    }

    console.log('Built rubric assessment:', assessment);
    return assessment;
  }

  /**
   * Batch save multiple student assessments
   * @param {string} assignmentId - Assignment ID
   * @param {Array} studentGrades - Array of { userId, grades }
   * @param {function} onProgress - Progress callback (current, total, userId, status, error)
   * @returns {Promise<object>} - Results summary
   */
  async batchSaveAssessments(assignmentId, studentGrades, onProgress = null) {
    const results = {
      success: [],
      failed: []
    };

    for (let i = 0; i < studentGrades.length; i++) {
      const { userId, grades } = studentGrades[i];

      // Notify that we're starting to save this student
      if (onProgress) {
        onProgress(i + 1, studentGrades.length, userId, 'saving', null);
      }

      try {
        const rubricAssessment = CanvasRestAPI.buildRubricAssessment(grades);
        await this.saveRubricAssessment(assignmentId, userId, rubricAssessment);
        results.success.push(userId);

        // Notify success for this student
        if (onProgress) {
          onProgress(i + 1, studentGrades.length, userId, 'success', null);
        }
      } catch (error) {
        results.failed.push({ userId, error: error.message });

        // Notify error for this student
        if (onProgress) {
          onProgress(i + 1, studentGrades.length, userId, 'error', error.message);
        }
      }
    }

    return results;
  }
}

window.CanvasRestAPI = CanvasRestAPI;
