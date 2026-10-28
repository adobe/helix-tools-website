import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import evaluatePullRequest, { claudeVerdict } from '../../.github/pr-review/policy.js';
import run from '../../.github/pr-review/run.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const CONFIG = {
  trustedContributors: ['shsteimer'],
  maxLines: 299,
  maxFiles: 10,
  maxScopes: 1,
  sourceDirs: ['tools', 'blocks'],
  testsDir: 'tests',
};

function claudeStatus(overrides = {}) {
  return {
    id: 1,
    context: 'claude-review',
    state: 'success',
    creator: { login: 'github-actions[bot]' },
    ...overrides,
  };
}

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
    ...overrides,
  };
}

function file(filename = 'tools/bulk/utils.js', overrides = {}) {
  return {
    filename, additions: 100, deletions: 99, patch: '@@ text change @@', ...overrides,
  };
}

function evaluate(pr = {}, files = [file()], status = claudeStatus(), config = CONFIG) {
  return evaluatePullRequest(pullRequest(pr), files, config, status);
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
    '.claude/skills/code-review/SKILL.md',
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
  ].forEach((overrides) => {
    it(`rejects unmet gates: ${JSON.stringify(overrides)}`, () => {
      assert.equal(evaluate(overrides).eligible, false);
    });
  });

  [
    null,
    claudeStatus({ state: 'pending' }),
    claudeStatus({ state: 'failure' }),
    claudeStatus({ state: 'error' }),
    claudeStatus({ creator: { login: 'shsteimer' } }),
    claudeStatus({ creator: undefined }),
  ].forEach((status) => {
    it(`requires a passing Claude review: ${JSON.stringify(status)}`, () => {
      const result = evaluate({}, [file()], status);
      assert.equal(result.eligible, false);
      assert.match(result.reasons.join(' '), /\/claude-review/);
    });
  });

  it('matches GitHub usernames case-insensitively', () => {
    assert.equal(evaluate({ user: { login: 'SHSTEIMER', type: 'User' } }).eligible, true);
  });

  it('limits changed files', () => {
    const files = (count) => Array.from({ length: count }, (_, i) => file(`tools/bulk/f${i}.js`, {
      additions: 1, deletions: 0,
    }));
    const pr = (count) => ({ additions: count, deletions: 0, changed_files: count });
    assert.equal(evaluate(pr(10), files(10)).eligible, true);
    assert.equal(evaluate(pr(11), files(11)).eligible, false);
  });

  it('applies config limits and scopes', () => {
    const files = [
      file(undefined, { additions: 50, deletions: 49 }),
      file('blocks/other/other.js', { additions: 50, deletions: 50 }),
    ];
    const pr = { changed_files: 2 };
    assert.equal(evaluate(pr, files).eligible, false);
    assert.equal(evaluate(pr, files, undefined, { ...CONFIG, maxScopes: 2 }).eligible, true);
    assert.equal(evaluate({}, [file()], undefined, { ...CONFIG, maxLines: 198 }).eligible, false);
    assert.equal(evaluate({}, [file()], undefined, { ...CONFIG, sourceDirs: ['blocks'] }).eligible, false);
    assert.equal(evaluate({}, [file('src/bulk/x.js')], undefined, {
      ...CONFIG, sourceDirs: ['src'],
    }).eligible, true);
  });

  it('ships a complete policy config', async () => {
    const config = JSON.parse(await readFile(new URL('../../.github/pr-review/policy-config.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(config).sort(), Object.keys(CONFIG).sort());
    assert.ok(config.trustedContributors.length);
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

describe('Claude verdict', () => {
  it('passes with no BLOCKING issues', () => {
    assert.equal(claudeVerdict('success', '{"blocking":0,"summary":"ok"}').state, 'success');
  });

  it('fails with BLOCKING issues', () => {
    assert.deepEqual(claudeVerdict('success', '{"blocking":2,"summary":"bad"}'), {
      state: 'failure', description: 'Claude found 2 BLOCKING issue(s).',
    });
  });

  [
    ['failure', '{"blocking":0}'], ['skipped', ''], ['success', ''], ['success', 'nope'],
    ['success', '{}'], ['success', '{"blocking":-1}'], ['success', '{"blocking":"0"}'],
    ['success', 'null'],
  ].forEach(([conclusion, output]) => {
    it(`errors without a valid verdict: ${conclusion} ${output}`, () => {
      assert.equal(claudeVerdict(conclusion, output).state, 'error');
    });
  });
});

function harness(pr = pullRequest(), reviews = [], latest = pr, statuses = [claudeStatus()]) {
  const calls = {
    approvals: [], dismissals: [], failures: [], notices: [], statuses: [], refs: [],
  };
  let gets = 0;
  const pulls = {
    get: async () => {
      gets += 1;
      return { data: gets === 1 ? pr : latest };
    },
    listFiles: Symbol('listFiles'),
    listReviews: Symbol('listReviews'),
    createReview: async (args) => {
      calls.approvals.push(args);
      return { data: { id: 99 } };
    },
    dismissReview: async (args) => calls.dismissals.push(args),
  };
  const repos = {
    listCommitStatusesForRef: Symbol('listCommitStatusesForRef'),
    createCommitStatus: async (args) => calls.statuses.push(args),
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
        rest: { pulls, repos },
        paginate: async (method, args) => {
          if (method === pulls.listFiles) return [file()];
          if (method === repos.listCommitStatusesForRef) {
            calls.refs.push(args.ref);
            return typeof statuses === 'function' ? statuses(calls.refs.length) : statuses;
          }
          return reviews;
        },
      },
      context: {
        repo: { owner: 'adobe', repo: 'helix-tools-website' },
        payload: { repository: { default_branch: 'main' } },
      },
      core: {
        summary,
        setFailed: (message) => calls.failures.push(message),
        notice: (message) => calls.notices.push(message),
      },
      config: CONFIG,
      pullNumber: 1,
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
    assert.deepEqual(calls.refs, [SHA, SHA]);
    assert.equal(calls.approvals.length, 1);
    assert.equal(calls.approvals[0].event, 'APPROVE');
    assert.equal(calls.approvals[0].commit_id, SHA);
    assert.equal(calls.statuses.length, 0);
  });

  it('uses the newest Claude status for the head', async () => {
    const { args, calls } = harness(pullRequest(), [], undefined, [
      { context: 'other', state: 'success' },
      claudeStatus({ state: 'failure' }),
      claudeStatus(),
    ]);
    await run(args);
    assert.equal(calls.approvals.length, 0);
  });

  it('marks an unreviewed head as pending without approving', async () => {
    const { args, calls } = harness(pullRequest(), [], undefined, []);
    await run(args);
    assert.equal(calls.approvals.length, 0);
    assert.equal(calls.statuses.length, 1);
    assert.equal(calls.statuses[0].sha, SHA);
    assert.equal(calls.statuses[0].context, 'claude-review');
    assert.equal(calls.statuses[0].state, 'pending');
  });

  it('withdraws its approval if the Claude status changed meanwhile', async () => {
    const { args, calls } = harness(pullRequest(), [], undefined, (call) => [
      call === 1 ? claudeStatus() : claudeStatus({ id: 2, state: 'pending' }),
    ]);
    await run(args);
    assert.equal(calls.approvals.length, 1);
    assert.deepEqual(calls.dismissals.map((item) => item.review_id), [99]);
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

  [{ draft: true }, { user: { login: 'other', type: 'User' } }].forEach((overrides) => {
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

  ['failure', 'pending'].forEach((state) => {
    it(`revokes approval when Claude status is ${state}`, async () => {
      const { args, calls } = harness(pullRequest(), [approval()], undefined, [
        claudeStatus({ state }),
      ]);
      await run(args);
      assert.equal(calls.dismissals.length, 1);
      assert.equal(calls.approvals.length, 0);
      assert.equal(calls.statuses.length, 0);
    });
  });

  [
    { head: { sha: OTHER_SHA } }, { draft: true },
    { state: 'closed' }, { base: { ref: 'main', sha: SHA } },
  ].forEach((overrides) => {
    it('does not act on a PR that changed during evaluation', async () => {
      const { args, calls } = harness(pullRequest(), [], pullRequest(overrides), []);
      await run(args);
      assert.equal(calls.approvals.length, 0);
      assert.equal(calls.dismissals.length, 0);
      assert.equal(calls.statuses.length, 0);
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
