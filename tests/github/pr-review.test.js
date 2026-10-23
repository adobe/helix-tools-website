import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import evaluatePullRequest from '../../.github/pr-review/policy.js';
import run from '../../.github/pr-review/run.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const BODY = `- [x] Independent AI review: different model, fresh context, all findings resolved.
Authoring model: GPT-6
Review model: Claude
AI review head: ${SHA}`;

function pullRequest(overrides = {}) {
  return {
    state: 'open',
    draft: false,
    user: { login: 'shsteimer', type: 'User' },
    head: { sha: SHA },
    base: { ref: 'main', sha: OTHER_SHA },
    additions: 100,
    deletions: 99,
    changed_files: 1,
    body: BODY,
    ...overrides,
  };
}

function file(filename = 'tools/bulk/utils.js', overrides = {}) {
  return {
    filename, additions: 100, deletions: 99, patch: '@@ text change @@', ...overrides,
  };
}

function evaluate(pr = {}, files = [file()]) {
  return evaluatePullRequest(pullRequest(pr), files, ['shsteimer']);
}

describe('PR review eligibility', () => {
  it('accepts an eligible tool change', () => {
    assert.deepEqual(evaluate(), {
      eligible: true, reasons: [], lines: 199, tool: 'tools/bulk',
    });
  });

  it('accepts exactly 299 lines, but not 300', () => {
    [200, 201].forEach((additions) => {
      const result = evaluate({ additions }, [file(undefined, { additions })]);
      assert.equal(result.eligible, additions === 200);
    });
  });

  it('accepts a tool and its mirrored tests', () => {
    const files = [
      file(undefined, { additions: 50, deletions: 49 }),
      file('tests/tools/bulk/utils.test.js', { additions: 50, deletions: 50 }),
    ];
    assert.equal(evaluate({ changed_files: 2 }, files).eligible, true);
  });

  it('accepts a CMS block and its tests', () => {
    const files = [
      file('blocks/svg-doctor/svg-doctor.js', { additions: 50, deletions: 49 }),
      file('tests/blocks/svg-doctor/parser.test.js', { additions: 50, deletions: 50 }),
    ];
    assert.equal(evaluate({ changed_files: 2 }, files).eligible, true);
  });

  [
    'scripts/shared.js', '.github/workflows/pr-review.yml', 'package.json',
    'tools/bulk', 'ops/bulk/index.html', 'tests/scripts/shared.test.js',
  ].forEach((filename) => {
    it(`requires human review for ${filename}`, () => {
      assert.equal(evaluate({}, [file(filename)]).eligible, false);
    });
  });

  it('rejects multiple tools, including identical names under tools and blocks', () => {
    ['tools/other/index.html', 'blocks/bulk/bulk.js'].forEach((filename) => {
      assert.equal(evaluate({ changed_files: 2 }, [file(), file(filename)]).eligible, false);
    });
  });

  it('counts the old path of renamed files', () => {
    assert.equal(evaluate({}, [file(undefined, {
      previous_filename: 'scripts/shared.js',
    })]).eligible, false);
    assert.equal(evaluate({}, [file(undefined, {
      previous_filename: 'tools/bulk/old.js',
    })]).eligible, true);
  });

  [
    { draft: true }, { state: 'closed' },
    { user: { login: 'other', type: 'User' } },
    { user: { login: 'shsteimer', type: 'Bot' } },
    { additions: undefined }, { deletions: -1 }, { changed_files: 2 },
    { body: null }, { body: BODY.replace('[x]', '[ ]') },
    { body: BODY.replace(SHA, OTHER_SHA) },
    { body: BODY.replace('Review model: Claude', 'Review model: gpt-6') },
    { body: BODY.replace('Authoring model: GPT-6', 'Authoring model:') },
    { body: BODY.replace('Review model: Claude', 'Review model:') },
    { body: `<!-- ${BODY} -->` },
  ].forEach((overrides) => {
    it(`rejects unmet gates: ${JSON.stringify(overrides)}`, () => {
      assert.equal(evaluate(overrides).eligible, false);
    });
  });

  it('matches GitHub usernames case-insensitively', () => {
    assert.equal(evaluate({ user: { login: 'SHSTEIMER', type: 'User' } }).eligible, true);
  });

  it('accepts CRLF attestation text from GitHub', () => {
    assert.equal(evaluate({ body: BODY.replaceAll('\n', '\r\n') }).eligible, true);
  });

  it('rejects empty, incomplete, binary, and uncountable file lists', () => {
    [
      [], [file(undefined, { patch: undefined })],
      [file(undefined, { additions: 0, deletions: 0 })],
      [file(undefined, { additions: undefined })],
    ].forEach((files) => {
      assert.equal(evaluate({}, files).eligible, false);
    });
  });
});

function harness(pr = pullRequest(), reviews = [], latest = pr) {
  const calls = {
    approvals: [], dismissals: [], failures: [], notices: [],
  };
  let gets = 0;
  const pulls = {
    get: async () => {
      gets += 1;
      return { data: gets === 1 ? pr : latest };
    },
    listFiles: Symbol('listFiles'),
    listReviews: Symbol('listReviews'),
    createReview: async (args) => calls.approvals.push(args),
    dismissReview: async (args) => calls.dismissals.push(args),
  };
  const summary = {
    addHeading: () => summary,
    addRaw: () => summary,
    addList: () => summary,
    write: async () => {},
  };
  return {
    calls,
    args: {
      github: {
        rest: { pulls },
        paginate: async (method) => (method === pulls.listFiles ? [file()] : reviews),
      },
      context: {
        repo: { owner: 'adobe', repo: 'helix-tools-website' },
        payload: { pull_request: { number: 1 }, repository: { default_branch: 'main' } },
      },
      core: {
        summary,
        setFailed: (message) => calls.failures.push(message),
        notice: (message) => calls.notices.push(message),
      },
      trustedContributors: ['shsteimer'],
    },
  };
}

function approval(overrides = {}) {
  return {
    id: 1,
    user: { login: 'github-actions[bot]' },
    state: 'APPROVED',
    commit_id: SHA,
    body: '<!-- ai-pr-review -->\nEligible',
    ...overrides,
  };
}

describe('PR review approval orchestration', () => {
  it('approves only the evaluated SHA', async () => {
    const { args, calls } = harness();
    await run(args);
    assert.equal(calls.approvals.length, 1);
    assert.equal(calls.approvals[0].event, 'APPROVE');
    assert.equal(calls.approvals[0].commit_id, SHA);
  });

  it('does not duplicate a current approval', async () => {
    const { args, calls } = harness(pullRequest(), [approval()]);
    await run(args);
    assert.equal(calls.approvals.length, 0);
    assert.equal(calls.dismissals.length, 0);
  });

  it('dismisses stale automated approvals before approving', async () => {
    const { args, calls } = harness(pullRequest(), [approval({ commit_id: OTHER_SHA })]);
    await run(args);
    assert.equal(calls.dismissals.length, 1);
    assert.equal(calls.approvals.length, 1);
  });

  [{ body: '' }, { draft: true }].forEach((overrides) => {
    it('revokes approval when eligibility is withdrawn, without failing human review', async () => {
      const { args, calls } = harness(pullRequest(overrides), [
        approval(),
        approval({ id: 2, user: { login: 'human' } }),
        approval({ id: 3, body: 'Another workflow approved this.' }),
      ]);
      await run(args);
      assert.deepEqual(calls.dismissals.map((item) => item.review_id), [1]);
      assert.equal(calls.approvals.length, 0);
      assert.equal(calls.failures.length, 0);
      assert.equal(calls.notices.length, 1);
    });
  });

  [
    { head: { sha: OTHER_SHA } }, { body: '' }, { draft: true },
    { state: 'closed' }, { base: { ref: 'main', sha: SHA } },
  ].forEach((overrides) => {
    it('does not act on a PR that changed during evaluation', async () => {
      const { args, calls } = harness(pullRequest(), [], pullRequest(overrides));
      await run(args);
      assert.equal(calls.approvals.length, 0);
      assert.equal(calls.dismissals.length, 0);
      assert.equal(calls.failures.length, 1);
    });
  });

  it('revokes its approval after retargeting another branch', async () => {
    const { args, calls } = harness(
      pullRequest({ base: { ref: 'other', sha: SHA } }),
      [approval()],
    );
    await run(args);
    assert.equal(calls.approvals.length, 0);
    assert.equal(calls.dismissals.length, 1);
  });

  it('surfaces GitHub API errors', async () => {
    const { args } = harness();
    args.github.rest.pulls.createReview = async () => { throw new Error('Approval denied'); };
    await assert.rejects(run(args), /Approval denied/);
  });
});
