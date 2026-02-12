---
name: tool-image-prompt
description: Generate Adobe Firefly image prompts for AEM tools website (tools.aem.live) tool card thumbnails. Use when creating or updating thumbnail images for tools, or when a new tool needs a card image. Triggers on requests like "create an image for the X tool", "generate a tool thumbnail", "make a Firefly prompt for this tool".
---

# Tool Image Prompt Generator

Generate Adobe Firefly prompts for tool card thumbnail images on https://tools.aem.live/. The workflow is interactive: gather context, propose visual concepts, and output a ready-to-use Firefly prompt.

Read [references/style-guide.md](references/style-guide.md) before starting — it defines the visual style, color system, abstraction spectrum, and existing tool images.

## Workflow

### Step 1: Gather Tool Context

Ask the user:
1. **Tool name** — what is it called?
2. **Category** — Production, Content, Admin, or Development tool?
3. **Function** — what does the tool do, in one sentence?
4. **Key concepts** — 2-3 core actions or ideas the tool deals with

### Step 2: Choose Abstraction Level

Ask the user where this image should fall on the abstraction spectrum:
1. **Mostly abstract** (default) — pure shapes, color, composition
2. **Stylized objects** — recognizable objects, heavily simplified
3. **Grounded + abstract** — one anchor object against abstract backdrop

### Step 3: Propose Visual Concepts

Propose 3 distinct concepts. Each should:
- Use abstract geometric forms to evoke the tool's purpose
- Be visually distinctive from existing tool images (check the reference guide)
- Specify the key shapes, composition, and color direction

Present each as a 1-2 sentence description. Ask the user to pick one or suggest a direction.

### Step 4: Generate the Firefly Prompt

Construct the prompt following this template:

```
[Geometric shapes and abstract forms describing the composition],
[focal element or central symbol], [arrangement and spatial relationships],
[category color palette] against [dark background tone],
geometric, clean, modern, abstract digital art,
subtle gradients and soft shadows for depth, bold color blocking,
no text, no typography, no letters, square composition
```

**Firefly-specific rules:**
- Declarative descriptions only, never imperative verbs ("generate", "create")
- Comma-separated descriptive phrases
- Include material/surface keywords (glossy, matte, frosted, translucent)
- Specify "no text, no typography, no letters" to prevent unwanted text
- Keep prompt under 200 words
- Set Content Type to **Art** in Firefly settings

**Recommended Firefly settings:**
- Aspect ratio: Square (1:1)
- Content type: Art
- Visual intensity: Medium-High

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
2. **Like a direction but want tweaks** — adjust the prompt (loop back to Step 4), keeping what works and changing specific elements (color, composition, focal element, mood)
3. **Want a different concept** — loop back to Step 3 with new proposals
4. **Want to change abstraction level** — loop back to Step 2

When refining, ask specifically what to change rather than starting over. Small prompt edits often produce better results than wholesale rewrites. After each revision, regenerate and review again.

Repeat until the user selects a single final image.

### Step 7: Deliver

Once the user picks a final image:
1. Rename/copy it to a clear filename (e.g. `cdn-setup.jpg`)
2. Confirm the image is ready to be uploaded to the AEM authoring environment

## Example

**Tool:** Sitemap Admin — Admin tool for managing sitemap configurations
**Abstraction:** Grounded + abstract

**Prompt:**
```
Large teal circle divided into quadrants at center, small magnifying glass icon
overlapping the circle, thin lines radiating outward from the circle to small
colorful dots and nodes, dark navy blue background with subtle gradient,
teal and cyan primary tones with white and green accent nodes,
geometric, clean, modern, abstract digital art,
flat design with subtle depth from layered translucent shapes,
no text, no typography, no letters, square composition
```
