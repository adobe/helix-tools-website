# AEM Tools Image Style Guide

## Dimensions
- 4:3 aspect ratio: 1600x1200 pixels
- Displayed as card thumbnails in a grid layout on https://tools.aem.live/

## Visual Style

**Core aesthetic: Match the hero image style used on [www.aem.live](https://www.aem.live) documentation pages — light, clean, approachable illustrations with a single centered subject on a soft pastel background.**

- Light pastel gradient or textured backgrounds (never dark)
- Single centered icon, symbol, or simplified illustration as the focal point
- Soft, friendly, approachable tone — not dramatic or moody
- Flat or semi-flat style with soft drop shadows for subtle depth
- Rounded corners on any UI elements or shapes
- No text or typography in the image
- Generous whitespace around the subject

### Background Styles

Each image uses one of these background treatments (choose based on what feels right for the tool):

1. **Soft gradient** — smooth pastel gradient (e.g., pink to lavender, peach to coral). See: [Push Invalidation](https://www.aem.live/docs/setup-byo-cdn-push-invalidation)
2. **Grid / graph paper** — light pastel background with a subtle grid or graph-paper line overlay. See: [Adobe Managed CDN](https://www.aem.live/docs/byo-cdn-adobe-managed), [Markup & Blocks](https://www.aem.live/developer/markup-sections-blocks)
3. **Gradient + grid hybrid** — soft gradient with a faint grid texture on top. See: [Spreadsheets](https://www.aem.live/developer/spreadsheets)

### Subject / Focal Element

- A single recognizable icon or simplified illustration centered in the frame
- Can be a stylized UI element (browser window, folder, spreadsheet) relevant to the tool
- Optional: 1-2 small floating accent badges or icons near the main subject for context (gear icon, file type badge, etc.)
- Style should match aem.live illustrations: clean lines, rounded shapes, soft shadows, slightly glossy

### Drawing Inspiration

Most tools on tools.aem.live have one or more corresponding documentation pages on www.aem.live. When generating an image for a tool:
1. Search for related pages on www.aem.live (search `site:www.aem.live <tool concept>`) — there may be multiple relevant pages
2. For each relevant page, extract the hero image URL from the `og:image` meta tag: `curl -s <url> | grep 'og:image"'`
3. Download the images and view them with the Read tool for visual cues — subject matter, iconography, color palette
4. Use similar visual language but adapt for the specific tool's purpose

## Color System

**Base palette:** Light, warm pastels. Soft and inviting, not saturated or dark.

**Color palette is determined by tool category:**

| Category | Palette | Background Gradient | Accent Color |
|---|---|---|---|
| Content | Pink / Lavender | Pink to lavender | Soft purple |
| Admin | Blue / Periwinkle | Light blue to periwinkle | Blue-violet |
| Development | Green / Lime | Lime to soft yellow-green | Fresh green |

This is a hard rule — do not ask the user to choose a palette. The exact hue can shift to complement the subject icon, but must stay within the category's palette family.

## Subject Matter
- **Clear and recognizable** — the icon/illustration should immediately suggest what the tool does
- Simplified, stylized representations (not photorealistic)
- Common subjects: browser windows, gears, documents, folder icons, shields, charts, code brackets, network nodes
- Small floating accent icons add context (file type badges, status indicators)
- 1-2 accent badges maximum — don't overcrowd the composition

### Visual Metaphor Guidelines

When proposing concepts, prefer these patterns based on what the tool does:

**UI elements as subjects** — Use browser windows, spreadsheet grids, or panels when the tool itself is a UI for viewing/editing structured content (e.g., Page Status → browser with status rows, Simple Config Editor → spreadsheet grid with gear).

**Real-world analogies** — Use concrete, recognizable objects that map clearly to the tool's function. The metaphor should be immediately understandable at thumbnail size (e.g., robots.txt Editor → traffic barrier for allow/block, HTTP Headers → envelope attached to a page for metadata, Version Admin → rewind arrow for rollback, Deep PSI Comparison → performance gauges side by side).

**Connection/structure diagrams** — Use hub-and-spoke or network layouts for tools that deal with site-wide structure or relationships between elements (e.g., Index Admin → book with radiating connections, Sitemap Admin → central hub with page nodes).

**General principles:**
- Prefer metaphors that communicate the tool's purpose at card thumbnail size
- Concrete beats abstract — a traffic barrier says "access control" faster than an abstract shield
- Consider the tool's core UX: if users interact with a spreadsheet, show a spreadsheet
- Avoid being too literal about the tool name when the function tells a better story


## Anti-Patterns
- Dark or moody backgrounds
- Overly abstract compositions where the tool's purpose isn't clear
- Busy compositions with too many competing elements
- Text or typography in the image
- Photorealistic or stock photo aesthetics
- Detailed real-world scenes (workshops, desks, rooms)
- Heavy saturation or neon colors
