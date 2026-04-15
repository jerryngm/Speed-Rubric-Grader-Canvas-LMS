// Bulk Student Message Modal
// Depends on:
// - src/messaging/template-variables.js
// - src/messaging/file-upload-manager.js
// - src/messaging/student-message-modal.js (shared exports)
// - src/messaging/bulk-message-dialogs.js
// - src/api/canvas-rest.js
// - src/utils/state-manager.js

(function() {
  'use strict';

  const BulkStudentMessageModal = {
    state: {
      courseId: null, assignmentId: null, students: [],
      selectedUserIds: new Set(), manualDeselected: new Set(),
      currentTab: 'comment', uploadContext: 'comment',
      filterOperator: '>=', filterThreshold: 0
    },

    recipientKey(s) { return String(s?.userId || ''); },

    buildCompatRowData(student) {
      const origin = window.location.origin;
      const { givenName, surname } = window.StudentMessageTemplates.parseGivenSurname(student?.name || '');
      const ci = window.RubricGraderModal?.getCourseInfo?.() || {};
      return {
        odId: student?.userId, userId: student?.userId, user_id: student?.userId,
        course_id: this.state.courseId, assignment_id: this.state.assignmentId,
        stdname: student?.name || '', student_given_name: givenName, student_surname: surname,
        coursename: ci.name || ci.courseName || '', coursenickname: ci.courseNickname || ci.nickname || '',
        term: ci.term || ci.termName || '', student_section_name: student?.sectionName || '',
        assignment_name: student?.assignmentName || '', assignment_group: student?.assignmentGroup || '',
        assignment_duedate: student?.dueDate || '',
        assignment_link: `${origin}/courses/${this.state.courseId}/assignments/${this.state.assignmentId}`
      };
    },

    open({ courseId, assignmentId, students }) {
      this.state.courseId = courseId;
      this.state.assignmentId = assignmentId;
      this.state.students = students || [];
      this.state.selectedUserIds = new Set();
      this.state.manualDeselected = new Set();
      this.state.currentTab = 'comment';
      this.state.uploadContext = 'comment';
      this.close();

      const backdrop = document.createElement('div');
      backdrop.className = 'rgm-smm-backdrop';
      backdrop.id = 'rgm-bulk-smm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'rgm-smm-modal rgm-bulk-smm-modal';
      modal.id = 'rgm-bulk-smm-modal';

      const header = this._buildHeader();
      const body = document.createElement('div');
      body.className = 'rgm-smm-body rgm-bulk-smm-body';

      const notice = document.createElement('div');
      notice.className = 'rgm-smm-notice rgm-smm-notice-warning';
      notice.textContent = 'Filtering is based on original fetched grades, not unsaved table edits.';

      body.append(notice, this._buildFilterSidebar(), this._buildMainPane());

      const actions = document.createElement('div');
      actions.className = 'rgm-smm-actions rgm-bulk-smm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'rgm-smm-btn rgm-bulk-smm-btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this.close());

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.id = 'rgm-bulk-smm-submit';
      submitBtn.className = 'rgm-smm-btn rgm-bulk-smm-btn-primary';
      submitBtn.textContent = 'Add Comment';
      submitBtn.addEventListener('click', () => this.handleSubmit());

      actions.append(cancelBtn, submitBtn);
      modal.append(header, body, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this.loadSavedFilter();
      this._initFileUpload();

      this._keydownHandler = (e) => { if (e.key === 'Escape') this.close(); };
      window.addEventListener('keydown', this._keydownHandler);

      this._tinymceResizeListener = (e) => {
        if (e.data?.type === 'EDITOR_RESIZED') {
          const iframe = document.getElementById('rgm-bulk-smm-tinymce-iframe');
          if (iframe && e.data.height) iframe.style.height = e.data.height + 'px';
        }
      };
      window.addEventListener('message', this._tinymceResizeListener);
    },

    _buildHeader() {
      const header = document.createElement('div');
      header.className = 'rgm-smm-header rgm-bulk-smm-header';
      const wrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = 'Bulk Message Students';
      const sub = document.createElement('div');
      sub.className = 'rgm-smm-subtitle';
      sub.textContent = `${this.state.students.length} students loaded`;
      wrap.append(title, sub);
      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-bulk-smm-btn-close';
      closeBtn.type = 'button';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => this.close());
      header.append(wrap, closeBtn);
      return header;
    },

    _buildFilterSidebar() {
      const sidebar = document.createElement('div');
      sidebar.className = 'rgm-bulk-smm-sidebar';

      sidebar.innerHTML = `
        <h4 style="margin-bottom:12px;font-size:14px;font-weight:700">Filter by Progress</h4>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600">Operator:</label>
        <select id="rgm-bulk-filter-operator" class="rgm-smm-input" style="width:100%;padding:8px 10px;border:1px solid #cfd3d7;border-radius:8px;font-size:14px">
          <option value="<">&lt;</option><option value="<=">&lt;=</option>
          <option value="=">=</option><option value=">=" selected>&gt;=</option>
          <option value=">">&gt;</option>
        </select>
        <label style="display:block;margin-top:12px;margin-bottom:6px;font-size:13px;font-weight:600">Threshold (%):</label>
        <input id="rgm-bulk-filter-threshold" type="number" min="0" max="100" value="0" style="width:100%;padding:8px 10px;border:1px solid #cfd3d7;border-radius:8px;font-size:14px;box-sizing:border-box" />
      `;

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      applyBtn.textContent = 'Apply Filter';
      applyBtn.style.marginTop = '12px';
      applyBtn.style.width = '100%';
      applyBtn.addEventListener('click', () => this.applyFilter());

      const recipientList = document.createElement('div');
      recipientList.id = 'rgm-bulk-recipient-list';
      recipientList.style.marginTop = '18px';

      sidebar.append(applyBtn, recipientList);
      return sidebar;
    },

    _buildMainPane() {
      const pane = document.createElement('div');
      pane.className = 'rgm-bulk-smm-main-pane';

      const tabs = document.createElement('div');
      tabs.className = 'rgm-smm-tabs';
      tabs.id = 'rgm-bulk-smm-tabs';
      tabs.innerHTML = `
        <button class="rgm-smm-tab-btn" type="button" data-tab="comment" aria-selected="true">Add Submission Comment</button>
        <button class="rgm-smm-tab-btn" type="button" data-tab="message" aria-selected="false">Send Inbox Message</button>
      `;
      tabs.querySelectorAll('.rgm-smm-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
      });

      // Comment pane with variable tray + comment library buttons
      const commentPane = document.createElement('div');
      commentPane.id = 'rgm-bulk-smm-pane-comment';

      const commentVarTray = this._createVariableTray('comment');
      const commentLabel = document.createElement('label');
      commentLabel.textContent = 'Comment:';

      const commentTools = document.createElement('div');
      commentTools.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin:10px 0';

      const openLibBtn = document.createElement('button');
      openLibBtn.type = 'button';
      openLibBtn.className = 'rgm-smm-btn';
      openLibBtn.textContent = 'Comment Library';
      openLibBtn.addEventListener('click', () => {
        const iframe = document.getElementById('rgm-bulk-smm-tinymce-iframe');
        if (!iframe) return;
        window.StudentMessageCommentLibraryModal?.open({
          onUse: (text) => { iframe.contentWindow.postMessage({ type: 'INSERT_CONTENT', content: String(text || '') }, '*'); }
        });
      });

      const addToLibBtn = document.createElement('button');
      addToLibBtn.type = 'button';
      addToLibBtn.className = 'rgm-smm-btn';
      addToLibBtn.textContent = 'Add to Comment Library';
      addToLibBtn.addEventListener('click', async () => {
        const iframe = document.getElementById('rgm-bulk-smm-tinymce-iframe');
        if (!iframe) return;
        iframe.contentWindow.postMessage({ type: 'GET_CONTENT' }, '*');
        const content = await this._getTinyMCEContent();
        if (!content.trim()) return;
        const minified = content.replace(/>\s+</g, '><').replace(/\n/g, '').replace(/\s+/g, ' ').trim();
        window.StudentMessageSaveToCommentLibraryModal?.open(minified);
      });

      commentTools.append(openLibBtn, addToLibBtn);

      const tinymce = document.createElement('iframe');
      tinymce.id = 'rgm-bulk-smm-tinymce-iframe';
      tinymce.src = chrome?.runtime?.getURL ? chrome.runtime.getURL('src/messaging/tinymce.html') : '';
      tinymce.style.cssText = 'width:100%;border:1px solid #cfd3d7;border-radius:8px;min-height:360px';

      commentPane.append(commentVarTray, commentLabel, commentTools, tinymce);

      // Message pane with variable tray
      const messagePane = document.createElement('div');
      messagePane.id = 'rgm-bulk-smm-pane-message';
      messagePane.className = 'rgm-bulk-smm-message-pane';
      messagePane.style.display = 'none';

      const messageVarTray = this._createVariableTray('message');

      const subjSection = document.createElement('div');
      subjSection.className = 'rgm-smm-section';
      subjSection.innerHTML = `<label>Subject:</label><input id="rgm-bulk-smm-message-subject" class="rgm-smm-input" type="text" placeholder="Enter message subject..." />`;

      const bodySection = document.createElement('div');
      bodySection.className = 'rgm-smm-section';
      bodySection.innerHTML = `<label>Message (plain text):</label><textarea id="rgm-bulk-smm-message-body" class="rgm-smm-textarea" placeholder="Enter your message..."></textarea>`;

      messagePane.append(messageVarTray, subjSection, bodySection);

      // Attachments
      const attSection = document.createElement('div');
      attSection.className = 'rgm-smm-section';
      attSection.innerHTML = `<label>Attachments:</label><div id="rgm-bulk-smm-file-upload-container"></div>`;

      // Preview notice
      const previewNotice = document.createElement('div');
      previewNotice.className = 'rgm-smm-notice';
      previewNotice.style.marginTop = '12px';
      previewNotice.textContent = 'Template variables expand separately for each recipient when sending.';

      pane.append(tabs, commentPane, messagePane, attSection, previewNotice);
      return pane;
    },

    _createVariableTray(context) {
      if (typeof window.StudentMessageCreateVariableTray === 'function') {
        return window.StudentMessageCreateVariableTray((v) => {
          const placeholder = String(v?.placeholder || '');
          if (context === 'comment') {
            const iframe = document.getElementById('rgm-bulk-smm-tinymce-iframe');
            if (iframe) iframe.contentWindow.postMessage({ type: 'INSERT_CONTENT', content: placeholder }, '*');
          } else {
            const subj = document.getElementById('rgm-bulk-smm-message-subject');
            const body = document.getElementById('rgm-bulk-smm-message-body');
            if (document.activeElement === subj) { subj.value = (subj.value || '') + placeholder; }
            else if (body) { body.value = (body.value || '') + placeholder; }
          }
        });
      }
      // Fallback: no variable tray if shared function unavailable
      return document.createElement('div');
    },

    _initFileUpload() {
      const mgr = window.StudentMessageFileUploadManager;
      if (mgr && typeof mgr.initialize === 'function') {
        mgr.initialize({ containerId: 'rgm-bulk-smm-file-upload-container', context: 'comment', userId: null });
      }
    },

    async _getTinyMCEContent() {
      const iframe = document.getElementById('rgm-bulk-smm-tinymce-iframe');
      if (!iframe) return '';
      iframe.contentWindow.postMessage({ type: 'GET_CONTENT' }, '*');
      return new Promise((resolve) => {
        const handler = (e) => {
          if (e.data?.type === 'TMCE_CONTENT') { window.removeEventListener('message', handler); resolve(e.data.content); }
        };
        window.addEventListener('message', handler);
        setTimeout(() => { window.removeEventListener('message', handler); resolve(''); }, 5000);
      });
    },

    switchTab(tabName) {
      const tab = tabName === 'message' ? 'message' : 'comment';
      this.state.currentTab = tab;
      this.state.uploadContext = tab;
      const tabsEl = document.getElementById('rgm-bulk-smm-tabs');
      if (tabsEl) tabsEl.querySelectorAll('.rgm-smm-tab-btn').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
      const cp = document.getElementById('rgm-bulk-smm-pane-comment');
      const mp = document.getElementById('rgm-bulk-smm-pane-message');
      const sb = document.getElementById('rgm-bulk-smm-submit');
      if (cp) cp.style.display = tab === 'comment' ? '' : 'none';
      if (mp) mp.style.display = tab === 'message' ? '' : 'none';
      if (sb) sb.textContent = tab === 'comment' ? 'Add Comment' : 'Send Message';
      window.StudentMessageFileUploadManager?.setUploadContext?.(tab);
    },

    async loadSavedFilter() {
      const saved = await window.StateManager.loadBulkMessageFilter(this.state.courseId, this.state.assignmentId);
      if (saved) {
        this.state.filterOperator = String(saved.operator || '>=');
        this.state.filterThreshold = Number.isFinite(Number(saved.threshold)) ? Number(saved.threshold) : 0;
        const op = document.getElementById('rgm-bulk-filter-operator');
        const th = document.getElementById('rgm-bulk-filter-threshold');
        if (op) op.value = this.state.filterOperator;
        if (th) th.value = String(this.state.filterThreshold);
      }
      this.applyFilter();
    },

    _matchFilter(s) {
      const p = s.progressPercent, t = this.state.filterThreshold;
      switch (this.state.filterOperator) {
        case '<': return p < t; case '<=': return p <= t; case '=': return p === t;
        case '>=': return p >= t; case '>': return p > t; default: return false;
      }
    },

    applyFilter() {
      this.state.filterOperator = document.getElementById('rgm-bulk-filter-operator')?.value || '>=';
      this.state.filterThreshold = Number(document.getElementById('rgm-bulk-filter-threshold')?.value) || 0;
      this.state.manualDeselected.clear();

      const matches = this.state.students.filter(s => this._matchFilter(s));
      this.state.selectedUserIds = new Set(matches.map(s => this.recipientKey(s)));
      this._renderRecipientList(matches);
      this._updateSubmitButton();

      window.StateManager.saveBulkMessageFilter(this.state.courseId, this.state.assignmentId, {
        operator: this.state.filterOperator, threshold: this.state.filterThreshold
      });
    },

    _renderRecipientList(matches) {
      const container = document.getElementById('rgm-bulk-recipient-list');
      if (!container) return;
      const sc = this.state.selectedUserIds.size;
      container.innerHTML = `
        <div style="font-weight:800;margin-bottom:8px">Recipients: ${sc} selected / ${matches.length} matched</div>
        <div style="max-height:240px;overflow:auto;border:1px solid #e6e6e6;border-radius:8px;padding:8px;background:#fff">
          ${matches.map(s => {
            const k = this.recipientKey(s);
            const c = this.state.selectedUserIds.has(k);
            return `<label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer"><input type="checkbox" data-user-id="${k}" ${c ? 'checked' : ''}/><span style="flex:1">${s.name} (${s.progressPercent}%)</span></label>`;
          }).join('')}
        </div>
      `;
      container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const id = e.target.dataset.userId;
          if (e.target.checked) { this.state.selectedUserIds.add(id); this.state.manualDeselected.delete(id); }
          else { this.state.selectedUserIds.delete(id); this.state.manualDeselected.add(id); }
          this._updateSubmitButton();
        });
      });
    },

    _updateSubmitButton() {
      const btn = document.getElementById('rgm-bulk-smm-submit');
      if (btn) btn.disabled = this.state.selectedUserIds.size === 0;
      const el = document.querySelector('#rgm-bulk-recipient-list > div:first-child');
      if (el) {
        const mc = this.state.students.filter(s => this._matchFilter(s)).length;
        el.textContent = `Recipients: ${this.state.selectedUserIds.size} selected / ${mc} matched`;
      }
    },

    async handleSubmit() {
      const selected = this.state.students.filter(s => this.state.selectedUserIds.has(this.recipientKey(s)));
      if (selected.length === 0) return;
      if (this.state.currentTab === 'message') await this._sendBulkMessages(selected);
      else await this._addBulkComments(selected);
    },

    async _sendBulkMessages(students) {
      const subject = String(document.getElementById('rgm-bulk-smm-message-subject')?.value || '').trim();
      const bodyText = String(document.getElementById('rgm-bulk-smm-message-body')?.value || '').trim();
      if (!subject || !bodyText) return;

      const firstCompat = this.buildCompatRowData(students[0]);
      const confirmed = await window.BulkMessageDialogs.showMessageConfirmation({
        students, subject, bodyText, firstCompatRowData: firstCompat
      });
      if (!confirmed) return;

      const progress = window.BulkMessageDialogs.createProgressModal({
        students, courseId: this.state.courseId, assignmentId: this.state.assignmentId
      });

      const fileMgr = window.StudentMessageFileUploadManager;
      fileMgr?.setUploadContext?.('message');

      let attachmentIds = [];
      let successCount = 0, errorCount = 0;
      const errors = [];

      try {
        if (fileMgr?.getFiles && fileMgr?.uploadFile) {
          const files = await fileMgr.getFiles();
          for (let i = 0; i < files.length; i++) {
            progress.update({ statusText: `Uploading attachment ${i + 1}/${files.length}\u2026`, progressPercent: Math.round((i / files.length) * 20) });
            const r = await fileMgr.uploadFile({ courseId: null, assignmentId: null, userId: null, fileIndex: i, studentIndex: 0 });
            if (r?.id) attachmentIds.push(r.id);
            else if (r?.file_id) attachmentIds.push(r.file_id);
          }
        }

        const api = new window.CanvasRestAPI(this.state.courseId);
        const ctx = `course_${this.state.courseId}`;

        for (let i = 0; i < students.length; i++) {
          const s = students[i];
          const compat = this.buildCompatRowData(s);
          progress.update({ statusText: `Sending to ${s.name} (${i + 1}/${students.length})\u2026`, progressPercent: 20 + Math.round(((i + 1) / students.length) * 80) });
          progress.updateStudent({ studentIndex: i, statusText: 'Sending\u2026', progressPercent: 50 });
          try {
            const es = window.StudentMessageTemplates.replaceTemplateVariables(subject, compat);
            const eb = window.StudentMessageTemplates.replaceTemplateVariables(bodyText, compat);
            await api.sendConversation([s.userId], es, eb, attachmentIds, ctx);
            successCount++;
            progress.updateStudent({ studentIndex: i, statusText: 'Sent', progressPercent: 100, isSuccess: true });
          } catch (err) {
            errorCount++;
            errors.push({ student: s.name, error: err?.message || String(err) });
            progress.updateStudent({ studentIndex: i, statusText: `Error: ${err?.message || 'Failed'}`, progressPercent: 100, isError: true });
          }
        }

        fileMgr?.clearFiles?.();
      } catch (err) {
        errorCount++;
        errors.push({ student: 'Upload', error: err?.message || String(err) });
      }

      progress.showResults({ successCount, errorCount, errors });
      if (errorCount === 0) this.close();
    },

    async _addBulkComments(students) {
      const content = await this._getTinyMCEContent();
      if (!content || !String(content).trim()) return;

      const firstCompat = this.buildCompatRowData(students[0]);
      const confirmed = await window.BulkMessageDialogs.showCommentConfirmation({
        students, commentContent: content, firstCompatRowData: firstCompat
      });
      if (!confirmed) return;

      const progress = window.BulkMessageDialogs.createProgressModal({
        students, courseId: this.state.courseId, assignmentId: this.state.assignmentId
      });

      const fileMgr = window.StudentMessageFileUploadManager;
      fileMgr?.setUploadContext?.('comment');

      const api = new window.CanvasRestAPI(this.state.courseId);
      let successCount = 0, errorCount = 0;
      const errors = [];

      for (let i = 0; i < students.length; i++) {
        const s = students[i];
        const compat = this.buildCompatRowData(s);
        progress.update({ statusText: `Processing ${s.name} (${i + 1}/${students.length})\u2026`, progressPercent: Math.round(((i + 1) / students.length) * 100) });
        progress.updateStudent({ studentIndex: i, statusText: 'Processing\u2026', progressPercent: 50 });

        try {
          const expanded = window.StudentMessageTemplates.replaceTemplateVariables(String(content), compat);
          let fileIds = [];
          if (fileMgr?.getFiles && fileMgr?.uploadFile) {
            const files = await fileMgr.getFiles();
            for (let fi = 0; fi < files.length; fi++) {
              const r = await fileMgr.uploadFile({
                courseId: this.state.courseId, assignmentId: this.state.assignmentId,
                userId: s.userId, fileIndex: fi, studentIndex: i
              });
              if (r?.id) fileIds.push(r.id);
              else if (r?.file_id) fileIds.push(r.file_id);
            }
          }
          await api.addCommentToSubmission(this.state.assignmentId, s.userId, expanded, fileIds);
          successCount++;
          progress.updateStudent({ studentIndex: i, statusText: 'Added', progressPercent: 100, isSuccess: true });
        } catch (err) {
          errorCount++;
          errors.push({ student: s.name, error: err?.message || String(err) });
          progress.updateStudent({ studentIndex: i, statusText: `Error: ${err?.message || 'Failed'}`, progressPercent: 100, isError: true });
        }
      }

      fileMgr?.clearFiles?.();
      progress.showResults({ successCount, errorCount, errors });
      if (errorCount === 0) this.close();
    },

    close() {
      const el = document.getElementById('rgm-bulk-smm-backdrop');
      if (el) el.remove();
      window.StudentMessageFileUploadManager?.destroy?.();
      if (this._keydownHandler) { window.removeEventListener('keydown', this._keydownHandler); this._keydownHandler = null; }
      if (this._tinymceResizeListener) { window.removeEventListener('message', this._tinymceResizeListener); this._tinymceResizeListener = null; }
    }
  };

  window.BulkStudentMessageModal = BulkStudentMessageModal;
})();
