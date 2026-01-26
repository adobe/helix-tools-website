---
name: dark-mode-tools
description: Guide for implementing and testing dark mode support in the helix-tools-website project. Use when fixing dark mode issues in tools, blocks, or global styles - includes color system reference, common patterns, and testing workflow.
---
# Dark Mode Implementation for AEM Tools

## Overview
Guide for implementing and testing dark mode support in tools, blocks, and global styles for the helix-tools-website project.

## Color System

### Semantic Variables (Already Dark-Mode Aware)
Use these when possible - they automatically adapt:
- `var(--color-text)` - primary text color
- `var(--color-font-grey)` - secondary/muted text
- `var(--color-background)` - base background
- `var(--layer-elevated)` - elevated surfaces
- `var(--layer-depth-1)` - subtle depth/alternate rows
- `var(--layer-depth)` - depth/sunken areas
- `var(--layer-pasteboard)` - pasteboard background

### light-dark() Function
For custom color pairs:
```css
background: light-dark(var(--gray-50), var(--gray-800));
color: light-dark(var(--blue-900), var(--blue-400));
```

### [data-theme="dark"] Selector
For explicit dark mode overrides when `light-dark()` isn't appropriate (e.g., overriding existing rules, complex selectors):
```css
[data-theme="dark"] .element {
  background-color: var(--gray-700);
}
```

### Color Palette Reference
Grays: 25 (white) → 1000 (black)
- Light mode backgrounds: 25, 50, 75, 100
- Dark mode backgrounds: 700, 800, 900, 1000
- Light mode text: 700, 800, 900
- Dark mode text: use semantic vars or 100, 200, 300

Colors (100=lightest, 1600=darkest): blue, green, red, yellow, orange, etc.
- Light mode accents: 100-400 for backgrounds, 700-900 for text
- Dark mode accents: 1100-1400 for backgrounds, 400-600 for text

## Common Patterns

### Backgrounds
```css
/* Before */
background: white;
background: var(--gray-50);

/* After */
background: var(--color-background);
background: light-dark(var(--gray-50), var(--gray-800));
```

### Card Gradients
```css
background: linear-gradient(135deg,
  light-dark(var(--gray-25), var(--gray-800)) 0%,
  light-dark(var(--gray-50), var(--gray-900)) 100%
);
```

### Text Colors
```css
/* Before */
color: var(--gray-800);
color: var(--gray-600);

/* After */
color: var(--color-text);
color: var(--color-font-grey);
```

### Borders
```css
border: 1px solid light-dark(var(--gray-100), var(--gray-600));
```

### Focus States
```css
box-shadow: 0 0 0 3px light-dark(var(--blue-100), var(--blue-1100));
```

### Box Shadows
```css
/* Before - light gray shadow visible in light mode only */
box-shadow: 0 0 20px var(--gray-300);

/* After - darker shadow for dark mode */
[data-theme="dark"] .element {
  box-shadow: 0 0 20px var(--gray-800);
}
```

### Tools with Internal Light/Dark Mode Toggle
Some tools (like svg-doctor, mp4-doctor) have their own light/dark mode toggle for previewing content. The site-wide dark mode should only affect the initial/upload state, not the preview area:
```css
/* Only affect upload state, let tool's internal mode control preview */
[data-theme="dark"] .tool .viewbox[data-status='upload'] {
  --color-bg: #1a1a1a;
}

/* Don't override when tool has its own mode set */
/* The tool's [data-mode='light'] or [data-mode='dark'] should take precedence */
```

### Hover States
For subtle hovers in dark mode, prefer border-only changes:
```css
.element {
  background-color: light-dark(var(--gray-25), var(--gray-700));
  border: 1px solid light-dark(var(--gray-100), var(--gray-600));
  transition: border-color 0.2s ease-in-out;
}

.element:hover {
  border-color: light-dark(var(--blue-200), var(--gray-500));
}
```

### Diff/Status Colors
```css
/* Added/success */
background-color: light-dark(#e6ffec, var(--green-1200));
color: light-dark(var(--green-900), var(--green-400));

/* Removed/error */
background-color: light-dark(#ffebe9, var(--red-1200));
color: light-dark(var(--red-900), var(--red-400));

/* Changed/warning */
background-color: light-dark(#e3f2fd, var(--blue-1400));
```

### Code Blocks
```css
background: light-dark(var(--gray-100), var(--gray-700));
color: var(--color-text);
```

### Table Headers
```css
background: light-dark(var(--gray-100), var(--gray-700));
```

### Readonly Inputs
```css
background: light-dark(var(--gray-50), var(--gray-700));
color: var(--color-font-grey);
```

### Table Row Backgrounds
```css
/* Header/label column */
background-color: var(--layer-depth-1);

/* Alternating rows */
tr:nth-child(odd) td { background-color: var(--layer-elevated); }
tr:nth-child(even) td { background-color: var(--layer-depth-1); }
```

### Colored Badges/Labels
For elements with colored backgrounds that need readable text in both modes:
```css
/* Force dark text on light-colored badges */
background-color: var(--celery-400);
color: var(--gray-900);
```

## Testing Workflow

1. **Read the tool's CSS file** - Look for:
   - Hardcoded colors (`white`, `black`, `#hex`)
   - Raw gray variables (`var(--gray-*)`) without `light-dark()`
   - Light-only accent colors (`var(--blue-50)`, `var(--blue-100)`, etc.)

2. **Check the tool's JS file** - Look for inline styles with hardcoded colors:
   - Search for `style="color:` or `style="background` patterns
   - Replace raw vars like `var(--gray-600)` with semantic vars like `var(--color-font-grey)`

3. **Check the tool visually** in dark mode:
   - Toggle dark mode in browser/system
   - Look for: unreadable text, invisible elements, harsh contrast, wrong backgrounds

4. **Fix issues** using patterns above

5. **Test hover/focus states** - These often get missed

6. **Test dialogs/modals** - Often have separate styling

7. **Simulate UI states** - Inject elements via browser console to test without triggering real functionality:
   ```javascript
   // Show hidden elements
   document.querySelector('.hidden-element').classList.remove('hidden');

   // Inject a spinner
   const spinner = document.createElement('span');
   spinner.className = 'spinner';
   document.querySelector('#button').after(spinner);

   // Inject a results table
   document.querySelector('#results').innerHTML = `<table>...</table>`;
   ```

8. **Run linting**: `npm run lint`

## Files Reference
- Global styles: `styles/styles.css`
- Color definitions: `styles/colors.css`
- Tool styles: `tools/{toolname}/*.css`
- Block styles: `blocks/{blockname}/*.css` (some tools like svg-doctor, mp4-doctor are blocks)

## Checklist File
See `DARK_MODE_CHECKLIST.md` in project root for progress tracking.
