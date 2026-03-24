# Content Score

Content Score is a browser tool that audits authoring quality on the current page. It runs when the Sidekick loads and shows a badge (score and error/warning counts) and a tray of issues and selecting an issue highlights the relevant element(s) on the page. The tool checks alt text, heading order, link text, table structure, list-like paragraphs, block sprawl, and related issues.

## Embedding in your project

Load `init` from `https://tools.aem.live/tools/content-score/src/scripts.js` (see the snippet on the Content Score tool page).

## Workflow

1. **Init** – When Sidekick is ready, load the tool CSS and call `init()` in `tools/content-score/src/scripts.js`.
2. **Load config** – Categories and rules from `src/config.json`.
3. **Run detectors** – Per category, against the DOM. If any enabled category needs the authored markup, `analyzeContent()` fetches **one** `.plain.html` for the current URL (see `getPlainHtmlPath()` / `fetchPlainDom()`), parses it, and passes `plainDom` into each detector as the third argument `(doc, config, plainDom)`. Output is raw issue objects.
4. **assignIssueOutcome()** – Sets error or warning per issue when a rule has thresholds.
5. **normalizeDetailsToCanonical()** – Converts raw issues to one shared shape.
6. **calculateScore()** – Produces `good`, `needs-improvement`, or `poor`. Result is `{ score, details, config }`.
7. **Render** – Badge and tray from that result. 
  - The badge expands briefly to show counts, then collapses. 
  - The tray lists issues by section and sort mode.

### File Structure

```
tools/content-score/src/
  ├── config.json     Categories and rules (selectors, messages, thresholds)
  ├── scripts.js      Detectors, normalization, score, badge; DETECTORS map
  ├── styles.css      Badge styles
  ├── utils.js        Shared copy and helpers
  └── tray/
      ├── tray.css    Tray layout and issue list styles
      ├── tray.html   Tray shell (loaded at runtime)
      └── tray.js     `<content-score-tray>`: sections, sort, highlight-on-click
```

## Extending

### Adding a category

1. Add an entry to `categories` in `src/config.json` (id, heading).
2. Add a detector to the `DETECTORS` map in `src/scripts.js`, keyed by `categoryIdToDetailsKey(category.id)`. The function signature is `(doc, config, plainDom)`.
  - Use `plainDom` only if the check needs `.plain.html` (otherwise ignore it).
  - If the category needs `.plain.html`, add its details key to the `needsPlainDom` check in `analyzeContent()` so the plain document is fetched when that category is enabled.
3. The tray will show a section for it automatically.

### Adding a rule

1. Add the rule to `rules` in `src/config.json` (id, category, target, messages, thresholds).
2. Implement the check:
   - For “query selector, maybe one issue per node” rules: use `runSelectorDetector(config, ruleId, doc, outcome, check)` and implement `check(element)`.
   - Otherwise: add logic in the appropriate detector in `src/scripts.js`.
3. Resolve any message placeholders (e.g. `{previousLevel}`) in code before issues reach the tray.

## Constraints

- Detector output must fit the canonical issue shape (normalized by `buildCanonicalIssue()`).
- The tray only renders that shape; do not add tray-only fields.
- Keep the tray presentation-only (no config fetch or business logic).
- Use existing terms (`category`, `recommendation`).
