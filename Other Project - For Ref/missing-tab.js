// ============================================================================
// CANVAS LMS ENHANCED TO-DO LIST - MISSING & OVERDUE TAB
// ============================================================================
// This module extends the main extension with missing submission tracking.
// It identifies students who haven't submitted assignments near/past due dates.
// ============================================================================

(() => {
  'use strict';

  // Wait for shared utilities to be available
  if (typeof window.CanvasToDoShared === 'undefined') {
    console.error('CanvasToDoShared not available. Ensure content.js loads first.');
    return;
  }

  // Import shared utilities from content.js
  const { CONFIG, Utils, API, ModalState, DataTransformer, ExportConfig, FilterManager } = window.CanvasToDoShared;

  // ============================================================================
  // TEMPLATE VARIABLES FOR EMAIL PERSONALIZATION
  // ============================================================================

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
    { key: 'due_date', label: 'Due Date', dataKey: 'assignment_duedate', isDate: true },
    { key: 'term', label: 'Term', dataKey: 'term' }
  ];

  // ============================================================================
  // COMMENT LIBRARY QUERIES
  // ============================================================================

  const CommentLibraryQueries = {
    /**
     * GraphQL query for fetching comment bank items
     */
    SpeedGrader_CommentBankItemQuery: `
      query GetCommentBankItems($query: String) {
        legacyNode(type: User, _id: user_id) {
          ... on User {
            commentBankItemsConnection(query: $query) {
              nodes {
                comment
                createdAt
              }
              pageInfo {
                hasNextPage
                endCursor
                totalCount
                startCursor
              }
            }
          }
        }
      }
    `,

    /**
     * GraphQL query for fetching user courses
     */
    UserCoursesQuery: `
      query GetUserCourses {
        allCourses {
          _id
          courseCode
          courseNickname
          name
        }
      }
    `,

    /**
     * GraphQL mutation for saving comment to library
     */
    CreateCommentBankItemMutation: `
      mutation CreateCommentBankItem($comment: String!, $courseId: ID!) {
        __typename
        createCommentBankItem(input: {comment: $comment, courseId: $courseId}) {
          commentBankItem {
            id
            comment
            createdAt
          }
          errors {
            attribute
            message
          }
        }
      }
    `
  };

  // ============================================================================
  // 1. MISSING TAB PROGRESS TRACKER
  // ============================================================================

  const MissingProgress = Utils.createProgressTracker({
    wrapperId: 'missing-progress-wrapper',
    labelId: 'missing-progress-label',
    barId: 'missing-progress-bar'
  });

  // ============================================================================
  // 2. MISSING DATA FETCHER
  // ============================================================================

  const MissingDataFetcher = {
    /**
     * Fetch missing submissions using the submissionsConnection filter
     * This directly queries for unsubmitted submissions within a date range
     */
    async fetchMissingSubmissions(referenceDate, days) {
      try {
        MissingProgress.init(100);

        // Calculate date range (± days from reference date)
        const refMoment = moment(referenceDate);
        const startDate = refMoment.clone().subtract(days, 'days').format('YYYY-MM-DD');
        const endDate = refMoment.clone().add(days, 'days').format('YYYY-MM-DD');

        // GraphQL query to fetch missing submissions directly
        const query = `
          query GetMissingSubmissions($cursor: String) {
            allCourses {
              _id
              name
              courseNickname
              term { name sisTermId }
              submissionsConnection(
                filter: {
                  dueBetween: { start: "${startDate}", end: "${endDate}" }
                  states: unsubmitted
                }
                first: ${CONFIG.MAX_PAGE_SIZE}
                after: $cursor
              ) {
                nodes {
                  cachedDueDate
                  assignment {
                    _id
                    name
                    assignmentGroup { name }
                  }
                  grade
                  missing
                  state
                  submissionStatus
                  user {
                    _id
                    name
                    sortableName
                    sisId
                    email
                    enrollments {
                      state
                      course { _id }
                      section { name }
                    }
                  }
                  assignmentId
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        `;

        MissingProgress.increment(20);

        // Fetch initial data
        const result = await API.graphqlRequest(query);
        const courses = result.data.allCourses || [];

        MissingProgress.increment(30);

        // Paginate through submissions for each course if needed
        for (const course of courses) {
          let pageInfo = course?.submissionsConnection?.pageInfo;

          while (pageInfo?.hasNextPage) {
            await Utils.delay(CONFIG.PAGINATION_DELAY);

            const nextResult = await API.graphqlRequest(query, {
              cursor: pageInfo.endCursor
            });

            const moreCourses = nextResult?.data?.allCourses || [];
            const matchingCourse = moreCourses.find(c => c._id === course._id);

            if (matchingCourse?.submissionsConnection?.nodes) {
              course.submissionsConnection.nodes.push(...matchingCourse.submissionsConnection.nodes);
            }

            pageInfo = matchingCourse?.submissionsConnection?.pageInfo;
          }
        }

        MissingProgress.increment(30);

        // Transform the data
        const missingData = this.transformMissingData(courses, referenceDate);

        MissingProgress.finish();

        // Cache the data
        ModalState.dataCache.missing = missingData;

        return missingData;
      } catch (error) {
        MissingProgress.finish();
        console.error('Error fetching missing submissions:', error);
        throw error;
      }
    },

    /**
     * Transform the GraphQL response into table-ready data
     */
    transformMissingData(courses, referenceDate) {
      const canvasUrl = window.location.origin;
      const missingData = [];
      const now = moment();

      for (const course of courses) {
        // Skip demo courses
        if (CONFIG.DEMO_COURSE_PATTERN.test(course.name)) continue;

        const submissions = course?.submissionsConnection?.nodes || [];

        for (const submission of submissions) {
          const user = submission.user;

          // Skip test students
          if (user?.name === CONFIG.TEST_STUDENT_NAME) continue;

          // Find student's enrollment in this course
          const studentEnrollment = user?.enrollments?.find(
            e => e?.course?._id === course._id
          );

          // Calculate days until due
          const dueMoment = moment(submission.cachedDueDate);
          const daysUntilDue = Math.floor(dueMoment.diff(now, 'days', true));

          // Parse student name from sortableName (format: "Last, First" or "Last, First Middle")
          let givenName = '';
          let surname = '';
          if (user.sortableName) {
            const parts = user.sortableName.split(',').map(p => p.trim());
            if (parts.length >= 2) {
              surname = parts[0]; // Last name
              givenName = parts[1]; // First name (may include middle name)
            } else {
              // Fallback: try to parse from regular name
              const nameParts = user.name.split(' ');
              givenName = nameParts[0] || '';
              surname = nameParts.slice(1).join(' ') || '';
            }
          } else {
            // Fallback: parse from regular name (assumes "First Last" format)
            const nameParts = user.name.split(' ');
            givenName = nameParts[0] || '';
            surname = nameParts.slice(1).join(' ') || '';
          }

          missingData.push({
            course_id: course._id,
            assignment_id: submission.assignment?._id || submission.assignmentId,
            user_id: user._id,
            coursename: course.name,
            coursenickname: course.courseNickname,
            term: course.term?.name,
            student_section_name: studentEnrollment?.section?.name,
            stdname: user.name,
            student_given_name: givenName,
            student_surname: surname,
            sisid: user.sisId,
            stdemail: user.email,
            assignment_name: submission.assignment?.name,
            assignment_group: submission.assignment?.assignmentGroup?.name,
            assignment_duedate: submission.cachedDueDate,
            days_until_due: daysUntilDue,
            assignment_link: `${canvasUrl}/courses/${course._id}/assignments/${submission.assignment?._id || submission.assignmentId}`
          });
        }
      }

      return missingData;
    }
  };

  // ============================================================================
  // 3. MISSING TABLE MANAGER
  // ============================================================================

  const MissingTableManager = {
    getMissingTableColumns() {
      return [
        {
          title: '',
          data: null,
          name: 'Control',
          orderable: false,
          searchable: false,
          className: 'dtr-control',
          defaultContent: '',
          className: '_internal'
        },
        {
          title: '',
          data: null,
          name: 'Select',
          orderable: false,
          searchable: false,
          className: 'select-checkbox dt-center',
          defaultContent: '',
          className: '_internal'
        },
        { title: '#', data: null, name: '#', orderable: false, searchable: false, className: 'dt-center' },
        { title: 'Course ID', data: 'course_id', name: 'CourseID', visible: false, orderable: false, searchable: false, className: '_internal'},
        { title: 'Assignment ID', data: 'assignment_id', name: 'AssignmentID', visible: false, orderable: false, searchable: false, className: '_internal' },
        { title: 'User ID', data: 'user_id', name: 'UserID', visible: false, orderable: false, searchable: false, className: '_internal' },
        { title: 'Course Name', data: 'coursename', name: 'CourseName',  visible: true },
        { title: "Your Course's Nickname", data: 'coursenickname', name: 'CourseNickname', visible: true },
        { title: 'Term', data: 'term', name: 'Term', visible: true },
        { title: 'Student Section', data: 'student_section_name', name: 'StudentSection', visible: true },
        { title: 'Student Name', data: 'stdname', name: 'StudentName', visible: true },
        { title: 'Student ID (SIS ID)', data: 'sisid', name: 'StudentSISID', visible: true },
        { title: 'Student Email', data: 'stdemail', name: 'StudentEmail', visible: false },
        { title: 'Assignment Name', data: 'assignment_name', name: 'AssignmentName', visible: true },
        { title: 'Assignment Group', data: 'assignment_group', name: 'AssignmentGroup', visible: true },
        { title: 'Assignment Due Date', data: 'assignment_duedate', name: 'AssignmentDueDate', visible: true },
        { title: 'Days Until Due', data: 'days_until_due', name: 'DaysUntilDue', visible: true },
        { title: 'Assignment Link', data: 'assignment_link', name: 'AssignmentLink', visible: true, className: 'assignment-link' }
      ];
    },

    getMissingExportConfig() {
      return {
        excel: {
          extend: 'excelHtml5',
          text: '<i class="icon-ms-excel" aria-hidden="true"></i> Excel',
          filename: `Canvas_Missing_Submissions_${moment().format('YYYY-MM-DD')}`,
          title: '',
          autoFilter: true,
          exportOptions: {
            columns: function (idx) {
              if (idx === 0 || idx === 1 || idx === 2) return false; // Skip control, checkbox and # columns
              return ModalState.tables.missing.column(idx).visible();
            },
            format: {
              body: (data, row, column, node) => {
                const colDef = ModalState.tables.missing.settings()[0].aoColumns[column];
                const colName = colDef.data;
                const rowData = ModalState.tables.missing.row(row).data();

                // For Assignment Link column, get raw URL from data source
                if (colName === 'assignment_link') {
                  return rowData.assignment_link;
                }

                // Convert dates to Excel serial numbers
                const tryDate = (txt) => {
                  const m = moment(txt, [
                    'YYYY-MM-DD[T]HH:mm:ssZ',
                    'YYYY/MM/DD HH:mm'
                  ], true);
                  if (!m.isValid()) return null;
                  const excelEpoch = moment('1899-12-30');
                  return (m.valueOf() - excelEpoch.valueOf()) / 86400000;
                };

                const serial = tryDate(data);
                if (serial !== null) return serial;

                // Keep integers as integers
                if (/^\s*-?\d+\s*$/.test(data)) {
                  return parseInt(data, 10);
                }

                return data;
              }
            },
          
          customizeData: function (data) {
            // Remove ColumnControl header row
            if (data.headerStructure && data.headerStructure.length > 1) {
              data.headerStructure.pop();
            }
          }
        },
          customize: function (xlsx) {
            const styles = xlsx.xl['styles.xml'];
            const sheet = xlsx.xl.worksheets['sheet1.xml'];

            // Create date format
            const currentMax = Math.max(...$('numFmts numFmt', styles)
              .map(function() { return +$(this).attr('numFmtId') || -Infinity; }).toArray());
            const numFmtId = (isFinite(currentMax) ? currentMax : 0) + 1;

            $('numFmts', styles).append(
              `<numFmt numFmtId="${numFmtId}" formatCode="yyyy/mm/dd HH:mm"/>`
            ).attr('count', (parseInt($('numFmts', styles).attr('count')) || 0) + 1);

            const cellXfs = $('cellXfs', styles);
            cellXfs.append(
              `<xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
            ).attr('count', (parseInt(cellXfs.attr('count')) || 0) + 1);
            const dateStyleIdx = $('xf', cellXfs).length - 1;

            // Helper functions
            const colLetterOfCellRef = (r) => (r || '').replace(/\d+/g, '');

            const headerCells = $('sheetData row:first c', sheet);
            const headerMap = {};

            headerCells.each(function() {
              const c = $(this);
              const t = $('is t', c).text();
              const ref = c.attr('r');
              if (t && ref) {
                headerMap[t.trim()] = colLetterOfCellRef(ref);
              }
            });

            // Apply date style to date columns
            const DATE_HEADERS = ['Assignment Due Date'];
            DATE_HEADERS.forEach(h => {
              const col = headerMap[h];
              if (col) {
                $(`row c[r^="${col}"]:gt(0)`, sheet).attr('s', dateStyleIdx);
              }
            });

            // Ensure integer columns don't get date style
            const INTEGER_HEADERS = ['Days Until Due'];
            INTEGER_HEADERS.forEach(h => {
              const col = headerMap[h];
              if (col) {
                $(`row c[r^="${col}"]:gt(0)[s]`, sheet).removeAttr('s');
              }
            });
          }
        },

        copy: {
          extend: 'copyHtml5',
          text: '<i class="icon-copy" aria-hidden="true"></i> Copy',
          title: '',
          exportOptions: {
            columns: function (idx) {
              if (idx === 0 || idx === 1 || idx === 2) return false;
              return ModalState.tables.missing.column(idx).visible();
            },
            format: {
              body: (data, row, column, node) => {
                const colDef = ModalState.tables.missing.settings()[0].aoColumns[column];
                const colName = colDef.data;
                const rowData = ModalState.tables.missing.row(row).data();

                // For Assignment Link column, get raw URL from data source
                if (colName === 'assignment_link') {
                  return rowData.assignment_link;
                }

                // Keep "Days Until Due" as integer
                if (/^\s*-?\d+\s*$/.test(data) &&
                    $(ModalState.tables.missing.column(column).header()).text().trim() === 'Days Until Due') {
                  return String(parseInt(data, 10));
                }

                // Format dates consistently
                const headerText = $(ModalState.tables.missing.column(column).header()).text().trim();
                if (headerText === 'Assignment Due Date') {
                  const m = moment(data, [
                    'YYYY-MM-DD[T]HH:mm:ssZ',
                    'YYYY/MM/DD HH:mm'
                  ], true);
                  return m.isValid() ? m.format('YYYY/MM/DD HH:mm') : data;
                }

                return data;
              }
            }
          }
        },

        print: {
          extend: 'print',
          title: `Missing Submissions as of ${moment().format('YYYY-MM-DD')}`,
          text: '<i class="icon-printer" aria-hidden="true"></i> Print',
          exportOptions: {
            columns: ':visible',
            format: {
              body: (data, row, column, node) => {
                const colDef = ModalState.tables.missing.settings()[0].aoColumns[column];
                const colName = colDef.data;
                const rowData = ModalState.tables.missing.row(row).data();

                // For Assignment Link column, get raw URL from data source
                if (colName === 'assignment_link') {
                  return rowData.assignment_link;
                }

                if ($(node).hasClass('assignment-link')) {
                  return $(node).find('a').attr('href') || data;
                }
                return data;
              }
            }
          }
        }
      };
    },

    initializeMissingTable(data) {
      DataTable.datetime('YYYY/MM/DD HH:mm');

      const exportConfig = this.getMissingExportConfig();

      ModalState.tables.missing = new DataTable('#missing-table', {
        data,
        autoWidth: false,
        lengthMenu: [10, 25, 50, { label: 'All', value: -1 }],
        ordering: { indicators: false },
        order: [[16, 'asc']], // Days Until Due (ascending - soonest first) - shifted due to new control column
        processing: true,
        colReorder: { realtime: true, columns: ':not(.select-checkbox):not(:nth-child(2)):not(:nth-child(1)):not(:nth-child(3))' },
        responsive: {
          details: {
            type: 'column'
          }
        },
        select: {
          style: 'multi',
          selector: 'td.select-checkbox'
        },
        stateSave: true,
        stateDuration: 0,
        stateSaveCallback: function (settings, data) {
          // Convert column indexes to names for stability
          if (data.columnControl) {
            data.columnControlByName = {};
            Object.keys(data.columnControl).forEach(idx => {
              const colIdx = parseInt(idx);
              const colName = settings.aoColumns[colIdx]?.name;
              if (colName && data.columnControl[idx]) {
                data.columnControlByName[colName] = data.columnControl[idx];
              }
            });
          }
          localStorage.setItem(`${CONFIG.STORAGE_KEY}_Missing`, JSON.stringify(data));
        },

        stateLoadCallback: function (settings) {
          try {
            const raw = localStorage.getItem(`${CONFIG.STORAGE_KEY}_Missing`);
            return raw ? JSON.parse(raw) : null;
          } catch (e) {
            console.error('State load failed:', e);
            return null;
          }
        },

        stateLoadParams: function (settings, data) {
          if (data?.search) data.search.search = '';

          // Restore columnControl by mapping names to current indexes
          if (data.columnControlByName) {
            data.columnControl = {};
            Object.keys(data.columnControlByName).forEach(colName => {
              const currentIdx = settings.aoColumns.findIndex(col => col.name === colName);
              if (currentIdx !== -1) {
                data.columnControl[currentIdx] = data.columnControlByName[colName];
              }
            });
          }
          return true;
        },

        layout: {
          top3: "searchPanes",
          top2: "searchBuilder",
          top2Start: {buttons: ['pageLength', { extend: 'colvis', text: '<i class="icon-eye" aria-hidden="true"></i> Column Visibility', columns: ':not(._internal)' },          {
            extend: 'collection',
            text: '<i class="icon-download" aria-hidden="true"></i> Export',
            buttons: [
              exportConfig.excel,
              exportConfig.copy,
              exportConfig.print
            ]
          }]},
          topStart: 'buttons',
          top2End: {buttons: [         {
            text: '<i class="icon-table-delete-table" aria-hidden="true"></i> Clear Columns Search',
            action: function (e, dt) {
              try { dt.columns().columnControl?.searchClear?.(); } catch (e) {}
              dt.search('');
              dt.draw(false);
            }
          }]},
          topEnd: 'search',
          bottomStart: 'info',
          bottomEnd: 'paging'
        },
        columns: this.getMissingTableColumns(),
        on: {
          draw: (e) => {
            let start = e.dt.page.info().start;
            e.dt.column(2, { page: 'current' })
              .nodes()
              .each((cell, i) => {
                cell.textContent = start + i + 1;
              });
          }
        },

        columnControl: [
          {
            target: 0,
            className: 'dt-left',
            content: ['orderStatus', ['reorderLeft', 'reorderRight', 'spacer', 'rowGroup', 'spacer', 'searchList']]
          },
          {
            target: 1,
            className: 'dt-left',
            content: ['search']
          }
        ],

        keys: true,
        searchPanes: {
          cascadePanes: true,
          columns: [6,9]
        },

        columnDefs: [
          {
            targets: 0,
            orderable: false,
            className: 'dtr-control',
            responsivePriority: 1 // Highest priority to always show control column
          },
          {
            targets: 1,
            orderable: false,
            className: 'select-checkbox dt-center',
            responsivePriority: 2 // Second priority to always show checkbox
          },
          {
            targets: 2,
            orderable: false,
            searchable: false,
            className: 'dt-center',
            createdCell: (td) => { td.style.whiteSpace = 'nowrap'; },
            render: function (data, type, row, meta) {
              return meta.row + 1;
            },
            responsivePriority: 3 // Third priority to show row number
          },
          {
            targets: '_all',
            className: 'dt-left'
          },
          {
            targets: 'AssignmentDueDate:name',
            render: (data) => {
              moment.updateLocale(moment.locale(), { invalidDate: "" });
              return moment(data).format('YYYY/MM/DD HH:mm');
            }
          },
          {
            targets: 'DaysUntilDue:name',
            className: 'dt-body-left',
            render: (data) => {
              const days = parseInt(data);
              if (days < 0) {
                return `<span style="color: #d32f2f; font-weight: 600;">${days} (overdue)</span>`;
              } else if (days === 0) {
                return `<span style="color: #ff9800; font-weight: 600;">0 (due today)</span>`;
              } else {
                return `<span style="color: #666;">${days}</span>`;
              }
            }
          },
          {
            targets: 'AssignmentLink:name',
            render: {
              display: (data, type, row) => {
                return `<a href="${data}" target="_blank">View Assignment</a>`;
              },
              sort: (data, type, row) => {
                return data;
              },
              filter: (data, type, row) => {
                return data;
              }
            }
          }
        ],

        buttons: [
          
          {
            text: '<i class="icon-email" aria-hidden="true"></i> Email Selected',
            action: function (e, dt, node, config) {
              const selectedCount = dt.rows({ selected: true }).count();
              if (selectedCount === 0) {
                alert('Please select at least one student to email.');
                return;
              }
              EmailModal.open();
            }
          },
          {extend: 'selectAll', text: '<i class="icon-check-plus" aria-hidden="true"></i> Select All Rows'},
          {extend: 'selectNone', text: '<i class="icon-stop" aria-hidden="true"></i> Deselect All'}
        ],

        searchBuilder: {
          columns: ['CourseName:name', 'CourseNickname:name', 'StudentSection:name', 'Term:name',
                   'AssignmentName:name', 'AssignmentDueDate:name', 'DaysUntilDue:name']
        }
      });

      // Log selected rows for debugging
      ModalState.tables.missing.on('select', (e, dt, type, indexes) => {
        const selectedCount = ModalState.tables.missing.rows({ selected: true }).count();
        console.log(`Selected ${selectedCount} rows`);
      });

      ModalState.tables.missing.on('deselect', (e, dt, type, indexes) => {
        const selectedCount = ModalState.tables.missing.rows({ selected: true }).count();
        console.log(`Selected ${selectedCount} rows`);
      });

      // Show the table
      document.getElementById('missing-table').style.display = 'table';

      // Force responsive recalculation based on current modal width
      // This ensures columns collapse correctly when table is initialized in a small modal
      setTimeout(() => {
        if (ModalState.tables.missing) {
          ModalState.tables.missing.columns.adjust().responsive.recalc();
        }
      }, 100);
    }
  };

  // ============================================================================
  // FILE UPLOAD MANAGER
  // ============================================================================

  const FileUploadManager = {
    iframe: null,
    uploadedFiles: [],
    messageHandler: null,
    isInitialized: false,
    uploadCallbacks: new Map(), // Track upload callbacks by requestId
    uploadContext: 'comment', // Track upload context: 'comment' or 'message'
    currentUserId: null, // Store user ID

    /**
     * Initialize FilePond iframe
     * @param {string} context - Upload context: 'comment' or 'message'
     * @param {string} userId - Current user ID
     */
    initialize(context = 'comment', userId = null) {
      this.uploadContext = context;
      this.currentUserId = userId;
      // Clean up existing iframe if any
      if (this.iframe) {
        this.destroy();
      }

      // Find the file upload container in the modal
      const container = document.getElementById('file-upload-container');

      if (container) {
        // Create iframe for FilePond
        this.iframe = document.createElement('iframe');
        this.iframe.id = 'filepond-iframe';
        this.iframe.src = chrome.runtime.getURL('filepond-iframe.html');
        this.iframe.style.width = '100%';
        this.iframe.style.height = '150px'; // Initial height, will be adjusted
        this.iframe.style.border = 'none';
        this.iframe.style.backgroundColor = 'transparent';

        // Clear container and add iframe
        container.innerHTML = '';
        container.appendChild(this.iframe);

        // Set up message handler for parent-iframe communication
        this.setupMessageHandler();

        console.log('FilePond iframe initialized');
      } else {
        console.error('File upload container not found');
      }
    },

    /**
     * Set up message handler for parent-iframe communication
     */
    setupMessageHandler() {
      const MESSAGE_TYPES = {
        INIT: 'INIT',
        GET_FILES: 'GET_FILES',
        CLEAR_FILES: 'CLEAR_FILES',
        FILES_UPDATED: 'FILES_UPDATED',
        FILES_RESPONSE: 'FILES_RESPONSE',
        ERROR: 'ERROR',
        RESIZE_IFRAME: 'RESIZE_IFRAME',
        UPLOAD_PROGRESS: 'UPLOAD_PROGRESS',
        UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
        UPLOAD_ERROR: 'UPLOAD_ERROR'
      };

      this.messageHandler = (event) => {
        const { type, requestId, files, error, height, fileData, progress, step, message, fileName, studentIndex, fileIndex } = event.data;

        switch (type) {
          case MESSAGE_TYPES.FILES_UPDATED:
            // Update local files when iframe notifies of changes
            this.uploadedFiles = files || [];
            console.log('Files updated from iframe:', this.uploadedFiles.length);
            break;

          case MESSAGE_TYPES.FILES_RESPONSE:
            // Handle response to getFiles request
            if (this.pendingFilesCallback) {
              this.pendingFilesCallback(files || []);
              this.pendingFilesCallback = null;
            }
            break;

          case MESSAGE_TYPES.UPLOAD_PROGRESS:
            // Handle upload progress from iframe
            const progressCallback = this.uploadCallbacks.get(requestId);
            if (progressCallback && progressCallback.onProgress) {
              progressCallback.onProgress({
                step,
                message,
                fileName,
                progress,
                studentIndex,
                fileIndex
              });
            }
            break;

          case MESSAGE_TYPES.UPLOAD_SUCCESS:
            // Handle upload success from iframe
            const successCallback = this.uploadCallbacks.get(requestId);
            if (successCallback && successCallback.onSuccess) {
              successCallback.onSuccess(fileData);
            }
            // Clean up callback
            this.uploadCallbacks.delete(requestId);
            break;

          case MESSAGE_TYPES.UPLOAD_ERROR:
            // Handle upload error from iframe
            const errorCallback = this.uploadCallbacks.get(requestId);
            if (errorCallback && errorCallback.onError) {
              errorCallback.onError(new Error(error));
            }
            // Clean up callback
            this.uploadCallbacks.delete(requestId);
            break;

          case MESSAGE_TYPES.ERROR:
            console.error('Error from iframe:', error);
            break;

          case MESSAGE_TYPES.RESIZE_IFRAME:
            // Adjust iframe height based on content
            if (this.iframe && height) {
              this.iframe.style.height = height + 'px';
            }
            break;
        }
      };

      // Add message listener
      window.addEventListener('message', this.messageHandler);

      // Initialize iframe after it loads
      this.iframe.addEventListener('load', () => {
        this.isInitialized = true;
        console.log('FilePond iframe loaded and ready');

        // Send initialization message to iframe with Canvas base URL, CSRF token, upload context, and user ID
        this.sendMessageToIframe({
          type: 'INIT',
          data: {
            config: {
              canvasBaseUrl: window.location.origin, // Pass Canvas domain to iframe
              csrfToken: Utils.getCSRFToken(), // Pass CSRF token to iframe
              uploadContext: this.uploadContext, // Pass upload context (comment or message)
              userId: this.currentUserId // Pass current user ID
            }
          }
        });
      });
    },

    /**
     * Send message to iframe
     */
    sendMessageToIframe(message) {
      if (this.iframe && this.iframe.contentWindow && this.isInitialized) {
        this.iframe.contentWindow.postMessage(message, '*');
      }
    },

    /**
     * Get all uploaded files from iframe
     */
    async getFiles() {
      return new Promise((resolve) => {
        if (this.isInitialized) {
          // Store callback for when iframe responds
          this.pendingFilesCallback = resolve;

          // Request files from iframe
          this.sendMessageToIframe({
            type: 'GET_FILES'
          });

          // Set timeout in case iframe doesn't respond
          setTimeout(() => {
            if (this.pendingFilesCallback) {
              this.pendingFilesCallback([]);
              this.pendingFilesCallback = null;
            }
          }, 1000);
        } else {
          // Iframe not initialized, return empty array
          resolve([]);
        }
      });
    },

    /**
     * Upload a file through the iframe
     * @param {Object} options - Upload options
     * @param {string} options.courseId - Course ID
     * @param {string} options.assignmentId - Assignment ID
     * @param {string} options.userId - User ID
     * @param {number} options.fileIndex - Index of file in FilePond
     * @param {Function} options.onProgress - Progress callback
     * @returns {Promise<Object>} - File data with ID
     */
    async uploadFile({ courseId, assignmentId, userId, fileIndex, studentIndex, onProgress }) {
      return new Promise((resolve, reject) => {
        // Generate unique request ID
        const requestId = `upload_${Date.now()}_${Math.random()}`;

        // Store callbacks
        this.uploadCallbacks.set(requestId, {
          onProgress,
          onSuccess: resolve,
          onError: reject
        });

        // Send upload request to iframe
        this.sendMessageToIframe({
          type: 'UPLOAD_FILE',
          data: {
            courseId,
            assignmentId,
            userId,
            fileIndex,
            requestId,
            studentIndex
          }
        });

        // Set timeout for upload (5 minutes)
        setTimeout(() => {
          if (this.uploadCallbacks.has(requestId)) {
            this.uploadCallbacks.delete(requestId);
            reject(new Error('Upload timeout'));
          }
        }, 5 * 60 * 1000);
      });
    },

    /**
     * Clear all uploaded files in iframe
     */
    clearFiles() {
      if (this.isInitialized) {
        this.sendMessageToIframe({
          type: 'CLEAR_FILES'
        });
        this.uploadedFiles = [];
      }
    },

    /**
     * Set upload context and notify iframe
     * @param {string} context - Upload context: 'comment' or 'message'
     */
    setUploadContext(context) {
      this.uploadContext = context;
      if (this.isInitialized) {
        this.sendMessageToIframe({
          type: 'SET_CONTEXT',
          data: {
            uploadContext: context
          }
        });
      }
    },

    /**
     * Destroy iframe and clean up
     */
    destroy() {
      // Remove message listener
      if (this.messageHandler) {
        window.removeEventListener('message', this.messageHandler);
        this.messageHandler = null;
      }

      // Remove iframe
      if (this.iframe) {
        this.iframe.remove();
        this.iframe = null;
      }

      // Reset state
      this.uploadedFiles = [];
      this.isInitialized = false;
      this.pendingFilesCallback = null;
      this.uploadCallbacks.clear();
    }
  };

  // ============================================================================
  // TINYMCE EMAIL MODAL
  // ============================================================================

  const EmailModal = {
    currentEditor: null,
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    resizeHandle: null,
    currentTab: 'comment',  // Track active tab
    uploadContext: 'comment',  // Track upload context: 'comment' or 'message'
    lastFocusedInput: null,  // Track last focused input for variable insertion
    lastCursorPosition: { start: 0, end: 0 },  // Track cursor position

    open() {
      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'email-modal-backdrop';
      backdrop.className = 'modal-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'email-modal';
      modal.className = 'base-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const title = document.createElement('h3');
      title.textContent = 'Send Email to Selected Students';

      // Close button on the right
      const closeBtn = document.createElement('button');
      closeBtn.className = 'Button Button--small Button--secondary';
      closeBtn.innerHTML = '✖ Close';
      closeBtn.addEventListener('click', () => this.close());

      header.append(title, closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'modal-body';

      // Tab Navigation
      const tabsContainer = document.createElement('div');
      tabsContainer.id = 'email-tabs';
      tabsContainer.innerHTML = `
        <button class="email-tab-btn active" data-tab="comment">
        💬 Add Submission Comment
        </button>
        <button class="email-tab-btn" data-tab="message">
         📧 Send Inbox Message
        </button>
      `;

      // Tab Content Container
      const tabContentContainer = document.createElement('div');
      tabContentContainer.id = 'email-tab-content-container';

      // === COMMENT TAB CONTENT ===
      const commentTabContent = document.createElement('div');
      commentTabContent.id = 'email-tab-content-comment';
      commentTabContent.className = 'active';

      // Variable tray for Comment tab
      const commentVariableTray = this.createVariableTray();

      // Email subject
      const subjectLabel = document.createElement('label');
      subjectLabel.textContent = 'Subject:';
      subjectLabel.className = 'email-subject-label';

      const subjectInput = document.createElement('input');
      subjectInput.type = 'text';
      subjectInput.id = 'email-subject';
      subjectInput.className = 'ic-Input';
      subjectInput.placeholder = 'Email subject';

      // Email body label
      const bodyLabel = document.createElement('label');
      bodyLabel.textContent = 'Message:';
      bodyLabel.className = 'email-body-label';

      // Comment Library button container
      const commentLibraryContainer = document.createElement('div');
      commentLibraryContainer.className = 'comment-library-container';

      const commentLibraryBtn = document.createElement('button');
      commentLibraryBtn.className = 'Button Button--secondary';
      commentLibraryBtn.innerHTML = '<i class="icon-bookmark" aria-hidden="true"></i> Comment Library';
      commentLibraryBtn.addEventListener('click', () => CommentLibraryModal.open());

      commentLibraryContainer.appendChild(commentLibraryBtn);

      // Add to Comment Library button
      const addToLibraryBtn = document.createElement('button');
      addToLibraryBtn.className = 'Button Button--secondary';
      addToLibraryBtn.innerHTML = '<i class="icon-add" aria-hidden="true"></i> Add to Comment Library';
      addToLibraryBtn.addEventListener('click', () => this.handleAddToCommentLibrary());

      commentLibraryContainer.appendChild(addToLibraryBtn);

      // TinyMCE textarea
      const tinymce_iframe = document.createElement('iframe');
      tinymce_iframe.id = 'tinymce-iframe';
      tinymce_iframe.src = chrome.runtime.getURL('tinymce.html');
      tinymce_iframe.setAttribute('scrolling', 'no');
      tinymce_iframe.setAttribute('allow', 'fullscreen');
      tinymce_iframe.setAttribute('allowfullscreen', '');

      commentTabContent.append(commentVariableTray, bodyLabel, commentLibraryContainer, tinymce_iframe);

      // === MESSAGE TAB CONTENT ===
      const messageTabContent = document.createElement('div');
      messageTabContent.id = 'email-tab-content-message';

      // Variable tray for Message tab
      const messageVariableTray = this.createVariableTray();

      // Message subject
      const messageSubjectLabel = document.createElement('label');
      messageSubjectLabel.className = 'email-subject-label';
      messageSubjectLabel.textContent = 'Subject:';

      const messageSubject = document.createElement('input');
      messageSubject.type = 'text';
      messageSubject.id = 'message-subject';
      messageSubject.className = 'ic-Input';
      messageSubject.placeholder = 'Enter message subject...';

      // Message body
      const messageBodyLabel = document.createElement('label');
      messageBodyLabel.className = 'email-body-label';
      messageBodyLabel.textContent = 'Message:';

      const messageBody = document.createElement('textarea');
      messageBody.id = 'message-body';
      messageBody.className = 'ic-Input';
      messageBody.placeholder = 'Enter your message (plain text only)...';
      messageBody.rows = 10;

      messageTabContent.append(messageVariableTray, messageSubjectLabel, messageSubject, messageBodyLabel, messageBody);

      // Assemble tabs
      tabContentContainer.append(commentTabContent, messageTabContent);

      // === SHARED FILE UPLOAD SECTION (outside tabs) ===
      const fileUploadLabel = document.createElement('label');
      fileUploadLabel.textContent = 'Attachments:';
      fileUploadLabel.className = 'email-attachments-label';

      const fileUploadContainer = document.createElement('div');
      fileUploadContainer.id = 'file-upload-container';

      body.append(tabsContainer, tabContentContainer, fileUploadLabel, fileUploadContainer);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'modal-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'Button Button--secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.close());

      const submitBtn = document.createElement('button');
      submitBtn.id = 'email-submit-btn';
      submitBtn.className = 'Button Button--primary';
      submitBtn.innerHTML = '<i class="icon-comment" aria-hidden="true"></i> Add Comment';
      submitBtn.addEventListener('click', () => {
        if (this.currentTab === 'comment') {
          this.handleAddComment();
        } else if (this.currentTab === 'message') {
          this.handleSendMessage();
        }
      });

      //const debugBtn = document.createElement('button');
      //debugBtn.className = 'Button Button--secondary';
     // debugBtn.innerHTML = '<i class="icon-code" aria-hidden="true"></i> Show HTML (Debug)';
      //debugBtn.addEventListener('click', () => this.handleSubmit());

      footer.append(cancelBtn, submitBtn);

      // Create resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.id = 'email-modal-resize-handle';

      // Add resize event listeners
      resizeHandle.addEventListener('mousedown', (e) => this.initResize(e));
      
      // Assemble modal
      modal.append(header, body, footer, resizeHandle);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Store reference to resize handle
      this.resizeHandle = resizeHandle;

      // Initialize email tabs
      this.initializeEmailTabs();

      // Listen for TinyMCE autoresize events
      this.tinymceResizeListener = (event) => {
        if (event.data?.type === 'EDITOR_RESIZED') {
          const iframe = document.getElementById('tinymce-iframe');
          if (iframe && event.data.height) {
            // Update iframe height to match TinyMCE container height
            iframe.style.height = event.data.height + 'px';
            console.log(`TinyMCE iframe resized to: ${event.data.height}px`);
          }
        }
      };
      window.addEventListener('message', this.tinymceResizeListener);

      // Initialize FilePond after modal is fully rendered and visible
      setTimeout(async () => {
        console.log('Initializing FilePond...');

        // Get user ID for message uploads
        const userId = await API.getUserId();

        FileUploadManager.initialize(this.uploadContext, userId);
      }, 1000); // Delay to ensure modal is fully rendered
    },

    // Initialize tab click handlers
    initializeEmailTabs() {
      const tabButtons = document.querySelectorAll('.email-tab-btn');
      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          const tabName = button.dataset.tab;
          this.switchEmailTab(tabName);
        });
      });

      // Initialize cursor tracking for variable insertion
      this.initCursorTracking();
    },

    // Switch between tabs
    switchEmailTab(tabName) {
      if (tabName === this.currentTab) return;

      // Update button active class
      document.querySelectorAll('.email-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });

      // Hide current tab content
      const currentContent = document.getElementById(`email-tab-content-${this.currentTab}`);
      if (currentContent) currentContent.classList.remove('active');

      // Show new tab content
      const newContent = document.getElementById(`email-tab-content-${tabName}`);
      if (newContent) newContent.classList.add('active');

      // Update current tab
      this.currentTab = tabName;

      // Update upload context
      this.uploadContext = tabName; // 'comment' or 'message'

      // Notify FileUploadManager of context change
      FileUploadManager.setUploadContext(this.uploadContext);

      // Update submit button text
      const submitBtn = document.getElementById('email-submit-btn');
      if (submitBtn) {
        if (tabName === 'comment') {
          submitBtn.innerHTML = '<i class="icon-comment" aria-hidden="true"></i> Add Comment';
        } else if (tabName === 'message') {
          submitBtn.innerHTML = '<i class="icon-email" aria-hidden="true"></i> Send Message';
        }
      }

    },

    // Create the variable tray UI component
    createVariableTray() {
      const tray = document.createElement('div');
      tray.className = 'variable-tray';

      // Header
      const header = document.createElement('div');
      header.className = 'variable-tray-header';
      header.innerHTML = `
        <span class="variable-tray-title">📝 Insert Variable</span>
        <span class="variable-tray-hint">(click to insert • hover Due Date for modifiers)</span>
      `;

      // Chips container
      const chips = document.createElement('div');
      chips.className = 'variable-tray-chips';

      TEMPLATE_VARIABLES.forEach(variable => {
        const chip = document.createElement('span');
        chip.className = 'variable-chip';
        chip.dataset.var = `{{${variable.key}}}`;
        chip.textContent = variable.label;

        // Add tooltip for due_date variable to explain modifiers
        if (variable.key === 'due_date') {
          chip.title = 'Click to insert {{due_date}}\n\nModifiers:\n• Add "day." prefix for day of week: {{day.due_date}}\n• Add ".time" suffix for time: {{due_date.time}}\n• Combine both: {{day.due_date.time}}';
        }

        // Click to insert at cursor
        chip.addEventListener('click', () => {
          this.insertVariableAtCursor(`{{${variable.key}}}`);
        });

        chips.appendChild(chip);
      });

      tray.append(header, chips);
      return tray;
    },

    // Initialize cursor position tracking for input fields
    initCursorTracking() {
      const inputs = ['email-subject', 'message-subject', 'message-body'];

      inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          // Track cursor position when field loses focus
          el.addEventListener('blur', (e) => {
            this.lastFocusedInput = e.target;
            this.lastCursorPosition = {
              start: e.target.selectionStart,
              end: e.target.selectionEnd
            };
          });

          // Also track on keyup and mouseup for better accuracy
          el.addEventListener('keyup', (e) => {
            if (document.activeElement === e.target) {
              this.lastFocusedInput = e.target;
              this.lastCursorPosition = {
                start: e.target.selectionStart,
                end: e.target.selectionEnd
              };
            }
          });

          el.addEventListener('mouseup', (e) => {
            if (document.activeElement === e.target) {
              this.lastFocusedInput = e.target;
              this.lastCursorPosition = {
                start: e.target.selectionStart,
                end: e.target.selectionEnd
              };
            }
          });

          // Track focus event to know which field is active
          el.addEventListener('focus', (e) => {
            this.lastFocusedInput = e.target;
            this.lastCursorPosition = {
              start: e.target.selectionStart,
              end: e.target.selectionEnd
            };
          });
        }
      });

      // Track when TinyMCE iframe gets focus
      const tinymceIframe = document.getElementById('tinymce-iframe');
      if (tinymceIframe) {
        // When iframe is clicked, clear lastFocusedInput so we default to TinyMCE
        tinymceIframe.addEventListener('mousedown', () => {
          console.log('TinyMCE iframe clicked - clearing lastFocusedInput');
          this.lastFocusedInput = null; // Clear so we default to TinyMCE
        });
      }
    },

    // Insert variable at cursor position
    insertVariableAtCursor(varText) {
      // Check if TinyMCE editor is active (Comment tab)
      if (this.currentTab === 'comment') {
        const subjectInput = document.getElementById('email-subject');

        // Check if subject input currently has focus (not lastFocused, but active now)
        if (subjectInput && document.activeElement === subjectInput) {
          this.insertIntoInput(subjectInput, varText);
          return;
        }

        // Otherwise insert into TinyMCE via postMessage
        const iframe = document.getElementById('tinymce-iframe');
        if (!iframe) {
          console.error('TinyMCE iframe not found');
          return;
        }

        console.log('Sending INSERT_CONTENT to TinyMCE:', varText);
        iframe.contentWindow.postMessage({
          type: 'INSERT_CONTENT',
          content: varText
        }, '*');
        return;
      }

      // Insert into plain text field (Message tab)
      const messageSubject = document.getElementById('message-subject');
      const messageBody = document.getElementById('message-body');

      // First check if either field currently has focus
      if (document.activeElement === messageSubject) {
        console.log('Inserting into message subject (currently focused)');
        this.insertIntoInput(messageSubject, varText);
      } else if (document.activeElement === messageBody) {
        console.log('Inserting into message body (currently focused)');
        this.insertIntoInput(messageBody, varText);
      } else if (this.lastFocusedInput &&
          (this.lastFocusedInput.id === 'message-subject' ||
           this.lastFocusedInput.id === 'message-body')) {
        // Fall back to last focused if nothing is currently focused
        console.log('Inserting into last focused:', this.lastFocusedInput.id);
        this.insertIntoInput(this.lastFocusedInput, varText);
      } else {
        // Default to message body if no field was ever focused
        console.log('Defaulting to message body');
        if (messageBody) {
          this.insertIntoInput(messageBody, varText);
        }
      }
    },

    // Helper to insert text into an input/textarea at cursor position
    insertIntoInput(el, text) {
      const val = el.value;
      const start = this.lastCursorPosition.start;
      const end = this.lastCursorPosition.end;

      el.value = val.slice(0, start) + text + val.slice(end);
      el.focus();

      const newPos = start + text.length;
      el.setSelectionRange(newPos, newPos);

      // Update tracked position
      this.lastCursorPosition = { start: newPos, end: newPos };
    },

    // Replace template variables with actual values from row data
    replaceVariables(template, rowData) {
      let result = template;

      TEMPLATE_VARIABLES.forEach(variable => {
        // Handle date variables with modifiers (e.g., {{day.due_date.time}})
        if (variable.isDate && variable.dataKey === 'assignment_duedate') {
          const value = rowData[variable.dataKey];
          if (!value) {
            // Replace all variants with empty string
            result = result.replace(/\{\{(day\.)?due_date(\.time)?\}\}/g, '');
            return;
          }

          // Find all instances of this date variable with modifiers
          const dateRegex = /\{\{(day\.)?due_date(\.time)?\}\}/g;
          result = result.replace(dateRegex, (_match, hasDay, hasTime) => {
            // Build format string based on modifiers
            // hasDay = "day." prefix present
            // hasTime = ".time" suffix present

            let format = '';

            if (hasDay && hasTime) {
              // {{day.due_date.time}} -> Thursday, January 22, 2026 at 11:59 PM
              format = 'dddd, MMMM D, YYYY [at] h:mm A';
            } else if (hasDay && !hasTime) {
              // {{day.due_date}} -> Thursday, January 22, 2026
              format = 'dddd, MMMM D, YYYY';
            } else if (!hasDay && hasTime) {
              // {{due_date.time}} -> January 22, 2026 at 11:59 PM
              format = 'MMMM D, YYYY [at] h:mm A';
            } else {
              // {{due_date}} -> January 22, 2026
              format = 'MMMM D, YYYY';
            }

            // Format using moment.js
            // Note: Moment.js will automatically use Canvas locale if set
            // Day names (dddd) and month names (MMMM) will be localized
            return moment(value).format(format);
          });
        } else {
          // Handle regular variables
          const placeholder = `{{${variable.key}}}`;
          let value = rowData[variable.dataKey] || '';

          // Replace all occurrences
          result = result.split(placeholder).join(value);
        }
      });

      return result;
    },

    initResize(e) {
      this.isResizing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;

      const modal = document.getElementById('email-modal');
      this.startWidth = parseInt(window.getComputedStyle(modal).width, 10);
      this.startHeight = parseInt(window.getComputedStyle(modal).height, 10);
      
      // Add global event listeners
      document.addEventListener('mousemove', (e) => this.doResize(e));
      document.addEventListener('mouseup', () => this.stopResize());
      
      e.preventDefault();
    },

    doResize(e) {
      if (!this.isResizing) return;
      
      const modal = document.getElementById('email-modal');
      const newWidth = this.startWidth + e.clientX - this.startX;
      const newHeight = this.startHeight + e.clientY - this.startY;
      
      // Apply minimum size constraints
      const minWidth = 400;
      const minHeight = 300;
      
      if (newWidth > minWidth) {
        modal.style.width = newWidth + 'px';
      }
      
      if (newHeight > minHeight) {
        modal.style.height = newHeight + 'px';
      }
    },

    async handleAddToCommentLibrary() {
      try {
        // Get TinyMCE content
        const iframe = document.getElementById('tinymce-iframe');
        if (!iframe) {
          alert('Error: Editor not found');
          return;
        }

        // Request content from TinyMCE iframe
        iframe.contentWindow.postMessage({ type: "GET_CONTENT" }, "*");

        // Wait for content response
        const content = await new Promise((resolve) => {
          const handleMessage = (e) => {
            if (e.data?.type === "TMCE_CONTENT") {
              window.removeEventListener("message", handleMessage);
              resolve(e.data.content);
            }
          };
          window.addEventListener("message", handleMessage);
          
          // Timeout after 5 seconds
          setTimeout(() => {
            window.removeEventListener("message", handleMessage);
            resolve(null);
          }, 5000);
        });

        if (!content || content.trim() === '') {
          alert('Please enter a comment before saving to library.');
          return;
        }

        // Process content to handle HTML formatting for Canvas comment bank API
        // Minify HTML by removing newlines and extra whitespace between tags
        // This prevents API from treating whitespace as literal newlines
        const processedContent = content
          .replace(/>\s+</g, '><')  // Remove whitespace between tags
          .replace(/\n/g, '')  // Remove all newlines
          .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
          .trim();  // Remove leading/trailing spaces

        // Open Save to Comment Library modal with processed content
        SaveToCommentLibraryModal.open(processedContent);
      } catch (error) {
        console.error('Error in handleAddToCommentLibrary:', error);
        alert('An error occurred while preparing to save comment. Please try again.');
      }
    },

    stopResize() {
      this.isResizing = false;
      
      // Remove global event listeners
      document.removeEventListener('mousemove', (e) => this.doResize(e));
      document.removeEventListener('mouseup', () => this.stopResize());
    },

    handleSubmit() {
  

      const htmlContent = document.getElementById("tinymce-iframe").contentWindow.postMessage({ type: "GET_CONTENT" }, "*");

      window.addEventListener("message", (e) => {
        if (e.data?.type === "TMCE_CONTENT") {
          console.log("TinyMCE HTML:", e.data.content);
      
          // 👉 Here is where you would:
          // - insert into Canvas RCE
          // - save to storage
          // - send to background script
        }
      });
      
      const selectedRows = ModalState.tables.missing.rows({ selected: true }).data().toArray();
      console.log('Selected rows:', selectedRows);
    },

    async handleAddComment() {
      try {
        // Get TinyMCE content
        const iframe = document.getElementById('tinymce-iframe');
        if (!iframe) {
          alert('Error: Editor not found');
          return;
        }

        // Request content from TinyMCE iframe
        iframe.contentWindow.postMessage({ type: "GET_CONTENT" }, "*");

        // Wait for content response
        const content = await new Promise((resolve) => {
          const handleMessage = (e) => {
            if (e.data?.type === "TMCE_CONTENT") {
              window.removeEventListener("message", handleMessage);
              resolve(e.data.content);
            }
          };
          window.addEventListener("message", handleMessage);
          
          // Timeout after 5 seconds
          setTimeout(() => {
            window.removeEventListener("message", handleMessage);
            resolve(null);
          }, 5000);
        });

        if (!content || content.trim() === '') {
          alert('Please enter a comment before adding.');
          return;
        }

        // Get selected rows
        const selectedRows = ModalState.tables.missing.rows({ selected: true }).data().toArray();
        
        if (selectedRows.length === 0) {
          alert('Please select at least one student to add comments to.');
          return;
        }

        // Show confirmation dialog
        await this.showConfirmationDialog(selectedRows, content);
      } catch (error) {
        console.error('Error in handleAddComment:', error);
        alert('An error occurred while preparing to add comments. Please try again.');
      }
    },

    async handleSendMessage() {
      try {
        // Get form data
        const subject = document.getElementById('message-subject')?.value.trim();
        const body = document.getElementById('message-body')?.value.trim();

        // Validation
        if (!subject) {
          alert('Please enter a subject');
          return;
        }

        if (!body) {
          alert('Please enter a message body');
          return;
        }

        // Get selected students from DataTable
        const selectedRows = ModalState.tables.missing.rows({ selected: true }).data().toArray();
        if (selectedRows.length === 0) {
          alert('Please select at least one student');
          return;
        }

        // Get uploaded files from FileUploadManager (already uploaded to /files/pending)
        const uploadedFiles = await FileUploadManager.getFiles();

        // Show confirmation dialog
        await this.showMessageConfirmationDialog(selectedRows, subject, body, uploadedFiles);
      } catch (error) {
        console.error('Error in handleSendMessage:', error);
        alert('An error occurred while preparing to send message. Please try again.');
      }
    },

    // Helper function to get file type icon based on file extension
    getFileIcon(filename) {
      if (!filename) return 'icon-document';

      const ext = filename.split('.').pop().toLowerCase();
      const iconMap = {
        // Documents
        'pdf': 'icon-pdf',
        'doc': 'icon-ms-word',
        'docx': 'icon-ms-word',
        'txt': 'icon-document',
        'rtf': 'icon-document',

        // Spreadsheets
        'xls': 'icon-ms-excel',
        'xlsx': 'icon-ms-excel',
        'csv': 'icon-ms-excel',

        // Presentations
        'ppt': 'icon-ms-ppt',
        'pptx': 'icon-ms-ppt',

        // Images
        'jpg': 'icon-image',
        'jpeg': 'icon-image',
        'png': 'icon-image',
        'gif': 'icon-image',
        'svg': 'icon-image',
        'bmp': 'icon-image',

        // Video
        'mp4': 'icon-video',
        'mov': 'icon-video',
        'avi': 'icon-video',
        'wmv': 'icon-video',

        // Audio
        'mp3': 'icon-audio',
        'wav': 'icon-audio',
        'm4a': 'icon-audio',

        // Archives
        'zip': 'icon-folder',
        'rar': 'icon-folder',
        '7z': 'icon-folder',

        // Code
        'html': 'icon-code',
        'css': 'icon-code',
        'js': 'icon-code',
        'py': 'icon-code',
        'java': 'icon-code',
        'cpp': 'icon-code',
        'c': 'icon-code',
      };

      return iconMap[ext] || 'icon-document';
    },

    async showMessageConfirmationDialog(selectedRows, subject, body, uploadedFiles) {
      // Create backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'confirmation-backdrop';
      backdrop.className = 'modal-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'confirmation-modal';
      modal.className = 'base-modal modal-md';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const title = document.createElement('h3');
      title.textContent = `Confirm Send Message to ${selectedRows.length} Student${selectedRows.length > 1 ? 's' : ''}`;

      // Close button on the right
      const closeBtn = document.createElement('button');
      closeBtn.className = 'Button Button--small Button--secondary';
      closeBtn.innerHTML = '✖ Close';
      closeBtn.addEventListener('click', () => this.closeConfirmationDialog());

      header.append(title, closeBtn);

      // Body
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'modal-body';

      // Check if variables are present
      const hasVariables = TEMPLATE_VARIABLES.some(v =>
        subject.includes(`{{${v.key}}}`) || body.includes(`{{${v.key}}}`)
      );

      // Variable preview notice at the top (if applicable)
      if (hasVariables && selectedRows.length > 0) {
        const variableNote = document.createElement('div');
        variableNote.className = 'notice-box notice-box-warning';
        variableNote.innerHTML = `📝 Preview showing personalized content for <strong>${selectedRows[0].stdname}</strong>. Each student will receive their own personalized message.`;
        bodyDiv.appendChild(variableNote);
      }

      // Subject preview
      const subjectLabel = document.createElement('div');
      subjectLabel.textContent = 'Subject:';
      subjectLabel.className = 'confirmation-comment-label';

      const subjectPreview = document.createElement('div');
      subjectPreview.className = 'confirmation-comment-preview';

      // If variables exist, show preview with first student's data
      if (hasVariables && selectedRows.length > 0) {
        const previewSubject = this.replaceVariables(subject, selectedRows[0]);
        subjectPreview.textContent = previewSubject;
      } else {
        subjectPreview.textContent = subject;
      }

      // Message preview
      const messageLabel = document.createElement('div');
      messageLabel.textContent = 'Message:';
      messageLabel.className = 'confirmation-comment-label';
      messageLabel.style.marginTop = '16px';

      const messagePreview = document.createElement('div');
      messagePreview.className = 'confirmation-comment-preview';

      if (hasVariables && selectedRows.length > 0) {
        const previewBody = this.replaceVariables(body, selectedRows[0]);
        messagePreview.textContent = previewBody;
      } else {
        messagePreview.textContent = body;
      }

      // Student list
      const studentsLabel = document.createElement('div');
      studentsLabel.textContent = `Student${selectedRows.length > 1 ? 's' : ''} who will receive this message:`;
      studentsLabel.className = 'confirmation-students-label';

      const studentsList = document.createElement('div');
      studentsList.className = 'students-list';

      selectedRows.forEach((row, index) => {
        const studentItem = document.createElement('div');
        studentItem.className = 'student-item';
        if (index === selectedRows.length - 1) {
          studentItem.style.borderBottom = 'none';
        }

        const studentName = document.createElement('div');
        studentName.textContent = row.stdname;
        studentName.className = 'student-name';

        const courseName = document.createElement('div');
        courseName.textContent = `Course: ${row.coursename}`;
        courseName.className = 'student-course';

        studentItem.append(studentName, courseName);
        studentsList.appendChild(studentItem);
      });

      // File attachments section (match Comment modal styling)
      const fileListSection = document.createElement('div');
      fileListSection.className = 'file-list-section';

      const filesLabel = document.createElement('div');
      filesLabel.textContent = 'Files to be attached:';
      filesLabel.className = 'confirmation-files-label';

      const filesList = document.createElement('div');
      filesList.className = 'file-list-container';

      if (uploadedFiles && uploadedFiles.length > 0) {
        uploadedFiles.forEach(file => {
          const fileItem = document.createElement('div');
          fileItem.className = 'file-item';

          // Get file icon
          const iconClass = this.getFileIcon(file.filename || file.name);

          // Calculate file size
          const fileSize = file.fileSize || file.size || 0;
          const fileSizeKB = (fileSize / 1024).toFixed(2);

          fileItem.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="${iconClass}" aria-hidden="true" style="color: #666;"></i>
              <div style="flex: 1;">
                <div style="font-weight: 500;">${file.filename || file.name}</div>
                <div style="color: #666; font-size: 12px;">${fileSizeKB} KB</div>
              </div>
            </div>
          `;
          filesList.appendChild(fileItem);
        });
      } else {
        const noFiles = document.createElement('div');
        noFiles.textContent = 'No files attached';
        noFiles.className = 'no-files';
        filesList.appendChild(noFiles);
      }

      fileListSection.append(filesLabel, filesList);

      bodyDiv.append(subjectLabel, subjectPreview, messageLabel, messagePreview, studentsLabel, studentsList, fileListSection);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'modal-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'Button Button--secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.closeConfirmationDialog());

      const sendBtn = document.createElement('button');
      sendBtn.className = 'Button Button--primary';
      sendBtn.innerHTML = '<i class="icon-email" aria-hidden="true"></i> Send Message';
      sendBtn.addEventListener('click', () => {
        this.closeConfirmationDialog();
        this.submitMessages(selectedRows, subject, body, uploadedFiles);
      });

      footer.append(cancelBtn, sendBtn);

      // Assemble modal
      modal.append(header, bodyDiv, footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Store reference for cleanup
      this.confirmationBackdrop = backdrop;
    },

    async submitMessages(selectedRows, subject, body, uploadedFiles) {
      // Create progress modal
      const progressModal = this.createMessageProgressModal(selectedRows);

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      try {
        // Upload files first if there are any
        const fileIds = [];
        if (uploadedFiles.length > 0) {
          // Update all students to show file upload progress
          selectedRows.forEach((row, index) => {
            this.updateStudentProgress(index, 'processing', 10);
          });

          console.log(`Uploading ${uploadedFiles.length} file(s) for message...`);

          for (let j = 0; j < uploadedFiles.length; j++) {
            const file = uploadedFiles[j];

            try {
              // Update progress for file upload
              const uploadProgress = 10 + (j * 40 / uploadedFiles.length);
              selectedRows.forEach((row, index) => {
                this.updateStudentProgress(index, 'processing', uploadProgress);
              });

              console.log(`Uploading file: ${file.filename || file.name}`);

              // Upload file to /files/pending (context is already set to 'message')
              // For message uploads, we don't need courseId, assignmentId, userId
              const uploadResult = await FileUploadManager.uploadFile({
                fileIndex: j,
                studentIndex: 0, // Use 0 since this is shared across all students
                onProgress: (progressInfo) => {
                  if (progressInfo.progress) {
                    const baseProgress = 10 + (j * 40 / uploadedFiles.length);
                    const fileProgress = (progressInfo.progress / 100) * (40 / uploadedFiles.length);
                    selectedRows.forEach((row, index) => {
                      this.updateStudentProgress(index, 'processing', baseProgress + fileProgress);
                    });
                  }
                }
              });

              // Extract file ID from upload result
              if (uploadResult && uploadResult.id) {
                fileIds.push(uploadResult.id);
                console.log(`File uploaded successfully with ID: ${uploadResult.id}`);
              } else {
                console.warn('File upload did not return an ID:', uploadResult);
              }
            } catch (error) {
              console.error(`Error uploading file ${file.filename || file.name}:`, error);

              // Mark all students as error
              selectedRows.forEach((row, index) => {
                this.updateStudentProgress(index, 'error', 0, `File upload failed: ${error.message || 'Unknown error'}`);
              });

              // Show completion button with error
              const closeButton = document.getElementById('progress-close-btn');
              if (closeButton) {
                closeButton.style.display = 'block';
                closeButton.addEventListener('click', () => {
                  const backdrop = document.getElementById('progress-backdrop');
                  if (backdrop) backdrop.remove();
                });
              }

              return; // Stop execution
            }
          }

          console.log(`All files uploaded. File IDs: ${fileIds.join(', ')}`);
        }

        // Check if message contains variables that need personalization
        const hasVariables = TEMPLATE_VARIABLES.some(v =>
          subject.includes(`{{${v.key}}}`) || body.includes(`{{${v.key}}}`)
        );

        if (hasVariables) {
          // Send individual personalized messages
          for (let i = 0; i < selectedRows.length; i++) {
            const row = selectedRows[i];
            this.updateStudentProgress(i, 'processing', 60);

            try {
              // Replace variables with actual values for this student
              const personalizedSubject = this.replaceVariables(subject, row);
              const personalizedBody = this.replaceVariables(body, row);

              await this.sendConversation(
                [row.user_id],
                personalizedSubject,
                personalizedBody,
                fileIds,
                `course_${row.course_id}`
              );

              this.updateStudentProgress(i, 'success', 100);
              successCount++;
            } catch (error) {
              console.error(`Error sending message to ${row.stdname}:`, error);
              const errorMsg = error.message || 'Unknown error';
              this.updateStudentProgress(i, 'error', 100, errorMsg);
              errorCount++;
              errors.push({
                student: row.stdname,
                course: row.coursename,
                error: errorMsg
              });
            }

            // Small delay between requests
            if (i < selectedRows.length - 1) {
              await Utils.delay(200);
            }
          }
        } else {
          // No variables - use original batch approach (one message per course)
          const studentsByCourse = {};
          selectedRows.forEach((row, index) => {
            const courseId = row.course_id;
            if (!studentsByCourse[courseId]) {
              studentsByCourse[courseId] = {
                courseName: row.coursename,
                students: []
              };
            }
            studentsByCourse[courseId].students.push({ ...row, index });
          });

          for (const [courseId, courseData] of Object.entries(studentsByCourse)) {
            const students = courseData.students;

            students.forEach(s => {
              this.updateStudentProgress(s.index, 'processing', 60);
            });

            try {
              await this.sendConversation(
                students.map(s => s.user_id),
                subject,
                body,
                fileIds,
                `course_${courseId}`
              );

              students.forEach(s => {
                this.updateStudentProgress(s.index, 'success', 100);
                successCount++;
              });
            } catch (error) {
              console.error(`Error sending message to course ${courseId}:`, error);
              const errorMsg = error.message || 'Unknown error';

              students.forEach(s => {
                this.updateStudentProgress(s.index, 'error', 100, errorMsg);
                errorCount++;
                errors.push({
                  student: s.stdname,
                  course: courseData.courseName,
                  error: errorMsg
                });
              });
            }
          }
        }

        // Show completion buttons
        const closeButton = document.getElementById('progress-close-btn');
        const viewSentLink = document.getElementById('view-sent-messages-link');

        // Show View Sent Messages link if at least one message was sent successfully
        if (viewSentLink && successCount > 0) {
          viewSentLink.style.display = 'inline-block';
        }

        if (closeButton) {
          closeButton.style.display = 'block';
          closeButton.addEventListener('click', () => {
            const backdrop = document.getElementById('progress-backdrop');
            if (backdrop) backdrop.remove();

            // Close email modal if all successful
            if (errorCount === 0) {
              this.close();
            }
          });
        }

      } catch (error) {
        console.error('Error in submitMessages:', error);
        alert('An unexpected error occurred while sending messages. Please try again.');
      }
    },

    async sendConversation(recipientIds, subject, body, attachmentIds, contextCode) {
      const url = `${window.location.origin}/api/v1/conversations`;

      // Build form data
      const formData = new FormData();

      // Add recipients (array)
      recipientIds.forEach(id => {
        formData.append('recipients[]', id);
      });

      formData.append('subject', subject);
      formData.append('body', body);
      formData.append('context_code', contextCode);
      formData.append('group_conversation', 'false'); // Individual messages

      // Add attachments if any
      if (attachmentIds && attachmentIds.length > 0) {
        attachmentIds.forEach(id => {
          formData.append('attachment_ids[]', id);
        });
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': Utils.getCSRFToken()
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Failed to send message: ${response.statusText}`);
      }

      return await response.json();
    },

    createMessageProgressModal(selectedRows) {
      // Store reference to current students for progress updates
      this.currentStudents = selectedRows;

      const backdrop = document.createElement('div');
      backdrop.id = 'progress-backdrop';

      const modal = document.createElement('div');
      modal.id = 'progress-modal';

      const title = document.createElement('h3');
      title.textContent = `Sending Messages to ${selectedRows.length} Student${selectedRows.length > 1 ? 's' : ''}...`;
      title.className = 'progress-modal-title';

      // Create scrollable container for student cards
      const studentsContainer = document.createElement('div');
      studentsContainer.id = 'students-progress-container';

      // Create a card for each student
      selectedRows.forEach((student, index) => {
        const studentCard = this.createStudentCard(student, index);
        studentsContainer.appendChild(studentCard);
      });

      // Overall progress section
      const overallProgress = document.createElement('div');
      overallProgress.id = 'overall-progress';

      const progressText = document.createElement('div');
      progressText.id = 'overall-progress-text';
      progressText.textContent = `Processing: 0 of ${selectedRows.length}`;

      // Create button container for better layout
      const buttonContainer = document.createElement('div');
      buttonContainer.style.display = 'flex';
      buttonContainer.style.gap = '12px';
      buttonContainer.style.alignItems = 'center';

      // View Sent Messages link
      const viewSentLink = document.createElement('a');
      viewSentLink.id = 'view-sent-messages-link';
      viewSentLink.href = '/conversations#filter=type=sent';
      viewSentLink.target = '_blank';
      viewSentLink.className = 'Button Button--secondary';
      viewSentLink.innerHTML = '<i class="icon-email" aria-hidden="true"></i> View Sent Messages';
      viewSentLink.style.display = 'none';
      viewSentLink.style.textDecoration = 'none';

      const closeButton = document.createElement('button');
      closeButton.id = 'progress-close-btn';
      closeButton.className = 'Button Button--primary';
      closeButton.textContent = 'Close';
      closeButton.style.display = 'none';

      buttonContainer.append(viewSentLink, closeButton);
      overallProgress.append(progressText, buttonContainer);

      modal.append(title, studentsContainer, overallProgress);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      return modal;
    },

    async showConfirmationDialog(selectedRows, commentContent) {
      // Create backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'confirmation-backdrop';
      backdrop.className = 'modal-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'confirmation-modal';
      modal.className = 'base-modal modal-md';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const title = document.createElement('h3');
      title.textContent = `Confirm Add Comment to ${selectedRows.length} Student${selectedRows.length > 1 ? 's' : ''}`;

      // Close button on the right
      const closeBtn = document.createElement('button');
      closeBtn.className = 'Button Button--small Button--secondary';
      closeBtn.innerHTML = '✖ Close';
      closeBtn.addEventListener('click', () => this.closeConfirmationDialog());

      header.append(title, closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'modal-body';

      // Check if variables are present in comment
      const hasVariables = TEMPLATE_VARIABLES.some(v =>
        commentContent.includes(`{{${v.key}}}`)
      );

      // Variable preview notice at the top (if applicable)
      if (hasVariables && selectedRows.length > 0) {
        const variableNote = document.createElement('div');
        variableNote.className = 'notice-box notice-box-warning';
        variableNote.innerHTML = `📝 Preview showing personalized content for <strong>${selectedRows[0].stdname}</strong>. Each student will receive their own personalized comment.`;
        body.appendChild(variableNote);
      }

      // Comment preview
      const commentLabel = document.createElement('div');
      commentLabel.textContent = 'Comment to be added:';
      commentLabel.className = 'confirmation-comment-label';

      const commentPreview = document.createElement('div');
      commentPreview.className = 'confirmation-comment-preview';

      // If variables exist, show preview with first student's data
      if (hasVariables && selectedRows.length > 0) {
        const previewComment = this.replaceVariables(commentContent, selectedRows[0]);
        commentPreview.innerHTML = previewComment;
      } else {
        commentPreview.innerHTML = commentContent;
      }

      // Student list
      const studentsLabel = document.createElement('div');
      studentsLabel.textContent = `Student${selectedRows.length > 1 ? 's' : ''} who will receive this comment:`;
      studentsLabel.className = 'confirmation-students-label';

      const studentsList = document.createElement('div');
      studentsList.className = 'students-list';

      selectedRows.forEach((row, index) => {
        const studentItem = document.createElement('div');
        studentItem.className = 'student-item';
        if (index === selectedRows.length - 1) {
          studentItem.style.borderBottom = 'none';
        }

        const studentName = document.createElement('div');
        studentName.textContent = row.stdname;
        studentName.className = 'student-name';

        const courseName = document.createElement('div');
        courseName.textContent = `Course: ${row.coursename}`;
        courseName.className = 'student-course';

        const assignmentName = document.createElement('div');
        assignmentName.textContent = `Assignment: ${row.assignment_name}`;
        assignmentName.className = 'student-assignment';

        const dueDate = document.createElement('div');
        dueDate.textContent = `Due: ${moment(row.assignment_duedate).format('YYYY-MM-DD HH:mm')}`;
        dueDate.className = 'student-due-date';

        studentItem.append(studentName, courseName, assignmentName, dueDate);
        studentsList.appendChild(studentItem);
      });

      // File list section
      const fileListSection = document.createElement('div');
      fileListSection.className = 'file-list-section';

      const fileListLabel = document.createElement('div');
      fileListLabel.textContent = 'Files to be attached:';
      fileListLabel.className = 'confirmation-files-label';

      const fileListContainer = document.createElement('div');
      fileListContainer.id = 'confirmation-files-list';
      fileListContainer.className = 'file-list-container';

      // Get uploaded files from FileUploadManager
      const uploadedFiles = await FileUploadManager.getFiles();

      if (uploadedFiles.length > 0) {
        uploadedFiles.forEach(file => {
          const fileItem = document.createElement('div');
          fileItem.className = 'file-item';

          // Get file icon
          const iconClass = this.getFileIcon(file.filename);

          fileItem.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="${iconClass}" aria-hidden="true" style="color: #666;"></i>
              <div style="flex: 1;">
                <div style="font-weight: 500;">${file.filename}</div>
                <div style="color: #666; font-size: 12px;">${(file.fileSize / 1024).toFixed(2)} KB</div>
              </div>
            </div>
          `;
          fileListContainer.appendChild(fileItem);
        });
      } else {
        const noFiles = document.createElement('div');
        noFiles.textContent = 'No files attached';
        noFiles.className = 'no-files';
        fileListContainer.appendChild(noFiles);
      }

      fileListSection.appendChild(fileListLabel);
      fileListSection.appendChild(fileListContainer);

      body.append(commentLabel, commentPreview, studentsLabel, studentsList, fileListSection);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'modal-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'Button Button--secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.closeConfirmationDialog());

      const sendBtn = document.createElement('button');
      sendBtn.className = 'Button Button--primary';
      sendBtn.innerHTML = '<i class="icon-send" aria-hidden="true"></i> Send';
      sendBtn.addEventListener('click', () => {
        this.closeConfirmationDialog();
        this.submitComments(selectedRows, commentContent);
      });

      footer.append(cancelBtn, sendBtn);

      // Assemble modal
      modal.append(header, body, footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Store reference for cleanup
      this.confirmationBackdrop = backdrop;
    },

    closeConfirmationDialog() {
      const backdrop = document.getElementById('confirmation-backdrop');
      if (backdrop) {
        backdrop.remove();
      }
      this.confirmationBackdrop = null;
    },

    async submitComments(selectedRows, commentContent) {
      // Create progress modal with individual student cards
      const progressModal = this.createProgressModal(selectedRows);
      
      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      
      // Get uploaded files from FileUploadManager
      const uploadedFiles = await FileUploadManager.getFiles();

      try {
        // Process each submission separately with individual file uploads
        for (let i = 0; i < selectedRows.length; i++) {
          const row = selectedRows[i];
          const fileIds = [];
          
          // Update student to processing state
          this.updateStudentProgress(i, 'processing', 10);
          
          try {
            // Upload files for this specific student
            if (uploadedFiles.length > 0) {
              this.updateStudentProgress(i, 'processing', 25);

              for (let j = 0; j < uploadedFiles.length; j++) {
                const file = uploadedFiles[j];

                try {
                  // Update progress for file upload
                  this.updateStudentProgress(i, 'processing', 25 + (j * 50 / uploadedFiles.length));

                  // Upload file for this specific student via iframe
                  const uploadResult = await FileUploadManager.uploadFile({
                    courseId: row.course_id,
                    assignmentId: row.assignment_id,
                    userId: row.user_id,
                    fileIndex: j, // Index of file in FilePond
                    studentIndex: i,
                    onProgress: (progressInfo) => {
                      // Update progress based on file upload
                      if (progressInfo.progress) {
                        const baseProgress = 25 + (j * 50 / uploadedFiles.length);
                        const fileProgress = (progressInfo.progress / 100) * (50 / uploadedFiles.length);
                        this.updateStudentProgress(i, 'processing', baseProgress + fileProgress);
                      }
                    }
                  });

                  // Extract file ID from upload result
                  if (uploadResult && uploadResult.id) {
                    fileIds.push(uploadResult.id);
                  }
                } catch (error) {
                  console.error(`Error uploading file ${file.filename} for ${row.stdname}:`, error);
                  throw new Error(`Failed to upload ${file.filename}: ${error.message || 'Unknown error'}`);
                }
              }
            }
            
            // Update progress before adding comment
            this.updateStudentProgress(i, 'processing', 75);

            // Replace variables with actual values for this student
            const personalizedComment = this.replaceVariables(commentContent, row);

            // Add comment with uploaded file IDs
            await this.addCommentToSubmission(
              row.course_id,
              row.assignment_id,
              row.user_id,
              personalizedComment,
              fileIds
            );
            
            // Update student to success state
            this.updateStudentProgress(i, 'success', 100);
            successCount++;
          } catch (error) {
            // Update student to error state
            this.updateStudentProgress(i, 'error', 0, error.message || 'Unknown error');
            errorCount++;
            errors.push({
              student: row.stdname,
              course: row.coursename,
              assignment: row.assignment_name,
              error: error.message || 'Unknown error'
            });
            console.error(`Error adding comment for ${row.stdname}:`, error);
          }
          
          // Small delay between requests to avoid overwhelming the API
          if (i < selectedRows.length - 1) {
            await Utils.delay(200);
          }
        }
      } finally {
        // Update overall progress to show completion
        this.updateOverallProgress();
        
        // Show results after a delay to let users see the final state
        setTimeout(() => {
          
          // Add results to the footer of the progress modal
          this.addResultsToProgressFooter(successCount, errorCount, errors);
          
          // If all successful, close the email modal
          if (errorCount === 0) {
            setTimeout(() => this.close(), 2000);
          }
        }, 2000); // 2 second delay to show final state
      }
    },

    addResultsToProgressFooter(successCount, errorCount, errors) {
      const overallProgress = document.getElementById('overall-progress');
      if (!overallProgress) return;
      
      // Clear existing content
      overallProgress.innerHTML = '';
      
      // Create results section
      const resultsSection = document.createElement('div');
      Object.assign(resultsSection.style, {
        marginTop: '12px',
        padding: '12px',
        borderTop: '1px solid #e0e0e0',
        backgroundColor: '#f9f9f9',
        borderRadius: '4px'
      });
      
      // Success message
      const successMsg = document.createElement('div');
      successMsg.textContent = `Successfully added comments to ${successCount} student${successCount !== 1 ? 's' : ''}.`;
      successMsg.style.color = '#2e7d32';
      successMsg.style.fontWeight = '600';
      successMsg.style.marginBottom = '8px';
      
      resultsSection.appendChild(successMsg);
      
      // Error details if any
      if (errorCount > 0) {
        const errorMsg = document.createElement('div');
        errorMsg.textContent = `Failed to add comments to ${errorCount} student${errorCount !== 1 ? 's' : ''}:`;
        errorMsg.style.color = '#d32f2f';
        errorMsg.style.fontWeight = '600';
        errorMsg.style.marginBottom = '8px';
        
        resultsSection.appendChild(errorMsg);
        
        const errorList = document.createElement('div');
        Object.assign(errorList.style, {
          background: '#ffebee',
          border: '1px solid #ffcdd2',
          borderRadius: '4px',
          padding: '8px',
          maxHeight: '150px',
          overflowY: 'auto',
          fontSize: '12px'
        });
        
        errors.forEach(error => {
          const errorItem = document.createElement('div');
          errorItem.style.marginBottom = '4px';
          errorItem.innerHTML = `
            <strong>${error.student}</strong> - ${error.course}<br>
            <small>${error.error}</small>
          `;
          errorList.appendChild(errorItem);
        });
        
        resultsSection.appendChild(errorList);
      }
      
      // Close button
      const closeButton = document.createElement('button');
      closeButton.className = 'Button Button--primary';
      closeButton.textContent = 'Close';
      closeButton.style.marginTop = '12px';
      closeButton.addEventListener('click', () => {
        const backdrop = document.getElementById('progress-backdrop');
        if (backdrop) {
          backdrop.remove();
        }
      });
      
      resultsSection.appendChild(closeButton);
      overallProgress.appendChild(resultsSection);
    },

    createStudentCard(student, index) {
      const card = document.createElement('div');
      card.className = 'student-progress-card';
      card.id = `student-card-${index}`;
      Object.assign(card.style, {
        border: '1px solid #e0e0e0',
        borderRadius: '6px',
        padding: '16px',
        marginBottom: '12px',
        backgroundColor: '#fafafa',
        transition: 'all 0.3s ease'
      });

      // Student info section
      const infoSection = document.createElement('div');
      Object.assign(infoSection.style, {
        marginBottom: '12px'
      });

      const studentName = document.createElement('div');
      studentName.textContent = `Student Name: ${student.stdname}`;
      studentName.style.fontWeight = '600';
      studentName.style.marginBottom = '4px';

      const courseName = document.createElement('div');
      courseName.textContent = `Course: ${student.coursename}`;
      courseName.style.fontSize = '14px';
      courseName.style.color = '#666';
      courseName.style.marginBottom = '4px';

      const assignmentName = document.createElement('div');
      assignmentName.textContent = `Assignment: ${student.assignment_name}`;
      assignmentName.style.fontSize = '14px';
      assignmentName.style.color = '#666';
      assignmentName.style.marginBottom = '4px';

      const dueDate = document.createElement('div');
      dueDate.textContent = `Due: ${moment(student.assignment_duedate).format('YYYY-MM-DD HH:mm')}`;
      dueDate.style.fontSize = '14px';
      dueDate.style.color = '#666';

      infoSection.append(studentName, courseName, assignmentName, dueDate);

      // Progress bar section
      const progressSection = document.createElement('div');
      Object.assign(progressSection.style, {
        marginBottom: '8px'
      });

      const progressBarContainer = document.createElement('div');
      Object.assign(progressBarContainer.style, {
        width: '100%',
        height: '8px',
        backgroundColor: '#e0e0e0',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '4px'
      });

      const progressBarFill = document.createElement('div');
      progressBarFill.className = 'progress-fill';
      progressBarFill.id = `progress-fill-${index}`;
      Object.assign(progressBarFill.style, {
        height: '100%',
        width: '0%',
        backgroundColor: '#2a7ae2',
        transition: 'width 0.3s ease'
      });

      progressBarContainer.appendChild(progressBarFill);
      progressSection.appendChild(progressBarContainer);

      // Status section
      const statusSection = document.createElement('div');
      statusSection.id = `status-section-${index}`;
      Object.assign(statusSection.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      });

      const statusText = document.createElement('div');
      statusText.id = `status-text-${index}`;
      statusText.textContent = 'Waiting...';
      statusText.style.fontSize = '14px';
      statusText.style.color = '#666';

      const actionContainer = document.createElement('div');
      actionContainer.id = `action-container-${index}`;
      actionContainer.style.display = 'none';

      statusSection.append(statusText, actionContainer);

      card.append(infoSection, progressSection, statusSection);
      return card;
    },

    generateSpeedGraderUrl(courseId, assignmentId, studentId) {
      return `${window.location.origin}/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${studentId}`;
    },

    updateStudentProgress(studentIndex, status, progress = null, error = null) {
      const card = document.getElementById(`student-card-${studentIndex}`);
      if (!card) return;

      const progressFill = document.getElementById(`progress-fill-${studentIndex}`);
      const statusText = document.getElementById(`status-text-${studentIndex}`);
      const actionContainer = document.getElementById(`action-container-${studentIndex}`);
      const statusSection = document.getElementById(`status-section-${studentIndex}`);

      if (!progressFill || !statusText || !actionContainer || !statusSection) return;

      // Update progress bar if provided
      if (progress !== null) {
        progressFill.style.width = `${progress}%`;
      }

      // Update status based on status type
      switch (status) {
        case 'processing':
          statusText.textContent = 'Processing...';
          statusText.style.color = '#666';
          card.style.backgroundColor = '#fafafa';
          progressFill.style.backgroundColor = '#2a7ae2';
          actionContainer.style.display = 'none';
          break;

        case 'success':
          statusText.innerHTML = '✅ Comment added';
          statusText.style.color = '#2e7d32';
          card.style.backgroundColor = '#e8f5e8';
          progressFill.style.backgroundColor = '#4caf50';
          progressFill.style.width = '100%';
          
          // Add SpeedGrader link
          actionContainer.innerHTML = '';
          actionContainer.style.display = 'block';
          
          const speedGraderLink = document.createElement('a');
          speedGraderLink.href = this.generateSpeedGraderUrl(
            this.currentStudents[studentIndex].course_id,
            this.currentStudents[studentIndex].assignment_id,
            this.currentStudents[studentIndex].user_id
          );
          speedGraderLink.textContent = '🔗 Open in SpeedGrader';
          speedGraderLink.target = '_blank';
          speedGraderLink.className = 'Button Button--small Button--secondary';
          speedGraderLink.style.textDecoration = 'none';
          
          actionContainer.appendChild(speedGraderLink);
          break;

        case 'error':
          statusText.innerHTML = `❌ Failed: ${error}`;
          statusText.style.color = '#d32f2f';
          card.style.backgroundColor = '#ffebee';
          progressFill.style.backgroundColor = '#f44336';
          actionContainer.style.display = 'none';
          break;
      }

      // Update overall progress
      this.updateOverallProgress();
    },

    updateOverallProgress() {
      const totalStudents = this.currentStudents.length;
      
      // Count students in different states
      let successCount = 0;
      let errorCount = 0;
      let processedCount = 0;
      
      for (let i = 0; i < totalStudents; i++) {
        const statusText = document.getElementById(`status-text-${i}`);
        if (statusText) {
          const text = statusText.textContent;
          if (text.includes('✅ Comment added')) {
            successCount++;
            processedCount++;
          } else if (text.includes('❌ Failed')) {
            errorCount++;
            processedCount++;
          } else if (text.includes('Processing...')) {
            processedCount++;
          }
        }
      }
      
      const progressText = document.getElementById('overall-progress-text');
      const closeButton = document.getElementById('progress-close-btn');
      
      if (progressText) {
        if (processedCount === totalStudents) {
          progressText.textContent = `Completed: ${successCount} successful, ${errorCount} failed`;
          closeButton.style.display = 'block';
        } else {
          progressText.textContent = `Processing: ${processedCount} of ${totalStudents}`;
        }
      }
    },

    createProgressModal(selectedRows) {
      // Store reference to current students for progress updates
      this.currentStudents = selectedRows;

      const backdrop = document.createElement('div');
      backdrop.id = 'progress-backdrop';

      const modal = document.createElement('div');
      modal.id = 'progress-modal';

      const title = document.createElement('h3');
      title.textContent = `Adding Comments to ${selectedRows.length} Student${selectedRows.length > 1 ? 's' : ''}...`;
      title.className = 'progress-modal-title';

      // Create scrollable container for student cards
      const studentsContainer = document.createElement('div');
      studentsContainer.id = 'students-progress-container';

      // Create a card for each student
      selectedRows.forEach((student, index) => {
        const studentCard = this.createStudentCard(student, index);
        studentsContainer.appendChild(studentCard);
      });

      // Overall progress indicator
      const overallProgress = document.createElement('div');
      overallProgress.id = 'overall-progress';

      const progressText = document.createElement('div');
      progressText.id = 'overall-progress-text';
      progressText.textContent = 'Starting...';

      const closeButton = document.createElement('button');
      closeButton.className = 'Button Button--secondary';
      closeButton.textContent = 'Close';
      closeButton.id = 'progress-close-btn';
      closeButton.addEventListener('click', () => {
        backdrop.remove();
      });

      overallProgress.appendChild(progressText);
      overallProgress.appendChild(closeButton);

      modal.append(title, studentsContainer, overallProgress);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      return backdrop;
    },


    showSubmissionResults(successCount, errorCount, errors) {
      const backdrop = document.createElement('div');
      backdrop.id = 'results-backdrop';

      const modal = document.createElement('div');
      modal.className = 'base-modal';
      modal.style.maxWidth = '500px';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const title = document.createElement('h3');
      title.textContent = 'Comment Submission Results';
      title.style.margin = '0';
      title.style.flex = '1';

      // Close button on the right
      const closeBtn = document.createElement('button');
      closeBtn.className = 'Button Button--small Button--secondary';
      closeBtn.innerHTML = '✖ Close';
      closeBtn.addEventListener('click', () => {
        backdrop.remove();
      });

      header.append(title, closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'modal-body';

      // Success message
      const successMsg = document.createElement('div');
      successMsg.textContent = `Successfully added comments to ${successCount} student${successCount !== 1 ? 's' : ''}.`;
      successMsg.className = 'success-message';

      body.appendChild(successMsg);

      // Error details if any
      if (errorCount > 0) {
        const errorMsg = document.createElement('div');
        errorMsg.textContent = `Failed to add comments to ${errorCount} student${errorCount !== 1 ? 's' : ''}:`;
        errorMsg.className = 'error-message';

        body.appendChild(errorMsg);

        const errorList = document.createElement('div');
        errorList.className = 'error-list-container';

        errors.forEach(error => {
          const errorItem = document.createElement('div');
          errorItem.className = 'error-item';
          errorItem.innerHTML = `
            <strong>${error.student}</strong> - ${error.course}<br>
            <small>${error.error}</small>
          `;
          errorList.appendChild(errorItem);
        });

        body.appendChild(errorList);
      }

      // Assemble modal
      modal.append(header, body);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
    },

    async addCommentToSubmission(courseId, assignmentId, userId, commentText, fileIds = []) {
      const url = `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`;
      
      // Create form data for Canvas API
      const formData = new FormData();
      formData.append('comment[text_comment]', commentText);
      
      // Add file IDs if any
      fileIds.forEach(fileId => {
        formData.append('comment[file_ids][]', fileId);
      });
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-CSRF-Token': Utils.getCSRFToken()
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    },

    close() {
      // Close any open confirmation dialog
      this.closeConfirmationDialog();
      
      // Close Save to Comment Library modal if open
      SaveToCommentLibraryModal.close();
      
      // Destroy FilePond
      FileUploadManager.destroy();
      
      // Destroy TinyMCE
      if (this.currentEditor) {
        tinymce.remove('#email-body');
        this.currentEditor = null;
      }

      // Clean up resize event listeners
      if (this.isResizing) {
        this.stopResize();
      }

      // Remove TinyMCE resize listener
      if (this.tinymceResizeListener) {
        window.removeEventListener('message', this.tinymceResizeListener);
        this.tinymceResizeListener = null;
      }

      // Remove modal
      const backdrop = document.getElementById('email-modal-backdrop');
      if (backdrop) {
        backdrop.remove();
      }

      // Clear resize handle reference
      this.resizeHandle = null;

      // Reset current tab and upload context to default
      this.currentTab = 'comment';
      this.uploadContext = 'comment';
    }
  };

  // ============================================================================
  // SAVE TO COMMENT LIBRARY API
  // ============================================================================

  const SaveToCommentLibraryAPI = {
    /**
     * Fetch user courses for comment library saving
     */
    async fetchUserCourses() {
      try {
        const result = await API.graphqlRequest(CommentLibraryQueries.UserCoursesQuery);
        const courses = result?.data?.allCourses || [];
        
        // Filter out demo courses
        return courses.filter(course => !CONFIG.DEMO_COURSE_PATTERN.test(course.name));
      } catch (error) {
        console.error('Error fetching user courses:', error);
        throw error;
      }
    },

    /**
     * Save comment to comment library for specific course
     */
    async saveCommentToLibrary(comment, courseId) {
      try {
        const result = await API.graphqlRequest(
          CommentLibraryQueries.CreateCommentBankItemMutation,
          {
            comment: comment,
            courseId: courseId
          }
        );

        // Check for errors in the response
        if (result?.data?.createCommentBankItem?.errors?.length > 0) {
          const errors = result.data.createCommentBankItem.errors;
          throw new Error(errors.map(e => e.message).join(', '));
        }

        return result?.data?.createCommentBankItem?.commentBankItem;
      } catch (error) {
        console.error('Error saving comment to library:', error);
        throw error;
      }
    }
  };

  // ============================================================================
  // COMMENT LIBRARY API FETCHER
  // ============================================================================

  const CommentLibraryAPI = {
    /**
     * Get current user ID using the same pattern as content.js
     */
    async getUserId() {
      // Try Canvas ENV first (faster)
      if (typeof ENV !== 'undefined' && ENV.current_user?.id) {
        return ENV.current_user.id;
      }
      
      // Fallback to API
      try {
        const res = await fetch('/api/v1/users/self', {
          method: 'GET',
          headers: { "X-CSRF-Token": Utils.getCSRFToken() }
        });
        const data = await res.json();
        return data.id;
      } catch (error) {
        console.error('Failed to get user ID:', error);
        return null;
      }
    },

    /**
     * Fetch comment bank items for the current user
     */
    async fetchCommentBankItems(searchQuery = '') {
      try {
        // Get current user ID
        const userId = await this.getUserId();
        if (!userId) {
          throw new Error('User ID not found in Canvas environment');
        }

        // Replace user_id placeholder in the query
        const query = CommentLibraryQueries.SpeedGrader_CommentBankItemQuery
          .replace('user_id', userId);

        // Make GraphQL request
        const result = await API.graphqlRequest(query, {
          query: searchQuery
        });

        const commentBankItems = result?.data?.legacyNode?.commentBankItemsConnection?.nodes || [];
        
        return commentBankItems.map(item => ({
          comment: item.comment,
          createdAt: item.createdAt,
          id: item.createdAt // Use createdAt as unique identifier
        }));
      } catch (error) {
        console.error('Error fetching comment bank items:', error);
        throw error;
      }
    }
  };

  // ============================================================================
  // SAVE TO COMMENT LIBRARY MODAL
  // ============================================================================

  const SaveToCommentLibraryModal = {
    isOpen: false,
    courses: [],
    filteredCourses: [],
    selectedCourse: null,
    commentContent: '',
    searchTimeout: null,
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,

    async open(commentContent) {
      if (this.isOpen) return;
      
      this.isOpen = true;
      this.courses = [];
      this.filteredCourses = [];
      this.selectedCourse = null;
      this.commentContent = commentContent;

      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'save-to-library-backdrop';
      backdrop.className = 'modal-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'save-to-library-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const title = document.createElement('h3');
      title.textContent = 'Save to Comment Library';
      title.style.margin = '0';
      title.style.flex = '1';

      // Close button on the right
      const closeBtn = document.createElement('button');
      closeBtn.className = 'Button Button--small Button--secondary';
      closeBtn.innerHTML = '✖ Close';
      closeBtn.addEventListener('click', () => this.close());

      header.append(title, closeBtn);

      // Comment preview section (fixed at top)
      const commentSection = document.createElement('div');
      commentSection.className = 'save-comment-section';

      const commentLabel = document.createElement('div');
      commentLabel.className = 'save-comment-label';
      commentLabel.textContent = 'Comment to save:';

      // Helper function to display newlines visually and show HTML tags as text
      const escapeAndFormatText = (text) => {
        // Convert HTML tags and escape sequences to visible text
        const escaped = text
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/\"/g, '"');
        
        // Convert newlines to visual breaks for display
        return escaped.replace(/\n/g, '<br>');
      };

      // Helper function to count visual lines in text
      const countVisualLines = (text) => {
        // Create temporary element with same styles as preview
        const temp = document.createElement('div');
        Object.assign(temp.style, {
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          width: '100%', // Use full width of container
          fontSize: '14px', // Standard font size
          fontFamily: 'Arial, sans-serif', // Standard font family
          lineHeight: '1.4',
          padding: '12px' // Match the preview padding
        });
        
        temp.innerHTML = escapeAndFormatText(text);
        document.body.appendChild(temp);
        
        const lineHeight = 14 * 1.4; // fontSize * lineHeight
        const lines = Math.ceil(temp.scrollHeight / lineHeight);
        
        document.body.removeChild(temp);
        return lines;
      };

      // Check if text needs truncation based on visual lines
      const lineCount = countVisualLines(commentContent);
      const needsTruncation = lineCount > 5;

      // Comment preview
      const commentPreview = document.createElement('div');
      commentPreview.className = 'comment-preview';
      
      let previewText = commentContent;
      if (needsTruncation) {
        // Find approximate truncation point by binary search for efficiency
        let min = 0;
        let max = commentContent.length;
        let bestLength = max;
        
        while (min <= max) {
          const mid = Math.floor((min + max) / 2);
          const testText = commentContent.substring(0, mid);
          const testLines = countVisualLines(testText);
          
          if (testLines <= 5) {
            bestLength = mid;
            min = mid + 1;
          } else {
            max = mid - 1;
          }
        }
        
        previewText = commentContent.substring(0, bestLength) + '...';
      }
      
      commentPreview.innerHTML = escapeAndFormatText(previewText);
      commentPreview.className = 'save-comment-preview';

      // Expand/Collapse button
      const expandBtn = document.createElement('button');
      expandBtn.className = 'Button Button--small Button--link save-expand-btn';
      if (!needsTruncation) {
        expandBtn.classList.add('hidden');
      }
      expandBtn.textContent = needsTruncation ? 'Show more' : '';

      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'full-comment-backdrop';

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'full-comment-modal';

        // Header
        const header = document.createElement('div');
        header.className = 'modal-header';

        const title = document.createElement('h3');
        title.textContent = 'Full Comment';
        title.style.margin = '0';
        title.style.flex = '1';

        // Close button on the right
        const closeBtn = document.createElement('button');
        closeBtn.className = 'Button Button--small Button--secondary';
        closeBtn.innerHTML = '✖ Close';
        closeBtn.addEventListener('click', () => {
          backdrop.remove();
        });

        header.append(title, closeBtn);

        // Body
        const body = document.createElement('div');
        body.className = 'modal-body';

        // Helper function to display newlines visually and show HTML tags as text
        const escapeAndFormatText = (text) => {
          // Convert HTML tags and escape sequences to visible text
          const escaped = text
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/\"/g, '"');
          
          // Convert newlines to visual breaks for display
          return escaped.replace(/\n/g, '<br>');
        };

        body.innerHTML = escapeAndFormatText(commentContent);

        // Assemble modal
        modal.append(header, body);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) {
            backdrop.remove();
          }
        });
      });

      // Course selection label (fixed at top)
      const courseLabel = document.createElement('div');
      courseLabel.className = 'save-course-label';
      courseLabel.textContent = 'Select course:';

      commentSection.append(commentLabel, commentPreview, expandBtn, courseLabel);

      // Search bar container (fixed at top, matching Comment Library modal)
      const searchContainer = document.createElement('div');
      searchContainer.className = 'save-search-container';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'course-search-input';
      searchInput.className = 'ic-Input';
      searchInput.placeholder = 'Search courses...';

      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.filterCourses(e.target.value);
        }, 300);
      });

      searchContainer.appendChild(searchInput);

      // Courses list (scrollable area)
      const coursesContainer = document.createElement('div');
      coursesContainer.id = 'courses-list-container';

      // Loading indicator
      const loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'courses-loading';
      loadingIndicator.innerHTML = '<i class="icon-progress" aria-hidden="true"></i> Loading courses...';

      coursesContainer.appendChild(loadingIndicator);

      // Body container (no overflow, children manage their own scrolling)
      const body = document.createElement('div');
      body.className = 'save-body-container';

      body.append(commentSection, searchContainer, coursesContainer);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'save-footer';

      const selectedInfo = document.createElement('div');
      selectedInfo.id = 'selected-course-info';
      selectedInfo.textContent = 'No course selected';

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'save-button-container';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'Button Button--secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.close());

      const saveBtn = document.createElement('button');
      saveBtn.id = 'save-comment-btn';
      saveBtn.className = 'Button Button--primary';
      saveBtn.innerHTML = '<i class="icon-bookmark" aria-hidden="true"></i> Save Comment to Library';
      saveBtn.disabled = true;
      saveBtn.addEventListener('click', () => this.saveComment());

      buttonContainer.append(cancelBtn, saveBtn);
      footer.append(selectedInfo, buttonContainer);

      // Create resize handle (matching Comment Library modal)
      const resizeHandle = document.createElement('div');
      resizeHandle.id = 'save-to-library-resize-handle';

      // Add resize event listeners
      resizeHandle.addEventListener('mousedown', (e) => this.initResize(e));

      // Assemble modal
      modal.append(header, body, footer, resizeHandle);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Store reference
      this.backdrop = backdrop;
      this.modal = modal;
      this.coursesContainer = coursesContainer;
      this.saveBtn = saveBtn;
      this.selectedInfo = selectedInfo;

      // Focus search input
      setTimeout(() => searchInput.focus(), 100);

      // Load courses
      await this.loadCourses();
    },

    async loadCourses() {
      try {
        this.courses = await SaveToCommentLibraryAPI.fetchUserCourses();
        this.filteredCourses = [...this.courses];
        this.renderCourses();
      } catch (error) {
        console.error('Error loading courses:', error);
        this.showError('Failed to load courses. Please try again.');
      }
    },

    renderCourses() {
      const container = document.getElementById('courses-list-container');
      if (!container) return;

      container.innerHTML = '';

      if (this.filteredCourses.length === 0) {
        const noCourses = document.createElement('div');
        noCourses.textContent = this.courses.length === 0
          ? 'No courses found.'
          : 'No courses match your search.';
        noCourses.style.textAlign = 'center';
        noCourses.style.padding = '20px';
        noCourses.style.color = '#666';
        container.appendChild(noCourses);
        return;
      }

      this.filteredCourses.forEach((course) => {
        const courseItem = document.createElement('div');
        courseItem.className = 'course-item';
        courseItem.dataset.courseId = course._id;
        
        Object.assign(courseItem.style, {
          border: '1px solid #e0e0e0',
          borderRadius: '4px',
          marginBottom: '12px',
          padding: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          position: 'relative'
        });

        // Selection indicator (round blue indicator like Comment Library)
        const selectionIndicator = document.createElement('div');
        selectionIndicator.className = 'selection-indicator';
        Object.assign(selectionIndicator.style, {
          position: 'absolute',
          top: '8px',
          right: '8px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          border: '2px solid #ccc',
          backgroundColor: '#fff',
          display: 'none'
        });

        // Course name
        const courseName = document.createElement('div');
        courseName.textContent = course.courseNickname || course.name;
        courseName.style.fontWeight = '600';
        courseName.style.marginBottom = '4px';

        // Course code
        if (course.courseCode) {
          const courseCode = document.createElement('div');
          courseCode.textContent = `Code: ${course.courseCode}`;
          courseCode.style.fontSize = '12px';
          courseCode.style.color = '#666';
          courseCode.style.marginBottom = '4px';
          courseName.appendChild(courseCode);
        }

        // Course nickname (if different from name)
        if (course.courseNickname && course.courseNickname !== course.name) {
          const nickname = document.createElement('div');
          nickname.textContent = `Nickname: ${course.courseNickname}`;
          nickname.style.fontSize = '12px';
          nickname.style.color = '#666';
          nickname.style.fontStyle = 'italic';
          courseName.appendChild(nickname);
        }

        courseItem.appendChild(courseName);
        courseItem.appendChild(selectionIndicator);

        // Click handler
        courseItem.addEventListener('click', () => {
          this.selectCourse(course, courseItem);
        });

        // Hover effects (matching Comment Library modal)
        courseItem.addEventListener('mouseenter', () => {
          courseItem.style.backgroundColor = '#f5f5f5';
          courseItem.style.borderColor = '#2a7ae2';
        });

        courseItem.addEventListener('mouseleave', () => {
          if (!courseItem.classList.contains('selected')) {
            courseItem.style.backgroundColor = '#fff';
            courseItem.style.borderColor = '#e0e0e0';
          }
        });

        container.appendChild(courseItem);
      });
    },

    selectCourse(course, element) {
      // Remove previous selection
      document.querySelectorAll('.course-item').forEach(item => {
        item.classList.remove('selected');
        item.style.backgroundColor = '#fff';
        item.style.borderColor = '#e0e0e0';
        const indicator = item.querySelector('.selection-indicator');
        if (indicator) {
          indicator.style.display = 'none';
          indicator.style.backgroundColor = '#fff';
        }
      });

      // Add selection to current item
      element.classList.add('selected');
      element.style.backgroundColor = '#e3f2fd';
      element.style.borderColor = '#2a7ae2';
      
      // Show selection indicator
      const indicator = element.querySelector('.selection-indicator');
      if (indicator) {
        indicator.style.display = 'block';
        indicator.style.backgroundColor = '#2a7ae2';
      }

      // Update selected course
      this.selectedCourse = course;

      // Update selected info
      if (this.selectedInfo) {
        this.selectedInfo.textContent = `Selected: ${course.courseNickname || course.name}`;
      }

      // Enable save button
      if (this.saveBtn) {
        this.saveBtn.disabled = false;
      }
    },

    filterCourses(searchQuery) {
      if (!searchQuery.trim()) {
        this.filteredCourses = [...this.courses];
      } else {
        const query = searchQuery.toLowerCase();
        this.filteredCourses = this.courses.filter(course =>
          (course.name && course.name.toLowerCase().includes(query)) ||
          (course.courseNickname && course.courseNickname.toLowerCase().includes(query)) ||
          (course.courseCode && course.courseCode.toLowerCase().includes(query))
        );
      }
      this.renderCourses();
    },

    async saveComment() {
      if (!this.selectedCourse) {
        alert('Please select a course.');
        return;
      }

      if (!this.commentContent || this.commentContent.trim() === '') {
        alert('Comment cannot be empty.');
        return;
      }

      try {
        // Disable save button
        if (this.saveBtn) {
          this.saveBtn.disabled = true;
          this.saveBtn.innerHTML = '<i class="icon-progress" aria-hidden="true"></i> Saving...';
        }

        await SaveToCommentLibraryAPI.saveCommentToLibrary(
          this.commentContent,
          this.selectedCourse._id
        );

        // Show success message
        this.showSuccess();

        // Close modal after delay
        setTimeout(() => this.close(), 2000);
      } catch (error) {
        console.error('Error saving comment:', error);
        alert(`Failed to save comment: ${error.message}`);
      } finally {
        // Restore save button
        if (this.saveBtn) {
          this.saveBtn.disabled = false;
          this.saveBtn.innerHTML = '<i class="icon-bookmark" aria-hidden="true"></i> Save Comment to Library';
        }
      }
    },

    showSuccess() {
      const container = document.getElementById('courses-list-container');
      if (!container) return;

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #2e7d32;">
          <i class="icon-check" aria-hidden="true" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
          <h3 style="margin: 0 0 8px 0;">Comment Saved Successfully!</h3>
          <p style="margin: 0; color: #666;">The comment has been added to your comment library for ${this.selectedCourse.courseNickname || this.selectedCourse.name}.</p>
        </div>
      `;
    },

    showError(message) {
      const container = document.getElementById('courses-list-container');
      if (!container) return;

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #d32f2f;">
          <i class="icon-warning" aria-hidden="true"></i>
          <p>${message}</p>
        </div>
      `;
    },

    initResize(e) {
      this.isResizing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      
      this.startWidth = parseInt(window.getComputedStyle(this.modal).width, 10);
      this.startHeight = parseInt(window.getComputedStyle(this.modal).height, 10);
      
      // Add global event listeners
      document.addEventListener('mousemove', (e) => this.doResize(e));
      document.addEventListener('mouseup', () => this.stopResize());
      
      e.preventDefault();
    },

    doResize(e) {
      if (!this.isResizing) return;
      
      const newWidth = this.startWidth + e.clientX - this.startX;
      const newHeight = this.startHeight + e.clientY - this.startY;
      
      // Apply minimum size constraints
      const minWidth = 400;
      const minHeight = 300;
      
      if (newWidth > minWidth) {
        this.modal.style.width = newWidth + 'px';
      }
      
      if (newHeight > minHeight) {
        this.modal.style.height = newHeight + 'px';
      }
    },

    stopResize() {
      this.isResizing = false;
      
      // Remove global event listeners
      document.removeEventListener('mousemove', (e) => this.doResize(e));
      document.removeEventListener('mouseup', () => this.stopResize());
    },

    close() {
      if (!this.isOpen) return;
      
      // Clear search timeout
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }
      
      // Clean up resize event listeners
      if (this.isResizing) {
        this.stopResize();
      }
      
      // Remove modal
      if (this.backdrop) {
        this.backdrop.remove();
      }
      
      // Reset state
      this.isOpen = false;
      this.courses = [];
      this.filteredCourses = [];
      this.selectedCourse = null;
      this.commentContent = '';
      this.backdrop = null;
      this.modal = null;
      this.coursesContainer = null;
      this.saveBtn = null;
      this.selectedInfo = null;
    }
  };

  // ============================================================================
  // COMMENT LIBRARY MODAL
  // ============================================================================

  const CommentLibraryModal = {
    isOpen: false,
    comments: [],
    filteredComments: [],
    selectedComment: null,
    searchTimeout: null,
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,

    async open() {
      if (this.isOpen) return;
      
      this.isOpen = true;
      this.comments = [];
      this.filteredComments = [];
      this.selectedComment = null;

      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'comment-library-backdrop';
      backdrop.className = 'modal-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'comment-library-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const title = document.createElement('h3');
      title.textContent = 'Comment Library';
      title.style.margin = '0';
      title.style.flex = '1';

      // Close button on the right
      const closeBtn = document.createElement('button');
      closeBtn.className = 'Button Button--small Button--secondary';
      closeBtn.innerHTML = '✖ Close';
      closeBtn.addEventListener('click', () => this.close());

      header.append(title, closeBtn);

      // Search bar
      const searchContainer = document.createElement('div');
      searchContainer.className = 'comment-library-search-container';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'comment-library-search';
      searchInput.className = 'ic-Input';
      searchInput.placeholder = 'Search comments...';

      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.filterComments(e.target.value);
        }, 300);
      });

      searchContainer.appendChild(searchInput);

      // Comments list
      const commentsContainer = document.createElement('div');
      commentsContainer.id = 'comments-container';

      // Loading indicator
      const loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'comments-loading';
      loadingIndicator.innerHTML = '<i class="icon-progress" aria-hidden="true"></i> Loading comments...';

      commentsContainer.appendChild(loadingIndicator);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'comment-library-footer';

      const selectedInfo = document.createElement('div');
      selectedInfo.id = 'selected-info';
      selectedInfo.textContent = 'No comment selected';

      const useCommentBtn = document.createElement('button');
      useCommentBtn.id = 'use-comment-btn';
      useCommentBtn.className = 'Button Button--primary';
      useCommentBtn.textContent = 'Use Comment';
      useCommentBtn.disabled = true;
      useCommentBtn.addEventListener('click', () => this.useSelectedComment());

      footer.append(selectedInfo, useCommentBtn);

      // Create resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.id = 'comment-library-resize-handle';

      // Add resize event listeners
      resizeHandle.addEventListener('mousedown', (e) => this.initResize(e));

      // Assemble modal
      modal.append(header, searchContainer, commentsContainer, footer, resizeHandle);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Store reference
      this.backdrop = backdrop;
      this.modal = modal;

      // Focus search input
      setTimeout(() => searchInput.focus(), 100);

      // Load comments
      await this.loadComments();
    },

    async loadComments() {
      try {
        this.comments = await CommentLibraryAPI.fetchCommentBankItems();
        this.filteredComments = [...this.comments];
        this.renderComments();
      } catch (error) {
        console.error('Error loading comments:', error);
        this.showError('Failed to load comments. Please try again.');
      }
    },

    renderComments() {
      const container = document.getElementById('comments-container');
      if (!container) return;

      container.innerHTML = '';

      if (this.filteredComments.length === 0) {
        const noComments = document.createElement('div');
        noComments.className = 'comment-library-no-comments';
        noComments.textContent = this.comments.length === 0
          ? 'No comments found in your comment library.'
          : 'No comments match your search.';
        container.appendChild(noComments);
        return;
      }

      this.filteredComments.forEach((comment, index) => {
        const commentItem = this.createCommentItem(comment, index);
        container.appendChild(commentItem);
      });
    },

    createCommentItem(comment, index) {
      const item = document.createElement('div');
      item.className = 'comment-library-item';
      item.dataset.index = index;

      // Helper function to display newlines visually and show HTML tags as text
      const escapeAndFormatText = (text) => {
        // Convert HTML tags and escape sequences to visible text
        const escaped = text
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/\"/g, '"');
        
        // Convert newlines to visual breaks for display
        return escaped.replace(/\n/g, '<br>');
      };

      // Helper function to count visual lines in text
      const countVisualLines = (text) => {
        // Create temporary element with same styles as preview
        const temp = document.createElement('div');
        Object.assign(temp.style, {
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          width: '100%', // Use full width of container
          fontSize: '14px', // Standard font size
          fontFamily: 'Arial, sans-serif', // Standard font family
          lineHeight: '1.4',
          padding: '0'
        });
        
        temp.innerHTML = escapeAndFormatText(text);
        document.body.appendChild(temp);
        
        const lineHeight = 14 * 1.4; // fontSize * lineHeight
        const lines = Math.ceil(temp.scrollHeight / lineHeight);
        
        document.body.removeChild(temp);
        return lines;
      };

      // Check if text needs truncation based on visual lines
      const lineCount = countVisualLines(comment.comment);
      const needsTruncation = lineCount > 5;

      // Comment preview
      const preview = document.createElement('div');
      preview.className = 'comment-preview-text';

      let previewText = comment.comment;
      if (needsTruncation) {
        // Find approximate truncation point by binary search for efficiency
        let min = 0;
        let max = comment.comment.length;
        let bestLength = max;

        while (min <= max) {
          const mid = Math.floor((min + max) / 2);
          const testText = comment.comment.substring(0, mid);
          const testLines = countVisualLines(testText);

          if (testLines <= 5) {
            bestLength = mid;
            min = mid + 1;
          } else {
            max = mid - 1;
          }
        }

        previewText = comment.comment.substring(0, bestLength) + '...';
      }

      preview.innerHTML = escapeAndFormatText(previewText);

      // Full text (initially hidden)
      const fullText = document.createElement('div');
      fullText.className = 'comment-full-text';
      fullText.innerHTML = escapeAndFormatText(comment.comment);

      // Expand/Collapse button
      const expandBtn = document.createElement('button');
      expandBtn.className = 'Button Button--small Button--link comment-expand-btn';
      if (!needsTruncation) {
        expandBtn.classList.add('hidden');
      }
      expandBtn.textContent = needsTruncation ? 'Show more' : '';

      let isExpanded = false;
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        if (isExpanded) {
          preview.style.display = 'none';
          fullText.classList.add('expanded');
          expandBtn.textContent = 'Show less';
        } else {
          preview.style.display = 'block';
          fullText.classList.remove('expanded');
          expandBtn.textContent = 'Show more';
        }
      });

      // Date
      const date = document.createElement('div');
      date.className = 'comment-library-date';
      date.textContent = `Created: ${moment(comment.createdAt).format('YYYY-MM-DD HH:mm')}`;

      // Selection indicator
      const selectionIndicator = document.createElement('div');
      selectionIndicator.className = 'selection-indicator';

      // Click handler
      item.addEventListener('click', () => {
        this.selectComment(comment, item);
      });

      item.append(preview, fullText, expandBtn, date, selectionIndicator);
      return item;
    },

    selectComment(comment, element) {
      // Remove previous selection
      document.querySelectorAll('.comment-library-item').forEach(item => {
        item.classList.remove('selected');
      });

      // Add selection to current item
      element.classList.add('selected');

      // Update selected comment
      this.selectedComment = comment;

      // Update UI
      const selectedInfo = document.getElementById('selected-info');
      const useCommentBtn = document.getElementById('use-comment-btn');
      
      if (selectedInfo) {
        // Helper function to count visual lines in text
        const countVisualLines = (text) => {
          // Create temporary element with same styles as preview
          const temp = document.createElement('div');
          Object.assign(temp.style, {
            position: 'absolute',
            visibility: 'hidden',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            width: '100%', // Use full width of container
            fontSize: '14px', // Standard font size
            fontFamily: 'Arial, sans-serif', // Standard font family
            lineHeight: '1.4',
            padding: '0'
          });
          
          temp.innerHTML = text;
          document.body.appendChild(temp);
          
          const lineHeight = 14 * 1.4; // fontSize * lineHeight
          const lines = Math.ceil(temp.scrollHeight / lineHeight);
          
          document.body.removeChild(temp);
          return lines;
        };

        // Helper function to display newlines visually and show HTML tags as text
        const escapeAndFormatText = (text) => {
          // Convert HTML tags and escape sequences to visible text
          const escaped = text
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/\"/g, '"');
          
          // Convert newlines to visual breaks for display
          return escaped.replace(/\n/g, '<br>');
        };

        // Check if text needs truncation based on visual lines
        const lineCount = countVisualLines(comment.comment);
        const needsTruncation = lineCount > 2; // Use 2 lines for selected info preview

        let previewText = comment.comment;
        if (needsTruncation) {
          // Find approximate truncation point by binary search for efficiency
          let min = 0;
          let max = comment.comment.length;
          let bestLength = max;
          
          while (min <= max) {
            const mid = Math.floor((min + max) / 2);
            const testText = comment.comment.substring(0, mid);
            const testLines = countVisualLines(testText);
            
            if (testLines <= 2) {
              bestLength = mid;
              min = mid + 1;
            } else {
              max = mid - 1;
            }
          }
          
          previewText = comment.comment.substring(0, bestLength) + '...';
        }
        
        selectedInfo.textContent = `Selected: ${escapeAndFormatText(previewText)}`;
      }
      
      if (useCommentBtn) {
        useCommentBtn.disabled = false;
      }
    },

    filterComments(searchQuery) {
      if (!searchQuery.trim()) {
        this.filteredComments = [...this.comments];
      } else {
        const query = searchQuery.toLowerCase();
        this.filteredComments = this.comments.filter(comment =>
          comment.comment.toLowerCase().includes(query)
        );
      }
      this.renderComments();
    },

    useSelectedComment() {
      if (!this.selectedComment) return;

      // Get TinyMCE iframe
      const iframe = document.getElementById('tinymce-iframe');
      if (!iframe) {
        alert('Error: Editor not found');
        return;
      }

      // Send content to TinyMCE
      iframe.contentWindow.postMessage({
        type: 'INSERT_CONTENT',
        content: this.selectedComment.comment
      }, '*');

      // Close modal
      this.close();
    },

    showError(message) {
      const container = document.getElementById('comments-container');
      if (!container) return;

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #d32f2f;">
          <i class="icon-warning" aria-hidden="true"></i>
          <p>${message}</p>
        </div>
      `;
    },

    initResize(e) {
      this.isResizing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      
      this.startWidth = parseInt(window.getComputedStyle(this.modal).width, 10);
      this.startHeight = parseInt(window.getComputedStyle(this.modal).height, 10);
      
      // Add global event listeners
      document.addEventListener('mousemove', (e) => this.doResize(e));
      document.addEventListener('mouseup', () => this.stopResize());
      
      e.preventDefault();
    },

    doResize(e) {
      if (!this.isResizing) return;
      
      const newWidth = this.startWidth + e.clientX - this.startX;
      const newHeight = this.startHeight + e.clientY - this.startY;
      
      // Apply minimum size constraints
      const minWidth = 400;
      const minHeight = 300;
      
      if (newWidth > minWidth) {
        this.modal.style.width = newWidth + 'px';
      }
      
      if (newHeight > minHeight) {
        this.modal.style.height = newHeight + 'px';
      }
    },

    stopResize() {
      this.isResizing = false;
      
      // Remove global event listeners
      document.removeEventListener('mousemove', (e) => this.doResize(e));
      document.removeEventListener('mouseup', () => this.stopResize());
    },

    close() {
      if (!this.isOpen) return;
      
      // Clear search timeout
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }
      
      // Remove modal
      if (this.backdrop) {
        this.backdrop.remove();
      }
      
      // Reset state
      this.isOpen = false;
      this.comments = [];
      this.filteredComments = [];
      this.selectedComment = null;
      this.backdrop = null;
      this.modal = null;
    }
  };

  // ============================================================================
  // 5. MISSING TAB UI CONTROLLER
  // ============================================================================

  const MissingTabUI = {
    showMessage(text, type = 'info') {
      const msgEl = document.getElementById('missing-message');
      if (!msgEl) return;

      msgEl.className = `alert alert-${type}`;
      msgEl.innerHTML = `<p style="margin:0"><strong>${text}</strong></p>`;
      msgEl.style.display = 'block';
    },

    hideMessage() {
      const msgEl = document.getElementById('missing-message');
      if (msgEl) msgEl.style.display = 'none';
    },

    showButtons(show = true) {
      const btnFilter = document.getElementById('btn-filter-missing-teacher');
      const btnRefresh = document.getElementById('btn-refresh-missing');

      if (btnFilter) btnFilter.style.display = show ? 'inline-block' : 'none';
      if (btnRefresh) btnRefresh.style.display = show ? 'inline-block' : 'none';
    },

    async handleGenerate() {
      console.log('[Missing Tab] handleGenerate called');

      const dateInput = document.getElementById('missing-date-picker');
      const daysInput = document.getElementById('missing-days-range');
      const btnGenerate = document.getElementById('btn-generate-missing');

      console.log('[Missing Tab] Inputs found:', { dateInput: !!dateInput, daysInput: !!daysInput });

      if (!dateInput || !daysInput) {
        console.error('[Missing Tab] Required inputs not found');
        return;
      }

      const referenceDate = dateInput.value;
      const days = parseInt(daysInput.value) || 7;

      console.log('[Missing Tab] Parameters:', { referenceDate, days });

      if (!referenceDate) {
        alert('Please select a reference date.');
        return;
      }

      // Check if parameters have changed
      const currentParams = { referenceDate, days };
      const lastParams = ModalState.tabState.missing.lastFetchParams;

      const needsRefetch = !lastParams ||
        lastParams.referenceDate !== referenceDate ||
        lastParams.days !== days;

      // If parameters haven't changed and we have cached data, do nothing
      if (!needsRefetch && ModalState.dataCache.missing && ModalState.dataCache.missing.length > 0) {
        return;
      }

      // Disable button during fetch
      if (btnGenerate) {
        btnGenerate.disabled = true;
        btnGenerate.innerHTML = '<i class="icon-progress" aria-hidden="true"></i> Generating...';
      }

      this.hideMessage();
      console.log('[Missing Tab] Starting data fetch...');

      let data;
      try {
        if (needsRefetch) {
          // Fetch new data
          data = await MissingDataFetcher.fetchMissingSubmissions(referenceDate, days);
          ModalState.tabState.missing.lastFetchParams = currentParams;
        } else {
          // Use cached data (shouldn't reach here with the check above)
          data = ModalState.dataCache.missing;
        }

        // Destroy existing table if present
        if (ModalState.tables.missing) {
          try {
            ModalState.tables.missing.destroy();
            ModalState.tables.missing = null;
          } catch (e) {
            console.warn('Error destroying missing table:', e);
          }
        }

        // Clear and recreate table element
        const tableEl = document.getElementById('missing-table');
        if (tableEl) {
          tableEl.remove();
        }

        const newTable = document.createElement('table');
        newTable.id = 'missing-table';
        newTable.className = 'table table-bordered compact';
        newTable.style.width = '100%';
        newTable.style.display = 'none';
        newTable.setAttribute('cellspacing', '0');

        const tabContent = document.getElementById('tab-content-missing');
        if (tabContent) {
          tabContent.appendChild(newTable);
        }

        if (data.length === 0) {
          this.showMessage('No missing submissions found within the selected date range. Try adjusting the date or days range.', 'warning');
        } else {
          // Initialize table
          MissingTableManager.initializeMissingTable(data);
          this.showButtons(true);
        }
      } catch (error) {
        console.error('Error generating missing submissions:', error);
        this.showMessage('Error fetching missing submissions. Please try again.', 'danger');
      } finally {
        // Re-enable button only if there was an error or no data
        // Keep it disabled if data was successfully loaded
        const shouldKeepDisabled = data && data.length > 0;
        if (btnGenerate) {
          btnGenerate.disabled = shouldKeepDisabled;
          btnGenerate.innerHTML = shouldKeepDisabled ?
            '<i class="icon-solid icon-complete" aria-hidden="true"></i> Generated' :
            '<i class="icon-solid icon-circle-arrow-down" aria-hidden="true"></i> Generate';
        }
      }
    },

    async handleFilterMyClasses() {
      const btn = document.getElementById('btn-filter-missing-teacher');

      if (!ModalState.tables.missing) {
        alert('Please generate missing submissions first.');
        return;
      }

      // Show loading state
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="icon-progress" aria-hidden="true"></i> Loading...';
      }

      try {
        const userId = await API.getUserId();
        if (!userId) {
          alert('Could not retrieve user ID');
          return;
        }

        // Reuse the DataFetcher from content.js
        const DataFetcher = window.CanvasToDoShared.DataFetcher || {
          async getTeacherEnrollments(userId) {
            const query = `query GetTeacherEnrollments {
              allCourses {
                name
                enrollmentsConnection(
                  filter: {states: active, types: TeacherEnrollment, userIds: "${userId}"}
                ) {
                  edges {
                    node {
                      section {
                        name
                      }
                    }
                  }
                }
              }
            }`;

            try {
              const result = await API.graphqlRequest(query);
              const courses = result.data.allCourses || [];

              const enrollments = [];
              for (const course of courses) {
                if (course.enrollmentsConnection?.edges) {
                  for (const edge of course.enrollmentsConnection.edges) {
                    enrollments.push({
                      courseName: course.name,
                      sectionName: edge.node.section.name
                    });
                  }
                }
              }

              return enrollments;
            } catch (error) {
              console.error('Failed to fetch teacher enrollments:', error);
              return [];
            }
          }
        };

        const enrollments = await DataFetcher.getTeacherEnrollments(userId);
        if (enrollments.length === 0) {
          alert('No active teacher enrollments found');
          return;
        }

        // Apply filter using FilterManager
        this.applyTeacherFilter(enrollments);
      } catch (error) {
        console.error('Error applying teacher filter:', error);
        alert('Failed to apply teacher filter');
      } finally {
        // Restore button state
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="icon-solid icon-educators" aria-hidden="true"></i> Filter My Classes';
        }
      }
    },

    applyTeacherFilter(enrollments) {
      if (!ModalState.tables.missing || enrollments.length === 0) {
        return;
      }

      const sbApi = ModalState.tables.missing.searchBuilder;
      if (!sbApi) {
        console.warn('SearchBuilder not available on missing table');
        return;
      }

      // Get existing criteria
      let existing = sbApi.getDetails();
      if (!existing || !Array.isArray(existing.criteria)) {
        existing = { logic: 'OR', criteria: [] };
      }

      // Build new criteria
      const newCriteria = enrollments.map(e => ({
        logic: 'AND',
        criteria: [
          {
            condition: 'contains',
            data: 'Course Name',
            value: [e.courseName]
          },
          {
            condition: 'contains',
            data: 'Student Section',
            value: [e.sectionName]
          }
        ]
      }));

      // Prevent duplicates
      const existingKeySet = new Set(
        existing.criteria.map(c => JSON.stringify(c))
      );

      const uniqueNewCriteria = newCriteria.filter(c =>
        !existingKeySet.has(JSON.stringify(c))
      );

      if (uniqueNewCriteria.length === 0) {
        console.log("No new criteria to add.");
        return;
      }

      // Add new criteria
      existing.criteria.push(...uniqueNewCriteria);

      // Rebuild SearchBuilder
      sbApi.rebuild(existing);
    },

    async handleRefresh() {
      const btnRefresh = document.getElementById('btn-refresh-missing');
      
      // Disable refresh button during fetch
      if (btnRefresh) {
        btnRefresh.disabled = true;
        btnRefresh.innerHTML = '<i class="icon-progress" aria-hidden="true"></i> Refreshing...';
      }

      // Clear cached data to force refetch
      ModalState.tabState.missing.lastFetchParams = null;
      ModalState.dataCache.missing = [];

      // Destroy table
      if (ModalState.tables.missing) {
        try {
          ModalState.tables.missing.destroy();
          ModalState.tables.missing = null;
        } catch (e) {
          console.warn('Error destroying table:', e);
        }
      }

      // Clear and recreate table element
      const tableEl = document.getElementById('missing-table');
      if (tableEl) {
        tableEl.remove();
      }

      const newTable = document.createElement('table');
      newTable.id = 'missing-table';
      newTable.className = 'table table-bordered compact';
      newTable.style.width = '100%';
      newTable.style.display = 'none';
      newTable.setAttribute('cellspacing', '0');

      const tabContent = document.getElementById('tab-content-missing');
      if (tabContent) {
        tabContent.appendChild(newTable);
      }

      try {
        // Regenerate
        await this.handleGenerate();
      } finally {
        // Re-enable refresh button
        if (btnRefresh) {
          btnRefresh.disabled = false;
          btnRefresh.innerHTML = '<i class="icon-refresh" aria-hidden="true"></i> Refresh';
        }
      }
    },

    initialize() {
      console.log('[Missing Tab] Initializing...');

      const btnGenerate = document.getElementById('btn-generate-missing');
      const btnFilterTeacher = document.getElementById('btn-filter-missing-teacher');
      const btnRefresh = document.getElementById('btn-refresh-missing');
      const dateInput = document.getElementById('missing-date-picker');
      const daysInput = document.getElementById('missing-days-range');

      console.log('[Missing Tab] Generate button found:', !!btnGenerate);

      if (btnGenerate) {
        btnGenerate.addEventListener('click', () => {
          console.log('[Missing Tab] Generate button clicked!');
          this.handleGenerate();
        });
      } else {
        console.warn('[Missing Tab] Generate button not found!');
      }

      if (btnFilterTeacher) {
        btnFilterTeacher.addEventListener('click', () => this.handleFilterMyClasses());
      }

      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => this.handleRefresh());
      }

      // Update state when inputs change and check if button should be enabled
      const updateButtonState = () => {
        const btnGenerate = document.getElementById('btn-generate-missing');
        if (!btnGenerate) return;

        const referenceDate = dateInput ? dateInput.value : '';
        const days = parseInt(daysInput ? daysInput.value : 0) || 7;
        
        // Check if parameters have changed from last fetched
        const lastParams = ModalState.tabState.missing.lastFetchParams;
        const paramsChanged = !lastParams ||
          lastParams.referenceDate !== referenceDate ||
          lastParams.days !== days;

        // Enable button if parameters changed or no data cached
        const shouldEnable = paramsChanged || !ModalState.dataCache.missing || ModalState.dataCache.missing.length === 0;
        
        btnGenerate.disabled = !shouldEnable;
        if (shouldEnable) {
          btnGenerate.innerHTML = '<i class="icon-solid icon-circle-arrow-down" aria-hidden="true"></i> Generate';
        }
      };

      if (dateInput) {
        dateInput.addEventListener('change', (e) => {
          ModalState.tabState.missing.selectedDate = e.target.value;
          updateButtonState();
        });
      }

      if (daysInput) {
        daysInput.addEventListener('change', (e) => {
          ModalState.tabState.missing.daysRange = parseInt(e.target.value) || 7;
          updateButtonState();
        });
      }

      // Initial button state check
      setTimeout(updateButtonState, 100);

      // Show initial message
      this.showMessage('Select a reference date and click "Generate" to find missing submissions.');

      console.log('[Missing Tab] Initialization complete');
    }
  };

  // ============================================================================
  // 5. INITIALIZATION
  // ============================================================================

  // Export for use by content.js (called when modal is created)
  window.CanvasMissingTab = {
    MissingDataFetcher,
    MissingTableManager,
    MissingTabUI,
    MissingProgress,
    CommentLibraryModal,
    initialize() {
      // Initialize the missing tab UI (called from ModalManager.openToDoModal)
      MissingTabUI.initialize();
    }
  };

})();
