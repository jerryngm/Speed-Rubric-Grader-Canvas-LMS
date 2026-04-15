/**
 * Content Script - Injects the Rubric Grader button into Canvas assignment pages
 */

(function() {
  'use strict';

  const BUTTON_ID = 'canvas-rubric-grader-btn';
  const BUTTON_NAV_ID = 'canvas-rubric-grader-btn-nav';
  const BUTTON_ASSIGNMENT_ID = 'canvas-rubric-grader-btn-assignment';

  /**
   * Create the grader button element
   */
  function createGraderButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'btn btn-primary';
    button.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/icon.svg')}" width="35" height="35" alt="" style="flex-shrink: 0;">
      Speed Rubric Grader
    `;
    button.style.cssText = `
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    button.addEventListener('click', openGraderModal);
    return button;
  }

  /**
   * Create the grader button element for the page-action-list nav
   */
  function createNavGraderButton() {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.id = BUTTON_NAV_ID;
    button.className = 'btn btn-primary';
    button.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/icon.svg')}" width="20" height="20" alt="" style="flex-shrink: 0;">
      Speed Rubric Grader
    `;
    button.style.cssText = `
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
    `;
    button.addEventListener('click', openGraderModal);
    li.appendChild(button);
    return li;
  }

  /**
   * Create the grader button element for the assignment edit page
   */
  function createAssignmentGraderButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ASSIGNMENT_ID;
    button.className = 'btn btn-primary';
    button.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/icon.svg')}" width="35" height="35" alt="" style="flex-shrink: 0;">
      Speed Rubric Grader
    `;
    button.style.cssText = `
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    button.addEventListener('click', openGraderModal);
    return button;
  }

  /**
   * Inject the button above the rubric title and at the bottom of page-action-list
   */
  function injectButton() {
    // Try to inject above enhanced-rubric-assignment-edit-mount-point first
    const assignmentMountPoint = document.querySelector('#enhanced-rubric-assignment-edit-mount-point');

    if (!document.getElementById(BUTTON_ASSIGNMENT_ID) && assignmentMountPoint) {
      const button = createAssignmentGraderButton();
      assignmentMountPoint.parentNode.insertBefore(button, assignmentMountPoint);
    }

    // Only inject above rubric_title if assignment mount point doesn't exist
    if (!document.getElementById(BUTTON_ID) && !assignmentMountPoint) {
      const rubricTitle = document.querySelector('.rubric_title');
      if (rubricTitle) {
        const button = createGraderButton();
        rubricTitle.parentNode.insertBefore(button, rubricTitle);
      }
    }

    if (!document.getElementById(BUTTON_NAV_ID)) {
      const pageActionList = document.querySelector('ul.page-action-list');
      if (pageActionList) {
        const navButton = createNavGraderButton();
        pageActionList.appendChild(navButton);
      }
    }

    return document.getElementById(BUTTON_ASSIGNMENT_ID) || document.getElementById(BUTTON_ID) || document.getElementById(BUTTON_NAV_ID);
  }

  /**
   * Open the grader modal
   */
  async function openGraderModal() {
    const urlInfo = CanvasGraphQLAPI.getAssignmentIdFromUrl();
    if (!urlInfo) {
      alert('Could not determine assignment ID from URL');
      return;
    }

    window.RubricGraderModal.open(urlInfo.courseId, urlInfo.assignmentId);
  }

  /**
   * Wait for the rubric section or page-action-list to load, then inject buttons
   */
  function waitForRubric() {
    const observer = new MutationObserver((mutations, obs) => {
      const assignmentMountPoint = document.querySelector('#enhanced-rubric-assignment-edit-mount-point');
      const rubricTitle = document.querySelector('.rubric_title');
      const pageActionList = document.querySelector('ul.page-action-list');
      if (assignmentMountPoint || rubricTitle || pageActionList) {
        injectButton();
        const hasAssignmentBtn = document.getElementById(BUTTON_ASSIGNMENT_ID);
        const hasMainBtn = document.getElementById(BUTTON_ID);
        const hasNavBtn = document.getElementById(BUTTON_NAV_ID);
        if ((hasAssignmentBtn || hasMainBtn) && hasNavBtn) {
          obs.disconnect();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => observer.disconnect(), 10000);
  }

  /**
   * Initialize the content script
   */
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        injectButton() || waitForRubric();
      });
    } else {
      injectButton() || waitForRubric();
    }
  }

  init();
})();
