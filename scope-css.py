import re

# Read the CSS file
with open('src/modal/modal.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Split into lines
lines = css.split('\n')

# Process each line
result_lines = []
in_media_query = False
media_depth = 0
skip_next_scope = False

for i, line in enumerate(lines):
    stripped = line.strip()

    # Skip lines that are already scoped or are special cases
    if i < 25:  # Skip the header we just added
        result_lines.append(line)
        continue

    # Track media queries
    if stripped.startswith('@media'):
        in_media_query = True
        media_depth = 0
        result_lines.append(line)
        continue

    if in_media_query:
        result_lines.append(line)
        if '{' in stripped:
            media_depth += stripped.count('{')
        if '}' in stripped:
            media_depth -= stripped.count('}')
            if media_depth <= 0:
                in_media_query = False
        continue

    # Check if line contains a selector (ends with {)
    if stripped.endswith('{') and not stripped.startswith('/*') and not stripped.startswith('*') and not stripped.startswith('@'):
        # Extract selector
        selector = stripped[:-1].strip()

        # Skip if already scoped
        if selector.startswith('#rubric-grader-modal'):
            result_lines.append(line)
            continue

        # Get indentation
        indent = line[:len(line) - len(line.lstrip())]

        # Scope the selector
        if ',' in selector:
            # Handle multiple selectors
            selectors = [s.strip() for s in selector.split(',')]
            scoped = [f'#rubric-grader-modal {s}' for s in selectors]
            result_lines.append(f"{indent}{',\\n{indent}'.join(scoped)} {{")
        else:
            result_lines.append(f"{indent}#rubric-grader-modal {selector} {{")
    else:
        result_lines.append(line)

# Write back
with open('src/modal/modal.css', 'w', encoding='utf-8') as f:
    f.write('\n'.join(result_lines))

print(f"Processed {len(lines)} lines")
print("CSS scoping completed!")
