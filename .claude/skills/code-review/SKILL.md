---
name: Code Review
description: Review code for AEM Edge Delivery Services projects. Use for self-review before committing, or to review pull requests with one-click GitHub suggestions.
---

# Code Review

Review code for AEM Edge Delivery Services (EDS) projects.

## Modes

### Mode 1: Self-Review (Local Development)

Use before committing to catch issues early.

**Invoke:** `/code-review` (no PR number)

**Process:**
```bash
git status        # See modified files
git diff          # See changes
git diff --staged # See staged changes
```

**Output:** Report issues directly so the developer can fix them before committing.

**Optional - Capture screenshots** for visual validation:
```bash
cd .claude/skills/code-review/scripts
npm install
node capture-screenshots.js https://{branch}--helix-tools-website--adobe.aem.page/{path}
```

---

### Mode 2: PR Review (Automated or Manual)

Use to review an existing pull request.

**Invoke:** `/code-review <PR-number>` or automatically via GitHub Actions

See **Output Format → PR Review Mode** below for the full process.

---

## Review Criteria

**PR Structure (PR mode only):**
- Preview URL: `https://{branch}--helix-tools-website--adobe.aem.page/{path}` or `https://{branch}--helix-tools-website--adobe.aem.live/{path}` (both `.aem.page` and `.aem.live` are accepted)
- Clear description of what changed and why

**JavaScript:**
- Linting passes (ESLint airbnb-base)
- No `eslint-disable` without justification
- No CSS in JavaScript (use CSS classes)
- No debug console.log statements
- `aem.js` must NOT be modified

**CSS:**
- Linting passes (Stylelint)
- All selectors scoped to block: `.block-name .selector`
- No `!important` without justification
- Mobile-first with standard breakpoints (600px, 900px, 1200px)

**Security:**
- No secrets committed
- No XSS vulnerabilities (sanitize user input)

**Performance:**
- No libraries in critical path
- Consider IntersectionObserver for heavy operations

For detailed checklists, see `resources/review-checklist.md`.

## Priority Levels

- **BLOCKING:** Must fix (security, linting failures, breaking changes)
- **SHOULD FIX:** High priority (performance, accessibility, code quality)
- **CONSIDER:** Nice-to-have improvements

---

## Output Format

### Self-Review Mode

Report findings directly:

```markdown
## Code Review

### Files Reviewed
- `blocks/my-block/my-block.js`
- `blocks/my-block/my-block.css`

### Issues Found

**BLOCKING:**
- `my-block.js:45` - Remove console.log debug statement

**SHOULD FIX:**
- `my-block.css:12` - Selector `.title` needs block scoping

### Ready to Commit?
- [ ] Fix blocking issues above
- [ ] Run `npm run lint`
```

### PR Review Mode

Complete phases in order. **No write API calls until Phase 2.**

**Phase 1: Gather information**
```bash
gh pr view <PR-number> --json title,body,headRefName,files,headRefOid
gh pr diff <PR-number>
```
Read changed files for context. Complete your full analysis before proceeding.

**Phase 2: Clean up previous bot comments**

Fetch IDs first, then delete each one individually (avoid `$(...)` substitution):
```bash
gh api repos/{owner}/{repo}/pulls/<PR-number>/comments --jq '[.[] | select(.user.login == "claude[bot]") | .id] | .[]'
# For each id returned: gh api -X DELETE repos/{owner}/{repo}/pulls/comments/<id>

gh api repos/{owner}/{repo}/issues/<PR-number>/comments --jq '[.[] | select(.user.login == "claude[bot]") | .id] | .[]'
# For each id returned: gh api -X DELETE repos/{owner}/{repo}/issues/comments/<id>
```

**Phase 3: Post inline suggestions**

Post a suggestion for **every BLOCKING or SHOULD FIX issue where a concrete one-line-or-few-line fix exists**. Inline suggestions are the primary output — the summary in Phase 4 should reference them, not replace them.

Only skip a suggestion if:
- The fix spans multiple files or requires architectural changes
- The affected lines are not present in the diff (e.g. surrounding context lines only)

`position` = 1-based line number counting from the `@@` header line in the unified diff.

Write the suggestions JSON to a temp file to avoid shell escaping issues:
```bash
COMMIT_SHA=$(gh pr view <PR-number> --json headRefOid --jq '.headRefOid')
# Write JSON to /tmp/review-comments.json first, then:
gh api --method POST repos/{owner}/{repo}/pulls/<PR-number>/reviews \
  --field commit_id="$COMMIT_SHA" \
  --field event="COMMENT" \
  --field 'comments=[{"path":"FILE","position":N,"body":"**Fix:** REASON\n\n```suggestion\nCODE\n```"}]'
```

**Phase 4: Post summary comment**

Write the body to a temp file, then post (avoids shell escaping issues with multi-line content):
```bash
# Write to /tmp/review-summary.md, then:
gh pr comment <PR-number> --body-file /tmp/review-summary.md
```

Summary format:
```markdown
<!-- claude-code-review -->
## Code Review

### Issues Found
- [List by severity: BLOCKING / SHOULD FIX / CONSIDER]

### Verdict
[APPROVE / REQUEST CHANGES / COMMENT]
```
