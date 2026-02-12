---
name: tool-image-prompt
description: Generate Adobe Firefly image prompts for AEM tools website (tools.aem.live) tool card thumbnails. Use when creating or updating thumbnail images for tools, or when a new tool needs a card image. Triggers on requests like "create an image for the X tool", "generate a tool thumbnail", "make a Firefly prompt for this tool".
---

# Tool Image Prompt Generator

Generate Adobe Firefly prompts for tool card thumbnail images on https://tools.aem.live/. The workflow is interactive: gather context, propose visual concepts, and output a ready-to-use Firefly prompt.

Read [references/style-guide.md](references/style-guide.md) before starting — it defines the visual style, color system, background treatments, and reference examples from www.aem.live.

## Workflow

### Step 1: Gather Tool Context

Ask the user:
1. **Tool name** — what is it called?
2. **Category** — Production, Content, Admin, or Development tool?
3. **Function** — what does the tool do, in one sentence?
4. **Key concepts** — 2-3 core actions or ideas the tool deals with

Also: check if the tool has a corresponding page on www.aem.live (search `site:www.aem.live <tool concept>`) and look at its hero image for visual inspiration.

### Step 2: Choose Background Style

Ask the user which background treatment to use:
1. **Soft gradient** (default) — smooth pastel gradient
2. **Grid / graph paper** — light pastel with subtle grid overlay
3. **Gradient + grid hybrid** — soft gradient with faint grid texture

### Step 3: Propose Visual Concepts

Propose 3 distinct concepts. Each should:
- Feature a single clear icon or simplified illustration as the central subject
- Match the aem.live hero image aesthetic (light, clean, approachable)
- Specify the subject, any accent badges/icons, and background color direction

Present each as a 1-2 sentence description. Ask the user to pick one or suggest a direction.

### Step 4: Generate the Firefly Prompt

Construct the prompt following this template:

```
[Central icon or simplified illustration described clearly],
centered in the frame, [small accent icons or badges if any],
[background style: soft gradient / grid texture / hybrid] in [category pastel colors],
clean, modern, friendly illustration style,
soft drop shadows, rounded shapes, flat design with subtle depth,
light and airy composition, generous whitespace,
no text, no typography, no letters, 4:3 landscape composition
```

**Firefly-specific rules:**
- Declarative descriptions only, never imperative verbs ("generate", "create")
- Comma-separated descriptive phrases
- Include surface keywords where helpful (glossy, matte, frosted)
- Specify "no text, no typography, no letters" to prevent unwanted text
- Keep prompt under 200 words
- Set Content Type to **Art** in Firefly settings

**Recommended Firefly settings:**
- Aspect ratio: Landscape (4:3)
- Content type: Art
- Visual intensity: Medium

### Step 5: Generate Images

Generate 4 variations using the Firefly API:

```bash
node .claude/skills/tool-image-prompt/scripts/generate.mjs \
  --prompt "the finalized prompt" \
  --output tool-image \
  --n 4
```

This saves `tool-image-1.jpg` through `tool-image-4.jpg` in the current directory.

**Setup required:** `FIREFLY_CLIENT_ID` and `FIREFLY_CLIENT_SECRET` environment variables. If not configured, see [references/firefly-setup.md](references/firefly-setup.md) and guide the user through setup before continuing. If the user prefers to generate images manually in the Firefly web UI, present the prompt and recommended settings instead.

### Step 6: Review and Refine

Open the generated images (use the Read tool to display them) and ask the user to review.

The user may:
1. **Pick a winner** — done, move to final delivery
2. **Like a direction but want tweaks** — adjust the prompt (loop back to Step 4), keeping what works and changing specific elements (color, subject, background, mood)
3. **Want a different concept** — loop back to Step 3 with new proposals
4. **Want to change background style** — loop back to Step 2

When refining, ask specifically what to change rather than starting over. Small prompt edits often produce better results than wholesale rewrites. After each revision, regenerate and review again.

Repeat until the user selects a single final image.

### Step 7: Deliver

Once the user picks a final image:
1. Rename/copy it to a clear filename (e.g. `cdn-setup.jpg`)
2. Confirm the image is ready to be uploaded to the AEM authoring environment

## Example

**Tool:** Spreadsheets — Developer tool for working with spreadsheets and JSON
**Background:** Gradient + grid hybrid

**Prompt:**
```
Simplified browser window with spreadsheet grid inside, centered in the frame,
small Excel icon and Google Sheets icon floating nearby as accent badges,
soft purple to lavender gradient background with faint grid paper texture overlay,
clean, modern, friendly illustration style,
soft drop shadows, rounded corners on the browser window, flat design with subtle depth,
light and airy composition, generous whitespace,
no text, no typography, no letters, 4:3 landscape composition
```
