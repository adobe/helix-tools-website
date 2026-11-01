# PR review automation

Auto-approves small PRs from trusted contributors once Claude finds no BLOCKING issues. Everything else needs human review.

## Flow

1. The PR author or a committer comments `/claude-review` (same-repo branches only). Ignored if the current head was already reviewed or a review is running.
2. `claude-code-review.yml` runs Claude on the current head and sets commit status `claude-review`:
   - `success`: no BLOCKING issues
   - `failure`: BLOCKING issues found
   - `error`: Claude failed or returned no verdict
   - `pending`: review running, or not yet requested
3. If the PR is eligible, `github-actions[bot]` approves it. CI and other merge rules still apply.
4. Check `auto-approval` shows the outcome: `success` (auto-approved) or `neutral` (human review required, with reasons).

New pushes or new `/claude-review` requests reset the status to pending and revoke the bot approval. `pr-review.yml` re-checks eligibility on PR events (open, push, edit, draft/ready).

Workflows run this folder's code from the default branch only, so changes here take effect after merge.

## Eligibility

All of:

- PR is open, non-draft, and targets the default branch
- Author is in `trustedContributors`
- Changes stay within the size and path limits below
- Claude found no BLOCKING issues on the head commit (newest `claude-review` status is `success`)

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

- `policy.js`: eligibility rules and Claude verdict parsing
- `run.js`: evaluates a PR, sets the pending status, approves or dismisses bot approvals, reports the `auto-approval` check
- `policy-config.json`: settings above
- Tests: `tests/github/pr-review.test.js`
