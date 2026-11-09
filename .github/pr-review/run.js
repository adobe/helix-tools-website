import evaluatePullRequest, { REVIEW_CONTEXTS } from './policy.js';

const MARKER = '<!-- ai-pr-review -->';
const CHECK_NAME = 'auto-approval';

export default async function run({
  github, context, core, config, pullNumber,
}) {
  const params = { ...context.repo, pull_number: pullNumber };
  // newest first, so find() gets each reviewer's current status
  const currentReviewStatuses = async (ref) => {
    const statuses = await github.paginate(
      github.rest.repos.listCommitStatusesForRef,
      { ...context.repo, ref, per_page: 100 },
    );
    return REVIEW_CONTEXTS.map((name) => statuses.find((status) => status.context === name));
  };
  const { data: pr } = await github.rest.pulls.get(params);
  const files = await github.paginate(github.rest.pulls.listFiles, { ...params, per_page: 100 });
  const reviewStatuses = await currentReviewStatuses(pr.head.sha);
  const result = evaluatePullRequest(pr, files, config, reviewStatuses);
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

  const dismiss = (reviewId) => github.rest.pulls.dismissReview({
    ...params,
    review_id: reviewId,
    message: 'Automated approval no longer applies. Human review or renewed eligibility required.',
  });
  const report = async (eligible, reasons) => {
    if (pr.state !== 'open') return;
    const more = reasons.length > 1 ? ` (+${reasons.length - 1} more)` : '';
    const title = eligible ? 'Auto-approved' : `Human review required: ${reasons[0]}${more}`;
    await github.rest.checks.create({
      ...context.repo,
      name: CHECK_NAME,
      head_sha: pr.head.sha,
      status: 'completed',
      conclusion: eligible ? 'success' : 'neutral',
      output: {
        title: title.length > 255 ? `${title.slice(0, 254)}…` : title,
        summary: eligible
          ? `${result.tool}: ${result.lines} changed lines, trusted author, the AI review approved. CI and other merge requirements still apply.`
          : reasons.map((reason) => `- ${reason}`).join('\n'),
      },
    });
  };
  const approvals = reviews.filter((review) => review.user.login === 'github-actions[bot]'
    && review.state === 'APPROVED' && review.body?.includes(MARKER));
  await Promise.all(approvals
    .filter((review) => !result.eligible || review.commit_id !== pr.head.sha)
    .map((review) => dismiss(review.id)));

  if (result.eligible) {
    if (!approvals.some((review) => review.commit_id === pr.head.sha)) {
      const { data: created } = await github.rest.pulls.createReview({
        ...params,
        commit_id: pr.head.sha,
        event: 'APPROVE',
        body: `${MARKER}\nEligible: ${result.tool}, ${result.lines} changed lines, trusted author, the AI review approved ${pr.head.sha}. CI and other merge requirements still apply.`,
      });
      const recheck = await currentReviewStatuses(pr.head.sha);
      if (recheck.some((status, i) => status?.id !== reviewStatuses[i].id)) {
        await dismiss(created.id);
        const reason = 'AI review status changed during approval; approval withdrawn.';
        await report(false, [reason]);
        core.notice(reason);
        await core.summary.write();
        return;
      }
    }
    await report(true, []);
    core.summary.addHeading('Eligible for automated approval')
      .addRaw(`${result.tool}: ${result.lines} added/deleted lines. Existing CI remains required.`);
  } else {
    await report(false, result.reasons);
    core.summary.addHeading('Human review required')
      .addList(result.reasons);
    core.notice(result.reasons.join(' '));
  }
  await core.summary.write();
}
