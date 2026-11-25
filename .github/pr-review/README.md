# PR review automation

Auto-approves small PRs from trusted contributors once the AI review approves them. Everything else needs human review.

## Flow

1. `ai-review.yml` runs the shared AI review ([adobe/helix-shared-workflows](https://github.com/adobe/helix-shared-workflows/blob/main/docs/ai-review.md)) on every push to a same-repo PR. Claude and Codex each set a commit status on the head: `review / claude` and `review / codex`, `success` when that reviewer approved, `failure` when it denied, and `error` when it left no verdict.
2. When the AI review finishes, `pr-review.yml` runs (`workflow_run`) and checks eligibility. If the PR is eligible, `github-actions[bot]` approves it. CI and other merge rules still apply.
3. Check `auto-approval` shows the outcome: `success` (auto-approved) or `neutral` (human review required, with reasons).

A new push starts a new review and revokes the bot approval, since the new head has no review statuses yet. `pr-review.yml` also re-checks eligibility on PR events (open, push, edit, draft/ready).

Workflows run this folder's code from the default branch only, so changes here take effect after merge.

## Eligibility

All of:

- PR is open, non-draft, and targets the default branch
- Author is in `trustedContributors`
- Changes stay within the size and path limits below
- Both AI reviewers approved the head commit (the newest `review / claude` and `review / codex` statuses are `success`, set by `github-actions[bot]`)

## `policy-config.json`

| Key | Description |
| --- | --- |
| `trustedContributors` | GitHub logins eligible for auto-approval (case-insensitive). |
| `maxLines` | Max additions + deletions. |
| `maxFiles` | Max changed files. |
| `maxScopes` | Max `<sourceDir>/<name>/` directories one PR may touch (e.g. `tools/bulk`). |
| `sourceDirs` | Top-level dirs whose subdirectories are eligible scopes. Changes anywhere else need human review. |
| `testsDir` | Tests dir mirroring `sourceDirs` (e.g. `tests/tools/bulk/`); counts toward the same scope. |

## Files

- `policy.js`: eligibility rules
- `run.js`: evaluates a PR, approves or dismisses bot approvals, reports the `auto-approval` check
- `policy-config.json`: settings above
- Tests: `tests/github/pr-review.test.js`
