// TinyMCE iframe controller
// Adapted from reference: [`Other Project - For Ref/tinymce.js`](Other Project - For Ref/tinymce.js:1)

(function() {
  'use strict';

  function postToParent(message) {
    window.parent.postMessage(message, '*');
  }

  tinymce.init({
    selector: '#editor',
    license_key: 'gpl',
    menubar: true,
    plugins: [
      'autoresize',
      'lists',
      'link',
      'table',
      'code',
      'fullscreen',
      'preview',
      'searchreplace',
      'wordcount'
    ],
    toolbar: [
      {
        name: 'history',
        items: ['undo', 'redo']
      },
      {
        name: 'formatting',
        items: ['bold', 'italic', 'underline', 'forecolor', 'backcolor', 'removeformat']
      },
      {
        name: 'alignment',
        items: ['alignleft', 'aligncenter', 'alignright', 'alignjustify']
      },
      {
        name: 'lists',
        items: ['bullist', 'numlist', 'outdent', 'indent']
      },
      {
        name: 'insert',
        items: ['link', 'table']
      },
      {
        name: 'view',
        items: ['code', 'preview', 'fullscreen']
      }
    ],
    autoresize_bottom_margin: 14,

    init_instance_callback: function(editor) {
      const reportHeight = () => {
        try {
          const container = editor.getContainer();
          const height = container ? container.offsetHeight : null;
          if (height) {
            postToParent({ type: 'EDITOR_RESIZED', height });
          }
        } catch (_e) {
          // ignore
        }
      };

      editor.on('init', reportHeight);
      editor.on('keyup', reportHeight);
      editor.on('SetContent', reportHeight);
      editor.on('NodeChange', reportHeight);

      window.addEventListener('message', (event) => {
        const data = event.data || {};

        if (data.type === 'GET_CONTENT') {
          const content = editor.getContent();
          postToParent({ type: 'TMCE_CONTENT', content });
        }

        if (data.type === 'INSERT_CONTENT') {
          const contentToInsert = String(data.content || '');
          console.log('[StudentMessage][TinyMCE] INSERT_CONTENT', {
            length: contentToInsert.length,
            preview: contentToInsert.slice(0, 200)
          });

          // If it looks like HTML, insert as-is.
          // Otherwise, match reference behavior: convert newlines to paragraphs and escape.
          const looksLikeHtml = /<\w+[^>]*>/.test(contentToInsert);
          if (looksLikeHtml) {
            editor.insertContent(contentToInsert);
          } else if (contentToInsert.includes('\n')) {
            const html = contentToInsert
              .split('\n')
              .map((line) => (line.trim() === '' ? '<p>&nbsp;</p>' : `<p>${tinymce.util.I18n.encode(line)}</p>`))
              .join('');
            editor.insertContent(html);
          } else {
            editor.insertContent(contentToInsert);
          }

          reportHeight();
        }
      });
    }
  });
})();
