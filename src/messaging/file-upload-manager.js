// Parent-side FileUploadManager for FilePond iframe
// Adapted from reference: [`Other Project - For Ref/missing-tab.js:765`](Other Project - For Ref/missing-tab.js:765)

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

  const FileUploadManager = {
    iframe: null,
    uploadedFiles: [],
    isInitialized: false,
    uploadCallbacks: new Map(),
    pendingFilesCallback: null,
    uploadContext: 'comment',
    currentUserId: null,

    initialize({ containerId, context = 'comment', userId = null }) {
      this.uploadContext = context;
      this.currentUserId = userId;

      this.destroy();

      const container = document.getElementById(containerId);
      if (!container) {
        console.error('File upload container not found:', containerId);
        return;
      }

      this.iframe = document.createElement('iframe');
      this.iframe.id = 'rgm-smm-filepond-iframe';
      this.iframe.src = (window.chrome?.runtime?.getURL)
        ? chrome.runtime.getURL('src/messaging/filepond-iframe.html')
        : 'src/messaging/filepond-iframe.html';
      this.iframe.style.width = '100%';
      this.iframe.style.height = '180px';
      this.iframe.style.border = 'none';
      this.iframe.style.backgroundColor = 'transparent';

      container.innerHTML = '';
      container.appendChild(this.iframe);

      this._messageHandler = (event) => {
        const data = event.data || {};
        const { type, requestId, files, error, height, fileData } = data;

        switch (type) {
          case MESSAGE_TYPES.FILES_UPDATED:
            this.uploadedFiles = files || [];
            break;

          case MESSAGE_TYPES.FILES_RESPONSE:
            if (this.pendingFilesCallback) {
              this.pendingFilesCallback(files || []);
              this.pendingFilesCallback = null;
            }
            break;

          case MESSAGE_TYPES.UPLOAD_PROGRESS: {
            const cb = this.uploadCallbacks.get(requestId);
            if (cb?.onProgress) cb.onProgress(data);
            break;
          }

          case MESSAGE_TYPES.UPLOAD_SUCCESS: {
            const cb = this.uploadCallbacks.get(requestId);
            if (cb?.onSuccess) cb.onSuccess(fileData);
            this.uploadCallbacks.delete(requestId);
            break;
          }

          case MESSAGE_TYPES.UPLOAD_ERROR: {
            const cb = this.uploadCallbacks.get(requestId);
            if (cb?.onError) cb.onError(new Error(error));
            this.uploadCallbacks.delete(requestId);
            break;
          }

          case MESSAGE_TYPES.RESIZE_IFRAME:
            if (this.iframe && height) this.iframe.style.height = `${height}px`;
            break;

          case MESSAGE_TYPES.ERROR:
            console.error('FilePond iframe error:', error);
            break;
        }
      };

      window.addEventListener('message', this._messageHandler);

      this.iframe.addEventListener('load', () => {
        this.isInitialized = true;

        const csrfToken = window?.CanvasRestAPI?.getCsrfToken
          ? window.CanvasRestAPI.getCsrfToken()
          : (window?.CanvasRestAPI?.getCSRFToken ? window.CanvasRestAPI.getCSRFToken() : null);

        console.log('[StudentMessage][FileUploadManager] INIT', {
          canvasBaseUrl: window.location.origin,
          hasCsrfToken: !!csrfToken,
          uploadContext: this.uploadContext,
          userId: this.currentUserId
        });

        this.sendMessage({
          type: MESSAGE_TYPES.INIT,
          data: {
            config: {
              canvasBaseUrl: window.location.origin,
              csrfToken,
              uploadContext: this.uploadContext,
              userId: this.currentUserId
            }
          }
        });
      });
    },

    sendMessage(message) {
      if (this.iframe?.contentWindow && this.isInitialized) {
        this.iframe.contentWindow.postMessage(message, '*');
      }
    },

    setUploadContext(context) {
      this.uploadContext = context;
      this.sendMessage({
        type: MESSAGE_TYPES.SET_CONTEXT,
        data: { uploadContext: context }
      });
    },

    clearFiles() {
      this.sendMessage({ type: MESSAGE_TYPES.CLEAR_FILES });
      this.uploadedFiles = [];
    },

    async getFiles() {
      return new Promise((resolve) => {
        if (!this.isInitialized) return resolve([]);

        this.pendingFilesCallback = resolve;
        this.sendMessage({ type: MESSAGE_TYPES.GET_FILES });

        setTimeout(() => {
          if (this.pendingFilesCallback) {
            this.pendingFilesCallback([]);
            this.pendingFilesCallback = null;
          }
        }, 1000);
      });
    },

    async uploadFile({ courseId, assignmentId, userId, fileIndex, studentIndex = 0, onProgress }) {
      return new Promise((resolve, reject) => {
        const requestId = `upload_${Date.now()}_${Math.random()}`;

        this.uploadCallbacks.set(requestId, {
          onProgress,
          onSuccess: resolve,
          onError: reject
        });

        this.sendMessage({
          type: MESSAGE_TYPES.UPLOAD_FILE,
          data: {
            courseId,
            assignmentId,
            userId,
            fileIndex,
            requestId,
            studentIndex
          }
        });

        setTimeout(() => {
          if (this.uploadCallbacks.has(requestId)) {
            this.uploadCallbacks.delete(requestId);
            reject(new Error('Upload timeout'));
          }
        }, 5 * 60 * 1000);
      });
    },

    destroy() {
      if (this._messageHandler) {
        window.removeEventListener('message', this._messageHandler);
        this._messageHandler = null;
      }
      if (this.iframe) {
        this.iframe.remove();
        this.iframe = null;
      }
      this.uploadedFiles = [];
      this.isInitialized = false;
      this.pendingFilesCallback = null;
      this.uploadCallbacks.clear();
    }
  };

  window.StudentMessageFileUploadManager = FileUploadManager;
})();
