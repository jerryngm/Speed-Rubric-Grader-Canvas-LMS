// Bulk Student Message Modal — Confirmation + Progress dialogs
// Extracted to keep bulk-student-message-modal.js under 200 lines.
// Depends on: src/messaging/student-message-modal.js (shared exports)

(function() {
  'use strict';

  const BulkMessageDialogs = {
    _confirmBackdrop: null,
    _progressBackdrop: null,

    closeConfirmation() {
      const el = document.getElementById('rgm-bulk-confirm-backdrop');
      if (el) el.remove();
      this._confirmBackdrop = null;
    },

    closeProgress() {
      const el = document.getElementById('rgm-bulk-progress-backdrop');
      if (el) el.remove();
      this._progressBackdrop = null;
    },

    async showCommentConfirmation({ students, commentContent, firstCompatRowData }) {
      const count = students.length;
      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-bulk-confirm-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'rgm-smm-modal rgm-smm-confirm-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = `Confirm Add Comment to ${count} Student${count === 1 ? '' : 's'}`;

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = 'Please review before sending.';

      titleWrap.append(title, subtitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      closeBtn.type = 'button';
      closeBtn.textContent = '\u2716 Close';

      header.append(titleWrap, closeBtn);

      const body = document.createElement('div');
      body.className = 'rgm-smm-body';

      const hasVariables = window.StudentMessageTemplates.TEMPLATE_VARIABLES.some(v =>
        (commentContent || '').includes(`{{${v.key}}}`)
      );

      if (hasVariables) {
        const note = document.createElement('div');
        note.className = 'rgm-smm-notice rgm-smm-notice-warning';
        note.innerHTML = `Preview showing personalized content for <strong>${firstCompatRowData?.stdname || ''}</strong>. Variables expand per recipient at send time.`;
        body.appendChild(note);
      }

      const recipientCard = document.createElement('div');
      recipientCard.className = 'rgm-smm-student-card';
      const recipientTitle = document.createElement('div');
      recipientTitle.className = 'rgm-smm-student-name';
      recipientTitle.textContent = `${count} recipient${count === 1 ? '' : 's'} selected`;
      const recipientList = document.createElement('div');
      recipientList.className = 'rgm-smm-student-meta';
      recipientList.textContent = students.map(s => s.name).join(', ');
      recipientCard.append(recipientTitle, recipientList);

      const label = document.createElement('div');
      label.className = 'rgm-smm-confirm-label';
      label.textContent = 'Comment to be added:';

      const preview = document.createElement('div');
      preview.className = 'rgm-smm-confirm-preview';
      const expandedForPreview = hasVariables
        ? window.StudentMessageTemplates.replaceTemplateVariables(commentContent || '', firstCompatRowData)
        : (commentContent || '');
      preview.innerHTML = expandedForPreview;

      const fileListSection = this._buildFileListSection();
      const actions = this._buildConfirmActions();

      body.append(recipientCard, label, preview, fileListSection);
      modal.append(header, body, actions.el);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      this._confirmBackdrop = backdrop;

      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeConfirmation(); });

      return new Promise((resolve) => {
        const cleanup = () => { this.closeConfirmation(); };
        actions.cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
        closeBtn.addEventListener('click', () => { cleanup(); resolve(false); });
        actions.sendBtn.addEventListener('click', () => { cleanup(); resolve(true); });
      });
    },

    async showMessageConfirmation({ students, subject, bodyText, firstCompatRowData }) {
      const count = students.length;
      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-bulk-confirm-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'rgm-smm-modal rgm-smm-confirm-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.textContent = `Confirm Send Message to ${count} Student${count === 1 ? '' : 's'}`;

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = 'Each student receives an individual message thread.';

      titleWrap.append(title, subtitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
      closeBtn.type = 'button';
      closeBtn.textContent = '\u2716 Close';

      header.append(titleWrap, closeBtn);

      const body = document.createElement('div');
      body.className = 'rgm-smm-body';

      const hasVariables = window.StudentMessageTemplates.TEMPLATE_VARIABLES.some(v =>
        (subject || '').includes(`{{${v.key}}}`) || (bodyText || '').includes(`{{${v.key}}}`)
      );

      if (hasVariables) {
        const note = document.createElement('div');
        note.className = 'rgm-smm-notice rgm-smm-notice-warning';
        note.innerHTML = `Preview showing personalized content for <strong>${firstCompatRowData?.stdname || ''}</strong>. Variables expand per recipient at send time.`;
        body.appendChild(note);
      }

      const recipientCard = document.createElement('div');
      recipientCard.className = 'rgm-smm-student-card';
      const recipientTitle = document.createElement('div');
      recipientTitle.className = 'rgm-smm-student-name';
      recipientTitle.textContent = `${count} recipient${count === 1 ? '' : 's'} selected`;
      const recipientList = document.createElement('div');
      recipientList.className = 'rgm-smm-student-meta';
      recipientList.textContent = students.map(s => s.name).join(', ');
      recipientCard.append(recipientTitle, recipientList);

      const subjLabel = document.createElement('div');
      subjLabel.className = 'rgm-smm-confirm-label';
      subjLabel.textContent = 'Subject:';

      const subjPreview = document.createElement('div');
      subjPreview.className = 'rgm-smm-confirm-preview';
      subjPreview.textContent = hasVariables
        ? window.StudentMessageTemplates.replaceTemplateVariables(subject, firstCompatRowData)
        : subject;

      const msgLabel = document.createElement('div');
      msgLabel.className = 'rgm-smm-confirm-label';
      msgLabel.textContent = 'Message:';

      const msgPreview = document.createElement('div');
      msgPreview.className = 'rgm-smm-confirm-preview';
      const expandedBody = hasVariables
        ? window.StudentMessageTemplates.replaceTemplateVariables(bodyText, firstCompatRowData)
        : bodyText;
      msgPreview.innerHTML = String(expandedBody || '').replace(/\r\n|\n|\r/g, '<br>');

      const fileListSection = this._buildFileListSection();
      const actions = this._buildConfirmActions();

      body.append(recipientCard, subjLabel, subjPreview, msgLabel, msgPreview, fileListSection);
      modal.append(header, body, actions.el);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      this._confirmBackdrop = backdrop;

      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeConfirmation(); });

      return new Promise((resolve) => {
        const cleanup = () => { this.closeConfirmation(); };
        actions.cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
        closeBtn.addEventListener('click', () => { cleanup(); resolve(false); });
        actions.sendBtn.addEventListener('click', () => { cleanup(); resolve(true); });
      });
    },

    _buildFileListSection() {
      const section = document.createElement('div');
      section.className = 'rgm-smm-file-list-section';

      const label = document.createElement('div');
      label.className = 'rgm-smm-file-list-label';
      label.textContent = 'Files to be attached:';

      const list = document.createElement('div');
      list.className = 'rgm-smm-file-list-container';

      const fileMgr = window.StudentMessageFileUploadManager;
      const files = (fileMgr && fileMgr.uploadedFiles) || [];

      if (files.length > 0) {
        files.forEach(file => {
          const item = document.createElement('div');
          item.className = 'rgm-smm-file-item';
          const name = file.filename || file.name || '';
          const size = file.fileSize || file.size || 0;
          const kb = (size / 1024).toFixed(2);
          item.innerHTML = `<div class="rgm-smm-file-item-row"><div class="rgm-smm-file-meta"><div class="rgm-smm-file-name">${name}</div><div class="rgm-smm-file-size">${kb} KB</div></div></div>`;
          list.appendChild(item);
        });
      } else {
        const noFiles = document.createElement('div');
        noFiles.className = 'rgm-smm-no-files';
        noFiles.textContent = 'No files attached';
        list.appendChild(noFiles);
      }

      section.append(label, list);
      return section;
    },

    _buildConfirmActions() {
      const el = document.createElement('div');
      el.className = 'rgm-smm-confirm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'rgm-smm-btn rgm-smm-btn-secondary';
      cancelBtn.textContent = 'Cancel';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      sendBtn.textContent = 'Send';

      el.append(cancelBtn, sendBtn);
      return { el, cancelBtn, sendBtn };
    },

    createProgressModal({ students, courseId, assignmentId }) {
      const count = students.length;
      const backdrop = document.createElement('div');
      backdrop.id = 'rgm-bulk-progress-backdrop';
      backdrop.className = 'rgm-smm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'rgm-smm-modal rgm-smm-progress-modal';

      const header = document.createElement('div');
      header.className = 'rgm-smm-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'rgm-smm-title';
      title.id = 'rgm-bulk-progress-title';
      title.textContent = `Processing ${count} Student${count === 1 ? '' : 's'}\u2026`;

      const subtitle = document.createElement('div');
      subtitle.className = 'rgm-smm-subtitle';
      subtitle.textContent = 'Please keep this window open until complete.';

      titleWrap.append(title, subtitle);
      header.append(titleWrap);

      const body = document.createElement('div');
      body.className = 'rgm-smm-body';
      body.id = 'rgm-bulk-progress-body';

      const progressBar = document.createElement('div');
      progressBar.className = 'rgm-smm-progress-bar';
      const progressFill = document.createElement('div');
      progressFill.className = 'rgm-smm-progress-bar-fill';
      progressFill.id = 'rgm-bulk-progress-fill';
      progressFill.style.width = '0%';
      progressBar.appendChild(progressFill);

      const statusText = document.createElement('div');
      statusText.className = 'rgm-smm-progress-status';
      statusText.id = 'rgm-bulk-progress-status';
      statusText.textContent = 'Preparing\u2026';

      const studentCardsContainer = document.createElement('div');
      studentCardsContainer.id = 'rgm-bulk-progress-student-cards';
      studentCardsContainer.style.cssText = 'display:grid;gap:12px;margin-top:18px;max-height:400px;overflow:auto';

      students.forEach((s, idx) => {
        const card = document.createElement('div');
        card.className = 'rgm-smm-progress-student-card';
        card.id = `rgm-bulk-progress-card-${idx}`;
        card.dataset.userId = s.userId;

        const top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';

        const left = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'rgm-smm-progress-student-name';
        name.textContent = s.name;
        left.appendChild(name);

        const right = document.createElement('div');
        const sgLink = document.createElement('a');
        sgLink.className = 'rgm-smm-btn rgm-smm-btn-secondary rgm-smm-btn-small';
        sgLink.textContent = 'SpeedGrader';
        sgLink.href = `${window.location.origin}/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${s.userId}`;
        sgLink.target = '_blank';
        sgLink.rel = 'noopener noreferrer';
        sgLink.style.display = 'none';
        sgLink.id = `rgm-bulk-progress-sg-${idx}`;
        right.appendChild(sgLink);

        top.append(left, right);

        const bar = document.createElement('div');
        bar.className = 'rgm-smm-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'rgm-smm-progress-bar-fill';
        fill.id = `rgm-bulk-progress-fill-${idx}`;
        fill.style.width = '0%';
        bar.appendChild(fill);

        const statusRow = document.createElement('div');
        statusRow.className = 'rgm-smm-progress-status-row';
        const status = document.createElement('div');
        status.className = 'rgm-smm-progress-status';
        status.id = `rgm-bulk-progress-status-${idx}`;
        status.textContent = 'Waiting\u2026';
        statusRow.appendChild(status);

        card.append(top, bar, statusRow);
        studentCardsContainer.appendChild(card);
      });

      const results = document.createElement('div');
      results.id = 'rgm-bulk-progress-results';
      results.style.display = 'none';

      body.append(progressBar, statusText, studentCardsContainer, results);

      const actions = document.createElement('div');
      actions.className = 'rgm-smm-actions';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'rgm-smm-btn rgm-smm-btn-primary';
      closeBtn.id = 'rgm-bulk-progress-close';
      closeBtn.textContent = 'Done';
      closeBtn.style.display = 'none';
      closeBtn.addEventListener('click', () => this.closeProgress());

      actions.append(closeBtn);

      modal.append(header, body, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeProgress(); });

      this._progressBackdrop = backdrop;

      return {
        update: ({ statusText: text, progressPercent }) => {
          const sEl = document.getElementById('rgm-bulk-progress-status');
          const fEl = document.getElementById('rgm-bulk-progress-fill');
          if (sEl && text) sEl.textContent = text;
          if (fEl && progressPercent != null) fEl.style.width = `${progressPercent}%`;
        },
        updateStudent: ({ studentIndex, statusText: text, progressPercent, isSuccess, isError }) => {
          const card = document.getElementById(`rgm-bulk-progress-card-${studentIndex}`);
          const status = document.getElementById(`rgm-bulk-progress-status-${studentIndex}`);
          const fill = document.getElementById(`rgm-bulk-progress-fill-${studentIndex}`);
          const sg = document.getElementById(`rgm-bulk-progress-sg-${studentIndex}`);

          if (status && text) status.textContent = text;
          if (fill && progressPercent != null) fill.style.width = `${progressPercent}%`;
          if (card) {
            card.classList.toggle('is-success', !!isSuccess);
            card.classList.toggle('is-error', !!isError);
          }
          if (sg && isSuccess) sg.style.display = 'inline-flex';
        },
        showResults: ({ successCount, errorCount, errors }) => {
          const resultsEl = document.getElementById('rgm-bulk-progress-results');
          const closeEl = document.getElementById('rgm-bulk-progress-close');
          const titleEl = document.getElementById('rgm-bulk-progress-title');
          if (!resultsEl || !closeEl) return;

          resultsEl.style.display = 'block';
          closeEl.style.display = 'inline-flex';

          if (titleEl) titleEl.textContent = 'Complete';

          const ok = document.createElement('div');
          ok.style.color = '#2e7d32';
          ok.style.fontWeight = '800';
          ok.textContent = `Successfully processed ${successCount} student${successCount === 1 ? '' : 's'}.`;
          resultsEl.innerHTML = '';
          resultsEl.appendChild(ok);

          if (errorCount > 0) {
            const bad = document.createElement('div');
            bad.style.color = '#b00020';
            bad.style.fontWeight = '800';
            bad.style.marginTop = '8px';
            bad.textContent = `Failed for ${errorCount} student${errorCount === 1 ? '' : 's'}.`;
            resultsEl.appendChild(bad);

            (errors || []).forEach(err => {
              const item = document.createElement('div');
              item.style.fontSize = '13px';
              item.style.color = '#666';
              item.textContent = `${err.student || ''}: ${err.error || ''}`;
              resultsEl.appendChild(item);
            });
          }
        }
      };
    }
  };

  window.BulkMessageDialogs = BulkMessageDialogs;
})();
