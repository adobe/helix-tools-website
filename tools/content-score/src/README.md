# Content Score

Content Score is a browser tool that audits authoring quality on the current page. It runs when the Sidekick loads and shows a badge (score and error/warning counts) and a tray of issues and selecting an issue highlights the relevant element(s) on the page. The tool checks alt text, heading order, link text, table structure, list-like paragraphs, block sprawl, and related issues.

## Workflow

1. **Init** – When Sidekick is ready, load the tool CSS and calls `init()` in `tools/content-score/scripts.js`.
2. **Load config** – Categories and rules from `config.json`.
3. **Run detectors** – Per category, against the DOM and (when needed) `.plain.html`. Output is raw issue objects.
4. **assignIssueOutcome()** – Sets error or warning per issue when a rule has thresholds.
5. **normalizeDetailsToCanonical()** – Converts raw issues to one shared shape.
6. **calculateScore()** – Produces `good`, `needs-improvement`, or `poor`. Result is `{ score, details, config }`.
7. **Render** – Badge and tray from that result. 
  - The badge expands briefly to show counts, then collapses. 
  - The tray lists issues by section and sort mode.

### File Structure

```
tools/content-score/
├── config.json      categories and rules (selectors, messages, thresholds)
├── scripts.js       detectors, normalization, score, badge; DETECTORS map
├── styles.css       badge styles
├── utils.js         shared copy and helpers
└── tray/
    ├── tray.css     tray layout and issue list styles
    ├── tray.html    tray shell (loaded at runtime)
    └── tray.js      <content-score-tray>: renders sections, sort, highlight-on-click
```

## Extending

### Adding a category

1. Add an entry to `categories` in `config.json` (id, heading).
2. Add a detector to the `DETECTORS` map in `scripts.js`, keyed by `categoryIdToDetailsKey(category.id)`.
3. The tray will show a section for it automatically.

### Adding a rule

1. Add the rule to `rules` in `config.json` (id, category, target, messages, thresholds).
2. Implement the check:
   - For “query selector, maybe one issue per node” rules: use `runSelectorDetector(config, ruleId, doc, outcome, check)` and implement `check(element)`.
   - Otherwise: add logic in the appropriate detector in `scripts.js`.
3. Resolve any message placeholders (e.g. `{previousLevel}`) in code before issues reach the tray.

## Constraints

- Detector output must fit the canonical issue shape (normalized by `buildCanonicalIssue()`).
- The tray only renders that shape; do not add tray-only fields.
- Keep the tray presentation-only (no config fetch or business logic).
- Use existing terms (`category`, `recommendation`).
