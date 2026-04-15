// Student Message/Comment modal (per-student)
// Depends on:
// - [`src/messaging/template-variables.js`](src/messaging/template-variables.js:1)
// - [`src/api/canvas-rest.js`](src/api/canvas-rest.js:1) new methods (to be added)

(function() {
  'use strict';

  // ==========================================================================
  // Comment Library (replicated from reference implementation)
  // ==========================================================================

  const CommentLibraryQueries = {
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

  const CommentLibraryAPI = {
    async getUserId() {
      if (typeof ENV !== 'undefined' && ENV.current_user?.id) {
        return ENV.current_user.id;
      }

      try {
        const res = await fetch('/api/v1/users/self', {
          method: 'GET',
          headers: { 'X-CSRF-Token': window.CanvasRestAPI?.getCsrfToken?.() }
        });
        const data = await res.json();
        return data.id;
      } catch (error) {
        console.error('[StudentMessage][CommentLibrary] Failed to get user ID:', error);
        return null;
      }
    },

    async graphqlRequest(query, variables = {}) {
      // Prefer shared GraphQL client if present.
      if (window.CanvasToDoShared?.API?.graphqlRequest) {
        return window.CanvasToDoShared.API.graphqlRequest(query, variables);
      }

      // Fallback: use our CanvasGraphQLAPI wrapper.
      if (window.CanvasGraphQLAPI) {
        const api = new window.CanvasGraphQLAPI();
        const data = await api.executeQuery(query, variables);
        return { data };
      }

      // Last resort: raw fetch.
      const csrf = window.CanvasRestAPI?.getCsrfToken?.() || window.CanvasGraphQLAPI?.getCsrfToken?.();
      const res = await fetch('/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {})
        },
        credentials: 'same-origin',
        body: JSON.stringify({ query, variables })
      });
      const json = await res.json();
      return json;
    },

    async fetchCommentBankItems(searchQuery = '') {
      const userId = await this.getUserId();
      if (!userId) throw new Error('User ID not found in Canvas environment');

      const query = CommentLibraryQueries.SpeedGrader_CommentBankItemQuery
        .replace('user_id', userId);

      const result = await this.graphqlRequest(query, { query: searchQuery });
      const nodes = result?.data?.legacyNode?.commentBankItemsConnection?.nodes || [];

      return nodes.map(item => ({
        comment: item.comment,
        createdAt: item.createdAt,
        id: item.createdAt
      }));
    }
  };

  const SaveToCommentLibraryAPI = {
    async fetchUserCourses() {
      const result = await CommentLibraryAPI.graphqlRequest(CommentLibraryQueries.UserCoursesQuery);
      const courses = result?.data?.allCourses || [];
      // No demo-course filtering in this project; keep parity with reference behavior where possible.
      return courses;
    },

    async saveCommentToLibrary(comment, courseId) {
      const result = await CommentLibraryAPI.graphqlRequest(
        CommentLibraryQueries.CreateCommentBankItemMutation,
        { comment, courseId }
      );

      const errors = result?.data?.createCommentBankItem?.errors || [];
      if (errors.length > 0) {
        throw new Error(errors.map(e => e.message).join(', '));
      }

      return result?.data?.createCommentBankItem?.commentBankItem;
    }
  };

  const CommentLibraryModal = {
    isOpen: false,
    comments: [],
    filteredComments: [],
    selectedComment: null,
    searchTimeout: null,
    modal: null,
    backdrop: null,

    async open({ onUse } = {}) {
      if (this.isOpen) return;
      this.isOpen = true;
      this.comments = [];
      this.filteredComments = [];
      this.selectedComment = null;

      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-smm-comment-library-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.id = 'rgm-smm-comment-library-modal';
      modal.className = 'rgm-smm-modal rgm-smm-comment-library-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Comment Library';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      closeBtn.type = 'button';
      closeBtn.textContent = '✖ Close';
      closeBtn.addEventListener('click', () => this.close());

      header.append(title, closeBtn);

      const searchContainer = document.createElement('div');
      searchContainer.className = 'rgm-smm-comment-library-search';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'rgm-smm-input';
      searchInput.placeholder = 'Search comments...';
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.filterComments(e.target.value);
        }, 300);
      });

      searchContainer.appendChild(searchInput);

      const commentsContainer = document.createElement('div');
      commentsContainer.id = 'rgm-smm-comment-library-comments';
      commentsContainer.className = 'rgm-smm-comment-library-comments';
      commentsContainer.innerHTML = '<div class="rgm-smm-muted">Loading comments...</div>';

      const footer = document.createElement('div');
      footer.className = 'rgm-smm-actions rgm-smm-comment-library-footer';

      const selectedInfo = document.createElement('div');
      selectedInfo.id = 'rgm-smm-comment-library-selected';
      selectedInfo.className = 'rgm-smm-muted';
      selectedInfo.textContent = 'No comment selected';

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      useBtn.textContent = 'Use Comment';
      useBtn.disabled = true;
      useBtn.addEventListener('click', () => {
        if (!this.selectedComment) return;
        if (typeof onUse === 'function') {
          onUse(this.selectedComment.comment);
        }
        this.close();
      });

      footer.append(selectedInfo, useBtn);

      modal.append(header, searchContainer, commentsContainer, footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this.backdrop = backdrop;
      this.modal = modal;
      this._commentsContainer = commentsContainer;
      this._selectedInfo = selectedInfo;
      this._useBtn = useBtn;

      setTimeout(() => searchInput.focus(), 50);

      await this.loadComments();
    },

    async loadComments() {
      try {
        this.comments = await CommentLibraryAPI.fetchCommentBankItems();
        this.filteredComments = [...this.comments];
        this.renderComments();
      } catch (error) {
        console.error('[StudentMessage][CommentLibrary] loadComments error', error);
        this.showError('Failed to load comments. Please try again.');
      }
    },

    filterComments(searchQuery) {
      const q = String(searchQuery || '').trim().toLowerCase();
      if (!q) {
        this.filteredComments = [...this.comments];
      } else {
        this.filteredComments = this.comments.filter(c => String(c.comment || '').toLowerCase().includes(q));
      }
      this.renderComments();
    },

    renderComments() {
      const container = this._commentsContainer;
      if (!container) return;

      container.innerHTML = '';

      if (this.filteredComments.length === 0) {
        const no = document.createElement('div');
        no.className = 'rgm-smm-muted';
        no.textContent = this.comments.length === 0
          ? 'No comments found in your comment library.'
          : 'No comments match your search.';
        container.appendChild(no);
        return;
      }

      this.filteredComments.forEach((comment) => {
        const item = document.createElement('div');
        item.className = 'rgm-smm-comment-library-item';

        // Selection tick (reference parity)
        const tick = document.createElement('div');
        tick.className = 'rgm-smm-comment-library-tick';
        tick.setAttribute('aria-hidden', 'true');
        tick.textContent = '✓';

        const content = document.createElement('div');
        content.className = 'rgm-smm-comment-library-content';

        const preview = document.createElement('div');
        preview.className = 'rgm-smm-comment-library-preview';

        const fullText = String(comment.comment || '');
        const truncatedText = this._truncateByLines(fullText, 5);
        const needsTruncation = truncatedText !== fullText;

        // Start collapsed
        preview.innerHTML = this._escapeAndFormatText(needsTruncation ? truncatedText : fullText);

        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'rgm-smm-comment-library-expand';
        expandBtn.textContent = needsTruncation ? 'Show more' : '';
        expandBtn.style.display = needsTruncation ? 'inline-flex' : 'none';

        let expanded = false;
        expandBtn.addEventListener('click', (e) => {
          // Prevent selecting the comment when toggling expand
          e.preventDefault();
          e.stopPropagation();

          expanded = !expanded;
          preview.innerHTML = this._escapeAndFormatText(expanded ? fullText : truncatedText);
          expandBtn.textContent = expanded ? 'Show less' : 'Show more';
        });

        const meta = document.createElement('div');
        meta.className = 'rgm-smm-comment-library-meta';
        meta.textContent = comment.createdAt && window.moment
          ? `Created: ${window.moment(comment.createdAt).format('YYYY-MM-DD HH:mm')}`
          : (comment.createdAt ? `Created: ${comment.createdAt}` : '');

        content.append(preview, expandBtn, meta);
        item.append(tick, content);

        item.addEventListener('click', () => this.selectComment(comment, item));

        container.appendChild(item);
      });
    },

    selectComment(comment, element) {
      document.querySelectorAll('.rgm-smm-comment-library-item').forEach(el => el.classList.remove('selected'));
      element.classList.add('selected');
      this.selectedComment = comment;

      if (this._selectedInfo) {
        const preview = this._truncateByLines(String(comment.comment || ''), 2);
        this._selectedInfo.textContent = `Selected: ${preview}`;
      }
      if (this._useBtn) this._useBtn.disabled = false;
    },

    showError(message) {
      const container = this._commentsContainer;
      if (!container) return;
      container.innerHTML = `<div class="rgm-smm-muted" style="color:#b00020">${String(message || '')}</div>`;
    },

    close() {
      if (!this.isOpen) return;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      if (this.backdrop) this.backdrop.remove();

      this.isOpen = false;
      this.comments = [];
      this.filteredComments = [];
      this.selectedComment = null;
      this.searchTimeout = null;
      this.modal = null;
      this.backdrop = null;
      this._commentsContainer = null;
      this._selectedInfo = null;
      this._useBtn = null;
    },

    _escapeAndFormatText(text) {
      // Escape HTML for safe preview rendering, then preserve newlines.
      // NOTE: this is for *display* inside the library modal; it does not affect what gets inserted.
      const escaped = String(text || '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '');
      return escaped.replace(/\r\n|\n|\r/g, '<br>');
    },

    _truncateByLines(text, maxLines) {
      // Simple truncation heuristic: keep first N lines, then add ellipsis.
      const lines = String(text || '').split(/\r\n|\n|\r/);
      if (lines.length <= maxLines) return String(text || '');
      return lines.slice(0, maxLines).join('\n') + '...';
    }
  };

  const SaveToCommentLibraryModal = {
    isOpen: false,
    courses: [],
    filteredCourses: [],
    selectedCourse: null,
    commentContent: '',
    searchTimeout: null,

    async open(commentContent) {
      if (this.isOpen) return;
      this.isOpen = true;
      this.courses = [];
      this.filteredCourses = [];
      this.selectedCourse = null;
      this.commentContent = String(commentContent || '');

      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-smm-save-to-library-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.id = 'rgm-smm-save-to-library-modal';
      modal.className = 'rgm-smm-modal rgm-smm-save-to-library-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Save to Comment Library';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      closeBtn.type = 'button';
      closeBtn.textContent = '✖ Close';
      closeBtn.addEventListener('click', () => this.close());

      header.append(title, closeBtn);

      const body = document.createElement('div');
      body.className = 'rgm-smm-body';

      const commentLabel = document.createElement('div');
      commentLabel.style.fontWeight = '800';
      commentLabel.style.marginBottom = '8px';
      commentLabel.textContent = 'Comment to save:';

      const commentPreview = document.createElement('div');
      commentPreview.className = 'rgm-smm-confirm-preview';
      commentPreview.innerHTML = CommentLibraryModal._escapeAndFormatText(this.commentContent);

      const courseLabel = document.createElement('div');
      courseLabel.style.fontWeight = '800';
      courseLabel.style.margin = '14px 0 8px';
      courseLabel.textContent = 'Select course:';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'rgm-smm-input';
      searchInput.placeholder = 'Search courses...';
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.filterCourses(e.target.value);
        }, 300);
      });

      const coursesContainer = document.createElement('div');
      coursesContainer.id = 'rgm-smm-save-to-library-courses';
      coursesContainer.className = 'rgm-smm-save-to-library-courses';
      coursesContainer.innerHTML = '<div class="rgm-smm-muted">Loading courses...</div>';

      body.append(commentLabel, commentPreview, courseLabel, searchInput, coursesContainer);

      const footer = document.createElement('div');
      footer.className = 'rgm-smm-actions';

      const selectedInfo = document.createElement('div');
      selectedInfo.className = 'rgm-smm-muted';
      selectedInfo.textContent = 'No course selected';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'rgm-smm-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.close());

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      saveBtn.textContent = 'Save Comment to Library';
      saveBtn.disabled = true;
      saveBtn.addEventListener('click', async () => {
        if (!this.selectedCourse) return;
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          await SaveToCommentLibraryAPI.saveCommentToLibrary(this.commentContent, this.selectedCourse._id);
          coursesContainer.innerHTML = '<div class="rgm-smm-muted" style="color:#2e7d32;font-weight:800">Comment Saved Successfully!</div>';
          setTimeout(() => this.close(), 1500);
        } catch (err) {
          console.error('[StudentMessage][SaveToLibrary] save error', err);
          alert(`Failed to save comment: ${err?.message || String(err)}`);
        } finally {
          saveBtn.textContent = 'Save Comment to Library';
          saveBtn.disabled = !this.selectedCourse;
        }
      });

      footer.append(selectedInfo, cancelBtn, saveBtn);

      modal.append(header, body, footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this.backdrop = backdrop;
      this.modal = modal;
      this._coursesContainer = coursesContainer;
      this._selectedInfo = selectedInfo;
      this._saveBtn = saveBtn;

      setTimeout(() => searchInput.focus(), 50);

      await this.loadCourses();
    },

    async loadCourses() {
      try {
        this.courses = await SaveToCommentLibraryAPI.fetchUserCourses();
        this.filteredCourses = [...this.courses];
        this.renderCourses();
      } catch (error) {
        console.error('[StudentMessage][SaveToLibrary] loadCourses error', error);
        this.showError('Failed to load courses. Please try again.');
      }
    },

    filterCourses(searchQuery) {
      const q = String(searchQuery || '').trim().toLowerCase();
      if (!q) {
        this.filteredCourses = [...this.courses];
      } else {
        this.filteredCourses = this.courses.filter(c =>
          String(c.name || '').toLowerCase().includes(q) ||
          String(c.courseNickname || '').toLowerCase().includes(q) ||
          String(c.courseCode || '').toLowerCase().includes(q)
        );
      }
      this.renderCourses();
    },

    renderCourses() {
      const container = this._coursesContainer;
      if (!container) return;

      container.innerHTML = '';

      if (this.filteredCourses.length === 0) {
        const no = document.createElement('div');
        no.className = 'rgm-smm-muted';
        no.textContent = this.courses.length === 0 ? 'No courses found.' : 'No courses match your search.';
        container.appendChild(no);
        return;
      }

      this.filteredCourses.forEach(course => {
        const item = document.createElement('div');
        item.className = 'rgm-smm-save-to-library-course';

        const name = document.createElement('div');
        name.style.fontWeight = '800';
        name.textContent = course.courseNickname || course.name;

        const meta = document.createElement('div');
        meta.className = 'rgm-smm-muted';
        meta.textContent = course.courseCode ? `Code: ${course.courseCode}` : '';

        item.append(name, meta);

        item.addEventListener('click', () => this.selectCourse(course, item));

        container.appendChild(item);
      });
    },

    selectCourse(course, element) {
      document.querySelectorAll('.rgm-smm-save-to-library-course').forEach(el => el.classList.remove('selected'));
      element.classList.add('selected');
      this.selectedCourse = course;

      if (this._selectedInfo) {
        this._selectedInfo.textContent = `Selected: ${course.courseNickname || course.name}`;
      }
      if (this._saveBtn) this._saveBtn.disabled = false;
    },

    showError(message) {
      const container = this._coursesContainer;
      if (!container) return;
      container.innerHTML = `<div class="rgm-smm-muted" style="color:#b00020">${String(message || '')}</div>`;
    },

    close() {
      if (!this.isOpen) return;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      if (this.backdrop) this.backdrop.remove();

      this.isOpen = false;
      this.courses = [];
      this.filteredCourses = [];
      this.selectedCourse = null;
      this.commentContent = '';
      this.searchTimeout = null;
      this.backdrop = null;
      this.modal = null;
      this._coursesContainer = null;
      this._selectedInfo = null;
      this._saveBtn = null;
    }
  };

  function envelopeIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
      </svg>
    `;
  }

  function ensureDeps() {
    if (!window.StudentMessageTemplates) {
      throw new Error('StudentMessageTemplates not loaded');
    }
    if (!window.CanvasRestAPI) {
      throw new Error('CanvasRestAPI not loaded');
    }
  }

  function createVariableTray(onInsert) {
    const tray = document.createElement('div');
    tray.className = 'rgm-smm-variable-tray';

    const header = document.createElement('div');
    header.className = 'rgm-smm-variable-tray-header';
    header.innerHTML = `
      <span class="rgm-smm-variable-tray-title">Insert Variable</span>
      <span class="rgm-smm-variable-tray-hint">(click to insert)</span>
    `;

    const chips = document.createElement('div');
    chips.className = 'rgm-smm-variable-chips';

    window.StudentMessageTemplates.TEMPLATE_VARIABLES.forEach(v => {
      const chip = document.createElement('span');
      chip.className = 'rgm-smm-variable-chip';
      chip.textContent = v.label;
      chip.dataset.var = `{{${v.key}}}`;

      if (v.key === 'today_datetime') {
        chip.title = "Click to insert today's date/time (format selectable)";

        const closeExistingMenu = () => {
          const existing = document.getElementById('rgm-smm-today-datetime-menu');
          if (existing) existing.remove();
        };

        const formatNow = ({ dateFormat, includeTime, timeFormat }) => {
          const nowMoment = (typeof moment !== 'undefined') ? moment() : null;
          const d = nowMoment ? nowMoment.toDate() : new Date();

          const pad2 = (n) => String(n).padStart(2, '0');
          const yyyy = d.getFullYear();
          const mm = pad2(d.getMonth() + 1);
          const dd = pad2(d.getDate());

          const dateStr = (() => {
            switch (dateFormat) {
              case 'YYYY/MM/DD': return `${yyyy}/${mm}/${dd}`;
              case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
              case 'DD/MM/YYYY':
              default: return `${dd}/${mm}/${yyyy}`;
            }
          })();

          if (!includeTime) return dateStr;

          if (nowMoment) {
            const timeStr = timeFormat === '24h' ? nowMoment.format('HH:mm') : nowMoment.format('h:mma').toUpperCase();
            return `${dateStr} ${timeStr}`;
          }

          const hours = d.getHours();
          const mins = pad2(d.getMinutes());
          if (timeFormat === '24h') {
            return `${dateStr} ${pad2(hours)}:${mins}`;
          }
          const h12 = ((hours + 11) % 12) + 1;
          const ampm = hours >= 12 ? 'PM' : 'AM';
          return `${dateStr} ${h12}:${mins}${ampm}`;
        };

        const buildMenu = () => {
          closeExistingMenu();

          const menu = document.createElement('div');
          menu.id = 'rgm-smm-today-datetime-menu';
          menu.style.position = 'absolute';
          menu.style.zIndex = '999999';
          menu.style.background = '#fff';
          menu.style.border = '1px solid #cfd3d7';
          menu.style.borderRadius = '10px';
          menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
          menu.style.padding = '10px';
          menu.style.minWidth = '340px';

          const title = document.createElement('div');
          title.style.fontWeight = '600';
          title.style.marginBottom = '8px';
          title.textContent = 'Insert Today (Date/Time)';

          const row = (labelText, controlEl) => {
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '10px';
            wrap.style.margin = '8px 0';

            const label = document.createElement('div');
            label.style.width = '110px';
            label.style.fontSize = '12px';
            label.style.color = '#444';
            label.textContent = labelText;

            wrap.append(label, controlEl);
            return wrap;
          };

          const dateSelect = document.createElement('select');
          dateSelect.style.flex = '1';
          dateSelect.style.padding = '6px 8px';
          dateSelect.style.borderRadius = '8px';
          dateSelect.style.border = '1px solid #cfd3d7';

          const timeSelect = document.createElement('select');
          timeSelect.style.flex = '1';
          timeSelect.style.padding = '6px 8px';
          timeSelect.style.borderRadius = '8px';
          timeSelect.style.border = '1px solid #cfd3d7';

          const makeOption = (value, label) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            return opt;
          };

          // Populate date formats with live samples
          const dateFormats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD'];
          dateFormats.forEach(fmt => {
            const sample = formatNow({ dateFormat: fmt, includeTime: false, timeFormat: '12h' });
            dateSelect.appendChild(makeOption(fmt, `${fmt} (e.g. ${sample})`));
          });
          dateSelect.value = 'DD/MM/YYYY';

          timeSelect.appendChild(makeOption('12h', '12-hour (e.g. 1:00PM)'));
          timeSelect.appendChild(makeOption('24h', '24-hour (e.g. 13:00)'));
          timeSelect.value = '12h';

          const preview = document.createElement('div');
          preview.style.fontSize = '12px';
          preview.style.color = '#666';
          preview.style.marginTop = '8px';

          const updatePreview = () => {
            const dateOnly = formatNow({ dateFormat: dateSelect.value, includeTime: false, timeFormat: timeSelect.value });
            const withTime = formatNow({ dateFormat: dateSelect.value, includeTime: true, timeFormat: timeSelect.value });
            preview.textContent = `Preview: ${dateOnly} | ${withTime}`;
          };

          dateSelect.addEventListener('change', updatePreview);
          timeSelect.addEventListener('change', updatePreview);
          updatePreview();

          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '8px';
          actions.style.justifyContent = 'flex-end';
          actions.style.marginTop = '10px';

          const btn = (text, primary = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.style.padding = '6px 10px';
            b.style.borderRadius = '8px';
            b.style.border = primary ? '1px solid #2d6cdf' : '1px solid #cfd3d7';
            b.style.background = primary ? '#2d6cdf' : '#fff';
            b.style.color = primary ? '#fff' : '#222';
            return b;
          };

          const insertDateBtn = btn('Insert Date', true);
          insertDateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const content = formatNow({ dateFormat: dateSelect.value, includeTime: false, timeFormat: timeSelect.value });
            onInsert({ key: 'today_datetime', placeholder: content });
          });

          const insertDateTimeBtn = btn('Insert Date + Time', true);
          insertDateTimeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const content = formatNow({ dateFormat: dateSelect.value, includeTime: true, timeFormat: timeSelect.value });
            onInsert({ key: 'today_datetime', placeholder: content });
          });

          const cancelBtn = btn('Close', false);
          cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeExistingMenu();

            // Ensure the next click on the chip can open the menu again.
            // (Without this, the document-level outside-click handler can remain attached
            // and immediately close the newly opened menu.)
            document.removeEventListener('mousedown', onDocClick, true);
            document.removeEventListener('keydown', onEsc, true);
          });

          actions.append(cancelBtn, insertDateBtn, insertDateTimeBtn);

          menu.append(
            title,
            row('Date format', dateSelect),
            row('Time format', timeSelect),
            preview,
            actions
          );

          // Prevent outside-click handler from firing when interacting inside the menu.
          menu.addEventListener('mousedown', (e) => e.stopPropagation());
          menu.addEventListener('click', (e) => e.stopPropagation());

          document.body.appendChild(menu);

          // Position under chip
          const rect = chip.getBoundingClientRect();
          menu.style.left = `${Math.round(rect.left + window.scrollX)}px`;
          menu.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;

          // Close on outside click / Escape (keep listeners active so menu can be used multiple times)
          const onDocClick = (e) => {
            if (!menu.contains(e.target) && e.target !== chip) {
              closeExistingMenu();
              document.removeEventListener('mousedown', onDocClick, true);
              document.removeEventListener('keydown', onEsc, true);
            }
          };
          const onEsc = (e) => {
            if (e.key === 'Escape') {
              closeExistingMenu();
              document.removeEventListener('mousedown', onDocClick, true);
              document.removeEventListener('keydown', onEsc, true);
            }
          };
          document.addEventListener('mousedown', onDocClick, true);
          document.addEventListener('keydown', onEsc, true);
        };

        chip.addEventListener('click', () => {
          console.log('[StudentMessage][VariableTray] click', {
            key: v.key,
            label: v.label,
            placeholder: `{{${v.key}}}`
          });
          try {
            buildMenu();
          } catch (err) {
            console.error('[StudentMessage][VariableTray] onInsert error', err);
          }
        });

        chips.appendChild(chip);
        return;
      }

      chip.addEventListener('click', () => {
        console.log('[StudentMessage][VariableTray] click', {
          key: v.key,
          label: v.label,
          placeholder: `{{${v.key}}}`
        });
        try {
          onInsert({ key: v.key, placeholder: `{{${v.key}}}` });
        } catch (err) {
          console.error('[StudentMessage][VariableTray] onInsert error', err);
        }
      });

      chips.appendChild(chip);
    });

    tray.append(header, chips);
    return tray;
  }

  function buildCompatRowData({ courseId, assignmentId, student }) {
    const origin = window.location.origin;
    const { givenName, surname } = window.StudentMessageTemplates.parseGivenSurname(student?.name || '');

    // Best-effort: RubricGraderModal captures some course info during section load.
    // If unavailable, leave blank.
    const courseInfo = (window.RubricGraderModal && window.RubricGraderModal.getCourseInfo)
      ? window.RubricGraderModal.getCourseInfo()
      : null;

    return {
      // Student ids (support both keys used across the codebase)
      odId: student?.userId,
      userId: student?.userId,
      user_id: student?.userId,

      course_id: courseId,
      assignment_id: assignmentId,

      // expected by TEMPLATE_VARIABLES dataKey mapping
      stdname: student?.name || '',
      student_given_name: givenName,
      student_surname: surname,
      coursename: courseInfo?.name || courseInfo?.courseName || '',
      coursenickname: courseInfo?.courseNickname || courseInfo?.nickname || '',
      term: courseInfo?.term || courseInfo?.termName || '',
      student_section_name: student?.sectionName || '',
      assignment_name: student?.assignmentName || '',
      assignment_group: student?.assignmentGroup || '',
      assignment_duedate: student?.dueDate || '',
      assignment_link: `${origin}/courses/${courseId}/assignments/${assignmentId}`
    };
  }

  const StudentMessageModal = {
    state: {
      courseId: null,
      assignmentId: null,
      student: null,
      currentTab: 'comment',
      uploadContext: 'comment'
    },

    switchTab(tabName) {
      const tab = tabName === 'message' ? 'message' : 'comment';
      this.state.currentTab = tab;
      this.state.uploadContext = tab; // reference parity: uploadContext mirrors tab

      const tabsEl = document.getElementById('rgm-smm-tabs');
      const commentPane = document.getElementById('rgm-smm-pane-comment');
      const messagePane = document.getElementById('rgm-smm-pane-message');
      const submitBtn = document.getElementById('rgm-smm-submit');

      if (tabsEl) {
        tabsEl.querySelectorAll('.rgm-smm-tab-btn').forEach(b => {
          b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
        });
      }

      const isComment = tab === 'comment';
      if (commentPane) commentPane.style.display = isComment ? '' : 'none';
      if (messagePane) messagePane.style.display = isComment ? 'none' : '';
      if (submitBtn) submitBtn.textContent = isComment ? 'Add Comment' : 'Send Message';

      // Ensure iframe uses correct endpoint
      if (window.StudentMessageFileUploadManager && typeof window.StudentMessageFileUploadManager.setUploadContext === 'function') {
        window.StudentMessageFileUploadManager.setUploadContext(this.state.uploadContext);
      }
    },

    _confirmationBackdrop: null,

    closeConfirmationDialog() {
      const backdrop = document.getElementById('rgm-smm-confirm-backdrop');
      if (backdrop) backdrop.remove();
      this._confirmationBackdrop = null;
    },

    closeProgressDialog() {
      const backdrop = document.getElementById('rgm-smm-progress-backdrop');
      if (backdrop) backdrop.remove();
      this._progressBackdrop = null;
    },

    getFileIconClass(filename) {
      if (!filename) return 'icon-document';
      const ext = String(filename).split('.').pop().toLowerCase();

      const iconMap = {
        // Documents
        pdf: 'icon-pdf',
        doc: 'icon-ms-word',
        docx: 'icon-ms-word',
        txt: 'icon-document',
        rtf: 'icon-document',

        // Spreadsheets
        xls: 'icon-ms-excel',
        xlsx: 'icon-ms-excel',
        csv: 'icon-ms-excel',

        // Presentations
        ppt: 'icon-ms-ppt',
        pptx: 'icon-ms-ppt',

        // Images
        jpg: 'icon-image',
        jpeg: 'icon-image',
        png: 'icon-image',
        gif: 'icon-image',
        svg: 'icon-image',
        bmp: 'icon-image',

        // Video
        mp4: 'icon-video',
        mov: 'icon-video',
        avi: 'icon-video',
        wmv: 'icon-video',

        // Audio
        mp3: 'icon-audio',
        wav: 'icon-audio',
        m4a: 'icon-audio',

        // Archives
        zip: 'icon-folder',
        rar: 'icon-folder',
        '7z': 'icon-folder',

        // Code
        html: 'icon-code',
        css: 'icon-code',
        js: 'icon-code',
        py: 'icon-code',
        java: 'icon-code',
        cpp: 'icon-code',
        c: 'icon-code'
      };

      return iconMap[ext] || 'icon-document';
    },

    generateSpeedGraderUrl({ courseId, assignmentId, userId }) {
      return `${window.location.origin}/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${userId}`;
    },

    createProgressModal({ student, compatRowData }) {
      // Backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-smm-progress-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      // Modal
      const modal = document.createElement('div');
      modal.id = 'rgm-smm-progress-modal';
      modal.className = 'rgm-smm-modal rgm-smm-progress-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Adding Comments to 1 Student…';

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = 'Please keep this window open until complete.';

      titleWrap.append(title, subtitle);

      header.append(titleWrap);

      // Body
      const body = document.createElement('div');
      body.className = 'rgm-smm-body';

      const studentCard = document.createElement('div');
      studentCard.className = 'rgm-smm-progress-student-card';
      studentCard.id = 'rgm-smm-progress-student-card-0';

      const top = document.createElement('div');
      top.className = 'rgm-smm-progress-student-top';

      const left = document.createElement('div');
      left.className = 'rgm-smm-progress-student-left';

      const studentName = document.createElement('div');
      studentName.className = 'rgm-smm-progress-student-name';
      studentName.textContent = compatRowData?.stdname || student?.name || '';

      const meta = document.createElement('div');
      meta.className = 'rgm-smm-progress-student-meta';
      const courseName = compatRowData?.coursename ? `Course: ${compatRowData.coursename}` : 'Course: (unknown)';
      const assignmentName = compatRowData?.assignment_name ? `Assignment: ${compatRowData.assignment_name}` : 'Assignment: (unknown)';
      meta.textContent = `${courseName} • ${assignmentName}`;

      left.append(studentName, meta);

      const right = document.createElement('div');
      right.className = 'rgm-smm-progress-student-right';

      const speedGraderLink = document.createElement('a');
      speedGraderLink.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      speedGraderLink.textContent = 'Open in SpeedGrader';
      speedGraderLink.href = this.generateSpeedGraderUrl({
        courseId: this.state.courseId,
        assignmentId: this.state.assignmentId,
        userId: this.state.student?.userId
      });
      speedGraderLink.target = '_blank';
      speedGraderLink.rel = 'noopener noreferrer';
      speedGraderLink.style.display = 'none';
      speedGraderLink.id = 'rgm-smm-progress-speedgrader-0';

      right.append(speedGraderLink);

      top.append(left, right);

      const bar = document.createElement('div');
      bar.className = 'rgm-smm-progress-bar';

      const fill = document.createElement('div');
      fill.className = 'rgm-smm-progress-bar-fill';
      fill.id = 'rgm-smm-progress-fill-0';
      fill.style.width = '0%';

      bar.appendChild(fill);

      const statusRow = document.createElement('div');
      statusRow.className = 'rgm-smm-progress-status-row';

      const status = document.createElement('div');
      status.className = 'rgm-smm-progress-status';
      status.id = 'rgm-smm-progress-status-0';
      status.textContent = 'Waiting…';

      statusRow.append(status);

      studentCard.append(top, bar, statusRow);

      const results = document.createElement('div');
      results.className = 'rgm-smm-progress-results';
      results.id = 'rgm-smm-progress-results';
      results.style.display = 'none';

      const actions = document.createElement('div');
      actions.className = 'rgm-smm-actions';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      closeBtn.textContent = 'Close';
      closeBtn.id = 'rgm-smm-progress-close';
      closeBtn.style.display = 'none';
      closeBtn.addEventListener('click', () => this.closeProgressDialog());

      actions.append(closeBtn);

      body.append(studentCard, results);

      modal.append(header, body, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Close on backdrop click
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeProgressDialog();
      });

      this._progressBackdrop = backdrop;

      return {
        backdrop,
        update: ({ statusText, progressPercent, isSuccess = false, isError = false, errorText = null, showSpeedGrader = false }) => {
          const statusEl = document.getElementById('rgm-smm-progress-status-0');
          const fillEl = document.getElementById('rgm-smm-progress-fill-0');
          const cardEl = document.getElementById('rgm-smm-progress-student-card-0');
          const sgEl = document.getElementById('rgm-smm-progress-speedgrader-0');

          if (statusEl && statusText) statusEl.textContent = statusText;
          if (fillEl && progressPercent != null) fillEl.style.width = `${progressPercent}%`;

          if (cardEl) {
            cardEl.classList.toggle('is-success', !!isSuccess);
            cardEl.classList.toggle('is-error', !!isError);
          }

          if (sgEl) {
            sgEl.style.display = showSpeedGrader ? 'inline-flex' : 'none';
          }

          if (errorText && statusEl) {
            statusEl.textContent = errorText;
          }
        },
        showResults: ({ successCount, errorCount, errors }) => {
          const resultsEl = document.getElementById('rgm-smm-progress-results');
          const closeEl = document.getElementById('rgm-smm-progress-close');
          if (!resultsEl || !closeEl) return;

          resultsEl.style.display = 'block';
          closeEl.style.display = 'inline-flex';

          const ok = document.createElement('div');
          ok.className = 'rgm-smm-progress-results-ok';
          ok.textContent = `Successfully added comments to ${successCount} student${successCount === 1 ? '' : 's'}.`;

          resultsEl.innerHTML = '';
          resultsEl.appendChild(ok);

          if (errorCount > 0) {
            const bad = document.createElement('div');
            bad.className = 'rgm-smm-progress-results-bad';
            bad.textContent = `Failed to add comments to ${errorCount} student${errorCount === 1 ? '' : 's'}.`;
            resultsEl.appendChild(bad);

            const list = document.createElement('div');
            list.className = 'rgm-smm-progress-results-errors';

            (errors || []).forEach(err => {
              const item = document.createElement('div');
              item.className = 'rgm-smm-progress-results-error-item';
              item.textContent = `${err.student || ''}: ${err.error || ''}`;
              list.appendChild(item);
            });

            resultsEl.appendChild(list);
          }
        }
      };
    },

    async showConfirmationDialog({ student, commentContent, compatRowData }) {
      // Create backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-smm-confirm-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'rgm-smm-confirm-modal';
      modal.className = 'rgm-smm-modal rgm-smm-confirm-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Confirm Add Comment to 1 Student';

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = 'Please review before sending.';

      titleWrap.append(title, subtitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      closeBtn.type = 'button';
      closeBtn.textContent = '✖ Close';

      header.append(titleWrap, closeBtn);

      const body = document.createElement('div');
      body.className = 'rgm-smm-body';

      // Check if variables are present
      const hasVariables = window.StudentMessageTemplates.TEMPLATE_VARIABLES.some(v =>
        (commentContent || '').includes(`{{${v.key}}}`)
      );

      if (hasVariables) {
        const variableNote = document.createElement('div');
        variableNote.className = 'rgm-smm-notice rgm-smm-notice-warning';
        variableNote.innerHTML = `Preview showing personalized content for <strong>${compatRowData?.stdname || student?.name || ''}</strong>.`;
        body.appendChild(variableNote);
      }

      // Student card block
      const studentCard = document.createElement('div');
      studentCard.className = 'rgm-smm-student-card';

      const studentName = document.createElement('div');
      studentName.className = 'rgm-smm-student-name';
      studentName.textContent = compatRowData?.stdname || student?.name || '';

      const studentMeta = document.createElement('div');
      studentMeta.className = 'rgm-smm-student-meta';

      const courseLine = document.createElement('div');
      courseLine.textContent = `Course: ${compatRowData?.coursename || '(unknown)'}`;

      const assignmentLine = document.createElement('div');
      assignmentLine.textContent = `Assignment: ${compatRowData?.assignment_name || '(unknown)'}`;

      const dueLine = document.createElement('div');
      dueLine.textContent = compatRowData?.assignment_duedate
        ? `Due: ${window.moment ? window.moment(compatRowData.assignment_duedate).format('YYYY-MM-DD HH:mm') : String(compatRowData.assignment_duedate)}`
        : 'Due: (unknown)';

      studentMeta.append(courseLine, assignmentLine, dueLine);
      studentCard.append(studentName, studentMeta);

      const label = document.createElement('div');
      label.className = 'rgm-smm-confirm-label';
      label.textContent = 'Comment to be added:';

      const preview = document.createElement('div');
      preview.className = 'rgm-smm-confirm-preview';

      const expandedForPreview = hasVariables
        ? window.StudentMessageTemplates.replaceTemplateVariables(commentContent || '', compatRowData)
        : (commentContent || '');

      preview.innerHTML = expandedForPreview;

      // File list section (uses current FilePond selection)
      const fileListSection = document.createElement('div');
      fileListSection.className = 'rgm-smm-file-list-section';

      const filesLabel = document.createElement('div');
      filesLabel.className = 'rgm-smm-file-list-label';
      filesLabel.textContent = 'Files to be attached:';

      const filesList = document.createElement('div');
      filesList.className = 'rgm-smm-file-list-container';

      const fileMgr = window.StudentMessageFileUploadManager;
      const uploadedFiles = (fileMgr && typeof fileMgr.getFiles === 'function')
        ? await fileMgr.getFiles()
        : [];

      if (uploadedFiles.length > 0) {
        uploadedFiles.forEach(file => {
          const fileItem = document.createElement('div');
          fileItem.className = 'rgm-smm-file-item';

          const name = file.filename || file.name || '';
          const iconClass = this.getFileIconClass(name);
          const size = file.fileSize || file.size || 0;
          const kb = (size / 1024).toFixed(2);

          fileItem.innerHTML = `
            <div class="rgm-smm-file-item-row">
              <i class="${iconClass} rgm-smm-file-icon" aria-hidden="true"></i>
              <div class="rgm-smm-file-meta">
                <div class="rgm-smm-file-name">${name}</div>
                <div class="rgm-smm-file-size">${kb} KB</div>
              </div>
            </div>
          `;
          filesList.appendChild(fileItem);
        });
      } else {
        const noFiles = document.createElement('div');
        noFiles.className = 'rgm-smm-no-files';
        noFiles.textContent = 'No files attached';
        filesList.appendChild(noFiles);
      }

      fileListSection.append(filesLabel, filesList);

      const actions = document.createElement('div');
      actions.className = 'rgm-smm-confirm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary';
      cancelBtn.textContent = 'Cancel';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      sendBtn.textContent = 'Send';

      actions.append(cancelBtn, sendBtn);

      body.append(studentCard, label, preview, fileListSection);

      modal.append(header, body, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this._confirmationBackdrop = backdrop;

      // Close on backdrop click
      const onBackdropClick = (e) => {
        if (e.target === backdrop) this.closeConfirmationDialog();
      };
      backdrop.addEventListener('click', onBackdropClick);

      // Resolve like reference flow
      const confirmed = await new Promise((resolve) => {
        const cleanup = () => {
          backdrop.removeEventListener('click', onBackdropClick);
          this.closeConfirmationDialog();
        };

        cancelBtn.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });

        closeBtn.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });

        sendBtn.addEventListener('click', () => {
          cleanup();
          resolve(true);
        });
      });

      return confirmed;
    },

    async showMessageConfirmationDialog({ student, subject, body, uploadedFiles, compatRowData }) {
      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-smm-confirm-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.id = 'rgm-smm-confirm-modal';
      modal.className = 'rgm-smm-modal rgm-smm-confirm-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Confirm Send Message to 1 Student';

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = 'Please review before sending.';

      titleWrap.append(title, subtitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      closeBtn.type = 'button';
      closeBtn.textContent = '✖ Close';

      header.append(titleWrap, closeBtn);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'rgm-smm-body';

      const rawSubject = String(subject || '');
      const rawBody = String(body || '');

      const hasVariables = window.StudentMessageTemplates.TEMPLATE_VARIABLES.some(v =>
        rawSubject.includes(`{{${v.key}}}`) || rawBody.includes(`{{${v.key}}}`)
      );

      if (hasVariables) {
        const variableNote = document.createElement('div');
        variableNote.className = 'rgm-smm-notice rgm-smm-notice-warning';
        variableNote.innerHTML = `Preview showing personalized content for <strong>${compatRowData?.stdname || student?.name || ''}</strong>.`;
        bodyEl.appendChild(variableNote);
      }

      const studentCard = document.createElement('div');
      studentCard.className = 'rgm-smm-student-card';

      const studentName = document.createElement('div');
      studentName.className = 'rgm-smm-student-name';
      studentName.textContent = compatRowData?.stdname || student?.name || '';

      const studentMeta = document.createElement('div');
      studentMeta.className = 'rgm-smm-student-meta';

      const courseLine = document.createElement('div');
      courseLine.textContent = `Course: ${compatRowData?.coursename || '(unknown)'}`;

      studentMeta.append(courseLine);
      studentCard.append(studentName, studentMeta);

      const subjLabel = document.createElement('div');
      subjLabel.className = 'rgm-smm-confirm-label';
      subjLabel.textContent = 'Subject:';

      const subjPreview = document.createElement('div');
      subjPreview.className = 'rgm-smm-confirm-preview';
      subjPreview.innerHTML = hasVariables
        ? window.StudentMessageTemplates.replaceTemplateVariables(rawSubject, compatRowData)
        : rawSubject;

      const msgLabel = document.createElement('div');
      msgLabel.className = 'rgm-smm-confirm-label';
      msgLabel.textContent = 'Message:';

      const msgPreview = document.createElement('div');
      msgPreview.className = 'rgm-smm-confirm-preview';
      const expandedBody = hasVariables
        ? window.StudentMessageTemplates.replaceTemplateVariables(rawBody, compatRowData)
        : rawBody;
      msgPreview.innerHTML = String(expandedBody || '').replace(/\r\n|\n|\r/g, '<br>');

      const fileListSection = document.createElement('div');
      fileListSection.className = 'rgm-smm-file-list-section';

      const filesLabel = document.createElement('div');
      filesLabel.className = 'rgm-smm-file-list-label';
      filesLabel.textContent = 'Files to be attached:';

      const filesList = document.createElement('div');
      filesList.className = 'rgm-smm-file-list-container';

      const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
      if (files.length > 0) {
        files.forEach(file => {
          const fileItem = document.createElement('div');
          fileItem.className = 'rgm-smm-file-item';

          const name = file.filename || file.name || '';
          const iconClass = this.getFileIconClass(name);
          const size = file.fileSize || file.size || 0;
          const kb = (size / 1024).toFixed(2);

          fileItem.innerHTML = `
            <div class="rgm-smm-file-item-row">
              <i class="${iconClass} rgm-smm-file-icon" aria-hidden="true"></i>
              <div class="rgm-smm-file-meta">
                <div class="rgm-smm-file-name">${name}</div>
                <div class="rgm-smm-file-size">${kb} KB</div>
              </div>
            </div>
          `;
          filesList.appendChild(fileItem);
        });
      } else {
        const noFiles = document.createElement('div');
        noFiles.className = 'rgm-smm-no-files';
        noFiles.textContent = 'No files attached';
        filesList.appendChild(noFiles);
      }

      fileListSection.append(filesLabel, filesList);

      const actions = document.createElement('div');
      actions.className = 'rgm-smm-confirm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary';
      cancelBtn.textContent = 'Cancel';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      sendBtn.textContent = 'Send';

      actions.append(cancelBtn, sendBtn);

      bodyEl.append(studentCard, subjLabel, subjPreview, msgLabel, msgPreview, fileListSection);

      modal.append(header, bodyEl, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this._confirmationBackdrop = backdrop;

      const onBackdropClick = (e) => {
        if (e.target === backdrop) this.closeConfirmationDialog();
      };
      backdrop.addEventListener('click', onBackdropClick);

      const confirmed = await new Promise((resolve) => {
        const cleanup = () => {
          backdrop.removeEventListener('click', onBackdropClick);
          this.closeConfirmationDialog();
        };

        cancelBtn.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });

        closeBtn.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });

        sendBtn.addEventListener('click', () => {
          cleanup();
          resolve(true);
        });
      });

      return confirmed;
    },

    open({ courseId, assignmentId, student }) {
      ensureDeps();

      this.state.courseId = courseId;
      this.state.assignmentId = assignmentId;
      this.state.student = student;
      this.state.currentTab = 'comment';
      this.state.uploadContext = 'comment';

      const compatRowData = buildCompatRowData({ courseId, assignmentId, student });

      // Debug logging to understand what data we have available at modal-open time
      console.log('[StudentMessage][ModalOpen]', {
        courseId,
        assignmentId,
        student,
        compatRowData,
        hasCourseInfoGetter: !!(window.RubricGraderModal && window.RubricGraderModal.getCourseInfo),
        csrfTokenPresent: !!(window.CanvasRestAPI && window.CanvasRestAPI.getCsrfToken && window.CanvasRestAPI.getCsrfToken())
      });

      this.close(); // ensure no duplicates

      const backdrop = document.createElement('div');
      backdrop.className = 'rgm-smm-backdrop';
      backdrop.id = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'rgm-smm-modal';
      modal.id = 'rgm-smm-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Message/Comment Student';

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = `${student?.name || ''} (User ID: ${student?.userId || 'n/a'})`;

      titleWrap.append(title, subtitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-close';
      closeBtn.type = 'button';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => this.close());

      header.append(titleWrap, closeBtn);

      const body = document.createElement('div');
      body.className = 'rgm-smm-body';

      const tabs = document.createElement('div');
      tabs.className = 'rgm-smm-tabs';
      tabs.id = 'rgm-smm-tabs';
      tabs.innerHTML = `
        <button class="rgm-smm-tab-btn" type="button" data-tab="comment" aria-selected="true">Add Submission Comment</button>
        <button class="rgm-smm-tab-btn" type="button" data-tab="message" aria-selected="false">Send Inbox Message</button>
      `;

      // Comment tab
      const commentPane = document.createElement('div');
      commentPane.id = 'rgm-smm-pane-comment';

      const commentVariables = createVariableTray((v) => {
        const iframe = document.getElementById('rgm-smm-tinymce-iframe');
        if (!iframe) {
          console.warn('[StudentMessage][VariableInsert] TinyMCE iframe not found');
          return;
        }

        const placeholder = String(v?.placeholder || '');
        console.log('[StudentMessage][VariableInsert] inserting into TinyMCE', {
          key: v?.key,
          placeholder,
          compatRowData
        });

        // Since this modal is for a single student, insert resolved content immediately.
        const resolved = window.StudentMessageTemplates.replaceTemplateVariables(placeholder, compatRowData);
        console.log('[StudentMessage][VariableInsert] resolved', {
          key: v?.key,
          resolvedPreview: String(resolved || '').slice(0, 200),
          resolvedLength: String(resolved || '').length
        });

        iframe.contentWindow.postMessage({ type: 'INSERT_CONTENT', content: resolved }, '*');
      });

      const commentEditorLabel = document.createElement('label');
      commentEditorLabel.textContent = 'Comment:';

      const commentTools = document.createElement('div');
      commentTools.style.display = 'flex';
      commentTools.style.gap = '12px';
      commentTools.style.justifyContent = 'flex-end';
      commentTools.style.margin = '10px 0';

      const openLibraryBtn = document.createElement('button');
      openLibraryBtn.type = 'button';
      openLibraryBtn.className = 'rgm-smm-btn';
      openLibraryBtn.textContent = 'Comment Library';
      openLibraryBtn.addEventListener('click', () => {
        const iframe = document.getElementById('rgm-smm-tinymce-iframe');
        if (!iframe) {
          alert('Editor not found.');
          return;
        }

        CommentLibraryModal.open({
          onUse: (commentText) => {
            iframe.contentWindow.postMessage({ type: 'INSERT_CONTENT', content: String(commentText || '') }, '*');
          }
        });
      });

      const addToLibraryBtn = document.createElement('button');
      addToLibraryBtn.type = 'button';
      addToLibraryBtn.className = 'rgm-smm-btn';
      addToLibraryBtn.textContent = 'Add to Comment Library';
      addToLibraryBtn.addEventListener('click', async () => {
        const iframe = document.getElementById('rgm-smm-tinymce-iframe');
        if (!iframe) {
          alert('Editor not found.');
          return;
        }

        // Match reference: request TinyMCE content via postMessage.
        iframe.contentWindow.postMessage({ type: 'GET_CONTENT' }, '*');

        const content = await new Promise((resolve) => {
          const handler = (e) => {
            if (e.data?.type === 'TMCE_CONTENT') {
              window.removeEventListener('message', handler);
              resolve(e.data.content);
            }
          };
          window.addEventListener('message', handler);
          setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve('');
          }, 5000);
        });

        const raw = String(content || '');
        if (!raw.trim()) {
          alert('Please enter a comment before saving to the library.');
          return;
        }

        // Match reference minify behavior.
        const minified = raw
          .replace(/>\s+</g, '><')
          .replace(/\n/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        SaveToCommentLibraryModal.open(minified);
      });

      commentTools.append(openLibraryBtn, addToLibraryBtn);

      const tinymceIframe = document.createElement('iframe');
      tinymceIframe.id = 'rgm-smm-tinymce-iframe';
      tinymceIframe.src = (window.chrome?.runtime?.getURL)
        ? chrome.runtime.getURL('src/messaging/tinymce.html')
        : '';
      tinymceIframe.style.width = '100%';
      tinymceIframe.style.border = '1px solid #cfd3d7';
      tinymceIframe.style.borderRadius = '8px';
      tinymceIframe.style.minHeight = '360px';

      commentPane.append(commentVariables, commentEditorLabel, commentTools, tinymceIframe);

      // Message tab
      const messagePane = document.createElement('div');
      messagePane.id = 'rgm-smm-pane-message';
      messagePane.style.display = 'none';

      const messageVariables = createVariableTray((v) => {
        const subj = document.getElementById('rgm-smm-message-subject');
        const bodyEl = document.getElementById('rgm-smm-message-body');

        // Since this modal is for a single student, insert resolved content immediately.
        const resolved = window.StudentMessageTemplates.replaceTemplateVariables(String(v.placeholder || ''), compatRowData);

        // simplest: append to end of body if focus not on subject
        if (document.activeElement === subj) {
          subj.value = (subj.value || '') + resolved;
        } else {
          bodyEl.value = (bodyEl.value || '') + resolved;
        }
      });

      const subjectSection = document.createElement('div');
      subjectSection.className = 'rgm-smm-section';
      const subjectLabel = document.createElement('label');
      subjectLabel.textContent = 'Subject:';
      const subjectInput = document.createElement('input');
      subjectInput.id = 'rgm-smm-message-subject';
      subjectInput.className = 'rgm-smm-input';
      subjectInput.type = 'text';
      subjectInput.placeholder = 'Enter message subject...';
      subjectSection.append(subjectLabel, subjectInput);

      const bodySection = document.createElement('div');
      bodySection.className = 'rgm-smm-section';
      const bodyLabel = document.createElement('label');
      bodyLabel.textContent = 'Message (plain text):';
      const bodyTextarea = document.createElement('textarea');
      bodyTextarea.id = 'rgm-smm-message-body';
      bodyTextarea.className = 'rgm-smm-textarea';
      bodyTextarea.placeholder = 'Enter your message...';
      bodySection.append(bodyLabel, bodyTextarea);

      messagePane.append(messageVariables, subjectSection, bodySection);

      // Attachments (FilePond iframe)
      const attachmentsSection = document.createElement('div');
      attachmentsSection.className = 'rgm-smm-section';
      const attLabel = document.createElement('label');
      attLabel.textContent = 'Attachments:';
      const attBox = document.createElement('div');
      attBox.id = 'rgm-smm-file-upload-container';
      attachmentsSection.append(attLabel, attBox);

      body.append(tabs, commentPane, messagePane, attachmentsSection);

      const actions = document.createElement('div');
      actions.className = 'rgm-smm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.close());

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.id = 'rgm-smm-submit';
      submitBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      submitBtn.textContent = 'Add Comment';
      submitBtn.addEventListener('click', async () => {
        const originalText = submitBtn.textContent;
        const setBusy = (busyText) => {
          submitBtn.disabled = true;
          submitBtn.textContent = busyText;
        };
        const clearBusy = () => {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        };

        try {
          if (!this.state.student?.userId) {
            alert('Missing userId for this student.');
            return;
          }

          if (this.state.currentTab === 'message') {
            // Send Inbox Message flow (reference parity: confirmation/preview before upload/send)
            const subject = String(document.getElementById('rgm-smm-message-subject')?.value || '').trim();
            const bodyText = String(document.getElementById('rgm-smm-message-body')?.value || '').trim();

            if (!subject) {
              alert('Please enter a subject.');
              return;
            }
            if (!bodyText) {
              alert('Please enter a message.');
              return;
            }

            const fileMgr = window.StudentMessageFileUploadManager;
            if (fileMgr && typeof fileMgr.setUploadContext === 'function') {
              fileMgr.setUploadContext('message');
            }

            // Snapshot selected files for preview (do not upload yet)
            const selectedFiles = (fileMgr && typeof fileMgr.getFiles === 'function')
              ? await fileMgr.getFiles()
              : [];

            const confirmed = await this.showMessageConfirmationDialog({
              student: this.state.student,
              subject,
              body: bodyText,
              uploadedFiles: selectedFiles,
              compatRowData
            });

            if (!confirmed) return;

            setBusy('Sending message...');

            // Upload attachments (message context) and collect file IDs
            let attachmentIds = [];
            if (fileMgr && typeof fileMgr.getFiles === 'function' && typeof fileMgr.uploadFile === 'function') {
              const files = await fileMgr.getFiles();
              console.log('[StudentMessage][MessageSubmit] files selected', { count: files.length, files });

              for (let i = 0; i < files.length; i++) {
                const uploadResult = await fileMgr.uploadFile({
                  courseId: null,
                  assignmentId: null,
                  userId: null,
                  fileIndex: i,
                  studentIndex: 0,
                  onProgress: (p) => {
                    const percent = p?.progress?.percent;
                    if (percent != null) {
                      submitBtn.textContent = `Sending... (upload ${i + 1}/${files.length} ${percent}%)`;
                    }
                  }
                });

                if (uploadResult?.id) attachmentIds.push(uploadResult.id);
                else if (uploadResult?.file_id) attachmentIds.push(uploadResult.file_id);

                console.log('[StudentMessage][MessageSubmit] uploadResult', uploadResult);
              }
            }

            const api = new window.CanvasRestAPI(this.state.courseId);
            const contextCode = `course_${this.state.courseId}`;
            const resp = await api.sendConversation(
              [this.state.student.userId],
              subject,
              bodyText,
              attachmentIds,
              contextCode
            );

            console.log('[StudentMessage][MessageSubmit] sendConversation response', resp);

            if (fileMgr && typeof fileMgr.clearFiles === 'function') fileMgr.clearFiles();
            this.close();
            return;
          }

          setBusy('Preparing comment...');

          // TinyMCE get content
          const iframe = document.getElementById('rgm-smm-tinymce-iframe');
          if (!iframe) {
            alert('Editor not found.');
            return;
          }

          iframe.contentWindow.postMessage({ type: 'GET_CONTENT' }, '*');
          const content = await new Promise((resolve) => {
            const handler = (e) => {
              if (e.data?.type === 'TMCE_CONTENT') {
                window.removeEventListener('message', handler);
                resolve(e.data.content);
              }
            };
            window.addEventListener('message', handler);
            setTimeout(() => {
              window.removeEventListener('message', handler);
              resolve('');
            }, 5000);
          });

          if (!content || !String(content).trim()) {
            alert('Please enter a comment.');
            return;
          }

          // Show confirmation modal BEFORE variable expansion + uploads (matches reference flow)
          const confirmed = await this.showConfirmationDialog({
            student: this.state.student,
            commentContent: String(content),
            compatRowData
          });

          if (!confirmed) {
            return;
          }

          // Create progress modal immediately after confirmation (reference flow)
          const progress = this.createProgressModal({
            student: this.state.student,
            compatRowData
          });

          let successCount = 0;
          let errorCount = 0;
          const errors = [];

          const fileMgr = window.StudentMessageFileUploadManager;

          try {
            // Expand variables after confirmation
            progress.update({ statusText: 'Preparing personalized comment…', progressPercent: 5 });
            const expanded = window.StudentMessageTemplates.replaceTemplateVariables(String(content), compatRowData);

            // Upload any selected files via FilePond (comment context)
            progress.update({ statusText: 'Checking attachments…', progressPercent: 10 });

            let fileIds = [];

            if (fileMgr && typeof fileMgr.setUploadContext === 'function') {
              fileMgr.setUploadContext('comment');
            }

            if (fileMgr && typeof fileMgr.getFiles === 'function' && typeof fileMgr.uploadFile === 'function') {
              const files = await fileMgr.getFiles();

              console.log('[StudentMessage][CommentSubmit] files selected', { count: files.length, files });

              if (files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                  progress.update({
                    statusText: `Uploading attachment ${i + 1}/${files.length}…`,
                    progressPercent: 15 + Math.round((i / files.length) * 55)
                  });

                  const uploadResult = await fileMgr.uploadFile({
                    courseId: this.state.courseId,
                    assignmentId: this.state.assignmentId,
                    userId: this.state.student.userId,
                    fileIndex: i,
                    studentIndex: 0,
                    onProgress: (p) => {
                      const percent = p?.progress?.percent;
                      if (percent != null) {
                        const base = 15 + Math.round((i / files.length) * 55);
                        const slice = Math.round((percent / 100) * Math.round(55 / files.length));
                        progress.update({
                          statusText: `Uploading attachment ${i + 1}/${files.length}… ${percent}%`,
                          progressPercent: Math.min(70, base + slice)
                        });
                      }
                    }
                  });

                  if (uploadResult?.id) {
                    fileIds.push(uploadResult.id);
                  } else if (uploadResult?.file_id) {
                    fileIds.push(uploadResult.file_id);
                  }

                  console.log('[StudentMessage][CommentSubmit] uploadResult', uploadResult);
                }
              }
            } else {
              console.warn('[StudentMessage][CommentSubmit] FileUploadManager not available; continuing without attachments');
            }

            progress.update({ statusText: 'Submitting comment…', progressPercent: 80 });

            const api = new window.CanvasRestAPI(this.state.courseId);
            const resp = await api.addCommentToSubmission(
              this.state.assignmentId,
              this.state.student.userId,
              expanded,
              fileIds
            );

            console.log('[StudentMessage][CommentSubmit] addCommentToSubmission response', resp);

            // Cleanup after success
            if (fileMgr && typeof fileMgr.clearFiles === 'function') fileMgr.clearFiles();

            successCount = 1;
            progress.update({
              statusText: 'Comment added',
              progressPercent: 100,
              isSuccess: true,
              showSpeedGrader: true
            });
          } catch (err) {
            errorCount = 1;
            errors.push({
              student: compatRowData?.stdname || this.state.student?.name || '',
              error: err?.message || String(err)
            });

            progress.update({
              statusText: 'Failed',
              progressPercent: 100,
              isError: true,
              errorText: `Failed: ${err?.message || String(err)}`
            });

            console.error(err);
          } finally {
            progress.showResults({ successCount, errorCount, errors });

            // Only close main modal on full success
            if (errorCount === 0) {
              this.close();
            }
          }

        } catch (err) {
          console.error(err);
          alert(err?.message || String(err));
        } finally {
          clearBusy();
        }
      });

      actions.append(cancelBtn, submitBtn);

      modal.append(header, body, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Mount FilePond iframe
      if (window.StudentMessageFileUploadManager && typeof window.StudentMessageFileUploadManager.initialize === 'function') {
        window.StudentMessageFileUploadManager.initialize({
          containerId: 'rgm-smm-file-upload-container',
          context: 'comment',
          userId: null
        });
      } else {
        attBox.style.border = '1px dashed #cfd3d7';
        attBox.style.borderRadius = '12px';
        attBox.style.padding = '16px';
        attBox.style.color = '#666';
        attBox.textContent = 'File upload manager not loaded.';
      }

      // Tab switching (reference parity: currentTab + uploadContext + setUploadContext)
      tabs.querySelectorAll('.rgm-smm-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.switchTab(btn.dataset.tab);
        });
      });

      // Ensure initial tab state is applied consistently
      this.switchTab('comment');

      // Close on Escape
      this._keydownHandler = (e) => {
        if (e.key === 'Escape') this.close();
      };
      window.addEventListener('keydown', this._keydownHandler);

      // Resize TinyMCE iframe on autoresize message
      this._tinymceResizeListener = (event) => {
        if (event.data?.type === 'EDITOR_RESIZED') {
          const iframe = document.getElementById('rgm-smm-tinymce-iframe');
          if (iframe && event.data.height) {
            iframe.style.height = event.data.height + 'px';
          }
        }
      };
      window.addEventListener('message', this._tinymceResizeListener);
    },

    close() {
      const existing = document.getElementById('rgm-smm-backdrop');
      if (existing) existing.remove();

      // Tear down file upload iframe
      if (window.StudentMessageFileUploadManager && typeof window.StudentMessageFileUploadManager.destroy === 'function') {
        window.StudentMessageFileUploadManager.destroy();
      }

      if (this._keydownHandler) {
        window.removeEventListener('keydown', this._keydownHandler);
        this._keydownHandler = null;
      }
      if (this._tinymceResizeListener) {
        window.removeEventListener('message', this._tinymceResizeListener);
        this._tinymceResizeListener = null;
      }
    }
  };

  window.StudentMessageModal = StudentMessageModal;
  window.StudentMessageCreateVariableTray = createVariableTray;
  window.StudentMessageCommentLibraryModal = CommentLibraryModal;
  window.StudentMessageSaveToCommentLibraryModal = SaveToCommentLibraryModal;
})();
