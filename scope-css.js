const fs = require('fs');
const path = require('path');

// Read the CSS file
const cssPath = path.join(__dirname, 'src', 'modal', 'modal.css');
const css = fs.readFileSync(cssPath, 'utf8');

// Add CSS containment at the beginning
const containmentCSS = `/* Rubric Grader Modal Styles */

/* CSS Containment and Isolation */
#rubric-grader-modal {
  contain: layout style paint;
  isolation: isolate;
}

#rubric-grader-modal *,
#rubric-grader-modal *::before,
#rubric-grader-modal *::after {
  box-sizing: border-box !important;
}

`;

// Function to scope a selector
function scopeSelector(selector) {
  // Skip if already scoped
  if (selector.trim().startsWith('#rubric-grader-modal')) {
    return selector;
  }

  // Skip @media, @keyframes, etc.
  if (selector.trim().startsWith('@')) {
    return selector;
  }

  // Handle multiple selectors separated by commas
  const selectors = selector.split(',').map(s => s.trim());
  const scopedSelectors = selectors.map(s => {
    // Skip if it's a pseudo-element or pseudo-class only
    if (s.startsWith(':')) {
      return s;
    }

    // Add scope prefix
    return `#rubric-grader-modal ${s}`;
  });

  return scopedSelectors.join(',\n');
}

// Process CSS
const lines = css.split('\n');
let result = containmentCSS;
let inMediaQuery = false;
let mediaQueryDepth = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  // Skip the first comment line (already added)
  if (i === 0 && trimmed.startsWith('/*')) {
    continue;
  }

  // Track media queries
  if (trimmed.startsWith('@media')) {
    inMediaQuery = true;
    mediaQueryDepth = 0;
    result += line + '\n';
    continue;
  }

  if (inMediaQuery) {
    result += line + '\n';
    if (trimmed.includes('{')) mediaQueryDepth++;
    if (trimmed.includes('}')) {
      mediaQueryDepth--;
      if (mediaQueryDepth === 0) inMediaQuery = false;
    }
    continue;
  }

  // Check if this line contains a selector (ends with {)
  if (trimmed.endsWith('{') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
    const selector = trimmed.slice(0, -1).trim();
    const scopedSelector = scopeSelector(selector);
    const indent = line.match(/^\s*/)[0];
    result += `${indent}${scopedSelector} {\n`;
  } else {
    result += line + '\n';
  }
}

// Write the scoped CSS
fs.writeFileSync(cssPath, result, 'utf8');
console.log('CSS scoping completed!');
console.log(`Processed ${lines.length} lines`);
