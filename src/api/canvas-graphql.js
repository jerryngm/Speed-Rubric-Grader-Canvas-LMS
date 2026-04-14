/**
 * Canvas GraphQL API Service
 * Handles fetching rubric data and student submissions with pagination
 */

class CanvasGraphQLAPI {
  constructor() {
    this.graphqlEndpoint = '/api/graphql';
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

  /**
   * Execute a GraphQL query against Canvas API
   * @param {string} query - GraphQL query string
   * @param {object} variables - Query variables
   * @returns {Promise<object>} - Query result
   */
  async executeQuery(query, variables = {}) {
    const csrfToken = CanvasGraphQLAPI.getCsrfToken();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(this.graphqlEndpoint, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  /**
   * Fetch course sections
   * @param {string} courseId - Canvas course ID
   * @returns {Promise<object>} - Object with course info and sections array
   */
  async fetchCourseSections(courseId) {
    let allSections = [];
    let courseInfo = null;
    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const MAX_PAGES = 100;

    while (hasNextPage && pageCount < MAX_PAGES) {
      pageCount++;
      const query = `
        query GetCourseSections($courseId: ID!, $cursor: String) {
          course(id: $courseId) {
            courseCode
            courseNickname
            name
            sectionsConnection(after: $cursor) {
              nodes {
                _id
                name
              }
              pageInfo {
                endCursor
                hasNextPage
                startCursor
              }
            }
          }
        }
      `;

      const data = await this.executeQuery(query, { courseId, cursor: cursor || null });

      if (!courseInfo) {
        courseInfo = {
          name: data.course?.name || null,
          courseCode: data.course?.courseCode || null,
          courseNickname: data.course?.courseNickname || null
        };
      }

      const sections = data.course?.sectionsConnection?.nodes || [];
      allSections.push(...sections);

      const pageInfo = data.course?.sectionsConnection?.pageInfo;
      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor;
    }

    return {
      course: courseInfo,
      sections: allSections
    };
  }

  /**
   * Build the rubric assessment query with pagination support
   * @param {string} assignmentId - Assignment ID
   * @param {string|null} submissionsCursor - Pagination cursor
   * @param {Array} sectionIds - Array of section IDs to filter (empty = all)
   */
  buildRubricQuery(assignmentId, submissionsCursor = null, sectionIds = []) {
    return `
      query GetRubricData($assignmentId: ID!, $cursor: String, $sectionIds: [ID!]) {
        assignment(id: $assignmentId) {
          name
          pointsPossible
          course {
            name
            courseCode
            courseNickname
          }
          rubric {
            criteria {
              _id
              description
              longDescription
              points
              ratings {
                _id
                description
                points
              }
            }
          }
          submissionsConnection(filter: {includeUnsubmitted: true, sectionIds: $sectionIds}, after: $cursor) {
            nodes {
              _id
              user {
                _id
                name
                sisId
              }
              rubricAssessmentsConnection(filter: {forAllAttempts: true}) {
                nodes {
                  _id
                  assessmentRatings {
                    criterion {
                      _id
                    }
                    points
                    comments
                  }
                }
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `;
  }

  /**
   * Fetch all rubric data with pagination handling
   * @param {string} assignmentId - Canvas assignment ID
   * @param {Array} sectionIds - Array of section IDs to filter (empty = all)
   * @returns {Promise<object>} - Complete rubric data with all students
   */
  async fetchRubricData(assignmentId, sectionIds = []) {
    let allSubmissions = [];
    let rubricCriteria = null;
    let assignmentInfo = null;
    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const MAX_PAGES = 100;

    while (hasNextPage && pageCount < MAX_PAGES) {
      pageCount++;
      const query = this.buildRubricQuery(assignmentId, cursor, sectionIds);
      const data = await this.executeQuery(query, {
        assignmentId,
        cursor: cursor || null,
        sectionIds: sectionIds.length > 0 ? sectionIds : null
      });

      if (!assignmentInfo) {
        assignmentInfo = {
          name: data.assignment.name,
          pointsPossible: data.assignment.pointsPossible,
          courseName: data.assignment.course?.name || null,
          courseCode: data.assignment.course?.courseCode || null,
          courseNickname: data.assignment.course?.courseNickname || null
        };
      }

      if (!rubricCriteria) {
        rubricCriteria = data.assignment.rubric?.criteria || [];
      }

      const submissions = data.assignment.submissionsConnection.nodes;
      allSubmissions.push(...submissions);

      const pageInfo = data.assignment.submissionsConnection.pageInfo;
      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor;
    }

    return {
      assignment: assignmentInfo,
      criteria: rubricCriteria,
      submissions: this.processSubmissions(allSubmissions, rubricCriteria)
    };
  }

  /**
   * Process submissions into a structured format for the grading table
   */
  processSubmissions(submissions, criteria) {
    return submissions.map(submission => {
      const assessments = submission.rubricAssessmentsConnection?.nodes?.[0]?.assessmentRatings || [];

      const grades = {};
      criteria.forEach(criterion => {
        const assessment = assessments.find(a => a.criterion?._id === criterion._id);
        grades[criterion._id] = {
          points: assessment?.points ?? null,
          comments: assessment?.comments ?? ''
        };
      });

      return {
        submissionId: submission._id,
        userId: submission.user._id,
        name: submission.user.name,
        sisId: submission.user.sisId || '',
        grades
      };
    });
  }

  /**
   * Extract assignment ID from current URL
   */
  static getAssignmentIdFromUrl() {
    const match = window.location.pathname.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
    return match ? { courseId: match[1], assignmentId: match[2] } : null;
  }
}

// Export for use in other modules
window.CanvasGraphQLAPI = CanvasGraphQLAPI;
