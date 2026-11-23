# AGENTS.md

tools.aem.live: administrative and development tools for AEM Edge Delivery Services. Based on aem-boilerplate; `*.aem.live` is the backend. Read an existing tool or block first. Omissions are in the repo or known.

## Avoid
- `scripts/aem.js` is vendored. Never edit.
- Markup comes from the backend. `curl localhost:3000/x.plain.html` first.
- Authors omit and add cells. Decorate defensively.
- No build step for site code; vanilla ES6+ and CSS, no frameworks.
- Keep dependencies to a minimum. Do not add one unless needed; justify it and expect a case-by-case decision. Approved packages go through `npm run vendor` into `vendor/`.
- Scope CSS to `.blockname`; `-wrapper`/`-container` are section classes. Mobile first, `(width >= Npx)` at 600/900/1200.
- `fragment/fragment.js` is the only cross-block import. Otherwise use `/scripts/` or `/utils/`.
- No auto-blocking exists here. Add `buildAutoBlocks()` only if needed.
- Always include `.js` in imports. Airbnb ESLint and Stylelint standard apply.
- Do not write tool code against a Helix 6 route that is not in `tests/fixtures/aem-admin-api-spec.json`. Do not add routes to the fake in `tests/helpers/mock-aem-api.js` to pass a test.
- Never name private H6 implementation, files or functions in code, tests, comments or docs.

## Layout
- `blocks/`: CMS blocks. Some are whole tools (`power-score`, `svg-doctor`): the block holds the code and logic, and a CMS page under `/tools/` holds the block. Inspect the page (`curl localhost:3000/tools/{name}`) to see which blocks it uses. Choose this pattern when the tool fits in a block on an authored page.
- `tools/{name}/`: standalone tools with `index.html`, `{name}.js`, `{name}.css`, served at `/tools/{name}/index.html`. They still load `scripts/aem.js` and `scripts/scripts.js` and reuse blocks (`profile`, `modal`).
- `ops/{name}/`: internal ops tools. HTML file name is flexible.
- `scripts/`, `styles/`, `utils/`, `widgets/`, `vendor/`, `tests/`.

## Commands
- `npm install`, then `npx -y @adobe/aem-cli up --no-open --forward-browser-logs` (localhost:3000: local code, previewed content).
- `npm run lint` (`lint:fix`), `npm test`, `npm run typecheck`. Run all three before a PR.
- No authored content to test against: add `.html` files under `drafts/` and pass `--html-folder drafts`.

## Admin API (Helix 6)
- `tests/fixtures/aem-admin-api-spec.json` is the only authority. Read `paths` and `components` (`schemas`, `parameters`).
- On config routes, `{path}` selects a property of the parent schema (`org`, `site`, `profile`), e.g. `headers`, `cdn`, `users`. That property's schema defines the body.
- When you discuss a route, give the full route with org/site: `GET /{org}/sites/{site}/config/headers`.
- On H6, sidekick config comes from `GET /{org}/sites/{site}/config.json?aggregated=true`. `sidekick().read()` and `sidekick().get('config.json')` in `scripts/aem-admin.js` read it through `aggregated()`.
- H5 and H6 payloads can differ for the same call (`robots.txt`: plain text on H5, `{ "txt": string }` on H6). Compare the body with the schema.
- The H5 client treats `x.json` and `x/` as one node; the spec is silent for H6. Do not assume.
- The fake validates write bodies with ajv and records `api.violations` (404 unresolvable path, 400 bad body). Tool tests assert it is empty in `afterEach`.
- Spec omissions are `SPEC GAP:` rules in the fake, written as behavior only. They are not a licence to call undocumented routes. Remove one when the spec covers it.

## Testing
- Read `TESTING.md` first. Test pure logic; extract it from DOM and fetch code when it is complex. Avoid mocks, and never mock `fetch` for code that consumes it.
- Touching a tool: add or update tests. Bug fix: add the regression test.
- `npm run typecheck` is opt-in (`// @ts-check` per file, `checkJs: false`, `noEmit`). Changing a checked API: update its JSDoc types and compile-only checks. Use `import(...)` for type-only refs. Fix mismatches; do not hide them with `any`. See `TESTING.md#incremental-javascript-type-checking`.

## Remember
- Merging `main` ships code; content publishes separately.
- Environments: `https://{branch}--helix-tools-website--adobe.aem.page/` (preview), `https://main--helix-tools-website--adobe.aem.live/` (live).
- A PR without a `https://{branch}--helix-tools-website--adobe.aem.page/{path}` link to an illustrating page is rejected. If no page exists, make a static test file and ask the human to copy it to the CMS.
- Target PageSpeed 100 on the preview URL. Keep non-critical work in `lazy-styles.css` and `delayed.js`.
- All committed files are served. Use `.hlxignore`. Never commit secrets; everything here is public client-side code.
- Accessibility: semantic HTML, heading order, alt text, WCAG 2.1 AA.
- PR review: `.github/workflows/ai-review.yml` applies `.claude/skills/code-review/SKILL.md`; `.github/pr-review/` handles auto-approval.
- Skills: `/plugin marketplace add adobe/skills`, then `aem-edge-delivery-services`. For docs, search `site:www.aem.live <terms>`.
