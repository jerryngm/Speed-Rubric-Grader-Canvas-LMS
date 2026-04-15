// Shared template variables + replacement logic
// Mirrors reference behavior from [`Other Project - For Ref/missing-tab.js:24`](Other Project - For Ref/missing-tab.js:24)

(function() {
  'use strict';

  const TEMPLATE_VARIABLES = [
    { key: 'student_name', label: 'Student Fullname', dataKey: 'stdname' },
    { key: 'student_given_name', label: 'Given Name', dataKey: 'student_given_name' },
    { key: 'student_surname', label: 'Surname', dataKey: 'student_surname' },
    { key: 'course_name', label: 'Course Name', dataKey: 'coursename' },
    { key: 'course_nickname', label: 'Course Nickname', dataKey: 'coursenickname' },
    { key: 'section_name', label: 'Section', dataKey: 'student_section_name' },
    { key: 'assignment_name', label: 'Assignment Name', dataKey: 'assignment_name' },
    { key: 'assignment_group', label: 'Student Assignment Group', dataKey: 'assignment_group' },
    { key: 'assignment_link', label: 'Assignment Link', dataKey: 'assignment_link' },
    { key: 'rubric_changes_summary', label: 'Rubric Changes Summary (Table)', dataKey: null, isHtml: true },
    // Inserts today's date/time via a popup in the variable tray (not a rowData field).
    { key: 'today_datetime', label: 'Today (Date/Time)', dataKey: null },
    { key: 'term', label: 'Term', dataKey: 'term' }
  ];

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeHtmlPreserveNewlines(text) {
    // Keep blank lines and line breaks inside table cells.
    // Escape first, then convert newlines to <br>.
    return escapeHtml(text).replace(/\r\n|\n|\r/g, '<br>');
  }

  function buildRubricChangesSummaryTableHtml(rowData) {
    const userId = rowData?.odId ?? rowData?.userId;
    if (!userId) return '';

    const provider = window.RubricGraderModal;
    const changes = provider && typeof provider.getModifiedChangesForStudent === 'function'
      ? provider.getModifiedChangesForStudent(userId)
      : [];

    if (!changes || changes.length === 0) {
      // Helpful placeholder so users understand why it’s blank.
      return '<p><em>No rubric changes detected for this student.</em></p>';
    }

    // Mirror "Save Changes" behavior: append the comment suffix when a comment exists.
    const commentSuffixInput = document.getElementById('rubric-grader-comment-suffix');
    const commentSuffix = commentSuffixInput ? String(commentSuffixInput.value || '').trim() : '';

    const rows = changes.map(c => {
      const crit = escapeHtml(c.criterionName);

      const pt = c.points === null || c.points === undefined ? '' : String(c.points);
      const max = c.maxPoints === null || c.maxPoints === undefined ? '' : String(c.maxPoints);
      const pointsDisplay = max ? `${escapeHtml(pt)} / ${escapeHtml(max)}` : escapeHtml(pt);

      let commentText = String(c.comment || '');
      if (commentSuffix && commentText.trim() !== '') {
        commentText = commentText + '\n' + commentSuffix;
      }

      const commentHtml = escapeHtmlPreserveNewlines(commentText);
      return `<tr><td>${crit}</td><td>${pointsDisplay}</td><td>${commentHtml}</td></tr>`;
    }).join('');

    return `
      <table style="border-collapse: collapse; width: 100%; border: 1px solid #000;">
        <thead>
          <tr>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; background: #f7f7f7;">Criteria</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; background: #f7f7f7;">Point</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; background: #f7f7f7;">Comment</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `.trim();
  }

  function replaceTemplateVariables(template, rowData) {
    let result = template;

    // Special-case HTML table variable.
    if (result.includes('{{rubric_changes_summary}}')) {
      const tableHtml = buildRubricChangesSummaryTableHtml(rowData);
      result = result.split('{{rubric_changes_summary}}').join(tableHtml);
    }

    TEMPLATE_VARIABLES.forEach(variable => {
      // Skip custom variable (handled above)
      if (variable.key === 'rubric_changes_summary') return;

      if (variable.isDate && variable.dataKey === 'assignment_duedate') {
        const value = rowData?.[variable.dataKey];
        if (!value) {
          result = result.replace(/\{\{(day\.)?due_date(\.time)?\}\}/g, '');
          return;
        }

        const dateRegex = /\{\{(day\.)?due_date(\.time)?\}\}/g;
        result = result.replace(dateRegex, (_match, hasDay, hasTime) => {
          let format = '';
          if (hasDay && hasTime) {
            format = 'dddd, MMMM D, YYYY [at] h:mm A';
          } else if (hasDay && !hasTime) {
            format = 'dddd, MMMM D, YYYY';
          } else if (!hasDay && hasTime) {
            format = 'MMMM D, YYYY [at] h:mm A';
          } else {
            format = 'MMMM D, YYYY';
          }

          if (typeof moment !== 'undefined') {
            return moment(value).format(format);
          }

          // If moment isn't present, do a best-effort conversion.
          try {
            return new Date(value).toLocaleString();
          } catch (_e) {
            return '';
          }
        });

        return;
      }

      const placeholder = `{{${variable.key}}}`;
      const value = variable.dataKey ? (rowData?.[variable.dataKey] || '') : '';
      result = result.split(placeholder).join(value);
    });

    return result;
  }

  function parseGivenSurname(fullName) {
    const name = (fullName || '').trim();
    if (!name) return { givenName: '', surname: '' };

    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { givenName: parts[0], surname: '' };

    return {
      givenName: parts[0],
      surname: parts.slice(1).join(' ')
    };
  }

  window.StudentMessageTemplates = {
    TEMPLATE_VARIABLES,
    replaceTemplateVariables,
    parseGivenSurname
  };
})();
