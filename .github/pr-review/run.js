import evaluatePullRequest, { STATUS_CONTEXT } from './policy.js';

const MARKER = '<!-- ai-pr-review -->';

export default async function run({
  github, context, core, trustedContributors, pullNumber,
}) {
  const params = { ...context.repo, pull_number: pullNumber };
  const { data: pr } = await github.rest.pulls.get(params);
  const files = await github.paginate(github.rest.pulls.listFiles, { ...params, per_page: 100 });
  const statuses = await github.paginate(github.rest.repos.listCommitStatusesForRef, {
    ...context.repo, ref: pr.head.sha, per_page: 100,
  });
  const claudeStatus = statuses.find((status) => status.context === STATUS_CONTEXT);
  const result = evaluatePullRequest(pr, files, trustedContributors, claudeStatus);
  if (pr.base.ref !== context.payload.repository.default_branch) {
    result.eligible = false;
    result.reasons.push('PR must target the default branch.');
  }
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    ...params, per_page: 100,
  });
  const { data: latest } = await github.rest.pulls.get(params);
  if (latest.head.sha !== pr.head.sha || latest.draft !== pr.draft
    || latest.state !== pr.state || latest.base.sha !== pr.base.sha) {
    core.setFailed('PR changed during evaluation; rerun against its current state.');
    return;
  }

  if (!claudeStatus && pr.state === 'open') {
    await github.rest.repos.createCommitStatus({
      ...context.repo,
      sha: pr.head.sha,
      context: STATUS_CONTEXT,
      state: 'pending',
      description: 'Comment /claude-review to run Claude review.',
    });
  }

  const approvals = reviews.filter((review) => review.user.login === 'github-actions[bot]'
    && review.state === 'APPROVED' && review.body?.includes(MARKER));
  await Promise.all(approvals
    .filter((review) => !result.eligible || review.commit_id !== pr.head.sha)
    .map((review) => github.rest.pulls.dismissReview({
      ...params,
      review_id: review.id,
      message: 'Automated approval no longer applies. Human review or renewed eligibility required.',
    })));

  if (result.eligible) {
    if (!approvals.some((review) => review.commit_id === pr.head.sha)) {
      await github.rest.pulls.createReview({
        ...params,
        commit_id: pr.head.sha,
        event: 'APPROVE',
        body: `${MARKER}\nEligible: ${result.tool}, ${result.lines} changed lines, trusted author, Claude review passed for ${pr.head.sha}. CI and other merge requirements still apply.`,
      });
    }
    core.summary.addHeading('Eligible for automated approval')
      .addRaw(`${result.tool}: ${result.lines} added/deleted lines. Existing CI remains required.`);
  } else {
    core.summary.addHeading('Human review required')
      .addList(result.reasons);
    core.notice(result.reasons.join(' '));
  }
  await core.summary.write();
}
