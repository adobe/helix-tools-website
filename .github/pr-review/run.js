import evaluatePullRequest from './policy.js';

const MARKER = '<!-- ai-pr-review -->';

export default async function run({
  github, context, core, trustedContributors,
}) {
  const params = { ...context.repo, pull_number: context.payload.pull_request.number };
  const { data: pr } = await github.rest.pulls.get(params);
  const files = await github.paginate(github.rest.pulls.listFiles, { ...params, per_page: 100 });
  const result = evaluatePullRequest(pr, files, trustedContributors);
  if (pr.base.ref !== context.payload.repository.default_branch) {
    result.eligible = false;
    result.reasons.push('PR must target the default branch.');
  }
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    ...params, per_page: 100,
  });
  const { data: latest } = await github.rest.pulls.get(params);
  if (latest.head.sha !== pr.head.sha || latest.body !== pr.body
    || latest.draft !== pr.draft || latest.state !== pr.state
    || latest.base.sha !== pr.base.sha) {
    core.setFailed('PR changed during evaluation; rerun against its current state.');
    return;
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
        body: `${MARKER}\nEligible: ${result.tool}, ${result.lines} changed lines, trusted author, independent AI review attested for ${pr.head.sha}. CI and other merge requirements still apply.`,
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
