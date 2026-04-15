// FilePond iframe controller
// Adapted from reference: [`Other Project - For Ref/filepond-iframe-script.js`](Other Project - For Ref/filepond-iframe-script.js:1)

(function() {
  'use strict';

  const MESSAGE_TYPES = {
    INIT: 'INIT',
    GET_FILES: 'GET_FILES',
    CLEAR_FILES: 'CLEAR_FILES',
    FILES_UPDATED: 'FILES_UPDATED',
    FILES_RESPONSE: 'FILES_RESPONSE',
    ERROR: 'ERROR',
    RESIZE_IFRAME: 'RESIZE_IFRAME',
    UPLOAD_FILE: 'UPLOAD_FILE',
    UPLOAD_PROGRESS: 'UPLOAD_PROGRESS',
    UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
    UPLOAD_ERROR: 'UPLOAD_ERROR',
    SET_CONTEXT: 'SET_CONTEXT'
  };

  let config = {
    canvasBaseUrl: window.location.origin,
    csrfToken: null,
    uploadContext: 'comment',
    userId: null
  };

  let pond = null;
  let uploadedFiles = [];

  function sendMessageToParent(message) {
    window.parent.postMessage(message, '*');
  }

  function getCSRFToken() {
    return config.csrfToken;
  }

  const CanvasFileUploader = {
    conversationFolderId: null,

    async getConversationFolderId() {
      if (this.conversationFolderId) return this.conversationFolderId;
      const url = `${config.canvasBaseUrl}/api/v1/users/self/folders/by_path/conversation attachments`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-CSRF-Token': getCSRFToken()
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to resolve conversation attachments folder: ${response.statusText}`);
      }

      const data = await response.json();
      const folderId = data?.[0]?.id;
      if (!folderId) throw new Error('Conversation attachments folder id not found');
      this.conversationFolderId = folderId;
      return folderId;
    },

    async uploadFile({ file, onProgress, context, courseId, assignmentId, userId }) {
      // 1) POST to create upload
      const initUrl = context === 'comment'
        ? `${config.canvasBaseUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}/comments/files`
        : `${config.canvasBaseUrl}/api/v1/users/${config.userId}/files/pending`;

      let initResponse;

      if (context === 'comment') {
        const params = new URLSearchParams({
          name: file.name,
          size: String(file.size),
          content_type: file.type || 'application/octet-stream'
        });

        initResponse = await fetch(`${initUrl}?${params.toString()}`, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': getCSRFToken()
          }
        });
      } else {
        const folderId = await this.getConversationFolderId();
        const form = new FormData();
        form.append('name', file.name);
        form.append('size', String(file.size));
        form.append('content_type', file.type || 'application/octet-stream');
        form.append('parent_folder_id', String(folderId));
        form.append('attachment[intent]', 'message');
        form.append('context_code', `user_${config.userId}`);

        initResponse = await fetch(initUrl, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': getCSRFToken()
          },
          body: form
        });
      }

      if (!initResponse.ok) {
        const err = await initResponse.json().catch(() => ({}));
        throw new Error(err?.message || `Upload init failed: ${initResponse.statusText}`);
      }

      const initData = await initResponse.json();
      const uploadUrl = initData?.upload_url;
      const uploadParams = initData?.upload_params;
      if (!uploadUrl || !uploadParams) throw new Error('Upload init response missing upload_url/upload_params');

      // 2) POST file data to upload_url
      const uploadResult = await this.uploadFileData({ uploadUrl, uploadParams, file, onProgress });

      // 3) Complete upload
      const completed = await this.completeUpload(uploadResult);
      return completed;
    },

    uploadFileData({ uploadUrl, uploadParams, file, onProgress }) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const json = JSON.parse(xhr.responseText);
              resolve(json);
            } catch (_e) {
              // Canvas often returns empty body + Location header
              resolve({ location: xhr.getResponseHeader('Location') });
            }
          } else {
            reject(new Error(`Upload failed: HTTP ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Upload network error'));

        const form = new FormData();
        Object.entries(uploadParams).forEach(([k, v]) => form.append(k, v));
        form.append('file', file);

        xhr.send(form);
      });
    },

    async completeUpload(uploadResult) {
      // If location provided, call it.
      const location = uploadResult?.location;
      if (!location) {
        // Some Canvas instances return file object directly.
        return uploadResult;
      }

      const response = await fetch(location, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': getCSRFToken()
        }
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.message || `Upload complete failed: ${response.statusText}`);
      }

      return await response.json();
    }
  };

  function initializeFilePond() {
    if (pond) return;

    if (window.FilePondPluginImagePreview) {
      FilePond.registerPlugin(FilePondPluginImagePreview);
    }

    const input = document.querySelector('.filepond-input');
    pond = FilePond.create(input, {
      allowMultiple: true,
      instantUpload: false,
      credits: false
    });

    pond.on('addfile', () => notifyParentFilesUpdated());
    pond.on('removefile', () => notifyParentFilesUpdated());

    resizeIframe();
  }

  function notifyParentFilesUpdated() {
    uploadedFiles = pond ? pond.getFiles().map(f => {
      const file = f.file;
      return {
        name: file?.name,
        filename: file?.name,
        size: file?.size,
        fileSize: file?.size,
        type: file?.type
      };
    }) : [];

    sendMessageToParent({
      type: MESSAGE_TYPES.FILES_UPDATED,
      files: uploadedFiles
    });
  }

  async function handleUploadRequest(data) {
    const { courseId, assignmentId, userId, fileIndex, requestId, studentIndex } = data || {};

    try {
      if (!pond) throw new Error('FilePond not initialized');
      const items = pond.getFiles();
      const item = items[fileIndex];
      if (!item) throw new Error(`File index ${fileIndex} not found`);

      const file = item.file;
      sendMessageToParent({
        type: MESSAGE_TYPES.UPLOAD_PROGRESS,
        requestId,
        progress: 0,
        step: 1,
        message: 'Starting upload...',
        fileName: file.name,
        studentIndex,
        fileIndex
      });

      const result = await CanvasFileUploader.uploadFile({
        file,
        context: config.uploadContext,
        courseId,
        assignmentId,
        userId,
        onProgress: (p) => {
          sendMessageToParent({
            type: MESSAGE_TYPES.UPLOAD_PROGRESS,
            requestId,
            progress: p,
            step: 2,
            message: 'Uploading file...',
            fileName: file.name,
            studentIndex,
            fileIndex
          });
        }
      });

      sendMessageToParent({
        type: MESSAGE_TYPES.UPLOAD_SUCCESS,
        requestId,
        fileData: result,
        studentIndex,
        fileIndex
      });
    } catch (error) {
      sendMessageToParent({
        type: MESSAGE_TYPES.UPLOAD_ERROR,
        requestId,
        error: error?.message || String(error),
        studentIndex,
        fileIndex
      });
    }
  }

  function resizeIframe() {
    const height = Math.max(160, document.body.scrollHeight);
    sendMessageToParent({ type: MESSAGE_TYPES.RESIZE_IFRAME, height });
  }

  const resizeObserver = new ResizeObserver(() => resizeIframe());
  resizeObserver.observe(document.body);

  function handleParentMessage(event) {
    const { type, data } = event.data || {};

    if (type === MESSAGE_TYPES.INIT) {
      config = { ...config, ...(data?.config || {}) };
      initializeFilePond();
      return;
    }

    if (type === MESSAGE_TYPES.SET_CONTEXT) {
      config.uploadContext = data?.uploadContext || 'comment';
      return;
    }

    if (type === MESSAGE_TYPES.GET_FILES) {
      sendMessageToParent({
        type: MESSAGE_TYPES.FILES_RESPONSE,
        files: uploadedFiles
      });
      return;
    }

    if (type === MESSAGE_TYPES.CLEAR_FILES) {
      if (pond) pond.removeFiles();
      uploadedFiles = [];
      notifyParentFilesUpdated();
      return;
    }

    if (type === MESSAGE_TYPES.UPLOAD_FILE) {
      handleUploadRequest(data);
      return;
    }
  }

  window.addEventListener('message', handleParentMessage);
})();
