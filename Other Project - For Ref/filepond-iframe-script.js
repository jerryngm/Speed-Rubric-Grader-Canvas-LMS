// FilePond instance
let pond = null;
let uploadedFiles = [];
let canvasBaseUrl = ''; // Store Canvas base URL from parent
let csrfToken = ''; // Store CSRF token from parent
let uploadContext = 'comment'; // Store upload context: 'comment' or 'message'
let currentUserId = null; // Store current user ID from parent

// Message types for parent-iframe communication
const MESSAGE_TYPES = {
    INIT: 'INIT',
    GET_FILES: 'GET_FILES',
    CLEAR_FILES: 'CLEAR_FILES',
    FILES_UPDATED: 'FILES_UPDATED',
    FILES_RESPONSE: 'FILES_RESPONSE',
    ERROR: 'ERROR',
    UPLOAD_FILE: 'UPLOAD_FILE',
    UPLOAD_PROGRESS: 'UPLOAD_PROGRESS',
    UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
    UPLOAD_ERROR: 'UPLOAD_ERROR',
    SET_CONTEXT: 'SET_CONTEXT'
};

// ============================================================================
// CANVAS FILE UPLOADER (3-STEP PROCESS) - Running in iframe
// ============================================================================

const CanvasFileUploader = {
    conversationFolderId: null, // Cache the folder ID

    /**
     * Get conversation attachments folder ID
     */
    async getConversationFolderId() {
        // Return cached value if available
        if (this.conversationFolderId) {
            return this.conversationFolderId;
        }

        const path = `/api/v1/users/self/folders/by_path/conversation attachments`;
        const url = `${canvasBaseUrl}${path}`;
        const csrfToken = this.getCSRFToken();

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-CSRF-Token': csrfToken,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch conversation folder: ${response.statusText}`);
            }

            const folders = await response.json();

            // Response is an array, find the folder with name "conversation attachments"
            const conversationFolder = folders.find(folder => folder.name === 'conversation attachments');

            if (conversationFolder && conversationFolder.id) {
                this.conversationFolderId = conversationFolder.id;
                console.log('Conversation folder ID:', this.conversationFolderId);
                return this.conversationFolderId;
            } else {
                throw new Error('Conversation attachments folder not found');
            }
        } catch (error) {
            console.error('Error fetching conversation folder:', error);
            throw error;
        }
    },

    /**
     * Upload a file using Canvas's 3-step process
     */
    async uploadFile(options) {
        const { courseId, assignmentId, userId, file, requestId, studentIndex, fileIndex } = options;

        try {
            // Step 1: Notify Canvas of upload intent
            sendMessageToParent({
                type: MESSAGE_TYPES.UPLOAD_PROGRESS,
                requestId,
                studentIndex,
                fileIndex,
                step: 1,
                message: 'Preparing upload...',
                fileName: file.name
            });

            // Use different endpoint based on upload context
            const uploadInfo = await (uploadContext === 'message'
                ? this.notifyCanvasOfMessageUpload({ file })
                : this.notifyCanvasOfUpload({ courseId, assignmentId, userId, file }));

            // Step 2: Upload file data
            sendMessageToParent({
                type: MESSAGE_TYPES.UPLOAD_PROGRESS,
                requestId,
                studentIndex,
                fileIndex,
                step: 2,
                message: 'Uploading file...',
                fileName: file.name
            });

            const uploadResult = await this.uploadFileData({
                uploadUrl: uploadInfo.upload_url,
                uploadParams: uploadInfo.upload_params,
                file,
                onProgress: (progress) => {
                    sendMessageToParent({
                        type: MESSAGE_TYPES.UPLOAD_PROGRESS,
                        requestId,
                        studentIndex,
                        fileIndex,
                        step: 2,
                        message: `Uploading ${file.name}... ${Math.round(progress)}%`,
                        fileName: file.name,
                        progress
                    });
                }
            });

            // Step 3: Complete upload
            sendMessageToParent({
                type: MESSAGE_TYPES.UPLOAD_PROGRESS,
                requestId,
                studentIndex,
                fileIndex,
                step: 3,
                message: 'Finalizing upload...',
                fileName: file.name
            });

            const fileData = await this.completeUpload(uploadResult);

            // Send success message to parent
            sendMessageToParent({
                type: MESSAGE_TYPES.UPLOAD_SUCCESS,
                requestId,
                studentIndex,
                fileIndex,
                fileData,
                fileName: file.name
            });

            return fileData;
        } catch (error) {
            console.error('Canvas file upload failed:', error);

            // Send error message to parent
            sendMessageToParent({
                type: MESSAGE_TYPES.UPLOAD_ERROR,
                requestId,
                studentIndex,
                fileIndex,
                error: error.message || 'Upload failed',
                fileName: file.name
            });

            throw error;
        }
    },

    /**
     * Step 1: Notify Canvas of upload intent
     */
    async notifyCanvasOfUpload({ courseId, assignmentId, userId, file }) {
        const path = `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}/comments/files`;
        const url = `${canvasBaseUrl}${path}`; // Use full URL with Canvas domain
        const params = new URLSearchParams({
            name: file.name,
            size: file.size.toString(),
            content_type: file.type || 'application/octet-stream',
            on_duplicate: 'rename'
        });

        const csrfToken = this.getCSRFToken();

        const response = await fetch(`${url}?${params}`, {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrfToken,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `Failed to prepare upload: ${response.statusText}`);
        }

        return await response.json();
    },

    /**
     * Step 1b: Notify Canvas of message upload intent (for inbox messages)
     */
    async notifyCanvasOfMessageUpload({ file }) {
        const path = `/files/pending`;
        const url = `${canvasBaseUrl}${path}`;

        // Validate user ID is available
        if (!currentUserId) {
            throw new Error('User ID not available for message upload');
        }

        // Get conversation attachments folder ID
        const folderId = await this.getConversationFolderId();
        if (!folderId) {
            throw new Error('Conversation attachments folder ID not available');
        }

        console.log(`Uploading file for message - User: ${currentUserId}, Folder: ${folderId}`);

        const formData = new FormData();
        formData.append('attachment[intent]', 'message');
        formData.append('attachment[filename]', file.name);
        formData.append('attachment[size]', file.size.toString());
        formData.append('attachment[content_type]', file.type || 'application/octet-stream');
        formData.append('attachment[context_code]', `user_${currentUserId}`);
        formData.append('attachment[on_duplicate]', 'rename');
        formData.append('no_redirect', 'true');
        formData.append('attachment[folder_id]', folderId.toString());

        const csrfToken = this.getCSRFToken();

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrfToken
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `Failed to prepare message upload: ${response.statusText}`);
        }

        return await response.json();
    },

    /**
     * Step 2: Upload file data to provided URL
     */
    async uploadFileData({ uploadUrl, uploadParams, file, onProgress }) {
        const formData = new FormData();

        // Add all parameters from upload_params
        Object.entries(uploadParams).forEach(([key, value]) => {
            formData.append(key, value);
        });

        // Add file as last parameter
        formData.append('file', file);

        // Create XMLHttpRequest to track progress
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progress = (e.loaded / e.total) * 100;
                    onProgress?.(progress);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        status: xhr.status,
                        responseText: xhr.responseText
                    });
                } else {
                    reject(new Error(`Upload failed: ${xhr.statusText}`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'));
            });

            xhr.open('POST', uploadUrl);
            xhr.send(formData);
        });
    },

    /**
     * Step 3: Complete upload process
     */
    async completeUpload(uploadResult) {
        if (uploadResult.status >= 300 && uploadResult.status < 400) {
            // Follow redirect
            const csrfToken = this.getCSRFToken();
            const response = await fetch(uploadResult.location, {
                method: 'GET',
                headers: {
                    'X-CSRF-Token': csrfToken
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to complete upload: ${response.statusText}`);
            }

            return await response.json();
        } else if (uploadResult.status === 201) {
            // Upload is complete, parse response
            try {
                return JSON.parse(uploadResult.responseText);
            } catch (e) {
                throw new Error('Invalid response from upload completion');
            }
        } else {
            throw new Error(`Unexpected upload response: ${uploadResult.status}`);
        }
    },

    /**
     * Get CSRF token (passed from parent during initialization)
     */
    getCSRFToken() {
        // Return the CSRF token received from parent
        // (iframe can't access Canvas cookies due to different origin)
        return csrfToken;
    }
};

// Initialize FilePond when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initializeFilePond();
    
    // Listen for messages from parent window
    window.addEventListener('message', handleParentMessage);
});

function initializeFilePond() {
    const input = document.querySelector('.filepond-input');
    
    // Register image preview plugin
    FilePond.registerPlugin(FilePondPluginImagePreview);
    
    // Create FilePond instance
    pond = FilePond.create(input);
    
    if (pond) {
        console.log('FilePond initialized in iframe');
        
        // Configure FilePond settings
        pond.allowImagePreview = true;
        pond.imagePreviewMaxHeight = 256;
        pond.imagePreviewMaxWidth = 256;
        pond.imagePreviewScaleUpscale = false;
        pond.credits = false;
        pond.itemInsertLocation = 'after';
        pond.allowReorder = true;
        
        // Add event listeners
        pond.on('addfile', (error, file) => {
            if (!error) {
                uploadedFiles.push(file);
                console.log('File added in iframe:', file.filename);
                notifyParentFilesUpdated();
            }
        });
        
        pond.on('removefile', (error, file) => {
            if (!error) {
                const index = uploadedFiles.findIndex(f => f.id === file.id);
                if (index > -1) {
                    uploadedFiles.splice(index, 1);
                }
                console.log('File removed in iframe:', file.filename);
                notifyParentFilesUpdated();
            }
        });
        
        pond.on('init', () => {
            console.log('FilePond fully initialized in iframe');
            // Notify parent that FilePond is ready
            sendMessageToParent({
                type: MESSAGE_TYPES.FILES_UPDATED,
                files: uploadedFiles
            });
        });
        
        pond.on('error', (error) => {
            console.error('FilePond error in iframe:', error);
            sendMessageToParent({
                type: MESSAGE_TYPES.ERROR,
                error: error.message || 'Unknown FilePond error'
            });
        });
    } else {
        console.error('Failed to initialize FilePond in iframe');
        sendMessageToParent({
            type: MESSAGE_TYPES.ERROR,
            error: 'Failed to initialize FilePond'
        });
    }
}

function handleParentMessage(event) {
    // Verify message origin for security (in production, check against specific origin)
    // For now, we'll accept messages from any parent window

    const { type, data } = event.data;

    switch (type) {
        case MESSAGE_TYPES.INIT:
            // Initialize with configuration from parent
            if (data && data.config) {
                // Store Canvas base URL for API calls
                if (data.config.canvasBaseUrl) {
                    canvasBaseUrl = data.config.canvasBaseUrl;
                    console.log('Canvas base URL set to:', canvasBaseUrl);
                }
                // Store CSRF token from parent
                if (data.config.csrfToken) {
                    csrfToken = data.config.csrfToken;
                    console.log('CSRF token received from parent');
                }
                // Store upload context
                if (data.config.uploadContext) {
                    uploadContext = data.config.uploadContext;
                    console.log('Upload context set to:', uploadContext);
                }
                // Store user ID
                if (data.config.userId) {
                    currentUserId = data.config.userId;
                    console.log('Current user ID set to:', currentUserId);
                }
                console.log('Initializing FilePond with config:', data.config);
            }
            break;

        case MESSAGE_TYPES.SET_CONTEXT:
            // Update upload context
            if (data && data.uploadContext) {
                uploadContext = data.uploadContext;
                console.log('Upload context changed to:', uploadContext);
            }
            break;

        case MESSAGE_TYPES.GET_FILES:
            // Return current files to parent
            sendMessageToParent({
                type: MESSAGE_TYPES.FILES_RESPONSE,
                files: uploadedFiles.map(file => ({
                    id: file.id,
                    filename: file.filename,
                    name: file.filename, // Add name property for compatibility
                    fileSize: file.fileSize,
                    fileType: file.fileType
                }))
            });
            break;

        case MESSAGE_TYPES.CLEAR_FILES:
            // Clear all files
            if (pond) {
                pond.removeFiles();
            }
            uploadedFiles = [];
            notifyParentFilesUpdated();
            break;

        case MESSAGE_TYPES.UPLOAD_FILE:
            // Handle upload request from parent
            handleUploadRequest(data);
            break;
    }
}

/**
 * Handle file upload request from parent
 */
async function handleUploadRequest(data) {
    const { courseId, assignmentId, userId, fileIndex, requestId, studentIndex } = data;

    // Get the file from FilePond
    const pondFiles = pond.getFiles();

    if (fileIndex < 0 || fileIndex >= pondFiles.length) {
        sendMessageToParent({
            type: MESSAGE_TYPES.UPLOAD_ERROR,
            requestId,
            studentIndex,
            fileIndex,
            error: `File index ${fileIndex} out of range`
        });
        return;
    }

    const pondFile = pondFiles[fileIndex];
    const file = pondFile.file;

    // Upload the file using CanvasFileUploader
    try {
        // For message context, courseId/assignmentId/userId are not needed
        // For comment context, they are required
        await CanvasFileUploader.uploadFile({
            courseId,
            assignmentId,
            userId,
            file,
            requestId,
            studentIndex,
            fileIndex
        });
    } catch (error) {
        console.error('Upload failed in iframe:', error);
        // Error already sent to parent by CanvasFileUploader
    }
}

// Create a MutationObserver to watch for changes in the iframe
const resizeObserver = new MutationObserver(() => {
    resizeIframe();
});

// Start observing the document body for changes
resizeObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style']
});

function notifyParentFilesUpdated() {
    sendMessageToParent({
        type: MESSAGE_TYPES.FILES_UPDATED,
        files: uploadedFiles.map(file => ({
            id: file.id,
            filename: file.filename,
            name: file.filename, // Add name property for compatibility
            fileSize: file.fileSize,
            fileType: file.fileType
            // Note: Do NOT send file object - can't serialize through postMessage
        }))
    });
}

function sendMessageToParent(message) {
    // Send message to parent window
    if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
    }
}

// Handle iframe resize to fit content
function resizeIframe() {
    if (window.parent && window.parent !== window) {
        const height = document.body.scrollHeight;
        window.parent.postMessage({
            type: 'RESIZE_IFRAME',
            height: height
        }, '*');
    }
}