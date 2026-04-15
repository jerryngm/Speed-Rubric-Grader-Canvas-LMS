tinymce.init({
    selector: "#editor",
    plugins: [
        'autolink',
        'table',
        'link',
        'directionality',
        'lists',
        'emoticons',
        'autosave',
        'code',
        'charmap',
        'image',
        'codesample',
        'autoresize',
        'fullscreen'
      ],
    content_style: ".mce-content-body { border: none; margin: 0; padding: 10px; font-size: 16px; }",
    content_css: false,
    fullscreen_native: true,
    toolbar: [
        {
          "name": "Styles",
          "items": [
            "emoticons",
            "fontsize",
            "blocks"
          ]
        },
        {
          "name": "Formatting",
          "items": [
            "bold",
            "italic",
            "underline",
            "forecolor",
            "backcolor",
            "subscript",
            "superscript"
          ]
        },
        {
          "name": "Content",
          "items": [
            "charmap",
            "link",
            "image",
            'restoredraft'
          ]
        },
        {
          "name": "Alignment and Lists",
          "items": [
            "alignleft",
            "aligncenter",
            "alignright",
            "alignjustify",
            "bullist",
            "numlist",
            "outdent",
            "indent"
          ]
        },
        {
          "name": "Miscellaneous",
          "items": [
            "removeformat",
            "table",
            "fullscreen"
          ]
        }
      ],
    min_height: 250,
    max_height: 800,
    autoresize_bottom_margin: 10,
    license_key: 'gpl',
    skin: 'tinymce-5',
    init_instance_callback: function(editor) {
      // Function to calculate and report full height including all TinyMCE elements
      function reportHeight() {
        const container = editor.getContainer();
        if (container) {
          // Get the actual container height which includes toolbar, menubar, status bar, and editor
          let height = container.offsetHeight;

          // Add extra padding to ensure status bar is fully visible
          height += 10;

          window.parent.postMessage({
            type: 'EDITOR_RESIZED',
            height: height
          }, '*');
        }
      }

      // When editor resizes (autoresize plugin triggers this), notify parent
      editor.on('ResizeEditor', reportHeight);

      // Send initial height after editor loads and fully renders
      setTimeout(reportHeight, 100);

      // Send again after a longer delay to catch any late-rendering elements
      setTimeout(reportHeight, 500);
    },
    menubar: "fullscreen file edit view insert format tools table",
    valid_elements: "@[id|class|style|title|dir<ltr?rtl|lang|xml::lang|role],a[rel|rev|charset|hreflang|tabindex|accesskey|type|name|href|target|title|class|data-old-link],strong/b,em/i,strike/s,u,#p,-ol[type|compact],-ul[type|compact],-li,br,img[longdesc|usemap|src|border|alt|title|hspace|vspace|width|height|align|role|data-old-link],-sub,-sup,-blockquote[cite],-table[border=0|cellspacing|cellpadding|width|frame|rules|height|align|summary|bgcolor|background|bordercolor],-tr[rowspan|width|height|align|valign|bgcolor|background|bordercolor],tbody,thead,tfoot,#td[colspan|rowspan|width|height|align|valign|bgcolor|background|bordercolor|scope],#th[colspan|rowspan|width|height|align|valign|scope],caption,-div,-span,-code,-pre,address,-h1,-h2,-h3,-h4,-h5,-h6,hr[size|noshade],-font[face|size|color],dd,dl,dt,cite,abbr,acronym,del[datetime|cite],ins[datetime|cite],object[classid|width|height|codebase|*],param[name|value|_value],embed[type|width|height|src|*],map[name],area[shape|coords|href|alt|target],bdo,col[align|char|charoff|span|valign|width],colgroup[align|char|charoff|span|valign|width],dfn,kbd,q[cite],samp,small,tt,var,big,figure,figcaption,source[media|width|height|sizes|src|srcset|type|data-old-link],track,mark,article,aside,details,footer,header,nav,section,summary,time",
    browser_spellcheck: true,
    forced_root_block: "p",
    branding: false,
    block_formats: "Heading 2=h2; Heading 3=h3; Heading 4=h4; Preformatted=pre; Paragraph=p",
    resize: false,  // Disable resize handle - iframe manages sizing
    promotion: false,
    font_formats: "Lato Extended=Lato Extended,Helvetica Neue,Helvetica,Arial,sans-serif; Balsamiq Sans=Balsamiq Sans,Lato Extended,Helvetica Neue,Helvetica,Arial,sans-serif; Architect's Daughter=Architects Daughter,Lato Extended,Helvetica Neue,Helvetica,Arial,sans-serif; Arial=arial,helvetica,sans-serif; Arial Black=arial black,avant garde; Courier New=courier new,courier; Georgia=georgia,palatino; Tahoma=tahoma,arial,helvetica,sans-serif; Times New Roman=times new roman,times; Trebuchet MS=trebuchet ms,geneva; Verdana=verdana,geneva; Open Dyslexic=OpenDyslexic; Open Dyslexic Mono=OpenDyslexicMono, Monaco, Menlo, Consolas, Courier New, monospace;"
  });
  
  // Listen for request from parent
  window.addEventListener("message", (e) => {
    if (e.data?.type === "GET_CONTENT") {
      const content = tinymce.get("editor").getContent();

      window.parent.postMessage(
        {
          type: "TMCE_CONTENT",
          content
        },
        "*"
      );
    }

    // Handle insert content request from Comment Library
    if (e.data?.type === "INSERT_CONTENT") {
      const editor = tinymce.get("editor");
      if (editor && e.data.content) {
        // Convert newlines to Canvas paragraph format
        let content = e.data.content;

        // Replace newlines with Canvas paragraph format
        content = content.replace(/\n/g, '<p>&nbsp;</p>');

        // Insert content at cursor position
        editor.insertContent(content);

        // Focus the editor after insertion
        editor.focus();
      }
    }
  });