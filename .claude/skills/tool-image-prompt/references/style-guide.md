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

Most tools on tools.aem.live have a corresponding documentation page on www.aem.live. When generating an image for a tool:
1. Check if a related page exists on www.aem.live (search `site:www.aem.live <tool concept>`)
2. Look at its hero image for visual cues — subject matter, iconography, color palette
3. Use similar visual language but adapt for the specific tool's purpose

## Color System

**Base palette:** Light, warm pastels. Soft and inviting, not saturated or dark.

**Category background palettes:**

| Category | Background Gradient | Accent Color |
|---|---|---|
| Production Tools | Peach to soft coral | Warm orange |
| Content Tools | Pink to lavender | Soft purple |
| Admin Tools | Light blue to periwinkle | Blue-violet |
| Development Tools | Lime to soft yellow-green | Fresh green |

These are starting points — the exact hue can shift to complement the subject icon.

## Subject Matter
- **Clear and recognizable** — the icon/illustration should immediately suggest what the tool does
- Simplified, stylized representations (not photorealistic)
- Common subjects: browser windows, gears, documents, folder icons, shields, charts, code brackets, network nodes
- Small floating accent icons add context (file type badges, status indicators)

## Existing Tool Images (Reference)

| Tool | Description | Legacy? |
|---|---|---|
| Admin Edit | Colorful diagonal ribbons/layers with faint code texture | Yes — old style |
| Sitemap Admin | Code symbol in teal circle with radiating node lines on dark navy | Yes — old style |
| Error Analyzer | Stylized magnifying glass over abstract 3D bar charts | Yes — old style |
| Page Status | Isometric geometric shapes with data visualization elements | Yes — old style |
| CDN Setup | Industrial pipes in a workshop setting | Yes — old style |
| Log Viewer | Magnifying glass on stacked documents | Yes — old style |

All existing images use the old dark/abstract style and should be regenerated to match this updated guide.

## Anti-Patterns
- Dark or moody backgrounds
- Overly abstract compositions where the tool's purpose isn't clear
- Busy compositions with too many competing elements
- Text or typography in the image
- Photorealistic or stock photo aesthetics
- Detailed real-world scenes (workshops, desks, rooms)
- Heavy saturation or neon colors
