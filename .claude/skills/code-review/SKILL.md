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

**Process:**
```bash
gh pr view <PR-number> --json title,body,headRefName,files
gh pr diff <PR-number>
```

**Output:** Create GitHub suggestions for one-click fixes (see below).

---

## Review Criteria

**PR Structure (PR mode only):**
- Preview URL: `https://{branch}--helix-tools-website--adobe.aem.page/{path}`
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

**For every fixable issue, create a GitHub suggestion** for one-click acceptance:

```bash
# Get commit SHA
COMMIT_SHA=$(gh api repos/{owner}/{repo}/pulls/<PR-number> --jq '.head.sha')

# Post review with suggestions
gh api --method POST repos/{owner}/{repo}/pulls/<PR-number>/reviews \
  --input /tmp/review.json
```

**Review JSON format:**

```json
{
  "commit_id": "<commit-sha>",
  "event": "COMMENT",
  "comments": [
    {
      "path": "path/to/file.js",
      "position": 12,
      "body": "**Fix:** Remove debug statement\n\n```suggestion\n// fixed code here\n```"
    }
  ]
}
```

**IMPORTANT:** `position` is the line number in the diff output, NOT the file. Count from the start of the diff including headers.

**Then post a summary comment:**

```bash
gh pr comment <PR-number> --body "## Code Review

### Issues Found
- [List by severity]

### One-Click Fixes
GitHub Suggestions added. Go to **Files changed** → **Commit suggestion**.

### Verdict
[APPROVE / REQUEST CHANGES / COMMENT]"
```
