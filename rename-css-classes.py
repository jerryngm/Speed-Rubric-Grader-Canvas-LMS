import re

# Read the CSS file
with open('src/modal/modal.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Class name mapping (old -> new)
class_mapping = {
    'btn-primary': 'rgm-btn-primary',
    'btn-secondary': 'rgm-btn-secondary',
    'toggle-label': 'rgm-toggle-label',
    'toggle-slider': 'rgm-toggle-slider',
    'filter-btn': 'rgm-filter-btn',
    'filter-btn-text': 'rgm-filter-btn-text',
    'filter-count': 'rgm-filter-count',
    'filter-chevron': 'rgm-filter-chevron',
    'section-item': 'rgm-section-item',
    'section-checkbox': 'rgm-section-checkbox',
    'section-checkmark': 'rgm-section-checkmark',
    'section-name': 'rgm-section-name',
    'comment-input': 'rgm-comment-input',
    'grade-btn': 'rgm-grade-btn',
    'minus-btn': 'rgm-minus-btn',
    'plus-btn': 'rgm-plus-btn',
    'expand-comment-btn': 'rgm-expand-comment-btn',
    'collapse-comment-btn': 'rgm-collapse-comment-btn'
}

# Replace each class name
# Use word boundaries to avoid partial matches
for old_class, new_class in class_mapping.items():
    # Match .classname (with optional space or other CSS selector characters after)
    pattern = r'\.' + re.escape(old_class) + r'\b'
    replacement = '.' + new_class
    css = re.sub(pattern, replacement, css)

# Write back
with open('src/modal/modal.css', 'w', encoding='utf-8') as f:
    f.write(css)

print(f"Renamed {len(class_mapping)} class names")
print("CSS class renaming completed!")
